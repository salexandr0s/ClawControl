import 'server-only'

import type { Prisma, PrismaClient } from '@prisma/client'
import { extractAgentIdFromSessionKey } from '@/lib/agent-identity'

type AgentQueryClient = Pick<PrismaClient, 'agent' | 'operation' | 'agentSession'> | Prisma.TransactionClient

interface AgentRecord {
  id: string
  name: string
  displayName: string | null
  slug: string | null
  runtimeAgentId: string | null
  kind: string
  dispatchEligible: boolean
  role: string
  station: string
  teamId: string | null
  templateId: string | null
  status: string
  sessionKey: string
  capabilities: string
  wipLimit: number
}

export interface ResolvedAgent {
  id: string
  name: string
  displayName: string
  slug: string
  runtimeAgentId: string
  kind: string
  dispatchEligible: boolean
  role: string
  station: string
  teamId: string | null
  templateId: string | null
  status: string
  sessionKey: string
  capabilities: string
  wipLimit: number
  load: number
  hasActiveSession: boolean
}

export interface AgentReference {
  id?: string | null
  name?: string | null
  slug?: string | null
  runtimeAgentId?: string | null
  sessionKey?: string | null
}

interface StageHints {
  preferredStations: string[]
  capabilityKeys: string[]
  preferredKinds: string[]
}

const ACTIVE_OPERATION_STATUSES = ['todo', 'in_progress', 'review', 'rework'] as const
const ACTIVE_SESSION_MAX_AGE_MS = 5 * 60 * 1000

const STAGE_HINTS: Record<string, StageHints> = {
  research: {
    preferredStations: ['spec'],
    capabilityKeys: ['research', 'analysis', 'investigation', 'spec'],
    preferredKinds: ['worker'],
  },
  plan: {
    preferredStations: ['spec'],
    capabilityKeys: ['plan', 'spec', 'architecture', 'design'],
    preferredKinds: ['worker', 'manager'],
  },
  plan_review: {
    preferredStations: ['qa', 'spec'],
    capabilityKeys: ['review', 'qa', 'audit', 'plan_review'],
    preferredKinds: ['worker', 'guard'],
  },
  build: {
    preferredStations: ['build'],
    capabilityKeys: ['build', 'implementation', 'code', 'dev'],
    preferredKinds: ['worker'],
  },
  build_review: {
    preferredStations: ['qa'],
    capabilityKeys: ['review', 'qa', 'audit', 'build_review'],
    preferredKinds: ['worker', 'guard'],
  },
  ui: {
    preferredStations: ['build'],
    capabilityKeys: ['ui', 'frontend', 'ux'],
    preferredKinds: ['worker'],
  },
  ui_review: {
    preferredStations: ['qa', 'build'],
    capabilityKeys: ['review', 'qa', 'a11y', 'ui_review'],
    preferredKinds: ['worker', 'guard'],
  },
  security: {
    preferredStations: ['qa', 'security'],
    capabilityKeys: ['security', 'auth', 'vulnerability'],
    preferredKinds: ['worker', 'guard'],
  },
  ops: {
    preferredStations: ['ops'],
    capabilityKeys: ['ops', 'infra', 'deploy', 'sre'],
    preferredKinds: ['worker', 'manager'],
  },
}

export function getResolverStageRefs(): string[] {
  return Object.keys(STAGE_HINTS).sort((left, right) => left.localeCompare(right))
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function parseCapabilityKeys(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
    return Object.entries(parsed as Record<string, unknown>)
      .filter(([, value]) => Boolean(value))
      .map(([key]) => normalizeText(key))
  } catch {
    return []
  }
}

function parseAssignees(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
  } catch {
    return []
  }
}

function isUnavailable(status: string): boolean {
  const normalized = normalizeText(status)
  return normalized === 'blocked' || normalized === 'error'
}

function readStageHints(stageRef: string): StageHints {
  const normalizedStage = normalizeText(stageRef)
  if (STAGE_HINTS[normalizedStage]) return STAGE_HINTS[normalizedStage]
  return {
    preferredStations: [],
    capabilityKeys: [normalizedStage],
    preferredKinds: ['worker'],
  }
}

function toResolvedAgent(agent: AgentRecord, load: number, hasActiveSession: boolean): ResolvedAgent {
  const displayName = agent.displayName?.trim() || agent.name
  const slug = agent.slug?.trim() || normalizeText(displayName).replace(/\s+/g, '-')
  const runtimeAgentId = agent.runtimeAgentId?.trim() || extractAgentIdFromSessionKey(agent.sessionKey) || slug || agent.id

  return {
    id: agent.id,
    name: agent.name,
    displayName,
    slug,
    runtimeAgentId,
    kind: agent.kind || 'worker',
    dispatchEligible: Boolean(agent.dispatchEligible),
    role: agent.role,
    station: agent.station,
    teamId: agent.teamId ?? null,
    templateId: agent.templateId ?? null,
    status: agent.status,
    sessionKey: agent.sessionKey,
    capabilities: agent.capabilities,
    wipLimit: Math.max(1, agent.wipLimit || 1),
    load,
    hasActiveSession,
  }
}

