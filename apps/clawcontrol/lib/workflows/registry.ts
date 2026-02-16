import 'server-only'

import type {
  WorkflowConfig,
  WorkflowSelectionConfig,
  WorkflowSelectionRule,
} from '@clawcontrol/core'
import { getWorkspaceRoot } from '@/lib/fs/path-policy'
import {
  orderSelectionRulesByPrecedence,
  validateSelectionSemantics,
} from './validation'
import {
  loadWorkspaceWorkflowConfigs,
  readWorkspaceSelectionOverlay,
  writeResolvedWorkflowSnapshots,
} from './storage'

const CACHE_TTL_MS = 30_000

export interface WorkflowSelectionInput {
  requestedWorkflowId?: string | null
  priority?: string | null
  tags?: string[] | null
  title?: string | null
  goalMd?: string | null
}

export interface WorkflowSelectionResult {
  workflowId: string
  reason: 'explicit' | 'rule' | 'default'
  matchedRuleId: string | null
}

export type WorkflowSource = 'built_in' | 'custom'

export interface WorkflowDefinitionRecord {
  id: string
  source: WorkflowSource
  sourcePath: string
  updatedAt: string
  editable: boolean
  stages: number
  loops: number
  workflow: WorkflowConfig
}

export interface WorkflowRegistrySnapshot {
  workflows: WorkflowConfig[]
  selection: WorkflowSelectionConfig
  selectionSource: WorkflowSource
  definitions: WorkflowDefinitionRecord[]
  loadedAt: string
}

interface RegistryCache {
  workspaceRoot: string
  versionKey: string
  loadedAtMs: number
  workflows: WorkflowConfig[]
  workflowsById: Map<string, WorkflowConfig>
  definitions: WorkflowDefinitionRecord[]
  definitionsById: Map<string, WorkflowDefinitionRecord>
  selection: WorkflowSelectionConfig
  selectionSource: WorkflowSource
}

let cache: RegistryCache | null = null

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function normalizeTags(tags: string[] | null | undefined): Set<string> {
  const out = new Set<string>()
  for (const tag of tags ?? []) {
    const normalized = normalizeText(tag)
    if (!normalized) continue
    out.add(normalized)
  }
  return out
}

function wordMatch(text: string, keywords: string[] | undefined): boolean {
  if (!keywords || keywords.length === 0) return true
  const normalizedText = normalizeText(text)
  if (!normalizedText) return false

  for (const rawKeyword of keywords) {
    const keyword = normalizeText(rawKeyword)
    if (!keyword) continue
    if (normalizedText.includes(keyword)) return true
  }

  return false
}

function overlapMatch(tagSet: Set<string>, tagsAny: string[] | undefined): boolean {
  if (!tagsAny || tagsAny.length === 0) return true
  if (tagSet.size === 0) return false

  for (const rawTag of tagsAny) {
    const tag = normalizeText(rawTag)
    if (!tag) continue
    if (tagSet.has(tag)) return true
  }

  return false
}

function matchRule(input: WorkflowSelectionInput, rule: WorkflowSelectionRule): boolean {
  const normalizedPriority = normalizeText(input.priority)
  if (rule.priority && rule.priority.length > 0) {
    const allowed = new Set(rule.priority.map((value) => value.toUpperCase()))
    if (!allowed.has(normalizedPriority.toUpperCase())) return false
  }

  const tags = normalizeTags(input.tags)
  if (!overlapMatch(tags, rule.tagsAny)) return false
  if (!wordMatch(input.title ?? '', rule.titleKeywordsAny)) return false
  if (!wordMatch(input.goalMd ?? '', rule.goalKeywordsAny)) return false
  return true
}

function countLoopStages(workflow: WorkflowConfig): number {
  return workflow.stages.filter((stage) => stage.type === 'loop').length
}

function pickDefaultWorkflowId(workflowIds: Set<string>): string {
  if (workflowIds.has('cc_greenfield_project')) return 'cc_greenfield_project'
  if (workflowIds.has('greenfield_project')) return 'greenfield_project'

  const sorted = [...workflowIds].sort((left, right) => left.localeCompare(right))
  const fallback = sorted[0]
  if (fallback) return fallback

  throw new Error('No workflows configured')
}

