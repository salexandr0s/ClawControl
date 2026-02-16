import 'server-only'

import type { AgentTemplate } from '@clawcontrol/core'
import type {
  TeamCapabilityConfig,
  TeamHierarchyConfig,
  TeamHierarchyMemberConfig,
} from '@/lib/repo/types'

const HIERARCHY_VERSION = 1 as const
const CAPABILITY_KEYS = [
  'canDelegate',
  'canSendMessages',
  'canExecuteCode',
  'canModifyFiles',
  'canWebSearch',
] as const

export interface TeamHierarchyValidationIssue {
  code:
    | 'HIERARCHY_INVALID_TYPE'
    | 'HIERARCHY_INVALID_VERSION'
    | 'MEMBERS_INVALID_TYPE'
    | 'MEMBER_KEY_NOT_IN_TEMPLATE_IDS'
    | 'MEMBER_REPORTS_TO_MISSING'
    | 'MEMBER_REPORTS_TO_SELF'
    | 'MEMBER_DELEGATES_TO_SELF'
    | 'MEMBER_DELEGATES_TO_MISSING'
    | 'MEMBER_RECEIVES_FROM_SELF'
    | 'MEMBER_RECEIVES_FROM_MISSING'
    | 'MEMBER_CAN_MESSAGE_SELF'
    | 'MEMBER_CAN_MESSAGE_MISSING'
    | 'CAPABILITY_CAN_SEND_MESSAGES_CONFLICT'
    | 'CAPABILITY_CAN_DELEGATE_CONFLICT'
    | 'REPORTS_TO_CYCLE'
  message: string
  path: string
}

export interface TeamHierarchyValidationResult {
  ok: boolean
  normalized: TeamHierarchyConfig
  errors: TeamHierarchyValidationIssue[]
}

export class TeamHierarchyValidationError extends Error {
  constructor(
    message: string,
    public readonly details: TeamHierarchyValidationIssue[]
  ) {
    super(message)
    this.name = 'TeamHierarchyValidationError'
  }
}

function normalizeTemplateIds(templateIds: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of templateIds) {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  out.sort((left, right) => left.localeCompare(right))
  return out
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function toUniqueStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  out.sort((left, right) => left.localeCompare(right))
  return out
}

function normalizeCapabilities(value: unknown): TeamCapabilityConfig {
  const record = asRecord(value)
  if (!record) return {}

  const capabilities: TeamCapabilityConfig = {}
  for (const key of CAPABILITY_KEYS) {
    const maybe = record[key]
    if (typeof maybe === 'boolean') {
      capabilities[key] = maybe
    }
  }
  return capabilities
}

function normalizeMember(value: unknown): TeamHierarchyMemberConfig {
  const record = asRecord(value)
  const reportsToRaw = typeof record?.reportsTo === 'string'
    ? record.reportsTo.trim()
    : null

  return {
    reportsTo: reportsToRaw || null,
    delegatesTo: toUniqueStringArray(record?.delegatesTo),
    receivesFrom: toUniqueStringArray(record?.receivesFrom),
    canMessage: toUniqueStringArray(record?.canMessage),
    capabilities: normalizeCapabilities(record?.capabilities),
  }
}

function emptyMember(): TeamHierarchyMemberConfig {
  return {
    reportsTo: null,
    delegatesTo: [],
    receivesFrom: [],
    canMessage: [],
    capabilities: {},
  }
}

function buildNormalizedHierarchy(
  hierarchy: unknown,
  teamTemplateIds: string[]
): TeamHierarchyConfig {
  const record = asRecord(hierarchy)
  const membersRecord = asRecord(record?.members) ?? {}
  const sortedTemplateIds = normalizeTemplateIds(teamTemplateIds)

  const members: Record<string, TeamHierarchyMemberConfig> = {}
  for (const templateId of sortedTemplateIds) {
    const rawMember = membersRecord[templateId]
    members[templateId] = rawMember ? normalizeMember(rawMember) : emptyMember()
  }

  return {
    version: HIERARCHY_VERSION,
    members,
  }
}