function scoreCandidate(agent: ResolvedAgent, stageRef: string): number {
  const hints = readStageHints(stageRef)
  const stage = normalizeText(stageRef)
  const station = normalizeText(agent.station)
  const kind = normalizeText(agent.kind)
  const capabilityKeys = parseCapabilityKeys(agent.capabilities ?? '{}')
  const roleTokens = normalizeText(agent.role)

  if (isUnavailable(agent.status)) return -1000

  let score = 0

  if (stage === 'security') {
    const securitySpecialist =
      station === 'security' ||
      capabilityKeys.includes('security') ||
      capabilityKeys.includes('vulnerability') ||
      capabilityKeys.includes('auth') ||
      roleTokens.includes('security')

    // Security stages must use a dedicated security specialist.
    if (!securitySpecialist) return -1000
  }

  if (hints.preferredStations.includes(station)) score += 120
  if (hints.preferredKinds.includes(kind)) score += 40
  if (capabilityKeys.some((k) => hints.capabilityKeys.includes(k))) score += 50
  if (hints.capabilityKeys.some((k) => roleTokens.includes(k))) score += 20
  if (!agent.dispatchEligible && stage !== 'manager' && stage !== 'ceo' && stage !== 'guard') score -= 120

  const headroom = Math.max(0, agent.wipLimit - agent.load)
  score += Math.min(headroom, 3) * 5
  if (agent.load >= agent.wipLimit) score -= 200
  if (agent.hasActiveSession) score -= 5

  return score
}

async function listAgents(client: AgentQueryClient): Promise<AgentRecord[]> {
  return client.agent.findMany({
    select: {
      id: true,
      name: true,
      displayName: true,
      slug: true,
      runtimeAgentId: true,
      kind: true,
      dispatchEligible: true,
      role: true,
      station: true,
      teamId: true,
      templateId: true,
      status: true,
      sessionKey: true,
      capabilities: true,
      wipLimit: true,
    },
    orderBy: [{ displayName: 'asc' }, { name: 'asc' }],
  })
}

function buildAgentTokens(agent: AgentRecord): string[] {
  const tokens = new Set<string>()
  const sessionRuntime = extractAgentIdFromSessionKey(agent.sessionKey)
  const runtime = agent.runtimeAgentId || sessionRuntime
  const values = [agent.id, agent.name, agent.displayName, agent.slug, runtime]
  for (const value of values) {
    const normalized = normalizeText(value)
    if (!normalized) continue
    tokens.add(normalized)
    tokens.add(normalized.replace(/[\s_-]+/g, ''))
  }
  return Array.from(tokens)
}

async function buildLoadState(client: AgentQueryClient, agents: AgentRecord[]): Promise<Map<string, { load: number; hasActiveSession: boolean }>> {
  const [operations, activeSessions] = await Promise.all([
    client.operation.findMany({
      where: {
        status: { in: [...ACTIVE_OPERATION_STATUSES] },
      },
      select: {
        assigneeAgentIds: true,
      },
    }),
    client.agentSession.findMany({
      where: { state: 'active' },
      select: {
        agentId: true,
        sessionKey: true,
        lastSeenAt: true,
      },
    }),
  ])

  const assigneeCountByToken = new Map<string, number>()
  for (const operation of operations) {
    for (const assignee of parseAssignees(operation.assigneeAgentIds)) {
      const token = normalizeText(assignee)
      if (!token) continue
      assigneeCountByToken.set(token, (assigneeCountByToken.get(token) ?? 0) + 1)
    }
  }

  const activeSessionTokens = new Set<string>()
  const activeCutoff = Date.now() - ACTIVE_SESSION_MAX_AGE_MS
  for (const session of activeSessions) {
    const seenAt = session.lastSeenAt?.getTime()
    if (!seenAt || seenAt < activeCutoff) continue

    const agentToken = normalizeText(session.agentId)
    if (agentToken) activeSessionTokens.add(agentToken)

    const runtimeFromSession = extractAgentIdFromSessionKey(session.sessionKey)
    if (runtimeFromSession) activeSessionTokens.add(normalizeText(runtimeFromSession))
  }

  const stateByAgentId = new Map<string, { load: number; hasActiveSession: boolean }>()
  for (const agent of agents) {
    const tokens = buildAgentTokens(agent)
    const load = tokens.reduce((max, token) => Math.max(max, assigneeCountByToken.get(token) ?? 0), 0)
    const hasActiveSession = tokens.some((token) => activeSessionTokens.has(token))

    stateByAgentId.set(agent.id, {
      load: hasActiveSession ? Math.max(load, 1) : load,
      hasActiveSession,
    })
  }

  return stateByAgentId
}

