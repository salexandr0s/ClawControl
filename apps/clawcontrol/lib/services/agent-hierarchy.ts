import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { join, resolve } from 'path'
import yaml from 'js-yaml'
import JSON5 from 'json5'
import { runCommandJson } from '@clawcontrol/adapters-openclaw'
import { getRepos, type AgentDTO } from '@/lib/repo'

export type AgentHierarchyEdgeType = 'reports_to' | 'delegates_to' | 'receives_from' | 'can_message'
export type AgentHierarchyConfidence = 'high' | 'medium'
export type AgentHierarchyNodeKind = 'agent' | 'external'
export type AgentHierarchySourceId =
  | 'db_agents'
  | 'clawcontrol_config_yaml'
  | 'runtime_openclaw_agents_list'
  | 'openclaw_template_policy'

export interface AgentHierarchyNodeCapabilities {
  delegate: boolean
  message: boolean
  exec: boolean
  write: boolean
}

export interface AgentHierarchyToolPolicy {
  allow: string[]
  deny: string[]
  execSecurity: string | null
  source: 'runtime' | 'fallback'
}

export interface AgentHierarchyNode {
  id: string
  normalizedId: string
  kind: AgentHierarchyNodeKind
  label: string
  dbAgentId: string | null
  role: string | null
  station: string | null
  status: string | null
  agentKind: string | null
  runtimeAgentId: string | null
  capabilities: AgentHierarchyNodeCapabilities
  toolPolicy: AgentHierarchyToolPolicy | null
  sources: AgentHierarchySourceId[]
}

export interface AgentHierarchyEdge {
  id: string
  type: AgentHierarchyEdgeType
  from: string
  to: string
  confidence: AgentHierarchyConfidence
  source: AgentHierarchySourceId
  sources: AgentHierarchySourceId[]
}

export interface AgentHierarchyWarning {
  code:
    | 'source_unavailable'
    | 'parse_error'
    | 'invalid_relation'
    | 'self_loop_dropped'
    | 'messaging_targets_ambiguous'
    | 'runtime_unavailable_fallback_used'
  message: string
  source?: AgentHierarchySourceId
  relatedNodeId?: string
}

export interface AgentHierarchySourceStatus {
  yaml: {
    available: boolean
    path: string
    error?: string
  }
  runtime: {
    available: boolean
    command: 'config.agents.list.json'
    error?: string
  }
  fallback: {
    available: boolean
    used: boolean
    path: string
    error?: string
  }
  db: {
    available: boolean
    count: number
  }
}

export interface AgentHierarchyData {
  nodes: AgentHierarchyNode[]
  edges: AgentHierarchyEdge[]
  meta: {
    sources: AgentHierarchySourceStatus
    warnings: AgentHierarchyWarning[]
  }
}

export interface HierarchyDbAgent {
  id: string
  runtimeAgentId: string | null
  slug: string | null
  name: string
  displayName: string
  role: string
  station: string
  status: string
  kind: string
}

interface YamlAgentRecord {
  id: string
  label?: string
  role?: string
  reportsTo?: string
  delegatesTo: string[]
  receivesFrom: string[]
  capabilities: Partial<AgentHierarchyNodeCapabilities>
}

interface YamlExtractionResult {
  agents: YamlAgentRecord[]
  warnings: AgentHierarchyWarning[]
}

interface ToolPolicyExtraction {
  id: string
  label?: string
  toolPolicy: AgentHierarchyToolPolicy | null
  capabilities: Partial<AgentHierarchyNodeCapabilities>
}

interface ToolOverlayResult {
  agents: ToolPolicyExtraction[]
  warnings: AgentHierarchyWarning[]
}

interface BuildAgentHierarchyInput {
  dbAgents: HierarchyDbAgent[]
  yaml: YamlExtractionResult | null
  runtime: ToolOverlayResult | null
  fallback: ToolOverlayResult | null
  sourceStatus: AgentHierarchySourceStatus
  initialWarnings?: AgentHierarchyWarning[]
}

type CapabilityName = keyof AgentHierarchyNodeCapabilities

