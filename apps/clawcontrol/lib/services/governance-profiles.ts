import 'server-only'

import { prisma } from '@/lib/db'
import {
  findCanonicalTeamId,
  reconcileOpenClawCompanyTopology,
} from '@/lib/services/openclaw-company-topology-reconcile'
import {
  MODEL_POLICY as COMPANY_MODEL_POLICY,
  findCompanyTopologyEntry,
  listCompanyTopologyEntries,
  type CompanyTopologyEntry,
} from '@/lib/services/openclaw-company-topology-map'

export const GOVERNANCE_ACTIVE_PROFILES_KEY = 'governance.activeProfiles'
export const LEGACY_COMPANY_PROFILE_ID = 'clawcontrol-company-v1'

export interface GovernanceProfileReconcileItem {
  profileId: string
  mutations: number
  error?: string
}

export interface GovernanceProfilesReconcileResult {
  profileIds: string[]
  totalMutations: number
  results: GovernanceProfileReconcileItem[]
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function dedupe(values: string[]): string[] {
  const out = new Set<string>()
  for (const value of values) {
    const normalized = normalizeString(value)
    if (!normalized) continue
    out.add(normalized)
  }
  return Array.from(out).sort((left, right) => left.localeCompare(right))
}

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return dedupe(parsed.map((entry) => normalizeString(entry)))
  } catch {
    return []
  }
}

async function readActiveProfilesFromSetting(): Promise<string[]> {
  const row = await prisma.setting.findUnique({
    where: { key: GOVERNANCE_ACTIVE_PROFILES_KEY },
    select: { value: true },
  })
  return parseJsonArray(row?.value)
}

async function writeActiveProfilesToSetting(profileIds: string[]): Promise<void> {
  await prisma.setting.upsert({
    where: { key: GOVERNANCE_ACTIVE_PROFILES_KEY },
    create: {
      key: GOVERNANCE_ACTIVE_PROFILES_KEY,
      value: JSON.stringify(dedupe(profileIds)),
    },
    update: {
      value: JSON.stringify(dedupe(profileIds)),
    },
  })
}

async function detectLegacyCompanyLayout(): Promise<boolean> {
  const team = await prisma.agentTeam.findFirst({
    where: { slug: 'clawcontrol-team' },
    select: { id: true },
  })
  if (!team) return false

  const runtimeIds = listCompanyTopologyEntries().map((entry) => entry.runtimeAgentId)
  const sessionKeys = runtimeIds.map((id) => `agent:${id}:${id}`)
  const rows = await prisma.agent.findMany({
    where: {
      OR: [
        { runtimeAgentId: { in: runtimeIds } },
        { sessionKey: { in: sessionKeys } },
      ],
    },
    select: {
      runtimeAgentId: true,
      sessionKey: true,
    },
  })

  const seen = new Set<string>()
  for (const row of rows) {
    const runtimeId = normalizeString(row.runtimeAgentId)
    if (runtimeId) seen.add(runtimeId)
    const session = normalizeString(row.sessionKey)
    if (session.startsWith('agent:')) {
      const runtimeFromSession = session.split(':')[1]
      if (runtimeFromSession) seen.add(runtimeFromSession)
    }
  }

  return seen.has('manager') && seen.has('wf-ops')
}

export async function getActiveGovernanceProfiles(): Promise<string[]> {
  const existing = await readActiveProfilesFromSetting()
  if (existing.length > 0) return existing

  const detectedLegacyLayout = await detectLegacyCompanyLayout()
  if (!detectedLegacyLayout) return []

  const migrated = [LEGACY_COMPANY_PROFILE_ID]
  await writeActiveProfilesToSetting(migrated)
  return migrated
}

export async function reconcileActiveGovernanceProfiles(options: {
  apply?: boolean
} = {}): Promise<GovernanceProfilesReconcileResult> {
  const apply = options.apply ?? true
  const profileIds = await getActiveGovernanceProfiles()
  const results: GovernanceProfileReconcileItem[] = []

  for (const profileId of profileIds) {
    if (profileId !== LEGACY_COMPANY_PROFILE_ID) {
      results.push({
        profileId,
        mutations: 0,
        error: 'Unknown governance profile',
      })
      continue
    }

    try {
      const reconciled = await reconcileOpenClawCompanyTopology({ apply })
      const mutations =
        reconciled.agents.created
        + reconciled.agents.updated
        + (reconciled.team.created || reconciled.team.updated ? 1 : 0)

      results.push({
        profileId,
        mutations,
      })
    } catch (error) {
      results.push({
        profileId,
        mutations: 0,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    profileIds,
    totalMutations: results.reduce((sum, item) => sum + item.mutations, 0),
    results,
  }
}

export interface ActiveTopologyOwnership {
  canonicalTeamId: string | null
  byRuntimeId: Map<string, CompanyTopologyEntry>
}

export async function resolveActiveTopologyOwnership(): Promise<ActiveTopologyOwnership> {
  const profileIds = await getActiveGovernanceProfiles()
  if (!profileIds.includes(LEGACY_COMPANY_PROFILE_ID)) {
    return {
      canonicalTeamId: null,
      byRuntimeId: new Map(),
    }
  }

  const byRuntimeId = new Map<string, CompanyTopologyEntry>()
  for (const entry of listCompanyTopologyEntries()) {
    byRuntimeId.set(entry.runtimeAgentId, entry)
  }

  return {
    canonicalTeamId: await findCanonicalTeamId(),
    byRuntimeId,
  }
}

export async function findOwnedTopologyEntry(runtimeAgentId: string): Promise<CompanyTopologyEntry | null> {
  const ownership = await resolveActiveTopologyOwnership()
  return ownership.byRuntimeId.get(runtimeAgentId) ?? null
}

export async function resolveActiveModelPolicy(): Promise<Record<string, string>> {
  const profileIds = await getActiveGovernanceProfiles()
  const policy: Record<string, string> = {}
  if (profileIds.includes(LEGACY_COMPANY_PROFILE_ID)) {
    for (const [runtimeId, model] of Object.entries(COMPANY_MODEL_POLICY)) {
      policy[runtimeId] = model
    }
  }
  return policy
}

export function getKnownTopologyEntry(runtimeAgentId: string): CompanyTopologyEntry | null {
  return findCompanyTopologyEntry(runtimeAgentId)
}

