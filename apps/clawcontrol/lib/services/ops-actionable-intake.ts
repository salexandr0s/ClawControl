import 'server-only'

import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getRepos } from '@/lib/repo'
import { assertValidTeamGovernance } from '@/lib/services/team-governance'

export type OpsActionableSeverity = 'critical' | 'high' | 'medium' | 'low'
export type OpsActionability = 'actionable' | 'no_action'

export interface OpsActionableIntakePayload {
  source?: string | null
  jobId?: string | null
  jobName?: string | null
  runAtMs?: number | null
  teamId?: string | null
  opsRuntimeAgentId?: string | null
  relayKey?: string | null
  severity?: string | null
  decisionRequired?: boolean | null
  actionability?: OpsActionability | string | null
  noAction?: boolean | null
  summary?: string | null
  recommendation?: string | null
  evidenceJson?: unknown
  workOrderId?: string | null
}

export interface OpsActionableEventDigest {
  id: string
  fingerprint: string
  source: string
  jobId: string | null
  jobName: string | null
  runAtMs: number | null
  teamId: string | null
  opsRuntimeAgentId: string | null
  relayKey: string | null
  severity: OpsActionableSeverity
  decisionRequired: boolean
  summary: string
  recommendation: string
  evidence: Record<string, unknown>
  workOrderId: string | null
  relayedAt: string | null
  createdAt: string
}

export interface OpsActionableIntakeResult {
  ignored: boolean
  deduped: boolean
  created: boolean
  fingerprint: string | null
  event: OpsActionableEventDigest | null
}