const CAPABILITY_PRIORITY: Record<AgentHierarchySourceId, number> = {
  db_agents: 0,
  clawcontrol_config_yaml: 1,
  openclaw_template_policy: 2,
  runtime_openclaw_agents_list: 3,
}

const STRUCTURAL_EDGE_TYPES: AgentHierarchyEdgeType[] = ['reports_to', 'delegates_to', 'receives_from']

interface MutableNode {
  key: string
  id: string
  kind: AgentHierarchyNodeKind
  label: string
  dbAgentId: string | null
  role: string | null
  station: string | null
  status: string | null
  agentKind: string | null
  runtimeAgentId: string | null
  capabilities: AgentHierarchyNodeCapabilities
  capabilityPriority: Record<CapabilityName, number>
  capabilitySources: Partial<Record<CapabilityName, AgentHierarchySourceId>>
  toolPolicy: AgentHierarchyToolPolicy | null
  toolPolicyPriority: number
  sources: Set<AgentHierarchySourceId>
}

interface MutableEdge {
  type: AgentHierarchyEdgeType
  fromKey: string
  toKey: string
  confidence: AgentHierarchyConfidence
  source: AgentHierarchySourceId
  sources: Set<AgentHierarchySourceId>
}

function normalizeIdentifier(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function compactString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => compactString(item))
    .filter((item): item is string => Boolean(item))
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function pathKey(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const output: string[] = []

  for (const rawPath of paths) {
    const normalized = resolve(rawPath)
    const key = pathKey(normalized)
    if (seen.has(key)) continue
    seen.add(key)
    output.push(normalized)
  }

  return output
}

function firstExistingPath(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

function isMissingFileError(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return true
  }

  const message = error instanceof Error ? error.message : String(error ?? '')
  const lowered = message.toLowerCase()
  return lowered.includes('enoent') || lowered.includes('no such file or directory')
}

function isRuntimeCliUnavailableError(message: string): boolean {
  const lowered = message.toLowerCase()
  return (
    lowered.includes('cli not found')
    || lowered.includes('openclaw cli not available')
    || lowered.includes('command not found')
    || lowered.includes('spawn enoent')
    || lowered.includes('enoent')
  )
}

interface ResolveHierarchySourcePathsOptions {
  cwd?: string
  env?: Partial<Record<'OPENCLAW_WORKSPACE' | 'CLAWCONTROL_WORKSPACE_ROOT' | 'WORKSPACE_ROOT', string | undefined>>
}

export function resolveHierarchySourcePaths(
  options: ResolveHierarchySourcePathsOptions = {}
): { workspaceRoot: string; yamlPath: string; fallbackPath: string } {
  const env = options.env ?? process.env
  const envCandidates = [
    env.OPENCLAW_WORKSPACE,
    env.CLAWCONTROL_WORKSPACE_ROOT,
    env.WORKSPACE_ROOT,
  ].filter((value): value is string => Boolean(compactString(value)))

  const cwd = options.cwd ?? process.cwd()
  const cwdCandidates = [
    cwd,
    resolve(cwd, '..'),
    resolve(cwd, '../..'),
    resolve(cwd, '../../..'),
    resolve(cwd, '../../../..'),
    resolve(cwd, '../../../../..'),
  ]

  const nestedProjectCandidates = envCandidates.flatMap((candidate) => [
    join(candidate, 'projects', 'ClawControl'),
    join(candidate, 'projects', 'clawcontrol'),
  ])
  const candidates = uniquePaths([...envCandidates, ...nestedProjectCandidates, ...cwdCandidates])

  const workspaceRoot = candidates[0] ?? cwd
  const yamlCandidates = uniquePaths(
    candidates.flatMap((candidate) => [
      join(candidate, 'clawcontrol.config.yaml'),
      join(candidate, 'config', 'clawcontrol.config.yaml'),
    ])
  )
  const fallbackCandidates = uniquePaths(
    candidates.flatMap((candidate) => [
      join(candidate, 'openclaw', 'openclaw.json5'),
      join(candidate, 'openclaw', 'openclaw.json'),
      join(candidate, 'openclaw.json5'),
      join(candidate, 'openclaw.json'),
      join(candidate, '.openclaw', 'openclaw.json5'),
      join(candidate, '.openclaw', 'openclaw.json'),
    ])
  )

  const yamlPath = firstExistingPath(yamlCandidates) ?? join(workspaceRoot, 'clawcontrol.config.yaml')
  const fallbackPath = firstExistingPath(fallbackCandidates) ?? join(workspaceRoot, 'openclaw', 'openclaw.json5')

  return {
    workspaceRoot,
    yamlPath,
    fallbackPath,
  }
}

