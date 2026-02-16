import 'server-only'

import type { WorkflowConfig, WorkflowSelectionConfig } from '@clawcontrol/core'
import { prisma } from '@/lib/db'
import {
  clearWorkflowRegistryCache,
  getWorkflowDefinition,
  getWorkflowRegistrySnapshot,
  syncResolvedWorkflowSnapshots,
} from './registry'
import {
  deleteWorkspaceSelectionOverlay,
  deleteWorkspaceWorkflowConfig,
  readWorkspaceSelectionOverlay,
  writeWorkspaceSelectionOverlay,
  writeWorkspaceWorkflowConfig,
} from './storage'
import {
  validateSelectionSemantics,
  validateWorkflowSemantics,
  validateSelectionSchema,
  validateWorkflowSchema,
  formatAjvErrors,
} from './validation'

const ACTIVE_WORK_ORDER_STATES = ['planned', 'active', 'blocked', 'review'] as const

export class WorkflowServiceError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
    public details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'WorkflowServiceError'
  }
}

function validateWorkflowInput(workflow: unknown, sourceLabel: string): WorkflowConfig {
  const valid = validateWorkflowSchema(workflow)
  if (!valid) {
    throw new WorkflowServiceError(
      `Workflow validation failed: ${formatAjvErrors(validateWorkflowSchema.errors)}`,
      'WORKFLOW_VALIDATION_FAILED',
      400,
      { source: sourceLabel }
    )
  }

  const parsed = workflow as WorkflowConfig
  try {
    validateWorkflowSemantics(parsed, sourceLabel)
  } catch (error) {
    throw new WorkflowServiceError(
      error instanceof Error ? error.message : 'Workflow semantic validation failed',
      'WORKFLOW_VALIDATION_FAILED',
      400,
      { source: sourceLabel }
    )
  }

  return parsed
}

function validateSelectionInput(
  selection: unknown,
  workflowIds: Set<string>,
  sourceLabel: string
): WorkflowSelectionConfig {
  const valid = validateSelectionSchema(selection)
  if (!valid) {
    throw new WorkflowServiceError(
      `Workflow selection validation failed: ${formatAjvErrors(validateSelectionSchema.errors)}`,
      'WORKFLOW_VALIDATION_FAILED',
      400,
      { source: sourceLabel }
    )
  }

  const parsed = selection as WorkflowSelectionConfig
  try {
    validateSelectionSemantics(parsed, workflowIds)
  } catch (error) {
    throw new WorkflowServiceError(
      error instanceof Error ? error.message : 'Workflow selection semantic validation failed',
      'WORKFLOW_VALIDATION_FAILED',
      400,
      { source: sourceLabel }
    )
  }

  return parsed
}

async function refreshSnapshots(): Promise<void> {
  clearWorkflowRegistryCache()
  await syncResolvedWorkflowSnapshots({ forceReload: true })
}

export async function getWorkflowUsageStats(workflowId: string): Promise<{
  totalWorkOrders: number
  activeWorkOrders: number
}> {
  const [totalWorkOrders, activeWorkOrders] = await Promise.all([
    prisma.workOrder.count({ where: { workflowId } }),
    prisma.workOrder.count({
      where: {
        workflowId,
        state: {
          in: [...ACTIVE_WORK_ORDER_STATES],
        },
      },
    }),
  ])

  return {
    totalWorkOrders,
    activeWorkOrders,
  }
}

export async function createCustomWorkflow(workflow: unknown): Promise<WorkflowConfig> {
  const parsed = validateWorkflowInput(workflow, 'request.body.workflow')
  const existing = await getWorkflowDefinition(parsed.id, { forceReload: true })
  if (existing) {
    throw new WorkflowServiceError(
      `Workflow id already exists: ${parsed.id}`,
      'WORKFLOW_ID_CONFLICT',
      409,
      {
        workflowId: parsed.id,
        source: existing.source,
      }
    )
  }

  await writeWorkspaceWorkflowConfig(parsed)
  await refreshSnapshots()
  return parsed
}

export async function updateCustomWorkflow(workflowId: string, workflow: unknown): Promise<WorkflowConfig> {
  const existing = await getWorkflowDefinition(workflowId, { forceReload: true })
  if (!existing) {
    throw new WorkflowServiceError('Workflow not found', 'WORKFLOW_NOT_FOUND', 404, { workflowId })
  }

  const parsed = validateWorkflowInput(workflow, 'request.body.workflow')
  if (parsed.id !== workflowId) {
    throw new WorkflowServiceError(
      `Workflow id mismatch: payload id ${parsed.id} must match route id ${workflowId}`,
      'WORKFLOW_ID_CONFLICT',
      400,
      { workflowId, payloadWorkflowId: parsed.id }
    )
  }

  await writeWorkspaceWorkflowConfig(parsed)
  await refreshSnapshots()
  return parsed
}

