import 'server-only'

export type CompanyTemplateId =
  | 'manager'
  | 'research'
  | 'plan'
  | 'plan_review'
  | 'build'
  | 'build_review'
  | 'ui'
  | 'ui_review'
  | 'ops'
  | 'security'

export interface CompanyTopologyEntry {
  runtimeAgentId: string
  templateId: CompanyTemplateId
  station: string
  kind: 'worker' | 'manager'
  role: string
  defaultDisplayName: string
  enforceModel?: string
}

export const REQUIRED_STAGE_COVERAGE: readonly CompanyTemplateId[] = [
  'research',
  'plan',
  'plan_review',
  'build',
  'build_review',
  'ui',
  'ui_review',
  'ops',
  'security',
] as const

export const MODEL_POLICY = {
  main: 'anthropic/claude-opus-4-6',
  'wf-ops': 'anthropic/claude-sonnet-4-6',
} as const

const COMPANY_TOPOLOGY_ENTRIES: readonly CompanyTopologyEntry[] = [
  {
    runtimeAgentId: 'manager',
    templateId: 'manager',
    station: 'orchestration',
    kind: 'manager',
    role: 'MANAGER',
    defaultDisplayName: 'SavorgManager',
  },
  {
    runtimeAgentId: 'wf-research',
    templateId: 'research',
    station: 'spec',
    kind: 'worker',
    role: 'RESEARCH',
    defaultDisplayName: 'SavorgResearch',
  },
  {
    runtimeAgentId: 'wf-plan',
    templateId: 'plan',
    station: 'spec',
    kind: 'worker',
    role: 'PLAN',
    defaultDisplayName: 'SavorgPlan',
  },
  {
    runtimeAgentId: 'wf-plan-review',
    templateId: 'plan_review',
    station: 'qa',
    kind: 'worker',
    role: 'PLAN_REVIEW',
    defaultDisplayName: 'SavorgPlanReview',
  },
  {
    runtimeAgentId: 'wf-build',
    templateId: 'build',
    station: 'build',
    kind: 'worker',
    role: 'BUILD',
    defaultDisplayName: 'SavorgBuild',
  },
  {
    runtimeAgentId: 'wf-build-review',
    templateId: 'build_review',
    station: 'qa',
    kind: 'worker',
    role: 'BUILD_REVIEW',
    defaultDisplayName: 'SavorgBuildReview',
  },
  {
    runtimeAgentId: 'wf-ui',
    templateId: 'ui',
    station: 'build',
    kind: 'worker',
    role: 'UI',
    defaultDisplayName: 'SavorgUI',
  },
  {
    runtimeAgentId: 'wf-ui-review',
    templateId: 'ui_review',
    station: 'qa',
    kind: 'worker',
    role: 'UI_REVIEW',
    defaultDisplayName: 'SavorgUIReview',
  },
  {
    runtimeAgentId: 'wf-ops',
    templateId: 'ops',
    station: 'ops',
    kind: 'worker',
    role: 'OPS',
    defaultDisplayName: 'SavorgOps',
    enforceModel: MODEL_POLICY['wf-ops'],
  },
  {
    runtimeAgentId: 'wf-security',
    templateId: 'security',
    station: 'security',
    kind: 'worker',
    role: 'SECURITY',
    defaultDisplayName: 'SavorgSecurity',
  },
] as const

const ENTRY_BY_RUNTIME = new Map(
  COMPANY_TOPOLOGY_ENTRIES.map((entry) => [entry.runtimeAgentId, entry])
)

export function listCompanyTopologyEntries(): readonly CompanyTopologyEntry[] {
  return COMPANY_TOPOLOGY_ENTRIES
}

export function companyRuntimeAgentIds(): string[] {
  return COMPANY_TOPOLOGY_ENTRIES.map((entry) => entry.runtimeAgentId)
}

export function findCompanyTopologyEntry(
  runtimeAgentId: string | null | undefined
): CompanyTopologyEntry | null {
  const key = (runtimeAgentId ?? '').trim().toLowerCase()
  if (!key) return null
  return ENTRY_BY_RUNTIME.get(key) ?? null
}

export function buildTemplateBaselineCapabilities(entry: CompanyTopologyEntry): Record<string, boolean> {
  const capabilities: Record<string, boolean> = {
    [entry.station]: true,
    [entry.templateId]: true,
  }

  if (entry.templateId === 'manager') {
    capabilities.can_delegate = true
    capabilities.can_send_messages = true
    capabilities.orchestration = true
  }

  if (entry.templateId === 'security') {
    capabilities.security = true
    capabilities.can_send_messages = true
  }

  return capabilities
}