function hasAnyToken(tokens: Set<string>, checks: string[]): boolean {
  if (tokens.has('*')) return true
  return checks.some((check) => tokens.has(check))
}

function inferCapabilityFromPolicy(
  allow: Set<string>,
  deny: Set<string>,
  allowChecks: string[],
  denyChecks: string[]
): boolean | undefined {
  if (hasAnyToken(deny, denyChecks)) return false
  if (hasAnyToken(allow, allowChecks)) return true
  return undefined
}

function inferCapabilitiesFromToolPolicy(policy: AgentHierarchyToolPolicy): Partial<AgentHierarchyNodeCapabilities> {
  const allow = new Set(policy.allow.map((token) => normalizeIdentifier(token)))
  const deny = new Set(policy.deny.map((token) => normalizeIdentifier(token)))

  const inferred: Partial<AgentHierarchyNodeCapabilities> = {}

  const write = inferCapabilityFromPolicy(
    allow,
    deny,
    ['write', 'edit', 'group:fs', 'filesystem'],
    ['*', 'write', 'edit', 'group:fs', 'filesystem']
  )
  if (write !== undefined) inferred.write = write

  let exec = inferCapabilityFromPolicy(
    allow,
    deny,
    ['exec', 'run', 'group:runtime', 'shell', 'terminal'],
    ['*', 'exec', 'run', 'group:runtime', 'shell', 'terminal']
  )
  if (policy.execSecurity === 'deny') {
    exec = false
  } else if (exec === undefined && policy.execSecurity && policy.execSecurity !== 'deny') {
    exec = true
  }
  if (exec !== undefined) inferred.exec = exec

  const message = inferCapabilityFromPolicy(
    allow,
    deny,
    ['message', 'messages', 'agenttoagent', 'group:agenttoagent', 'group:messages'],
    ['*', 'message', 'messages', 'agenttoagent', 'group:agenttoagent', 'group:messages']
  )
  if (message !== undefined) inferred.message = message

  return inferred
}

function warningKey(warning: AgentHierarchyWarning): string {
  return [warning.code, warning.source ?? '', warning.relatedNodeId ?? '', warning.message].join('|')
}

function readToolPolicy(
  source: 'runtime' | 'fallback',
  rawTools: unknown
): AgentHierarchyToolPolicy | null {
  const tools = asRecord(rawTools)
  if (!tools) return null

  const allow = toStringArray(tools.allow)
  const deny = toStringArray(tools.deny)
  const execSecurity = compactString(asRecord(tools.exec)?.security) ?? null

  if (allow.length === 0 && deny.length === 0 && !execSecurity) {
    return null
  }

  return {
    allow,
    deny,
    execSecurity,
    source,
  }
}

