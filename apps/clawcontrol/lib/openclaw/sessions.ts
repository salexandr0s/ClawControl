import 'server-only'

import { execFile } from 'child_process'
import { promisify } from 'util'
import { createHash, randomUUID } from 'crypto'
import { prisma } from '../db'
import { getWsConsoleClient } from './console-client'
import {
  runCommandJson,
  getOpenClawBin,
  parseJsonFromCommandOutput,
} from '@clawcontrol/adapters-openclaw'
import { getAgentModelFromOpenClaw, upsertAgentToOpenClaw } from '@/lib/services/openclaw-config'

const execFileAsync = promisify(execFile)
const OPENCLAW_STATUS_TIMEOUT_MS = 15_000
const ACTIVE_SESSION_AGE_MS = 5 * 60 * 1000
const AGENT_OUTPUT_CAPTURE_MAX_CHARS = 12_000
const AGENT_RAW_JSON_MAX_CHARS = 48_000
const OPENAI_CODEX_OAUTH_MODEL = 'openai-codex/gpt-5.3-codex'

export interface SpawnOptions {
  agentId: string
  label: string
  task: string
  context?: Record<string, unknown>
  model?: string
  timeoutSeconds?: number
}

export interface SpawnResult {
  sessionKey: string
  sessionId: string | null
}

type DispatchMode = 'auto' | 'run' | 'agent_local'
type EffectiveDispatchMode = Exclude<DispatchMode, 'auto'>
type CommandRunResult = {
  stdout: string
  stderr: string
}
type DispatchAttemptResult = {
  sessionId: string | null
  stdout: string
  stderr: string
  parsed: unknown
}

let autoResolvedDispatchMode: EffectiveDispatchMode | null = null

function normalizeDispatchMode(value: string | undefined): DispatchMode {
  if (!value) return 'auto'
  const normalized = value.trim().toLowerCase()
  if (normalized === 'auto' || normalized === 'run' || normalized === 'agent_local') {
    return normalized
  }
  return 'auto'
}

function getConfiguredDispatchMode(): DispatchMode {
  return normalizeDispatchMode(process.env.CLAWCONTROL_OPENCLAW_DISPATCH_MODE)
}

function extractExecFailureDetails(error: unknown): string {
  if (!error || typeof error !== 'object') return ''

  const details = error as {
    stdout?: unknown
    stderr?: unknown
  }

  const stdout = typeof details.stdout === 'string' ? details.stdout.trim() : ''
  const stderr = typeof details.stderr === 'string' ? details.stderr.trim() : ''

  return [stdout, stderr].filter(Boolean).join('\n')
}

function shouldFallbackToAgentLocal(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    normalized.includes("unknown command 'run'")
    || normalized.includes('unknown command "run"')
    || normalized.includes('did you mean cron?')
    || normalized.includes('enoent')
    || normalized.includes('not found')
  )
}