function validateSelfAndMissingTargets(input: {
  sourceTemplateId: string
  relation: 'delegatesTo' | 'receivesFrom' | 'canMessage'
  targets: string[]
  templateSet: Set<string>
}): TeamHierarchyValidationIssue[] {
  const errors: TeamHierarchyValidationIssue[] = []
  const source = input.sourceTemplateId

  for (const target of input.targets) {
    if (target === source) {
      errors.push({
        code: input.relation === 'delegatesTo'
          ? 'MEMBER_DELEGATES_TO_SELF'
          : input.relation === 'receivesFrom'
            ? 'MEMBER_RECEIVES_FROM_SELF'
            : 'MEMBER_CAN_MESSAGE_SELF',
        message: `Hierarchy member "${source}" cannot ${input.relation} itself`,
        path: `/members/${source}/${input.relation}`,
      })
      continue
    }

    if (!input.templateSet.has(target)) {
      errors.push({
        code: input.relation === 'delegatesTo'
          ? 'MEMBER_DELEGATES_TO_MISSING'
          : input.relation === 'receivesFrom'
            ? 'MEMBER_RECEIVES_FROM_MISSING'
            : 'MEMBER_CAN_MESSAGE_MISSING',
        message: `Hierarchy member "${source}" references unknown "${target}" in ${input.relation}`,
        path: `/members/${source}/${input.relation}`,
      })
    }
  }

  return errors
}

function detectReportsToCycle(
  members: Record<string, TeamHierarchyMemberConfig>
): string[] | null {
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const pathStack: string[] = []

  const dfs = (templateId: string): string[] | null => {
    if (visiting.has(templateId)) {
      const idx = pathStack.lastIndexOf(templateId)
      return idx === -1 ? [templateId] : pathStack.slice(idx).concat(templateId)
    }
    if (visited.has(templateId)) return null

    visiting.add(templateId)
    pathStack.push(templateId)

    const parent = members[templateId]?.reportsTo
    if (parent) {
      const cycle = dfs(parent)
      if (cycle) return cycle
    }

    pathStack.pop()
    visiting.delete(templateId)
    visited.add(templateId)
    return null
  }

  const templateIds = Object.keys(members)
  for (const templateId of templateIds) {
    const cycle = dfs(templateId)
    if (cycle) return cycle
  }

  return null
}