export function extractYamlHierarchy(parsedYaml: unknown): YamlExtractionResult {
  const warnings: AgentHierarchyWarning[] = []
  const root = asRecord(parsedYaml)
  if (!root) {
    warnings.push({
      code: 'parse_error',
      source: 'clawcontrol_config_yaml',
      message: 'Parsed YAML root is not an object',
    })
    return { agents: [], warnings }
  }

  const agentsNode = asRecord(root.agents)
  if (!agentsNode) {
    warnings.push({
      code: 'invalid_relation',
      source: 'clawcontrol_config_yaml',
      message: 'No agents section found in clawcontrol.config.yaml',
    })
    return { agents: [], warnings }
  }

  const agents: YamlAgentRecord[] = []

  for (const [agentIdRaw, rawAgent] of Object.entries(agentsNode)) {
    const agent = asRecord(rawAgent)
    const agentId = compactString(agentIdRaw)

    if (!agent || !agentId) {
      warnings.push({
        code: 'invalid_relation',
        source: 'clawcontrol_config_yaml',
        message: `Invalid agent entry in YAML: ${String(agentIdRaw)}`,
      })
      continue
    }

    const permissions = asRecord(agent.permissions)
    const capabilities: Partial<AgentHierarchyNodeCapabilities> = {
      delegate: typeof permissions?.can_delegate === 'boolean' ? Boolean(permissions.can_delegate) : undefined,
      message: typeof permissions?.can_send_messages === 'boolean' ? Boolean(permissions.can_send_messages) : undefined,
      exec: typeof permissions?.can_execute_code === 'boolean' ? Boolean(permissions.can_execute_code) : undefined,
      write: typeof permissions?.can_modify_files === 'boolean' ? Boolean(permissions.can_modify_files) : undefined,
    }

    const delegatesTo = toStringArray(agent.delegates_to)
    if (capabilities.delegate === undefined && delegatesTo.length > 0) {
      capabilities.delegate = true
    }

    agents.push({
      id: agentId,
      label: compactString(agent.name),
      role: compactString(agent.role),
      reportsTo: compactString(agent.reports_to),
      delegatesTo,
      receivesFrom: toStringArray(agent.receives_from),
      capabilities,
    })
  }

  return { agents, warnings }
}

export function extractRuntimeToolOverlay(data: unknown): ToolOverlayResult {
  const warnings: AgentHierarchyWarning[] = []

  if (!Array.isArray(data)) {
    warnings.push({
      code: 'parse_error',
      source: 'runtime_openclaw_agents_list',
      message: 'Runtime agents.list payload is not an array',
    })
    return { agents: [], warnings }
  }

  const agents: ToolPolicyExtraction[] = []

  for (const row of data) {
    const item = asRecord(row)
    const id = compactString(item?.id)
    if (!item || !id) {
      continue
    }

    const toolPolicy = readToolPolicy('runtime', item.tools)
    const capabilities = toolPolicy ? inferCapabilitiesFromToolPolicy(toolPolicy) : {}

    const permissions = asRecord(item.permissions)
    if (typeof permissions?.can_delegate === 'boolean') {
      capabilities.delegate = Boolean(permissions.can_delegate)
    }
    if (typeof permissions?.can_send_messages === 'boolean') {
      capabilities.message = Boolean(permissions.can_send_messages)
    }

    agents.push({
      id,
      label: compactString(item.name) ?? compactString(asRecord(item.identity)?.name),
      toolPolicy,
      capabilities,
    })
  }

  return { agents, warnings }
}

export function extractFallbackToolOverlay(data: unknown): ToolOverlayResult {
  const warnings: AgentHierarchyWarning[] = []
  const root = asRecord(data)

  if (!root) {
    warnings.push({
      code: 'parse_error',
      source: 'openclaw_template_policy',
      message: 'Fallback template root is not an object',
    })
    return { agents: [], warnings }
  }

  const agentsRoot = asRecord(root.agents)
  const list = Array.isArray(agentsRoot?.list) ? agentsRoot?.list : []

  const globalTools = asRecord(root.tools)
  const globalAgentToAgent = asRecord(globalTools?.agentToAgent)
  const agentToAgentEnabled = globalAgentToAgent?.enabled !== false
  const globalAllowList = toStringArray(globalAgentToAgent?.allow)
  const globalAllowSet = new Set(globalAllowList.map((id) => normalizeIdentifier(id)))

  const agents: ToolPolicyExtraction[] = []

  for (const row of list) {
    const item = asRecord(row)
    const id = compactString(item?.id)
    if (!item || !id) continue

    const toolPolicy = readToolPolicy('fallback', item.tools)
    const capabilities = toolPolicy ? inferCapabilitiesFromToolPolicy(toolPolicy) : {}

    const normalizedId = normalizeIdentifier(id)
    if (!agentToAgentEnabled) {
      capabilities.message = false
    } else if (globalAllowSet.size > 0) {
      capabilities.message = globalAllowSet.has(normalizedId)
    }

    agents.push({
      id,
      label: compactString(asRecord(item.identity)?.name) ?? compactString(item.name),
      toolPolicy,
      capabilities,
    })
  }

  for (const allowedId of globalAllowList) {
    const normalized = normalizeIdentifier(allowedId)
    if (!normalized) continue
    const exists = agents.some((agent) => normalizeIdentifier(agent.id) === normalized)
    if (exists) continue

    agents.push({
      id: allowedId,
      capabilities: { message: true },
      toolPolicy: null,
    })
  }

  if (agentToAgentEnabled && globalAllowSet.size === 0) {
    warnings.push({
      code: 'messaging_targets_ambiguous',
      source: 'openclaw_template_policy',
      message: 'Fallback template enables tools.agentToAgent but does not declare explicit allow list',
    })
  }

  return { agents, warnings }
}