function normalizeSelectionForWorkflows(
  selection: WorkflowSelectionConfig,
  workflowIds: Set<string>
): WorkflowSelectionConfig {
  const defaultWorkflowId = workflowIds.has(selection.defaultWorkflowId)
    ? selection.defaultWorkflowId
    : pickDefaultWorkflowId(workflowIds)

  const keptRules = selection.rules.filter((rule) => workflowIds.has(rule.workflowId))
  const keptRuleIds = new Set(keptRules.map((rule) => rule.id))

  const normalizedRules = keptRules.map((rule) => ({
    ...rule,
    precedes: rule.precedes?.filter((targetRuleId) => keptRuleIds.has(targetRuleId)),
  }))

  return {
    ...selection,
    defaultWorkflowId,
    rules: orderSelectionRulesByPrecedence(normalizedRules),
  }
}

function emptySelection(): WorkflowSelectionConfig {
  // Used only for UI snapshots when no workflow has been installed yet.
  return { defaultWorkflowId: '', rules: [] } as WorkflowSelectionConfig
}

async function buildRegistry(workspaceRoot: string, versionKey: string): Promise<RegistryCache> {
  const definitions: WorkflowDefinitionRecord[] = []
  const definitionsById = new Map<string, WorkflowDefinitionRecord>()
  const workflowsById = new Map<string, WorkflowConfig>()

  const workspaceEntries = await loadWorkspaceWorkflowConfigs()
  for (const entry of workspaceEntries) {
    const workflow = entry.workflow
    if (definitionsById.has(workflow.id)) {
      const existing = definitionsById.get(workflow.id) as WorkflowDefinitionRecord
      throw new Error(
        `Duplicate workflow id "${workflow.id}" in ${entry.file.workspacePath}; already defined in ${existing.sourcePath}`
      )
    }

    const record: WorkflowDefinitionRecord = {
      id: workflow.id,
      source: 'custom',
      sourcePath: entry.file.workspacePath,
      updatedAt: new Date(entry.file.updatedAtMs).toISOString(),
      editable: true,
      stages: workflow.stages.length,
      loops: countLoopStages(workflow),
      workflow,
    }

    definitions.push(record)
    definitionsById.set(workflow.id, record)
    workflowsById.set(workflow.id, workflow)
  }

  const selectionOverlay = await readWorkspaceSelectionOverlay()
  const workflowIds = new Set(workflowsById.keys())
  const selectionSource: WorkflowSource = 'custom'

  let selection: WorkflowSelectionConfig
  if (workflowIds.size === 0) {
    selection = emptySelection()
  } else {
    const rawSelection = selectionOverlay
      ? normalizeSelectionForWorkflows(selectionOverlay.selection, workflowIds)
      : {
        defaultWorkflowId: pickDefaultWorkflowId(workflowIds),
        rules: [],
      }

    validateSelectionSemantics(rawSelection, workflowIds)

    selection = {
      ...rawSelection,
      rules: orderSelectionRulesByPrecedence(rawSelection.rules),
    }
  }

  const workflows = [...workflowsById.values()].sort((a, b) => a.id.localeCompare(b.id))
  definitions.sort((a, b) => a.id.localeCompare(b.id))

  return {
    workspaceRoot,
    versionKey,
    loadedAtMs: Date.now(),
    workflows,
    workflowsById,
    definitions,
    definitionsById,
    selection,
    selectionSource,
  }
}

async function currentVersionKey(): Promise<string> {
  const workspaceEntries = await loadWorkspaceWorkflowConfigs()
  const workspaceVersions = workspaceEntries.map((entry) => {
    return `${entry.file.absolutePath}:${entry.file.updatedAtMs}:${entry.file.size}`
  })

  const overlay = await readWorkspaceSelectionOverlay()
  const overlayVersion = overlay
    ? `${overlay.absolutePath}:${overlay.updatedAtMs}:${overlay.size}`
    : 'overlay:none'

  return [...workspaceVersions, overlayVersion].sort().join('|')
}

