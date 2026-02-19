import 'server-only'

import type {
  TeamAgentIdentityMode,
  TeamGovernanceConfig,
  TeamGovernanceOpsConfig,
  TeamOpsRelayMode,
} from '@/lib/repo/types'

type GovernanceDefaultMode = 'new' | 'legacy'

export interface TeamGovernanceValidationIssue {
  code: string
  message: string
  path: string
}

export class TeamGovernanceValidationError extends Error {
  constructor(public readonly details: TeamGovernanceValidationIssue[]) {
    super('Team governance configuration is invalid')
    this.name = 'TeamGovernanceValidationError'
  }
}

const DEFAULT_ORCHESTRATOR_TEMPLATE_ID = 'manager'
const DEFAULT_OPS_TEMPLATE_ID = 'ops'
const DEFAULT_OPS_RELAY_MODE: TeamOpsRelayMode = 'decision_only'
const DEFAULT_OPS_RELAY_TARGET = 'agent:main:main'
const DEFAULT_OPS_POLL_INTERVAL = '*/15 * * * *'
const DEFAULT_TIMEZONE = 'Europe/Zurich'

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function parseIdentityMode(value: unknown): TeamAgentIdentityMode | null {
  const normalized = normalizeString(value)
  if (normalized === 'team_scoped' || normalized === 'legacy_global') return normalized
  return null
}

function parseRelayMode(value: unknown): TeamOpsRelayMode | null {
  const normalized = normalizeString(value)
  if (normalized === 'decision_only') return normalized
  return null
}

function sanitizeModelPolicy(value: unknown): Record<string, string> | undefined {
  const record = asRecord(value)
  if (!record) return undefined

  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(record)) {
    const policyKey = normalizeString(key)
    const model = normalizeString(raw)
    if (!policyKey || !model) continue
    out[policyKey] = model
  }

  return Object.keys(out).length > 0 ? out : undefined
}

function normalizeOpsConfig(
  input: unknown,
  issues: TeamGovernanceValidationIssue[]
): TeamGovernanceOpsConfig {
  const record = asRecord(input) ?? {}

  const templateId = normalizeString(record.templateId) || DEFAULT_OPS_TEMPLATE_ID
  const relayMode = parseRelayMode(record.relayMode) ?? DEFAULT_OPS_RELAY_MODE
  const relayTargetSessionKey = normalizeString(record.relayTargetSessionKey) || DEFAULT_OPS_RELAY_TARGET
  const pollerEnabled = record.pollerEnabled === undefined ? true : record.pollerEnabled === true
  const pollIntervalCron = normalizeString(record.pollIntervalCron) || DEFAULT_OPS_POLL_INTERVAL
  const timezone = normalizeString(record.timezone) || DEFAULT_TIMEZONE

  if (!templateId) {
    issues.push({
      code: 'REQUIRED',
      path: 'governance.ops.templateId',
      message: 'governance.ops.templateId is required',
    })
  }

  if (parseRelayMode(record.relayMode) === null && record.relayMode !== undefined) {
    issues.push({
      code: 'INVALID_ENUM',
      path: 'governance.ops.relayMode',
      message: 'governance.ops.relayMode must be "decision_only"',
    })
  }

  return {
    templateId: templateId || DEFAULT_OPS_TEMPLATE_ID,
    relayMode,
    relayTargetSessionKey,
    pollerEnabled,
    pollIntervalCron,
    timezone,
  }
}

export function createDefaultTeamGovernance(
  agentIdentityMode: TeamAgentIdentityMode = 'team_scoped'
): TeamGovernanceConfig {
  return {
    orchestratorTemplateId: DEFAULT_ORCHESTRATOR_TEMPLATE_ID,
    agentIdentityMode,
    ops: {
      templateId: DEFAULT_OPS_TEMPLATE_ID,
      relayMode: DEFAULT_OPS_RELAY_MODE,
      relayTargetSessionKey: DEFAULT_OPS_RELAY_TARGET,
      pollerEnabled: true,
      pollIntervalCron: DEFAULT_OPS_POLL_INTERVAL,
      timezone: DEFAULT_TIMEZONE,
    },
  }
}

function fallbackIdentityMode(mode: GovernanceDefaultMode): TeamAgentIdentityMode {
  return mode === 'new' ? 'team_scoped' : 'legacy_global'
}

function isTreatableAsUnset(value: unknown): boolean {
  if (value === undefined || value === null) return true
  const record = asRecord(value)
  if (!record) return false
  return Object.keys(record).length === 0
}

export function assertValidTeamGovernance(
  input: unknown,
  options: {
    whenUnset?: GovernanceDefaultMode
  } = {}
): TeamGovernanceConfig {
  const whenUnset = options.whenUnset ?? 'legacy'

  if (isTreatableAsUnset(input)) {
    return createDefaultTeamGovernance(fallbackIdentityMode(whenUnset))
  }

  const record = asRecord(input)
  if (!record) {
    throw new TeamGovernanceValidationError([
      {
        code: 'INVALID_TYPE',
        path: 'governance',
        message: 'governance must be an object',
      },
    ])
  }

  const issues: TeamGovernanceValidationIssue[] = []
  const orchestratorTemplateId = normalizeString(record.orchestratorTemplateId)
  const identityMode = parseIdentityMode(record.agentIdentityMode)
  const ops = normalizeOpsConfig(record.ops, issues)
  const modelPolicy = sanitizeModelPolicy(record.modelPolicy)

  if (!orchestratorTemplateId) {
    issues.push({
      code: 'REQUIRED',
      path: 'governance.orchestratorTemplateId',
      message: 'governance.orchestratorTemplateId is required',
    })
  }

  if (!identityMode && record.agentIdentityMode !== undefined) {
    issues.push({
      code: 'INVALID_ENUM',
      path: 'governance.agentIdentityMode',
      message: 'governance.agentIdentityMode must be "team_scoped" or "legacy_global"',
    })
  }

  if (issues.length > 0) {
    throw new TeamGovernanceValidationError(issues)
  }

  return {
    orchestratorTemplateId,
    agentIdentityMode: identityMode ?? fallbackIdentityMode(whenUnset),
    ops,
    ...(modelPolicy ? { modelPolicy } : {}),
  }
}

export function resolveTeamGovernance(
  team: { governance?: TeamGovernanceConfig | null } | null | undefined,
  options: {
    whenUnset?: GovernanceDefaultMode
  } = {}
): TeamGovernanceConfig {
  return assertValidTeamGovernance(team?.governance, options)
}

