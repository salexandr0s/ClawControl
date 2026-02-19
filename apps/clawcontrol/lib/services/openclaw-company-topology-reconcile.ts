import 'server-only'

import { readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import yaml from 'js-yaml'
import { prisma } from '@/lib/db'
import { buildOpenClawSessionKey, inferDefaultAgentWipLimit, slugifyDisplayName } from '@/lib/agent-identity'
import { getRepos, type TeamGovernanceConfig, type TeamHierarchyConfig } from '@/lib/repo'
import { assertValidTeamHierarchy } from '@/lib/services/team-hierarchy'
import { assertValidTeamGovernance } from '@/lib/services/team-governance'
import { getResolverStageRefs } from '@/lib/services/agent-resolution'
import {
  buildTemplateBaselineCapabilities,
  companyRuntimeAgentIds,
  listCompanyTopologyEntries,
  REQUIRED_STAGE_COVERAGE,
  type CompanyTopologyEntry,
} from '@/lib/services/openclaw-company-topology-map'

type AgentRow = {
  id: string
  name: string
  displayName: string | null
  runtimeAgentId: string | null
  kind: string
  role: string
  station: string
  teamId: string | null
  templateId: string | null
  sessionKey: string
  capabilities: string
  wipLimit: number
  model: string | null
  isStale: boolean
  staleAt: Date | null
}

type TeamHealthStatus = 'healthy' | 'warning' | 'degraded' | 'unknown'

interface StarterTeamDefinition {
  id: string
  slug: string
  name: string
  description: string | null
  source: 'custom' | 'imported' | 'builtin'
  workflowIds: string[]
  templateIds: string[]
  hierarchy: TeamHierarchyConfig
  governance: TeamGovernanceConfig
  healthStatus: TeamHealthStatus
}

export interface StageCoverageResult {
  required: string[]
  resolverHints: string[]
  missingInResolver: string[]
  missingInTopology: string[]
  ok: boolean
}

export interface CompanyTopologyReconcileOptions {
  apply?: boolean
  strictStageCoverage?: boolean
}

export interface CompanyTopologyReconcileResult {
  apply: boolean
  team: {
    id: string
    created: boolean
    updated: boolean
  }
  agents: {
    created: number
    updated: number
    modelPinned: number
  }
  stageCoverage: StageCoverageResult
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of value) {
    const trimmed = asString(item)
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  out.sort((left, right) => left.localeCompare(right))
  return out
}

function toStable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => toStable(entry))
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort((left, right) => left.localeCompare(right))
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    out[key] = toStable(record[key])
  }
  return out
}

function stableStringify(value: unknown): string {
  return JSON.stringify(toStable(value))
}

function parseCapabilities(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, unknown>
  } catch {
    return {}
  }
}

function mergeCapabilities(
  existing: Record<string, unknown>,
  baseline: Record<string, boolean>
): Record<string, unknown> {
  return {
    ...existing,
    ...baseline,
  }
}

function maybeSet<T>(patch: Record<string, unknown>, key: string, current: T, desired: T): void {
  if (current === desired) return
  patch[key] = desired
}

function starterTeamCandidatePaths(): string[] {
  const rel = ['starter-packs', 'clawcontrol-starter-pack', 'input', 'teams', 'clawcontrol-team.yaml']
  const cwd = process.cwd()
  const roots = [
    cwd,
    resolve(cwd, '..'),
    resolve(cwd, '../..'),
    resolve(cwd, '../../..'),
  ]
  return roots.map((root) => join(root, ...rel))
}