export async function deleteCustomWorkflow(workflowId: string): Promise<void> {
  const existing = await getWorkflowDefinition(workflowId, { forceReload: true })
  if (!existing) {
    throw new WorkflowServiceError('Workflow not found', 'WORKFLOW_NOT_FOUND', 404, { workflowId })
  }

  const usage = await getWorkflowUsageStats(workflowId)
  if (usage.activeWorkOrders > 0) {
    throw new WorkflowServiceError(
      `Workflow is in use by active work orders: ${workflowId}`,
      'WORKFLOW_IN_USE',
      409,
      {
        workflowId,
        activeWorkOrders: usage.activeWorkOrders,
      }
    )
  }

  await deleteWorkspaceWorkflowConfig(workflowId)
  await refreshSnapshots()
}

function buildCloneId(baseId: string, existingIds: Set<string>): string {
  let idx = 1
  while (idx < 1000) {
    const candidate = `${baseId}_clone_${idx}`
    if (!existingIds.has(candidate)) return candidate
    idx++
  }
  throw new WorkflowServiceError(
    `Could not allocate clone id for workflow ${baseId}`,
    'WORKFLOW_ID_CONFLICT',
    409,
    { workflowId: baseId }
  )
}

export async function cloneWorkflow(input: {
  workflowId: string
  cloneId?: string
  descriptionSuffix?: string
}): Promise<WorkflowConfig> {
  const snapshot = await getWorkflowRegistrySnapshot({ forceReload: true })
  const source = snapshot.definitions.find((item) => item.id === input.workflowId)
  if (!source) {
    throw new WorkflowServiceError('Workflow not found', 'WORKFLOW_NOT_FOUND', 404, {
      workflowId: input.workflowId,
    })
  }

  const existingIds = new Set(snapshot.definitions.map((item) => item.id))
  const cloneId = input.cloneId?.trim() || buildCloneId(source.id, existingIds)

  if (existingIds.has(cloneId)) {
    throw new WorkflowServiceError(
      `Workflow id already exists: ${cloneId}`,
      'WORKFLOW_ID_CONFLICT',
      409,
      { workflowId: cloneId }
    )
  }

  const clone: WorkflowConfig = {
    ...source.workflow,
    id: cloneId,
    description: input.descriptionSuffix
      ? `${source.workflow.description} ${input.descriptionSuffix}`.trim()
      : source.workflow.description,
  }

  await writeWorkspaceWorkflowConfig(clone)
  await refreshSnapshots()
  return clone
}

export async function importCustomWorkflows(workflows: unknown[]): Promise<{
  imported: WorkflowConfig[]
}> {
  if (!Array.isArray(workflows) || workflows.length === 0) {
    throw new WorkflowServiceError('No workflows provided for import', 'WORKFLOW_VALIDATION_FAILED', 400)
  }

  const parsed = workflows.map((item, idx) => validateWorkflowInput(item, `request.body.workflows[${idx}]`))
  const ids = new Set<string>()
  for (const workflow of parsed) {
    if (ids.has(workflow.id)) {
      throw new WorkflowServiceError(
        `Duplicate workflow id in import payload: ${workflow.id}`,
        'WORKFLOW_ID_CONFLICT',
        409,
        { workflowId: workflow.id }
      )
    }
    ids.add(workflow.id)
  }

  const snapshot = await getWorkflowRegistrySnapshot({ forceReload: true })
  const existingIds = new Set(snapshot.definitions.map((item) => item.id))

  for (const workflow of parsed) {
    if (existingIds.has(workflow.id)) {
      throw new WorkflowServiceError(
        `Workflow id already exists: ${workflow.id}`,
        'WORKFLOW_ID_CONFLICT',
        409,
        { workflowId: workflow.id }
      )
    }
  }

  const writtenIds: string[] = []

  try {
    for (const workflow of parsed) {
      await writeWorkspaceWorkflowConfig(workflow)
      writtenIds.push(workflow.id)
    }
  } catch (error) {
    await Promise.all(writtenIds.map(async (id) => {
      await deleteWorkspaceWorkflowConfig(id)
    }))

    throw new WorkflowServiceError(
      error instanceof Error ? error.message : 'Workflow import failed',
      'WORKFLOW_VALIDATION_FAILED',
      500
    )
  }

  await refreshSnapshots()
  return {
    imported: parsed,
  }
}

export async function getEffectiveWorkflowSelection(): Promise<{
  selection: WorkflowSelectionConfig
  source: 'built_in' | 'custom'
}> {
  const snapshot = await getWorkflowRegistrySnapshot({ forceReload: true })
  return {
    selection: snapshot.selection,
    source: snapshot.selectionSource,
  }
}

export async function upsertWorkflowSelection(selection: unknown): Promise<WorkflowSelectionConfig> {
  const snapshot = await getWorkflowRegistrySnapshot({ forceReload: true })
  const workflowIds = new Set(snapshot.definitions.map((item) => item.id))
  const parsed = validateSelectionInput(selection, workflowIds, 'request.body.selection')

  await writeWorkspaceSelectionOverlay(parsed)
  await refreshSnapshots()
  return parsed
}

export async function clearWorkflowSelectionOverlay(): Promise<void> {
  const overlay = await readWorkspaceSelectionOverlay()
  if (!overlay) return

  const result = await deleteWorkspaceSelectionOverlay()
  if (result) {
    await refreshSnapshots()
  }
}