export function buildAgentHierarchyGraph(input: BuildAgentHierarchyInput): AgentHierarchyData {
  const warningsByKey = new Map<string, AgentHierarchyWarning>()
  const addWarning = (warning: AgentHierarchyWarning) => {
    warningsByKey.set(warningKey(warning), warning)
  }

  for (const warning of input.initialWarnings ?? []) addWarning(warning)
  for (const warning of input.yaml?.warnings ?? []) addWarning(warning)
  for (const warning of input.runtime?.warnings ?? []) addWarning(warning)
  for (const warning of input.fallback?.warnings ?? []) addWarning(warning)

  const knownAliases = new Set<string>()
  const aliasToKey = new Map<string, string>()
  const nodesByKey = new Map<string, MutableNode>()
  const edgesByKey = new Map<string, MutableEdge>()

  const registerAlias = (aliasRaw: string | null | undefined, key: string) => {
    const alias = normalizeIdentifier(aliasRaw)
    if (!alias) return
    knownAliases.add(alias)
    if (!aliasToKey.has(alias)) {
      aliasToKey.set(alias, key)
    }
  }

  const getNodeByKey = (key: string): MutableNode => {
    const existing = nodesByKey.get(key)
    if (existing) return existing

    const node: MutableNode = {
      key,
      id: key,
      kind: 'external',
      label: key,
      dbAgentId: null,
      role: null,
      station: null,
      status: null,
      agentKind: null,
      runtimeAgentId: null,
      capabilities: {
        delegate: false,
        message: false,
        exec: false,
        write: false,
      },
      capabilityPriority: {
        delegate: -1,
        message: -1,
        exec: -1,
        write: -1,
      },
      capabilitySources: {},
      toolPolicy: null,
      toolPolicyPriority: -1,
      sources: new Set<AgentHierarchySourceId>(),
    }

    nodesByKey.set(key, node)
    return node
  }

  const ensureNode = (
    rawId: string,
    options: {
      source: AgentHierarchySourceId
      kind: AgentHierarchyNodeKind
      label?: string
      dbAgentId?: string | null
      role?: string | null
      station?: string | null
      status?: string | null
      agentKind?: string | null
      runtimeAgentId?: string | null
    }
  ): MutableNode => {
    const normalized = normalizeIdentifier(rawId)
    const key = aliasToKey.get(normalized) ?? normalized
    const node = getNodeByKey(key)

    if (!node.id || node.id === key) {
      node.id = rawId.trim() || key
    }

    if (!node.label || node.label === node.key) {
      node.label = node.id
    }

    if (options.kind === 'agent') {
      node.kind = 'agent'
    }

    if (options.label && (!node.label || node.label === node.id || node.label === node.key)) {
      node.label = options.label
    }

    if (options.dbAgentId) node.dbAgentId = options.dbAgentId
    if (options.role) node.role = options.role
    if (options.station) node.station = options.station
    if (options.status) node.status = options.status
    if (options.agentKind) node.agentKind = options.agentKind
    if (options.runtimeAgentId) node.runtimeAgentId = options.runtimeAgentId

    node.sources.add(options.source)

    registerAlias(rawId, key)

    return node
  }

  const applyCapability = (
    node: MutableNode,
    capability: CapabilityName,
    value: boolean | undefined,
    source: AgentHierarchySourceId
  ) => {
    if (value === undefined) return
    const priority = CAPABILITY_PRIORITY[source]
    if (priority < node.capabilityPriority[capability]) return

    node.capabilities[capability] = value
    node.capabilityPriority[capability] = priority
    node.capabilitySources[capability] = source
  }

  const applyToolPolicy = (
    node: MutableNode,
    policy: AgentHierarchyToolPolicy | null,
    source: AgentHierarchySourceId
  ) => {
    if (!policy) return
    const priority = CAPABILITY_PRIORITY[source]
    if (priority < node.toolPolicyPriority) return

    node.toolPolicy = policy
    node.toolPolicyPriority = priority
  }

  const addEdge = (
    type: AgentHierarchyEdgeType,
    fromRaw: string | undefined,
    toRaw: string | undefined,
    source: AgentHierarchySourceId,
    confidence: AgentHierarchyConfidence
  ) => {
    const fromNormalized = normalizeIdentifier(fromRaw)
    const toNormalized = normalizeIdentifier(toRaw)

    if (!fromNormalized || !toNormalized) {
      addWarning({
        code: 'invalid_relation',
        source,
        message: `Dropped invalid ${type} relation with empty endpoint`,
      })
      return
    }

    const fromKey = aliasToKey.get(fromNormalized) ?? fromNormalized
    const toKey = aliasToKey.get(toNormalized) ?? toNormalized

    const fromKind: AgentHierarchyNodeKind = knownAliases.has(fromNormalized) || knownAliases.has(fromKey)
      ? 'agent'
      : 'external'
    const toKind: AgentHierarchyNodeKind = knownAliases.has(toNormalized) || knownAliases.has(toKey)
      ? 'agent'
      : 'external'

    const fromNode = ensureNode(fromRaw ?? fromNormalized, { source, kind: fromKind })
    const toNode = ensureNode(toRaw ?? toNormalized, { source, kind: toKind })

    if (fromNode.key === toNode.key) {
      addWarning({
        code: 'self_loop_dropped',
        source,
        relatedNodeId: fromNode.id,
        message: `Dropped ${type} self-loop on ${fromNode.id}`,
      })
      return
    }

    const edgeKey = `${type}|${fromNode.key}|${toNode.key}`
    const existing = edgesByKey.get(edgeKey)

    if (existing) {
      existing.sources.add(source)
      if (existing.confidence !== 'high' && confidence === 'high') {
        existing.confidence = 'high'
        existing.source = source
      }
      return
    }

    edgesByKey.set(edgeKey, {
      type,
      fromKey: fromNode.key,
      toKey: toNode.key,
      confidence,
      source,
      sources: new Set([source]),
    })
  }

  for (const agent of input.dbAgents) {
    const primaryId =
      compactString(agent.runtimeAgentId) ??
      compactString(agent.slug) ??
      compactString(agent.id) ??
      agent.id

    const key = normalizeIdentifier(primaryId)
    registerAlias(primaryId, key)
    registerAlias(agent.id, key)
    registerAlias(agent.runtimeAgentId, key)
    registerAlias(agent.slug, key)
    registerAlias(agent.displayName, key)
    registerAlias(agent.name, key)

    const node = ensureNode(primaryId, {
      source: 'db_agents',
      kind: 'agent',
      label: compactString(agent.displayName) ?? compactString(agent.name) ?? primaryId,
      dbAgentId: agent.id,
      role: agent.role,
      station: agent.station,
      status: agent.status,
      agentKind: agent.kind,
      runtimeAgentId: agent.runtimeAgentId,
    })

    node.label = compactString(agent.displayName) ?? compactString(agent.name) ?? node.label
  }

  for (const yamlAgent of input.yaml?.agents ?? []) {
    registerAlias(yamlAgent.id, normalizeIdentifier(yamlAgent.id))
    const node = ensureNode(yamlAgent.id, {
      source: 'clawcontrol_config_yaml',
      kind: 'agent',
      label: yamlAgent.label,
      role: yamlAgent.role,
    })

    applyCapability(node, 'delegate', yamlAgent.capabilities.delegate, 'clawcontrol_config_yaml')
    applyCapability(node, 'message', yamlAgent.capabilities.message, 'clawcontrol_config_yaml')
    applyCapability(node, 'exec', yamlAgent.capabilities.exec, 'clawcontrol_config_yaml')
    applyCapability(node, 'write', yamlAgent.capabilities.write, 'clawcontrol_config_yaml')

    addEdge('reports_to', yamlAgent.id, yamlAgent.reportsTo, 'clawcontrol_config_yaml', 'high')

    for (const target of yamlAgent.delegatesTo) {
      addEdge('delegates_to', yamlAgent.id, target, 'clawcontrol_config_yaml', 'high')
    }

    for (const sender of yamlAgent.receivesFrom) {
      addEdge('receives_from', sender, yamlAgent.id, 'clawcontrol_config_yaml', 'high')
    }
  }

  const overlay = input.runtime ?? input.fallback
  const overlaySource: AgentHierarchySourceId | null = input.runtime
    ? 'runtime_openclaw_agents_list'
    : input.fallback
      ? 'openclaw_template_policy'
      : null

  if (overlay && overlaySource) {
    for (const agent of overlay.agents) {
      registerAlias(agent.id, normalizeIdentifier(agent.id))

      const node = ensureNode(agent.id, {
        source: overlaySource,
        kind: 'agent',
        label: agent.label,
      })

      applyCapability(node, 'delegate', agent.capabilities.delegate, overlaySource)
      applyCapability(node, 'message', agent.capabilities.message, overlaySource)
      applyCapability(node, 'exec', agent.capabilities.exec, overlaySource)
      applyCapability(node, 'write', agent.capabilities.write, overlaySource)
      applyToolPolicy(node, agent.toolPolicy, overlaySource)
    }
  }

  for (const node of nodesByKey.values()) {
    if (node.kind !== 'agent') continue

    if (node.capabilities.message !== true) continue

    const outgoingStructuralTargets = new Set<string>()
    for (const edge of edgesByKey.values()) {
      if (!STRUCTURAL_EDGE_TYPES.includes(edge.type)) continue
      if (edge.fromKey !== node.key) continue
      outgoingStructuralTargets.add(edge.toKey)
    }

    const messageSource = node.capabilitySources.message ?? 'clawcontrol_config_yaml'

    if (outgoingStructuralTargets.size === 0) {
      addWarning({
        code: 'messaging_targets_ambiguous',
        source: messageSource,
        relatedNodeId: node.id,
        message: `Messaging capability inferred for ${node.id}, but exact target set is unknown`,
      })
      continue
    }

    for (const targetKey of outgoingStructuralTargets) {
      const targetNode = nodesByKey.get(targetKey)
      if (!targetNode) continue
      addEdge('can_message', node.id, targetNode.id, messageSource, 'medium')
    }
  }

  const nodes = Array.from(nodesByKey.values())
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'agent' ? -1 : 1
      return a.label.localeCompare(b.label)
    })
    .map<AgentHierarchyNode>((node) => ({
      id: node.id,
      normalizedId: node.key,
      kind: node.kind,
      label: node.label,
      dbAgentId: node.dbAgentId,
      role: node.role,
      station: node.station,
      status: node.status,
      agentKind: node.agentKind,
      runtimeAgentId: node.runtimeAgentId,
      capabilities: node.capabilities,
      toolPolicy: node.toolPolicy,
      sources: Array.from(node.sources).sort(),
    }))

  const edges = Array.from(edgesByKey.values())
    .sort((a, b) => {
      if (a.type !== b.type) return a.type.localeCompare(b.type)
      if (a.fromKey !== b.fromKey) return a.fromKey.localeCompare(b.fromKey)
      return a.toKey.localeCompare(b.toKey)
    })
    .map<AgentHierarchyEdge>((edge) => {
      const from = nodesByKey.get(edge.fromKey)
      const to = nodesByKey.get(edge.toKey)
      const fromId = from?.id ?? edge.fromKey
      const toId = to?.id ?? edge.toKey

      return {
        id: `${edge.type}:${fromId}->${toId}`,
        type: edge.type,
        from: fromId,
        to: toId,
        confidence: edge.confidence,
        source: edge.source,
        sources: Array.from(edge.sources).sort(),
      }
    })

  const warnings = Array.from(warningsByKey.values()).sort((a, b) => a.message.localeCompare(b.message))

  return {
    nodes,
    edges,
    meta: {
      sources: input.sourceStatus,
      warnings,
    },
  }
}