export async function resolveAgentRef(
  client: AgentQueryClient,
  ref: string | AgentReference
): Promise<ResolvedAgent | null> {
  const input: AgentReference = typeof ref === 'string'
    ? ref.startsWith('agent:')
      ? { sessionKey: ref }
      : { id: ref, slug: ref, runtimeAgentId: ref, name: ref }
    : ref

  const candidates = [input.id, input.slug, input.runtimeAgentId, input.sessionKey, input.name]
    .map((v) => v?.trim())
    .filter((v): v is string => Boolean(v))

  if (candidates.length === 0) return null

  const where: Prisma.AgentWhereInput = {
    OR: candidates.flatMap((token) => ([
      { id: token },
      { slug: token },
      { runtimeAgentId: token },
      { sessionKey: token },
      { name: token },
      { displayName: token },
    ])),
  }

  const row = await client.agent.findFirst({
    where,
    select: {
      id: true,
      name: true,
      displayName: true,
      slug: true,
      runtimeAgentId: true,
      kind: true,
      dispatchEligible: true,
      role: true,
      station: true,
      teamId: true,
      templateId: true,
      status: true,
      sessionKey: true,
      capabilities: true,
      wipLimit: true,
    },
    orderBy: [{ displayName: 'asc' }, { name: 'asc' }],
  })

  if (!row) return null

  const loadState = await buildLoadState(client, [row as AgentRecord])
  const load = loadState.get(row.id)
  return toResolvedAgent(row as AgentRecord, load?.load ?? 0, Boolean(load?.hasActiveSession))
}

export async function resolveWorkflowStageAgent(
  client: AgentQueryClient,
  stageRef: string
): Promise<ResolvedAgent | null> {
  const agents = await listAgents(client)
  if (agents.length === 0) return null

  const loadStateByAgentId = await buildLoadState(client, agents)

  const scored = agents
    .map((row) => {
      const state = loadStateByAgentId.get(row.id)
      const resolved = toResolvedAgent(row, state?.load ?? 0, Boolean(state?.hasActiveSession))
      const score = scoreCandidate(resolved, stageRef)
      return { resolved, score }
    })
    .filter((entry) => entry.score > -900)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (a.resolved.load !== b.resolved.load) return a.resolved.load - b.resolved.load
      return a.resolved.displayName.localeCompare(b.resolved.displayName)
    })

  return scored[0]?.resolved ?? null
}

export async function resolveWorkflowStageAgentId(
  client: AgentQueryClient,
  stageRef: string
): Promise<string | null> {
  const resolved = await resolveWorkflowStageAgent(client, stageRef)
  return resolved?.id ?? null
}

export async function resolveWorkflowStageAgentName(
  client: AgentQueryClient,
  stageRef: string
): Promise<string | null> {
  const resolved = await resolveWorkflowStageAgent(client, stageRef)
  return resolved?.displayName ?? null
}

export async function resolveCeoSessionKey(client: AgentQueryClient): Promise<string | null> {
  const agents = await listAgents(client)
  if (agents.length === 0) return null

  const available = agents.filter((agent) => !isUnavailable(agent.status) && agent.sessionKey.startsWith('agent:'))
  if (available.length === 0) return null

  // Hard default: if the OpenClaw "main" agent exists and is available, treat it as CEO.
  // This matches the UX expectation that users primarily interact with their main agent.
  const main = available.find((agent) => {
    const runtime = normalizeText(agent.runtimeAgentId ?? extractAgentIdFromSessionKey(agent.sessionKey))
    return runtime === 'main'
  })
  if (main) return main.sessionKey

  const scored = available
    .map((agent) => {
      const capabilities = parseCapabilityKeys(agent.capabilities)
      let score = 0

      if (normalizeText(agent.kind) === 'ceo') score += 200
      if (normalizeText(agent.station) === 'strategic') score += 80
      if (normalizeText(agent.station) === 'orchestration') score += 30
      if (capabilities.includes('can_delegate')) score += 25
      if (capabilities.includes('can_send_messages')) score += 25
      if ((agent.runtimeAgentId ?? extractAgentIdFromSessionKey(agent.sessionKey)) === 'main') score += 10

      return { agent, score }
    })
    .sort((a, b) => b.score - a.score || a.agent.id.localeCompare(b.agent.id))

  return scored[0]?.agent.sessionKey ?? null
}
