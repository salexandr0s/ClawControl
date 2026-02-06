import 'server-only'

import { execFile } from 'child_process'
import { promisify } from 'util'
import { randomUUID } from 'crypto'
import { prisma } from '../db'
import { getWsConsoleClient } from './console-client'
import { runCommandJson } from '@clawcontrol/adapters-openclaw'

const execFileAsync = promisify(execFile)
const OPENCLAW_STATUS_TIMEOUT_MS = 15_000
const ACTIVE_SESSION_AGE_MS = 5 * 60 * 1000

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
  const { agentId, label, task, context, model, timeoutSeconds = 300 } = options

  const args: string[] = ['run', agentId, '--label', label, '--timeout', String(timeoutSeconds)]

  if (model) {
    args.push('--model', model)
  }

  args.push('--', JSON.stringify({ task, context: context ?? {} }))

  let stdout = ''
  let stderr = ''

  try {
    const res = await execFileAsync('openclaw', args, {
      timeout: timeoutSeconds * 1000,
      maxBuffer: 10 * 1024 * 1024,
    })
    stdout = res.stdout ?? ''
    stderr = res.stderr ?? ''
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`openclaw run failed: ${msg}`)
  }

  let parsed: unknown = null
  let sessionId: string | null = null
  try {
    parsed = JSON.parse(stdout.trim())
    const obj = parsed as { sessionId?: unknown; id?: unknown }
    if (typeof obj.sessionId === 'string') sessionId = obj.sessionId
    else if (typeof obj.id === 'string') sessionId = obj.id
  } catch {
    // Non-JSON output is acceptable; telemetry sync can still discover sessions by label.
  }

  if (sessionId) {
    const linkage = parseExplicitLinkage({ sessionKey: label })
    const now = new Date()

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
        rawJson: JSON.stringify({
          spawn: { stdout: stdout.trim(), stderr: stderr.trim() },
          parsed,
        }),
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
        rawJson: JSON.stringify({
          spawn: { stdout: stdout.trim(), stderr: stderr.trim() },
          parsed,
        }),
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