export function validateTeamHierarchy(
  hierarchy: unknown,
  templateIds: string[]
): TeamHierarchyValidationResult {
  const errors: TeamHierarchyValidationIssue[] = []
  const sortedTemplateIds = normalizeTemplateIds(templateIds)
  const templateSet = new Set(sortedTemplateIds)

  const hierarchyRecord = asRecord(hierarchy)
  if (!hierarchyRecord) {
    errors.push({
      code: 'HIERARCHY_INVALID_TYPE',
      message: 'Hierarchy must be an object',
      path: '/',
    })
  } else if (hierarchyRecord.version !== HIERARCHY_VERSION) {
    errors.push({
      code: 'HIERARCHY_INVALID_VERSION',
      message: `Hierarchy version must be ${HIERARCHY_VERSION}`,
      path: '/version',
    })
  }

  if (hierarchyRecord && hierarchyRecord.members !== undefined && !asRecord(hierarchyRecord.members)) {
    errors.push({
      code: 'MEMBERS_INVALID_TYPE',
      message: 'Hierarchy members must be an object keyed by templateId',
      path: '/members',
    })
  }

  const normalized = buildNormalizedHierarchy(hierarchy, sortedTemplateIds)
  const rawMembers = asRecord(hierarchyRecord?.members) ?? {}

  for (const key of Object.keys(rawMembers)) {
    if (!templateSet.has(key)) {
      errors.push({
        code: 'MEMBER_KEY_NOT_IN_TEMPLATE_IDS',
        message: `Hierarchy member "${key}" is not present in team.templateIds`,
        path: `/members/${key}`,
      })
    }
  }

  for (const templateId of sortedTemplateIds) {
    const member = normalized.members[templateId]

    if (member.reportsTo) {
      if (member.reportsTo === templateId) {
        errors.push({
          code: 'MEMBER_REPORTS_TO_SELF',
          message: `Hierarchy member "${templateId}" cannot report to itself`,
          path: `/members/${templateId}/reportsTo`,
        })
      } else if (!templateSet.has(member.reportsTo)) {
        errors.push({
          code: 'MEMBER_REPORTS_TO_MISSING',
          message: `Hierarchy member "${templateId}" reportsTo unknown template "${member.reportsTo}"`,
          path: `/members/${templateId}/reportsTo`,
        })
      }
    }

    errors.push(
      ...validateSelfAndMissingTargets({
        sourceTemplateId: templateId,
        relation: 'delegatesTo',
        targets: member.delegatesTo,
        templateSet,
      }),
      ...validateSelfAndMissingTargets({
        sourceTemplateId: templateId,
        relation: 'receivesFrom',
        targets: member.receivesFrom,
        templateSet,
      }),
      ...validateSelfAndMissingTargets({
        sourceTemplateId: templateId,
        relation: 'canMessage',
        targets: member.canMessage,
        templateSet,
      })
    )

    if (member.capabilities.canSendMessages === false && member.canMessage.length > 0) {
      errors.push({
        code: 'CAPABILITY_CAN_SEND_MESSAGES_CONFLICT',
        message: `Hierarchy member "${templateId}" disables canSendMessages but defines canMessage targets`,
        path: `/members/${templateId}/canMessage`,
      })
    }

    if (member.capabilities.canDelegate === false && member.delegatesTo.length > 0) {
      errors.push({
        code: 'CAPABILITY_CAN_DELEGATE_CONFLICT',
        message: `Hierarchy member "${templateId}" disables canDelegate but defines delegatesTo targets`,
        path: `/members/${templateId}/delegatesTo`,
      })
    }
  }

  const cycle = detectReportsToCycle(normalized.members)
  if (cycle && cycle.length > 1) {
    errors.push({
      code: 'REPORTS_TO_CYCLE',
      message: `reportsTo graph contains a cycle: ${cycle.join(' -> ')}`,
      path: '/members',
    })
  }

  return {
    ok: errors.length === 0,
    normalized,
    errors,
  }
}

export function assertValidTeamHierarchy(
  hierarchy: unknown,
  templateIds: string[]
): TeamHierarchyConfig {
  const result = validateTeamHierarchy(hierarchy, templateIds)
  if (!result.ok) {
    throw new TeamHierarchyValidationError('Invalid team hierarchy', result.errors)
  }
  return result.normalized
}

export function createDefaultTeamHierarchy(templateIds: string[]): TeamHierarchyConfig {
  return buildNormalizedHierarchy(
    {
      version: HIERARCHY_VERSION,
      members: {},
    },
    templateIds
  )
}

export function buildTeamHierarchyFromTemplateDefaults(
  templateIds: string[],
  templatesById: Map<string, AgentTemplate>
): TeamHierarchyConfig {
  const members: Record<string, TeamHierarchyMemberConfig> = {}

  for (const templateId of normalizeTemplateIds(templateIds)) {
    const template = templatesById.get(templateId)
    const defaults = template?.config?.teamDefaults
    members[templateId] = {
      reportsTo: typeof defaults?.reportsTo === 'string'
        ? (defaults.reportsTo.trim() || null)
        : defaults?.reportsTo === null
          ? null
          : null,
      delegatesTo: toUniqueStringArray(defaults?.delegatesTo),
      receivesFrom: toUniqueStringArray(defaults?.receivesFrom),
      canMessage: toUniqueStringArray(defaults?.canMessage),
      capabilities: normalizeCapabilities(defaults?.capabilities),
    }
  }

  return assertValidTeamHierarchy(
    {
      version: HIERARCHY_VERSION,
      members,
    },
    templateIds
  )
}

export function getHierarchyMemberConfig(
  hierarchy: TeamHierarchyConfig,
  templateId: string
): TeamHierarchyMemberConfig | null {
  const member = hierarchy.members[templateId]
  return member ?? null
}