async function loadStarterTeamDefinition(): Promise<StarterTeamDefinition> {
  let rawYaml: string | null = null

  for (const candidate of starterTeamCandidatePaths()) {
    try {
      rawYaml = await readFile(candidate, 'utf8')
      break
    } catch {
      continue
    }
  }

  if (!rawYaml) {
    throw new Error('Starter team definition not found (clawcontrol-team.yaml)')
  }

  const parsed = yaml.load(rawYaml)
  const record = asRecord(parsed)
  if (!record) {
    throw new Error('Starter team definition is invalid YAML')
  }

  const templateIds = normalizeIdArray(record.templateIds)
  const hierarchy = assertValidTeamHierarchy(record.hierarchy, templateIds)
  const governance = assertValidTeamGovernance(record.governance, { whenUnset: 'legacy' })

  const source = asString(record.source)
  const health = asString(record.healthStatus)

  return {
    id: asString(record.id) ?? 'clawcontrol-team',
    slug: asString(record.slug) ?? 'clawcontrol-team',
    name: asString(record.name) ?? 'ClawControl Team',
    description: asString(record.description),
    source: source === 'imported' || source === 'builtin' ? source : 'custom',
    workflowIds: normalizeIdArray(record.workflowIds),
    templateIds,
    hierarchy,
    governance,
    healthStatus: health === 'warning' || health === 'degraded' || health === 'unknown' ? health : 'healthy',
  }
}

function buildStageCoverage(): StageCoverageResult {
  const required = [...REQUIRED_STAGE_COVERAGE]
  const resolverHints = getResolverStageRefs()
  const topologyTemplates = new Set(listCompanyTopologyEntries().map((entry) => entry.templateId))

  const missingInResolver = required.filter((stageRef) => !resolverHints.includes(stageRef))
  const missingInTopology = required.filter((stageRef) => !topologyTemplates.has(stageRef))

  return {
    required,
    resolverHints,
    missingInResolver,
    missingInTopology,
    ok: missingInResolver.length === 0 && missingInTopology.length === 0,
  }
}

async function findAgentByRuntime(runtimeAgentId: string): Promise<AgentRow | null> {
  const sessionKey = buildOpenClawSessionKey(runtimeAgentId)
  return prisma.agent.findFirst({
    where: {
      OR: [
        { runtimeAgentId },
        { sessionKey },
        { slug: runtimeAgentId },
        { name: runtimeAgentId },
        { displayName: runtimeAgentId },
      ],
    },
    select: {
      id: true,
      name: true,
      displayName: true,
      runtimeAgentId: true,
      kind: true,
      role: true,
      station: true,
      teamId: true,
      templateId: true,
      sessionKey: true,
      capabilities: true,
      wipLimit: true,
      model: true,
      isStale: true,
      staleAt: true,
    },
  })
}

async function reconcileTeam(input: {
  apply: boolean
  desired: StarterTeamDefinition
}): Promise<{ id: string; created: boolean; updated: boolean }> {
  const repos = getRepos()
  const existing = await repos.agentTeams.getBySlug(input.desired.slug)

  if (!existing) {
    if (!input.apply) {
      return {
        id: input.desired.id,
        created: true,
        updated: false,
      }
    }

    const created = await repos.agentTeams.create({
      name: input.desired.name,
      slug: input.desired.slug,
      description: input.desired.description,
      source: input.desired.source,
      workflowIds: input.desired.workflowIds,
      templateIds: input.desired.templateIds,
      hierarchy: input.desired.hierarchy,
      governance: input.desired.governance,
      healthStatus: input.desired.healthStatus,
    })

    return {
      id: created.id,
      created: true,
      updated: false,
    }
  }

  const changed =
    existing.name !== input.desired.name
    || (existing.description ?? null) !== (input.desired.description ?? null)
    || stableStringify(existing.workflowIds) !== stableStringify(input.desired.workflowIds)
    || stableStringify(existing.templateIds) !== stableStringify(input.desired.templateIds)
    || stableStringify(existing.hierarchy) !== stableStringify(input.desired.hierarchy)
    || stableStringify(existing.governance) !== stableStringify(input.desired.governance)
    || existing.healthStatus !== input.desired.healthStatus

  if (changed && input.apply) {
    await repos.agentTeams.update(existing.id, {
      name: input.desired.name,
      description: input.desired.description,
      workflowIds: input.desired.workflowIds,
      templateIds: input.desired.templateIds,
      hierarchy: input.desired.hierarchy,
      governance: input.desired.governance,
      healthStatus: input.desired.healthStatus,
    })
  }

  return {
    id: existing.id,
    created: false,
    updated: changed,
  }
}

function maybeRolePatch(row: AgentRow, entry: CompanyTopologyEntry): string | null {
  if (entry.templateId === 'manager') return entry.role
  const currentRole = row.role.trim().toLowerCase()
  if (!currentRole || currentRole === 'agent' || currentRole === 'worker') {
    return entry.role
  }
  return null
}