function clampText(value: string, maxChars: number): string {
  const normalized = value.trim()
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, maxChars)}\n...[truncated ${normalized.length - maxChars} chars]`
}

function clampJsonForStorage(payload: unknown): string {
  const serialized = JSON.stringify(payload)
  if (serialized.length <= AGENT_RAW_JSON_MAX_CHARS) return serialized

  return JSON.stringify({
    truncated: true,
    originalLength: serialized.length,
    preview: serialized.slice(0, AGENT_RAW_JSON_MAX_CHARS),
  })
}

function makeDeterministicSessionId(label: string): string {
  const hex = createHash('sha256').update(label).digest('hex').slice(0, 32).split('')
  hex[12] = '4'
  const variantNibble = Number.parseInt(hex[16] ?? '0', 16)
  hex[16] = ((variantNibble & 0x3) | 0x8).toString(16)

  return [
    hex.slice(0, 8).join(''),
    hex.slice(8, 12).join(''),
    hex.slice(12, 16).join(''),
    hex.slice(16, 20).join(''),
    hex.slice(20, 32).join(''),
  ].join('-')
}

function buildAgentLocalMessage(task: string, context: Record<string, unknown>, sessionKey: string): string {
  const trimmedTask = task.trim()
  const payload = JSON.stringify({
    sessionKey,
    context,
  })

  if (!trimmedTask) {
    return `CLAWCONTROL_CONTEXT_JSON:${payload}`
  }

  return `${trimmedTask}\n\nCLAWCONTROL_CONTEXT_JSON:${payload}`
}

function parseRuntimeAgentIdFromLabel(label: string): string | null {
  const match = label.match(/(?:^|:)agent:([^:]+)/i)
  const runtimeAgentId = match?.[1]?.trim()
  return runtimeAgentId || null
}

function formatModelSyncWarning(message: string): string {
  return `agent_local model sync warning: ${clampText(message, 300)}`
}

function normalizeModelForOpenClaw(model: string): string {
  const trimmed = model.trim()
  if (!trimmed) return ''
  if (trimmed.includes('/')) return trimmed

  const normalized = trimmed.toLowerCase()
  if (
    normalized.startsWith('claude')
    || normalized.includes('sonnet')
    || normalized.includes('opus')
    || normalized.includes('haiku')
  ) {
    return `anthropic/${trimmed}`
  }

  if (normalized.includes('codex')) {
    return `openai-codex/${trimmed}`
  }

  if (normalized.startsWith('gpt-')) {
    return `openai/${trimmed}`
  }

  return trimmed
}

function hasOpenAiApiKeyConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim())
}

function dedupeModels(models: string[]): string[] {
  const seen = new Set<string>()
  const output: string[] = []

  for (const raw of models) {
    const value = raw.trim()
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    output.push(value)
  }

  return output
}

async function resolveAgentLocalFallbacks(
  label: string,
  normalizedPrimaryModel: string
): Promise<string[] | undefined> {
  if (hasOpenAiApiKeyConfigured()) return undefined
  if (normalizedPrimaryModel.toLowerCase().startsWith('openai-codex/')) return undefined

  const existing = await getAgentModelFromOpenClaw(label)
  const existingFallbacks = existing?.fallbacks ?? []
  const merged = dedupeModels([
    OPENAI_CODEX_OAUTH_MODEL,
    ...existingFallbacks,
  ])

  return merged.length > 0 ? merged : undefined
}

async function syncAgentLocalModel(options: SpawnOptions): Promise<string | null> {
  const model = options.model?.trim()
  if (!model) return null
  const normalizedModel = normalizeModelForOpenClaw(model)
  if (!normalizedModel) return null

  const runtimeAgentId = parseRuntimeAgentIdFromLabel(options.label) ?? options.agentId.trim()
  if (!runtimeAgentId) {
    return formatModelSyncWarning('missing runtime agent id')
  }

  let fallbacks: string[] | undefined
  try {
    fallbacks = await resolveAgentLocalFallbacks(options.label, normalizedModel)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return formatModelSyncWarning(`could not resolve fallback models: ${message}`)
  }

  try {
    const synced = await upsertAgentToOpenClaw({
      agentId: runtimeAgentId,
      runtimeAgentId,
      model: normalizedModel,
      ...(fallbacks ? { fallbacks } : {}),
    })
    if (synced.ok) return null
    return formatModelSyncWarning(synced.error ?? 'unknown sync failure')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return formatModelSyncWarning(message)
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null
  return value as Record<string, unknown>
}

function parseSessionIdFromRun(parsed: unknown): string | null {
  const root = asRecord(parsed)
  if (!root) return null

  if (typeof root.sessionId === 'string') return root.sessionId
  if (typeof root.id === 'string') return root.id

  return null
}

function parseSessionIdFromAgentLocal(parsed: unknown): string | null {
  const root = asRecord(parsed)
  if (!root) return null

  const directSessionId = root.sessionId
  if (typeof directSessionId === 'string') return directSessionId

  const meta = asRecord(root.meta)
  const metaSessionId = meta?.sessionId
  if (typeof metaSessionId === 'string') return metaSessionId

  const agentMeta = asRecord(meta?.agentMeta)
  const agentMetaSessionId = agentMeta?.sessionId
  if (typeof agentMetaSessionId === 'string') return agentMetaSessionId

  const report = asRecord(meta?.systemPromptReport)
  const reportSessionId = report?.sessionId
  if (typeof reportSessionId === 'string') return reportSessionId

  return null
}

async function runOpenClawCommand(args: string[], timeoutSeconds: number): Promise<CommandRunResult> {
  const timeoutMs = Math.max(1, timeoutSeconds) * 1000

  try {
    const res = await execFileAsync(getOpenClawBin(), args, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    })

    return {
      stdout: res.stdout ?? '',
      stderr: res.stderr ?? '',
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const details = extractExecFailureDetails(err)
    const combined = [msg, details].filter(Boolean).join('\n')
    throw new Error(combined)
  }
}

async function runDispatchWithRun(options: SpawnOptions): Promise<DispatchAttemptResult> {
  const timeoutSeconds = options.timeoutSeconds ?? 300
  const args: string[] = ['run', options.agentId, '--label', options.label, '--timeout', String(timeoutSeconds)]

  const normalizedModel = options.model ? normalizeModelForOpenClaw(options.model) : ''
  if (normalizedModel) {
    args.push('--model', normalizedModel)
  }

  args.push('--', JSON.stringify({ task: options.task, context: options.context ?? {} }))

  const command = `openclaw ${args.join(' ')}`
  const result = await runOpenClawCommand(args, timeoutSeconds)
  const parsed = parseJsonFromCommandOutput(result.stdout)
  const sessionId = parseSessionIdFromRun(parsed)

  return {
    sessionId,
    stdout: result.stdout,
    stderr: result.stderr,
    parsed: {
      command,
      mode: 'run',
      parsed,
    },
  }
}

async function runDispatchWithAgentLocal(options: SpawnOptions): Promise<DispatchAttemptResult> {
  const timeoutSeconds = options.timeoutSeconds ?? 300
  const modelSyncWarning = await syncAgentLocalModel(options)
  const deterministicSessionId = makeDeterministicSessionId(options.label)
  const message = buildAgentLocalMessage(options.task, options.context ?? {}, options.label)
  const args: string[] = [
    'agent',
    '--local',
    '--agent',
    options.agentId,
    '--session-id',
    deterministicSessionId,
    '--message',
    message,
    '--json',
    '--timeout',
    String(timeoutSeconds),
  ]

  const command = `openclaw ${args.join(' ')}`
  let result: CommandRunResult
  try {
    result = await runOpenClawCommand(args, timeoutSeconds)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    if (modelSyncWarning) {
      throw new Error(`${reason}\nmodel_sync_warning=${modelSyncWarning}`)
    }
    throw new Error(reason)
  }
  const parsed = parseJsonFromCommandOutput(result.stdout)
  const sessionId = parseSessionIdFromAgentLocal(parsed)

  if (!sessionId) {
    throw new Error(
      `openclaw agent --local did not return a sessionId\nstdout=${clampText(result.stdout, AGENT_OUTPUT_CAPTURE_MAX_CHARS)}\nstderr=${clampText(result.stderr, AGENT_OUTPUT_CAPTURE_MAX_CHARS)}${
        modelSyncWarning ? `\nmodel_sync_warning=${modelSyncWarning}` : ''
      }`
    )
  }

  return {
    sessionId,
    stdout: result.stdout,
    stderr: result.stderr,
    parsed: {
      command,
      mode: 'agent_local',
      expectedSessionId: deterministicSessionId,
      modelSyncWarning,
      parsed,
    },
  }
}

function parseExplicitLinkage(input: {
  sessionKey?: string
  flags?: string[]
  metadata?: { operationId?: string; workOrderId?: string }
}): { operationId?: string; workOrderId?: string } {
  // Highest precedence: explicit metadata
  const opMeta = input.metadata?.operationId
  const woMeta = input.metadata?.workOrderId

  // Next: flags e.g. ["op:<id>","wo:<id>"]
  const flagOp = input.flags?.find((f) => f.startsWith('op:'))?.slice(3)
  const flagWo = input.flags?.find((f) => f.startsWith('wo:'))?.slice(3)

  // Last: sessionKey label tokens (most stable across OpenClaw versions)
  // Convention: append a segment like :op:<operationId> (or :wo:<workOrderId>)
  const key = input.sessionKey ?? ''
  const opMatch = key.match(/(?:^|:)op:([a-z0-9]{10,})/i)
  const woMatch = key.match(/(?:^|:)wo:([a-z0-9]{10,})/i)

  const operationId = opMeta || flagOp || opMatch?.[1]
  const workOrderId = woMeta || flagWo || woMatch?.[1]

  return {
    ...(operationId ? { operationId } : {}),
    ...(workOrderId ? { workOrderId } : {}),
  }
}

/**
 * Spawns an OpenClaw agent session with the required session key convention.
 *
 * Convention: include `:op:<operationId>` (and optionally `:wo:<workOrderId>`) in the label.
 */
export async function spawnAgentSession(options: SpawnOptions): Promise<SpawnResult> {
  const {
    agentId,
    label,
    task,
    context,
    model,
    timeoutSeconds = 300,
  } = options

  const spawnOptions: SpawnOptions = {
    agentId,
    label,
    task,
    context,
    model,
    timeoutSeconds,
  }

  const mode = getConfiguredDispatchMode()
  let attempt: DispatchAttemptResult

  if (mode === 'run') {
    try {
      attempt = await runDispatchWithRun(spawnOptions)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`openclaw run failed: ${message}`)
    }
  } else if (mode === 'agent_local') {
    try {
      attempt = await runDispatchWithAgentLocal(spawnOptions)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`openclaw agent --local failed: ${message}`)
    }
  } else if (autoResolvedDispatchMode === 'agent_local') {
    try {
      attempt = await runDispatchWithAgentLocal(spawnOptions)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`openclaw agent --local failed: ${message}`)
    }
  } else {
    try {
      attempt = await runDispatchWithRun(spawnOptions)
      autoResolvedDispatchMode = 'run'
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!shouldFallbackToAgentLocal(message)) {
        throw new Error(`openclaw run failed: ${message}`)
      }

      autoResolvedDispatchMode = 'agent_local'
      try {
        attempt = await runDispatchWithAgentLocal(spawnOptions)
      } catch (fallbackError) {
        const fallbackMessage =
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
        throw new Error(
          `openclaw run unavailable; fallback agent_local failed.\nrun_error=${message}\nagent_local_error=${fallbackMessage}`
        )
      }
    }
  }

  const sessionId = attempt.sessionId

  if (sessionId) {
    const linkage = parseExplicitLinkage({ sessionKey: label })
    const now = new Date()
    const rawJson = clampJsonForStorage({
      spawn: {
        stdout: clampText(attempt.stdout, AGENT_OUTPUT_CAPTURE_MAX_CHARS),
        stderr: clampText(attempt.stderr, AGENT_OUTPUT_CAPTURE_MAX_CHARS),
      },
      parsed: attempt.parsed,
    })

    await prisma.agentSession.upsert({
      where: { sessionId },
      create: {
        sessionId,
        sessionKey: label,
        agentId,
        kind: 'unknown',
        model: model ?? null,
        updatedAtMs: BigInt(Date.now()),
        lastSeenAt: now,
        abortedLastRun: false,
        percentUsed: null,
        state: 'active',
        operationId: linkage.operationId ?? null,
        workOrderId: linkage.workOrderId ?? null,
        rawJson,
      },
      update: {
        sessionKey: label,
        agentId,
        model: model ?? null,
        updatedAtMs: BigInt(Date.now()),
        lastSeenAt: now,
        state: 'active',
        operationId: linkage.operationId ?? null,
        workOrderId: linkage.workOrderId ?? null,
        rawJson,
      },
    })
  }

  return {
    sessionKey: label,
    sessionId,
  }
}

/**
 * Sends a message to an existing session (session-scoped).
 */
export async function sendToSession(sessionKey: string, message: string): Promise<void> {
  const client = getWsConsoleClient()
  await client.chatSend({
    sessionKey,
    message,
    idempotencyKey: randomUUID(),
  })
}

type OpenClawStatusAll = {
  sessions?: {
    recent?: Array<{
      agentId: string
      key: string
      kind: string
      sessionId: string
      updatedAt: number
      age?: number
      abortedLastRun?: boolean
      percentUsed?: number
      model?: string
      flags?: string[]
      metadata?: {
        operationId?: string
        workOrderId?: string
      }
    }>
  }
}

function deriveState(s: { abortedLastRun?: boolean; age?: number }): string {
  if (s.abortedLastRun) return 'error'
  if (typeof s.age === 'number' && s.age < ACTIVE_SESSION_AGE_MS) return 'active'
  return 'idle'
}

/**
 * Syncs OpenClaw sessions into AgentSession telemetry.
 *
 * Telemetry only — never canonical.
 */
export async function syncAgentSessions(): Promise<{ seen: number; upserted: number }> {
  const res = await runCommandJson<OpenClawStatusAll>('status.all.json', {
    timeout: OPENCLAW_STATUS_TIMEOUT_MS,
  })
  if (res.error || !res.data) {
    throw new Error(res.error ?? 'OpenClaw status.all.json returned no data')
  }

  const recent = res.data.sessions?.recent ?? []
  let upserted = 0

  for (const s of recent) {
    if (!s?.sessionId || !s?.key || !s?.agentId) continue

    const updatedAtMs = BigInt(s.updatedAt)
    const lastSeenAt = new Date(s.updatedAt)
    const linkage = parseExplicitLinkage({ sessionKey: s.key, flags: s.flags, metadata: s.metadata })

    await prisma.agentSession.upsert({
      where: { sessionId: s.sessionId },
      create: {
        sessionId: s.sessionId,
        sessionKey: s.key,
        agentId: s.agentId,
        kind: s.kind ?? 'unknown',
        model: s.model ?? null,
        updatedAtMs,
        lastSeenAt,
        abortedLastRun: Boolean(s.abortedLastRun),
        percentUsed: typeof s.percentUsed === 'number' ? Math.floor(s.percentUsed) : null,
        state: deriveState({ abortedLastRun: s.abortedLastRun, age: s.age }),
        operationId: linkage.operationId ?? null,
        workOrderId: linkage.workOrderId ?? null,
        rawJson: JSON.stringify(s),
      },
      update: {
        sessionKey: s.key,
        agentId: s.agentId,
        kind: s.kind ?? 'unknown',
        model: s.model ?? null,
        updatedAtMs,
        lastSeenAt,
        abortedLastRun: Boolean(s.abortedLastRun),
        percentUsed: typeof s.percentUsed === 'number' ? Math.floor(s.percentUsed) : null,
        state: deriveState({ abortedLastRun: s.abortedLastRun, age: s.age }),
        operationId: linkage.operationId ?? null,
        workOrderId: linkage.workOrderId ?? null,
        rawJson: JSON.stringify(s),
      },
    })

    upserted++
  }

  return { seen: recent.length, upserted }
}