async function loadRegistry(force = false): Promise<RegistryCache> {
  const workspaceRoot = getWorkspaceRoot()
  const now = Date.now()

  if (
    !force
    && cache
    && cache.workspaceRoot === workspaceRoot
    && now - cache.loadedAtMs < CACHE_TTL_MS
  ) {
    return cache
  }

  const versionKey = await currentVersionKey()
  if (
    !force
    && cache
    && cache.workspaceRoot === workspaceRoot
    && cache.versionKey === versionKey
  ) {
    cache = {
      ...cache,
      loadedAtMs: now,
    }
    return cache
  }

  const next = await buildRegistry(workspaceRoot, versionKey)
  cache = next
  return next
}

export async function listWorkflowConfigs(options?: {
  forceReload?: boolean
}): Promise<WorkflowConfig[]> {
  const registry = await loadRegistry(Boolean(options?.forceReload))
  return registry.workflows
}

export async function listWorkflowDefinitions(options?: {
  forceReload?: boolean
}): Promise<WorkflowDefinitionRecord[]> {
  const registry = await loadRegistry(Boolean(options?.forceReload))
  return registry.definitions
}

export async function getWorkflowConfig(
  workflowId: string,
  options?: { forceReload?: boolean }
): Promise<WorkflowConfig | null> {
  const registry = await loadRegistry(Boolean(options?.forceReload))
  return registry.workflowsById.get(workflowId) ?? null
}

export async function getWorkflowDefinition(
  workflowId: string,
  options?: { forceReload?: boolean }
): Promise<WorkflowDefinitionRecord | null> {
  const registry = await loadRegistry(Boolean(options?.forceReload))
  return registry.definitionsById.get(workflowId) ?? null
}

export async function getWorkflowSelectionConfig(options?: {
  forceReload?: boolean
}): Promise<WorkflowSelectionConfig> {
  const registry = await loadRegistry(Boolean(options?.forceReload))
  return registry.selection
}

export async function getWorkflowRegistrySnapshot(options?: {
  forceReload?: boolean
}): Promise<WorkflowRegistrySnapshot> {
  const registry = await loadRegistry(Boolean(options?.forceReload))
  return {
    workflows: registry.workflows,
    selection: registry.selection,
    selectionSource: registry.selectionSource,
    definitions: registry.definitions,
    loadedAt: new Date(registry.loadedAtMs).toISOString(),
  }
}

export async function selectWorkflowForWorkOrder(
  input: WorkflowSelectionInput,
  options?: { forceReload?: boolean }
): Promise<WorkflowSelectionResult> {
  const registry = await loadRegistry(Boolean(options?.forceReload))

  if (registry.workflowsById.size === 0) {
    throw new Error('No workflows configured. Import a package or create a workflow first.')
  }

  const requestedWorkflowId = normalizeText(input.requestedWorkflowId)
  if (requestedWorkflowId) {
    if (!registry.workflowsById.has(requestedWorkflowId)) {
      throw new Error(`Unknown requested workflow: ${requestedWorkflowId}`)
    }
    return {
      workflowId: requestedWorkflowId,
      reason: 'explicit',
      matchedRuleId: null,
    }
  }

  for (const rule of registry.selection.rules) {
    if (!matchRule(input, rule)) continue
    return {
      workflowId: rule.workflowId,
      reason: 'rule',
      matchedRuleId: rule.id,
    }
  }

  return {
    workflowId: registry.selection.defaultWorkflowId,
    reason: 'default',
    matchedRuleId: null,
  }
}

export async function isBuiltInWorkflow(
  workflowId: string,
  options?: { forceReload?: boolean }
): Promise<boolean> {
  const definition = await getWorkflowDefinition(workflowId, options)
  if (!definition) return false
  return false
}

export async function syncResolvedWorkflowSnapshots(options?: {
  forceReload?: boolean
}): Promise<{
  workflowCount: number
  selectionSource: WorkflowSource
}> {
  const registry = await loadRegistry(Boolean(options?.forceReload))
  await writeResolvedWorkflowSnapshots({
    workflows: registry.workflows,
    selection: registry.selection,
    selectionSource: registry.selectionSource,
  })

  return {
    workflowCount: registry.workflows.length,
    selectionSource: registry.selectionSource,
  }
}

export function clearWorkflowRegistryCache(): void {
  cache = null
}