async function reconcileMappedAgents(input: {
  apply: boolean
  teamId: string
}): Promise<{ created: number; updated: number; modelPinned: number }> {
  const repos = getRepos()
  let created = 0
  let updated = 0
  let modelPinned = 0

  for (const entry of listCompanyTopologyEntries()) {
    const existing = await findAgentByRuntime(entry.runtimeAgentId)
    const baselineCapabilities = buildTemplateBaselineCapabilities(entry)

    if (!existing) {
      created += 1
      if (!input.apply) continue

      await repos.agents.create({
        name: entry.defaultDisplayName,
        displayName: entry.defaultDisplayName,
        slug: slugifyDisplayName(entry.defaultDisplayName),
        runtimeAgentId: entry.runtimeAgentId,
        kind: entry.kind,
        dispatchEligible: true,
        nameSource: 'openclaw',
        role: entry.role,
        station: entry.station,
        teamId: input.teamId,
        templateId: entry.templateId,
        sessionKey: buildOpenClawSessionKey(entry.runtimeAgentId),
        capabilities: baselineCapabilities,
        wipLimit: inferDefaultAgentWipLimit({
          id: entry.runtimeAgentId,
          name: entry.defaultDisplayName,
          station: entry.station,
        }),
        isStale: false,
        staleAt: null,
        ...(entry.enforceModel ? { model: entry.enforceModel } : {}),
      })
      if (entry.enforceModel) modelPinned += 1
      continue
    }

    const patch: Record<string, unknown> = {}
    maybeSet(patch, 'runtimeAgentId', existing.runtimeAgentId ?? null, entry.runtimeAgentId)
    maybeSet(patch, 'station', existing.station, entry.station)
    maybeSet(patch, 'teamId', existing.teamId, input.teamId)
    maybeSet(patch, 'templateId', existing.templateId, entry.templateId)
    maybeSet(patch, 'kind', existing.kind, entry.kind)
    maybeSet(patch, 'isStale', existing.isStale, false)
    maybeSet(patch, 'staleAt', existing.staleAt, null)

    const rolePatch = maybeRolePatch(existing, entry)
    if (rolePatch) {
      maybeSet(patch, 'role', existing.role, rolePatch)
    }

    const currentCapabilities = parseCapabilities(existing.capabilities)
    const mergedCapabilities = mergeCapabilities(currentCapabilities, baselineCapabilities)
    if (stableStringify(currentCapabilities) !== stableStringify(mergedCapabilities)) {
      patch.capabilities = mergedCapabilities
    }

    if (entry.enforceModel && existing.model !== entry.enforceModel) {
      patch.model = entry.enforceModel
      modelPinned += 1
    }

    if (Object.keys(patch).length === 0) continue
    updated += 1
    if (!input.apply) continue

    await repos.agents.update(existing.id, patch)
  }

  return {
    created,
    updated,
    modelPinned,
  }
}

export async function reconcileOpenClawCompanyTopology(
  options: CompanyTopologyReconcileOptions = {}
): Promise<CompanyTopologyReconcileResult> {
  const apply = options.apply ?? true
  const strictStageCoverage = options.strictStageCoverage ?? true

  const stageCoverage = buildStageCoverage()
  if (strictStageCoverage && !stageCoverage.ok) {
    throw new Error(
      `Topology stage coverage invalid (missingInResolver=${stageCoverage.missingInResolver.join(',') || 'none'}, missingInTopology=${stageCoverage.missingInTopology.join(',') || 'none'})`
    )
  }

  const desiredTeam = await loadStarterTeamDefinition()
  const team = await reconcileTeam({
    apply,
    desired: desiredTeam,
  })

  const agents = await reconcileMappedAgents({
    apply,
    teamId: team.id,
  })

  return {
    apply,
    team,
    agents,
    stageCoverage,
  }
}

export async function findCanonicalTeamId(): Promise<string | null> {
  const repos = getRepos()
  const team = await repos.agentTeams.getBySlug('clawcontrol-team')
  return team?.id ?? null
}

export function knownCompanyRuntimeAgentIds(): string[] {
  return companyRuntimeAgentIds()
}