export interface OpsActionablePollScope {
  teamId?: string | null
  relayKey?: string | null
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeSeverity(value: string | null | undefined): OpsActionableSeverity {
  const normalized = normalizeString(value).toLowerCase()
  if (normalized === 'critical') return 'critical'
  if (normalized === 'high') return 'high'
  if (normalized === 'low') return 'low'
  return 'medium'
}

function toPriority(severity: OpsActionableSeverity): 'P1' | 'P2' | 'P3' {
  if (severity === 'critical' || severity === 'high') return 'P1'
  if (severity === 'low') return 'P3'
  return 'P2'
}

function parseEvidence(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function normalizeScopeToken(value: unknown): string | null {
  const normalized = normalizeString(value)
  return normalized || null
}

function digestForFingerprint(input: {
  source: string
  jobId: string | null
  runAtMs: number | null
  summary: string
  scopeToken: string
}): string {
  const summaryHash = createHash('sha256')
    .update(input.summary)
    .digest('hex')
    .slice(0, 16)

  return createHash('sha256')
    .update(`${input.scopeToken}|${input.source}|${input.jobId ?? 'job:unknown'}|${input.runAtMs ?? 0}|${summaryHash}`)
    .digest('hex')
}

function shouldIgnoreEvent(input: {
  actionability: string
  noAction: boolean
  summary: string
}): boolean {
  if (input.noAction) return true
  if (input.actionability === 'no_action') return true
  const summaryToken = input.summary.trim().toUpperCase()
  return summaryToken === 'NO_ACTION' || summaryToken === 'NO_REPLY'
}

function extractRuntimeIdFromSessionKey(sessionKey: string | null | undefined): string | null {
  const normalized = normalizeString(sessionKey)
  if (!normalized.startsWith('agent:')) return null
  const runtimeId = normalized.split(':')[1]
  return runtimeId?.trim() || null
}

function parseGovernance(raw: string | null | undefined): ReturnType<typeof assertValidTeamGovernance> {
  if (!raw) return assertValidTeamGovernance(undefined, { whenUnset: 'legacy' })
  try {
    return assertValidTeamGovernance(JSON.parse(raw), { whenUnset: 'legacy' })
  } catch {
    return assertValidTeamGovernance(undefined, { whenUnset: 'legacy' })
  }
}

function asDigest(row: {
  id: string
  fingerprint: string
  source: string
  jobId: string | null
  jobName: string | null
  runAtMs: bigint | null
  teamId: string | null
  opsRuntimeAgentId: string | null
  relayKey: string | null
  severity: string
  decisionRequired: boolean
  summary: string
  recommendation: string
  evidenceJson: string
  workOrderId: string | null
  relayedAt: Date | null
  createdAt: Date
}): OpsActionableEventDigest {
  let evidence: Record<string, unknown> = {}
  try {
    evidence = parseEvidence(JSON.parse(row.evidenceJson))
  } catch {
    evidence = {}
  }

  return {
    id: row.id,
    fingerprint: row.fingerprint,
    source: row.source,
    jobId: row.jobId ?? null,
    jobName: row.jobName ?? null,
    runAtMs: row.runAtMs === null ? null : Number(row.runAtMs),
    teamId: row.teamId ?? null,
    opsRuntimeAgentId: row.opsRuntimeAgentId ?? null,
    relayKey: row.relayKey ?? null,
    severity: normalizeSeverity(row.severity),
    decisionRequired: row.decisionRequired,
    summary: row.summary,
    recommendation: row.recommendation,
    evidence,
    workOrderId: row.workOrderId ?? null,
    relayedAt: row.relayedAt ? row.relayedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  }
}

function isDuplicateFingerprintError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  if (code === 'P2002') return true
  return (
    error instanceof Prisma.PrismaClientKnownRequestError
    && error.code === 'P2002'
  )
}

async function findAgentByRuntime(runtimeAgentId: string | null): Promise<{ id: string; teamId: string | null } | null> {
  if (!runtimeAgentId) return null
  const row = await prisma.agent.findFirst({
    where: {
      OR: [
        { runtimeAgentId },
        { sessionKey: `agent:${runtimeAgentId}:${runtimeAgentId}` },
      ],
    },
    select: {
      id: true,
      teamId: true,
    },
  })
  return row ?? null
}

async function resolveTeamOpsRuntimeAgentId(teamId: string, templateId: string): Promise<string | null> {
  const row = await prisma.agent.findFirst({
    where: {
      teamId,
      templateId,
    },
    select: {
      runtimeAgentId: true,
      sessionKey: true,
    },
  })

  return normalizeString(row?.runtimeAgentId)
    || extractRuntimeIdFromSessionKey(row?.sessionKey)
    || null
}

async function resolveOpsOwnerAgentId(input: {
  teamId: string | null
  opsRuntimeAgentId: string | null
  opsTemplateId: string | null
}): Promise<string | null> {
  const fromRuntime = await findAgentByRuntime(input.opsRuntimeAgentId)
  if (fromRuntime?.id) return fromRuntime.id

  if (input.teamId && input.opsTemplateId) {
    const teamOps = await prisma.agent.findFirst({
      where: {
        teamId: input.teamId,
        templateId: input.opsTemplateId,
      },
      select: { id: true },
    })
    if (teamOps?.id) return teamOps.id
  }

  if (input.teamId) {
    const fallbackTeamOps = await prisma.agent.findFirst({
      where: {
        teamId: input.teamId,
        templateId: 'ops',
      },
      select: { id: true },
    })
    if (fallbackTeamOps?.id) return fallbackTeamOps.id
  }

  const legacyOps = await findAgentByRuntime('wf-ops')
  return legacyOps?.id ?? null
}

async function resolveScope(payload: OpsActionableIntakePayload): Promise<{
  teamId: string | null
  teamSlug: string | null
  relayKey: string | null
  opsRuntimeAgentId: string | null
  ownerAgentId: string | null
  opsTemplateId: string | null
}> {
  const explicitTeamId = normalizeScopeToken(payload.teamId)
  const explicitRelayKey = normalizeScopeToken(payload.relayKey)
  const explicitOpsRuntimeAgentId = normalizeScopeToken(payload.opsRuntimeAgentId)

  let team: {
    id: string
    slug: string
    governanceJson: string
  } | null = null

  if (explicitTeamId) {
    team = await prisma.agentTeam.findUnique({
      where: { id: explicitTeamId },
      select: {
        id: true,
        slug: true,
        governanceJson: true,
      },
    })
  }

  if (!team && explicitOpsRuntimeAgentId) {
    const linked = await findAgentByRuntime(explicitOpsRuntimeAgentId)
    if (linked?.teamId) {
      team = await prisma.agentTeam.findUnique({
        where: { id: linked.teamId },
        select: {
          id: true,
          slug: true,
          governanceJson: true,
        },
      })
    }
  }

  const governance = parseGovernance(team?.governanceJson)
  const opsTemplateId = team ? governance.ops.templateId : null
  const inferredOpsRuntimeAgentId = team
    ? await resolveTeamOpsRuntimeAgentId(team.id, governance.ops.templateId)
    : null

  const opsRuntimeAgentId = explicitOpsRuntimeAgentId
    || inferredOpsRuntimeAgentId
    || null

  const relayKey = explicitRelayKey
    || (team ? governance.ops.relayTargetSessionKey : null)

  const ownerAgentId = await resolveOpsOwnerAgentId({
    teamId: team?.id ?? null,
    opsRuntimeAgentId,
    opsTemplateId,
  })

  return {
    teamId: team?.id ?? null,
    teamSlug: team?.slug ?? null,
    relayKey,
    opsRuntimeAgentId,
    ownerAgentId,
    opsTemplateId,
  }
}

async function createWorkOrderForActionable(input: {
  source: string
  jobId: string | null
  jobName: string | null
  runAtMs: number | null
  severity: OpsActionableSeverity
  decisionRequired: boolean
  summary: string
  recommendation: string
  evidence: Record<string, unknown>
  teamId: string | null
  teamSlug: string | null
  relayKey: string | null
  ownerAgentId: string | null
}): Promise<string> {
  const repos = getRepos()
  const runAtIso = input.runAtMs ? new Date(input.runAtMs).toISOString() : null

  const tags = [
    'source:cron',
    `source:${input.source}`,
    ...(input.jobId ? [`job:${input.jobId}`] : []),
    ...(input.teamSlug ? [`team:${input.teamSlug}`] : input.teamId ? [`team:${input.teamId}`] : []),
    ...(input.relayKey ? [`relay:${input.relayKey}`] : []),
  ]

  const workOrder = await repos.workOrders.create({
    title: `[Ops][${input.severity.toUpperCase()}] ${input.summary.slice(0, 140)}`,
    goalMd: [
      '## Ops Actionable Event',
      `- Source: ${input.source}`,
      `- Team: ${input.teamSlug ?? input.teamId ?? 'unscoped'}`,
      `- Relay Key: ${input.relayKey ?? 'default'}`,
      `- Job: ${input.jobId ?? 'unknown'}${input.jobName ? ` (${input.jobName})` : ''}`,
      `- Run: ${runAtIso ?? 'unknown'}`,
      `- Severity: ${input.severity}`,
      `- Decision Required: ${input.decisionRequired ? 'yes' : 'no'}`,
      '',
      '## Summary',
      input.summary,
      '',
      '## Recommendation',
      input.recommendation,
      '',
      '## Evidence',
      '```json',
      JSON.stringify(input.evidence, null, 2),
      '```',
    ].join('\n'),
    priority: toPriority(input.severity),
    owner: input.ownerAgentId ? `agent:${input.ownerAgentId}` : 'system',
    ownerType: input.ownerAgentId ? 'agent' : 'system',
    ownerAgentId: input.ownerAgentId,
    tags,
    workflowId: 'cc_ops_change',
  })

  return workOrder.id
}

export async function ingestOpsActionableEvent(
  payload: OpsActionableIntakePayload
): Promise<OpsActionableIntakeResult> {
  const source = normalizeString(payload.source) || 'cron'
  const jobId = normalizeString(payload.jobId) || null
  const jobName = normalizeString(payload.jobName) || null
  const runAtMs = Number.isFinite(payload.runAtMs) ? Number(payload.runAtMs) : null
  const severity = normalizeSeverity(payload.severity)
  const summary = normalizeString(payload.summary)
  const recommendation = normalizeString(payload.recommendation)
  const decisionRequired = payload.decisionRequired !== false
  const actionability = normalizeString(payload.actionability).toLowerCase()
  const noAction = payload.noAction === true

  if (shouldIgnoreEvent({ actionability, noAction, summary })) {
    return {
      ignored: true,
      deduped: false,
      created: false,
      fingerprint: null,
      event: null,
    }
  }

  if (!summary || !recommendation) {
    throw new Error('Actionable payload requires non-empty summary and recommendation')
  }

  const evidence = parseEvidence(payload.evidenceJson)
  const scope = await resolveScope(payload)
  const scopeToken = `${scope.teamId ?? 'team:none'}|${scope.relayKey ?? 'relay:none'}`
  const fingerprint = digestForFingerprint({
    source,
    jobId,
    runAtMs,
    summary,
    scopeToken,
  })

  let created = false
  let row: {
    id: string
    fingerprint: string
    source: string
    jobId: string | null
    jobName: string | null
    runAtMs: bigint | null
    teamId: string | null
    opsRuntimeAgentId: string | null
    relayKey: string | null
    severity: string
    decisionRequired: boolean
    summary: string
    recommendation: string
    evidenceJson: string
    workOrderId: string | null
    relayedAt: Date | null
    createdAt: Date
  } | null = null

  try {
    row = await prisma.opsActionableEvent.create({
      data: {
        fingerprint,
        source,
        jobId,
        jobName,
        runAtMs: runAtMs === null ? null : BigInt(runAtMs),
        teamId: scope.teamId,
        opsRuntimeAgentId: scope.opsRuntimeAgentId,
        relayKey: scope.relayKey,
        severity,
        decisionRequired,
        summary,
        recommendation,
        evidenceJson: JSON.stringify(evidence),
        workOrderId: normalizeString(payload.workOrderId) || null,
      },
      select: {
        id: true,
        fingerprint: true,
        source: true,
        jobId: true,
        jobName: true,
        runAtMs: true,
        teamId: true,
        opsRuntimeAgentId: true,
        relayKey: true,
        severity: true,
        decisionRequired: true,
        summary: true,
        recommendation: true,
        evidenceJson: true,
        workOrderId: true,
        relayedAt: true,
        createdAt: true,
      },
    })
    created = true
  } catch (error) {
    if (!isDuplicateFingerprintError(error)) throw error
    const existing = await prisma.opsActionableEvent.findUnique({
      where: { fingerprint },
      select: {
        id: true,
        fingerprint: true,
        source: true,
        jobId: true,
        jobName: true,
        runAtMs: true,
        teamId: true,
        opsRuntimeAgentId: true,
        relayKey: true,
        severity: true,
        decisionRequired: true,
        summary: true,
        recommendation: true,
        evidenceJson: true,
        workOrderId: true,
        relayedAt: true,
        createdAt: true,
      },
    })
    if (!existing) {
      throw new Error('Duplicate fingerprint detected but row was not found')
    }
    return {
      ignored: false,
      deduped: true,
      created: false,
      fingerprint,
      event: asDigest(existing),
    }
  }

  if (!row) {
    throw new Error('Failed to create actionable event row')
  }

  if (!row.workOrderId) {
    const workOrderId = await createWorkOrderForActionable({
      source,
      jobId,
      jobName,
      runAtMs,
      severity,
      decisionRequired,
      summary,
      recommendation,
      evidence,
      teamId: scope.teamId,
      teamSlug: scope.teamSlug,
      relayKey: scope.relayKey,
      ownerAgentId: scope.ownerAgentId,
    })

    row = await prisma.opsActionableEvent.update({
      where: { id: row.id },
      data: { workOrderId },
      select: {
        id: true,
        fingerprint: true,
        source: true,
        jobId: true,
        jobName: true,
        runAtMs: true,
        teamId: true,
        opsRuntimeAgentId: true,
        relayKey: true,
        severity: true,
        decisionRequired: true,
        summary: true,
        recommendation: true,
        evidenceJson: true,
        workOrderId: true,
        relayedAt: true,
        createdAt: true,
      },
    })
  }

  return {
    ignored: false,
    deduped: false,
    created,
    fingerprint,
    event: asDigest(row),
  }
}

export async function pollAndRelayOpsActionable(
  maxItems = 10,
  scope: OpsActionablePollScope = {}
): Promise<{ items: OpsActionableEventDigest[] }> {
  const limit = Number.isFinite(maxItems) ? Math.max(1, Math.min(100, Math.floor(maxItems))) : 10
  const teamId = normalizeScopeToken(scope.teamId)
  const relayKey = normalizeScopeToken(scope.relayKey)

  const where = {
    relayedAt: null as null,
    ...(teamId ? { teamId } : {}),
    ...(relayKey ? { relayKey } : {}),
  }

  const items = await prisma.$transaction(async (tx) => {
    const pending = await tx.opsActionableEvent.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: {
        id: true,
        fingerprint: true,
        source: true,
        jobId: true,
        jobName: true,
        runAtMs: true,
        teamId: true,
        opsRuntimeAgentId: true,
        relayKey: true,
        severity: true,
        decisionRequired: true,
        summary: true,
        recommendation: true,
        evidenceJson: true,
        workOrderId: true,
        relayedAt: true,
        createdAt: true,
      },
    })

    if (pending.length === 0) return []

    const ids = pending.map((row) => row.id)
    const relayedAt = new Date()

    await tx.opsActionableEvent.updateMany({
      where: {
        id: { in: ids },
        relayedAt: null,
      },
      data: { relayedAt },
    })

    const delivered = await tx.opsActionableEvent.findMany({
      where: { id: { in: ids } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        fingerprint: true,
        source: true,
        jobId: true,
        jobName: true,
        runAtMs: true,
        teamId: true,
        opsRuntimeAgentId: true,
        relayKey: true,
        severity: true,
        decisionRequired: true,
        summary: true,
        recommendation: true,
        evidenceJson: true,
        workOrderId: true,
        relayedAt: true,
        createdAt: true,
      },
    })

    return delivered.map((row) => asDigest(row))
  })

  return { items }
}