export async function getAgentHierarchyData(): Promise<AgentHierarchyData> {
  const { yamlPath, fallbackPath } = resolveHierarchySourcePaths()

  const sourceStatus: AgentHierarchySourceStatus = {
    yaml: {
      available: false,
      path: yamlPath,
    },
    runtime: {
      available: false,
      command: 'config.agents.list.json',
    },
    fallback: {
      available: false,
      used: false,
      path: fallbackPath,
    },
    db: {
      available: false,
      count: 0,
    },
  }

  const initialWarnings: AgentHierarchyWarning[] = []

  let dbAgents: HierarchyDbAgent[] = []
  try {
    const repos = getRepos()
    const dbRows = await repos.agents.list({})
    dbAgents = dbRows.map((agent: AgentDTO) => ({
      id: agent.id,
      runtimeAgentId: compactString(agent.runtimeAgentId) ?? null,
      slug: compactString(agent.slug) ?? null,
      name: compactString(agent.name) ?? agent.id,
      displayName: compactString(agent.displayName) ?? compactString(agent.name) ?? agent.id,
      role: compactString(agent.role) ?? 'unknown',
      station: compactString(agent.station) ?? 'unknown',
      status: compactString(agent.status) ?? 'unknown',
      kind: compactString(agent.kind) ?? 'worker',
    }))
    sourceStatus.db.available = true
    sourceStatus.db.count = dbAgents.length
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    initialWarnings.push({
      code: 'source_unavailable',
      source: 'db_agents',
      message: `Failed to load DB agents: ${message}`,
    })
  }

  let yamlExtract: YamlExtractionResult | null = null
  try {
    const yamlRaw = await readFile(yamlPath, 'utf-8')
    const parsed = yaml.load(yamlRaw)
    yamlExtract = extractYamlHierarchy(parsed)
    sourceStatus.yaml.available = true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!isMissingFileError(error)) {
      sourceStatus.yaml.error = message
      initialWarnings.push({
        code: 'source_unavailable',
        source: 'clawcontrol_config_yaml',
        message: `YAML source unavailable: ${message}`,
      })
    }
  }

  let runtimeExtract: ToolOverlayResult | null = null
  const runtimeRes = await runCommandJson<unknown>('config.agents.list.json', { timeout: 30_000 })
  const runtimeMissingCli = runtimeRes.error ? isRuntimeCliUnavailableError(runtimeRes.error) : false

  if (runtimeRes.error) {
    if (!runtimeMissingCli) {
      sourceStatus.runtime.error = runtimeRes.error
    }
    if (!runtimeMissingCli) {
      initialWarnings.push({
        code: 'source_unavailable',
        source: 'runtime_openclaw_agents_list',
        message: `Runtime OpenClaw source unavailable: ${runtimeRes.error}`,
      })
    }
  } else {
    sourceStatus.runtime.available = true
    runtimeExtract = extractRuntimeToolOverlay(runtimeRes.data)
  }

  let fallbackExtract: ToolOverlayResult | null = null
  if (!runtimeExtract) {
    try {
      const fallbackRaw = await readFile(fallbackPath, 'utf-8')
      const parsed = JSON5.parse(fallbackRaw)
      fallbackExtract = extractFallbackToolOverlay(parsed)
      sourceStatus.fallback.available = true
      sourceStatus.fallback.used = true

      if (!runtimeMissingCli) {
        initialWarnings.push({
          code: 'runtime_unavailable_fallback_used',
          source: 'openclaw_template_policy',
          message: 'Runtime OpenClaw source unavailable, using fallback openclaw template policy',
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!isMissingFileError(error)) {
        sourceStatus.fallback.error = message
        initialWarnings.push({
          code: 'source_unavailable',
          source: 'openclaw_template_policy',
          message: `Fallback template source unavailable: ${message}`,
        })
      }
    }
  }

  return buildAgentHierarchyGraph({
    dbAgents,
    yaml: yamlExtract,
    runtime: runtimeExtract,
    fallback: fallbackExtract,
    sourceStatus,
    initialWarnings,
  })
}
