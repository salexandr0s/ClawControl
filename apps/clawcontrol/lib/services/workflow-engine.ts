import 'server-only'

import { Prisma } from '@prisma/client'
import type { Prisma as PrismaTypes } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getRepos } from '@/lib/repo'
import {
  getWorkflowConfig,
  selectWorkflowForWorkOrder,
  type WorkflowSelectionResult,
} from '@/lib/workflows/registry'
import type { WorkflowConfig } from '@clawcontrol/core'
import { dispatchToAgent, mapAgentToStation } from '@/lib/workflows/executor'
import { resolveCeoSessionKey, resolveWorkflowStageAgent } from '@/lib/services/agent-resolution'
import { sendToSession } from '@/lib/openclaw/sessions'
import { withIngestionLease } from '@/lib/openclaw/ingestion-lease'
import { buildOpenClawSessionKey } from '@/lib/agent-identity'
import {
  TeamHierarchyPolicyViolation,
} from '@/lib/services/team-hierarchy-policy'

const MANAGER_ACTIVITY_ACTOR = 'system:manager'
const DEFAULT_CEO_SESSION_KEY = buildOpenClawSessionKey('main')

const WORKFLOW_ENGINE_TICK_LEASE = 'workflow_engine_tick'
const WORKFLOW_ENGINE_RECOVERY_LEASE = 'workflow_engine_recovery'

const DEFAULT_OPERATION_CLAIM_TTL_MS = 15 * 60 * 1000
const ACTIVE_SESSION_MAX_AGE_MS = 5 * 60 * 1000
const STALE_OPERATION_AGE_MS = 20 * 60 * 1000
const DEFAULT_TICK_LIMIT = 25
const MAX_TICK_LIMIT = 100
const SECURITY_VETO_REASON = 'security_veto'

const OPEN_OPERATION_STATUSES = ['todo', 'in_progress', 'review', 'rework'] as const
const CLAIMABLE_OPERATION_STATUSES = ['todo', 'rework'] as const

type TxClient = PrismaTypes.TransactionClient

export type StageResult = {
  status: 'approved' | 'rejected' | 'vetoed' | 'completed'
  output: unknown
  feedback?: string
  artifacts?: string[]
}

export interface StartWorkOrderOptions {
  context?: Record<string, unknown>
  force?: boolean
  workflowIdOverride?: string
}

export interface StartWorkOrderResult {
  success: true
  workOrderId: string
  workflowId: string
  operationId: string
  stageIndex: number
  agentId: string
  agentName: string
  sessionKey: string | null
}

export interface CompletionResult {
  success: true
  operationId: string
  duplicate: boolean
  noop: boolean
  code?: 'COMPLETION_STALE_IGNORED' | 'COMPLETION_INVALID_STATE'
  reason?: string
}

export interface QueueTickResult {
  dryRun: boolean
  scanned: number
  started: number
  skipped: number
  staleRecovered: number
  failures: number
  overlapPrevented: boolean
  startedWorkOrders: string[]
  skippedWorkOrders: Array<{ workOrderId: string; reason: string }>
  failureWorkOrders: Array<{ workOrderId: string; reason: string }>
}

export interface StaleRecoveryResult {
  scanned: number
  recovered: number
  escalated: number
  failures: number
}

interface DispatchOperationResult {
  dispatched: boolean
  workflowId: string
  stageIndex: number
  operationId: string
  workOrderId: string
  agentId: string | null
  agentName: string | null
  sessionKey: string | null
  error?: string
}

interface LoopStoryInput {
  storyKey: string
  title: string
  description: string
  acceptanceCriteria: string[]
}

interface VerifyLoopMetadata {
  kind: 'story_verify'
  parentOperationId: string
  storyId: string
  loopStageIndex: number
}

interface CompletionTxOutcome {
  workOrderId: string
  workflowId: string
  dispatchOperationId: string | null
  notifyCeoMessage: string | null
  notifyCeoType: 'escalation' | 'completion' | null
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return JSON.stringify({ error: 'UNSERIALIZABLE_OUTPUT' })
  }
}

function safeJsonParse(value: string | null | undefined): unknown {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function parseAssignees(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is string => typeof value === 'string' && value.length > 0)
  } catch {
    return []
  }
}

function inferArtifactType(pathOrUrl: string): string {
  if (pathOrUrl.includes('github.com/') && pathOrUrl.includes('/pull/')) return 'pr'
  if (pathOrUrl.endsWith('.md')) return 'doc'
  if (pathOrUrl.endsWith('.png') || pathOrUrl.endsWith('.jpg') || pathOrUrl.endsWith('.jpeg')) {
    return 'screenshot'
  }
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) return 'link'
  return 'file'
}

function isCompletionSuccess(status: StageResult['status']): boolean {
  return status === 'approved' || status === 'completed'
}

function isSecurityVetoReason(value: string | null | undefined): boolean {
  return (value ?? '').toLowerCase().includes(SECURITY_VETO_REASON)
}

function evaluateCondition(condition: string, context: Record<string, unknown>): boolean {
  switch (condition) {
    case 'unknowns_exist':
      return Boolean((context as { hasUnknowns?: unknown }).hasUnknowns)
    case 'deployment_needed':
      return Boolean((context as { needsDeployment?: unknown }).needsDeployment)
    case 'security_relevant':
      return Boolean((context as { touchesSecurity?: unknown }).touchesSecurity)
    case 'code_review_needed':
      return Boolean((context as { hasCodeChanges?: unknown }).hasCodeChanges)
    default:
      return true
  }
}

function normalizeWorkflowTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((tag): tag is string => typeof tag === 'string')
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean)
  } catch {
    return []
  }
}

function parseStageAgentContext(result: StageResult): {
  agentId: string | null
  agentName: string | null
  runtimeAgentId: string | null
} {
  const output = result.output
  if (!output || typeof output !== 'object') {
    return { agentId: null, agentName: null, runtimeAgentId: null }
  }

  const maybe = output as Record<string, unknown>
  const context = maybe.context && typeof maybe.context === 'object'
    ? maybe.context as Record<string, unknown>
    : maybe

  const agentId = typeof context.agentId === 'string' ? context.agentId : null
  const agentName = typeof context.agentName === 'string' ? context.agentName : null
  const runtimeAgentId = typeof context.runtimeAgentId === 'string' ? context.runtimeAgentId : null

  return { agentId, agentName, runtimeAgentId }
}

function findStageIndexByRef(workflow: WorkflowConfig, stageRef: string): number {
  return workflow.stages.findIndex((stage) => stage.ref === stageRef || stage.agent === stageRef)
}

function parseStoriesFromOutput(output: unknown, maxStories: number): LoopStoryInput[] {
  const toStories = (rawStories: unknown[]): LoopStoryInput[] => {
    const items: LoopStoryInput[] = []
    for (let index = 0; index < rawStories.length; index++) {
      const raw = rawStories[index]
      if (!raw || typeof raw !== 'object') continue
      const obj = raw as Record<string, unknown>
      const storyKey =
        (typeof obj.storyKey === 'string' && obj.storyKey.trim()) ||
        (typeof obj.key === 'string' && obj.key.trim()) ||
        `story_${index + 1}`
      const title =
        (typeof obj.title === 'string' && obj.title.trim()) ||
        `Story ${index + 1}`
      const description =
        (typeof obj.description === 'string' && obj.description.trim()) ||
        (typeof obj.summary === 'string' && obj.summary.trim()) ||
        title

      const acceptanceRaw = Array.isArray(obj.acceptanceCriteria)
        ? obj.acceptanceCriteria
        : Array.isArray(obj.acceptance_criteria)
          ? obj.acceptance_criteria
          : []

      const acceptanceCriteria = acceptanceRaw
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean)

      items.push({
        storyKey,
        title,
        description,
        acceptanceCriteria,
      })
    }
    return items.slice(0, maxStories)
  }

  if (Array.isArray(output)) {
    return toStories(output)
  }

  if (!output || typeof output !== 'object') {
    return []
  }

  const obj = output as Record<string, unknown>
  if (Array.isArray(obj.stories)) {
    return toStories(obj.stories)
  }

  if (Array.isArray(obj.story_list)) {
    return toStories(obj.story_list)
  }

  if (typeof obj.STORIES_JSON === 'string') {
    try {
      const parsed = JSON.parse(obj.STORIES_JSON) as unknown
      if (Array.isArray(parsed)) return toStories(parsed)
    } catch {
      return []
    }
  }

  return []
}

function parseBoundedInt(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const normalized = Math.trunc(value)
  if (normalized < min || normalized > max) return null
  return normalized
}

function resolveLoopMaxStories(input: {
  stageRef: string
  configuredMaxStories: number
  initialContext: Record<string, unknown>
}): number {
  const stageRef = input.stageRef.trim().toLowerCase()
  let resolved = input.configuredMaxStories

  const globalOverride = parseBoundedInt(input.initialContext.maxStoriesOverride, 1, 50)
  if (globalOverride !== null) {
    resolved = globalOverride
  }

  const stageOverrides = input.initialContext.maxStoriesByStage
  if (stageOverrides && typeof stageOverrides === 'object' && !Array.isArray(stageOverrides)) {
    const overrides = stageOverrides as Record<string, unknown>
    const raw = overrides[input.stageRef] ?? overrides[stageRef]
    const stageOverride = parseBoundedInt(raw, 1, 50)
    if (stageOverride !== null) {
      resolved = stageOverride
    }
  }

  return resolved
}

async function getCeoSessionKey(): Promise<string> {
  const resolved = await resolveCeoSessionKey(prisma)
  return resolved ?? DEFAULT_CEO_SESSION_KEY
}

async function enforceWorkflowTeamHierarchy(input: {
  operationId: string
  workOrderId: string
  workflowId: string
  stageIndex: number
  stageRef: string
  targetAgent: {
    id: string
    displayName: string
    teamId?: string | null
    templateId?: string | null
  }
}): Promise<{
  managerAgentId: string | null
  managerTemplateId: string | null
}> {
  const targetTeamId = input.targetAgent.teamId ?? null
  if (!targetTeamId) {
    return { managerAgentId: null, managerTemplateId: null }
  }

  const team = await getRepos().agentTeams.getById(targetTeamId)
  if (!team) {
    return { managerAgentId: null, managerTemplateId: null }
  }
  const managerMember = team.hierarchy.members.manager
  if (!managerMember) {
    return { managerAgentId: null, managerTemplateId: null }
  }

  const targetTemplateId = input.targetAgent.templateId?.trim() || null
  if (!targetTemplateId) {
    throw new TeamHierarchyPolicyViolation(
      'Workflow dispatch target is missing templateId required for hierarchy enforcement',
      'MISSING_TEMPLATE_BINDING',
      {
        teamId: targetTeamId,
        targetAgentId: input.targetAgent.id,
        targetAgentName: input.targetAgent.displayName,
        ...input,
      }
    )
  }

  if (targetTemplateId === 'manager') {
    const managerAgent = team.members.find((member) => member.templateId === 'manager') ?? null
    return { managerAgentId: managerAgent?.id ?? null, managerTemplateId: 'manager' }
  }

  const allowedTargets = managerMember.delegatesTo
  const delegateEnabled = managerMember.capabilities.canDelegate !== false
  if (!delegateEnabled || !allowedTargets.includes(targetTemplateId)) {
    throw new TeamHierarchyPolicyViolation(
      `Workflow dispatch blocked: manager template cannot delegate to "${targetTemplateId}"`,
      'LINK_NOT_ALLOWED',
      {
        teamId: targetTeamId,
        targetTemplateId,
        allowedTargets,
        canDelegate: managerMember.capabilities.canDelegate,
        source: 'workflow_engine',
        workOrderId: input.workOrderId,
        operationId: input.operationId,
      }
    )
  }

  const managerAgent = team.members.find((member) => member.templateId === 'manager') ?? null
  return { managerAgentId: managerAgent?.id ?? null, managerTemplateId: 'manager' }
}

async function loadInitialContext(
  tx: TxClient,
  workOrderId: string
): Promise<Record<string, unknown>> {
  const row = await tx.activity.findFirst({
    where: {
      entityType: 'work_order',
      entityId: workOrderId,
      type: 'workflow.started',
    },
    orderBy: { ts: 'desc' },
  })

  if (!row) return {}

  try {
    const payload = JSON.parse(row.payloadJson) as { initialContext?: unknown }
    if (payload?.initialContext && typeof payload.initialContext === 'object') {
      return payload.initialContext as Record<string, unknown>
    }
  } catch {
    // ignore malformed payloads
  }

  return {}
}

async function selectWorkflow(
  workOrder: {
    workflowId: string | null
    priority: string
    title: string
    goalMd: string
    tags: string
  },
  options: {
    workflowIdOverride?: string | null
  }
): Promise<WorkflowSelectionResult> {
  const requested = options.workflowIdOverride?.trim()
  if (requested) {
    return selectWorkflowForWorkOrder({ requestedWorkflowId: requested })
  }

  const existing = workOrder.workflowId?.trim()
  if (existing) {
    return selectWorkflowForWorkOrder({ requestedWorkflowId: existing })
  }

  return selectWorkflowForWorkOrder({
    priority: workOrder.priority,
    title: workOrder.title,
    goalMd: workOrder.goalMd,
    tags: normalizeWorkflowTags(workOrder.tags),
  })
}

async function resolveWorkflowOrThrow(workflowId: string): Promise<WorkflowConfig> {
  const workflow = await getWorkflowConfig(workflowId)
  if (!workflow) {
    throw new Error(`Unknown workflow: ${workflowId}`)
  }
  return workflow
}

function buildEscalationMessage(input: {
  workOrderId: string
  workflowId: string
  stageLabel: string
  stageIndex: number
  totalStages: number
  iterationCount: number
  maxIterations: number | null
  reason: string
  feedback: string | null
}): string {
  const whatHappened =
    input.reason === 'security_veto'
      ? 'Security stage vetoed the current change.'
      : input.reason === 'iteration_cap_exceeded'
        ? `Review loop exceeded the iteration cap (${input.maxIterations ?? 'configured limit'}).`
        : input.reason === 'story_retry_exhausted'
          ? 'Story retries were exhausted during loop execution.'
          : 'Operation stalled and retry budget was exhausted.'

  return [
    `## Escalation: ${input.reason}`,
    '',
    `**Work Order:** ${input.workOrderId}`,
    `**Workflow:** ${input.workflowId} — Stage ${input.stageIndex + 1}/${input.totalStages || '?'}`,
    `**Stage:** ${input.stageLabel}`,
    `**Iterations:** ${input.iterationCount}/${input.maxIterations ?? 'N/A'}`,
    '',
    '### Feedback',
    input.feedback ?? 'No feedback provided.',
    '',
    '### Manager Summary',
    whatHappened,
    '',
    'Decision required: approve retry/resume, override gate, or cancel.',
  ].join('\n')
}

async function writeCompletionReceiptAndArtifactsTx(
  tx: TxClient,
  input: {
    operation: {
      id: string
      workOrderId: string
      workflowId: string | null
      workflowStageIndex: number
      iterationCount: number
      currentStoryId: string | null
      assigneeAgentIds: string
    }
    workflowId: string
    stageRef: string
    result: StageResult
  }
): Promise<void> {
  const now = new Date()
  const assignees = parseAssignees(input.operation.assigneeAgentIds)
  const parsedContext = parseStageAgentContext(input.result)
  const currentAgentId = assignees[0] ?? parsedContext.agentId
  const currentAgent = currentAgentId
    ? await tx.agent.findUnique({
        where: { id: currentAgentId },
        select: {
          id: true,
          name: true,
          displayName: true,
          runtimeAgentId: true,
          slug: true,
        },
      })
    : null

  const currentAgentName =
    currentAgent?.displayName?.trim() ||
    currentAgent?.name ||
    parsedContext.agentName ||
    currentAgentId ||
    input.stageRef

  const runtimeAgentId =
    currentAgent?.runtimeAgentId?.trim() ||
    currentAgent?.slug?.trim() ||
    parsedContext.runtimeAgentId ||
    currentAgentId ||
    input.stageRef

  const currentStory = input.operation.currentStoryId
    ? await tx.operationStory.findUnique({
        where: { id: input.operation.currentStoryId },
        select: {
          id: true,
          storyIndex: true,
          storyKey: true,
          title: true,
          status: true,
          retryCount: true,
        },
      })
    : null

  await tx.receipt.create({
    data: {
      workOrderId: input.operation.workOrderId,
      operationId: input.operation.id,
      kind: 'agent_run',
      commandName: `agent:${runtimeAgentId}`,
      commandArgsJson: JSON.stringify({
        workflowId: input.workflowId,
        stageIndex: input.operation.workflowStageIndex,
        stageRef: input.stageRef,
        agentId: currentAgentId,
        agentName: currentAgentName,
        runtimeAgentId,
        iterationCount: input.operation.iterationCount,
        status: input.result.status,
      }),
      exitCode: isCompletionSuccess(input.result.status) ? 0 : 1,
      durationMs: null,
      stdoutExcerpt: '',
      stderrExcerpt: '',
      parsedJson: safeJsonStringify({
        status: input.result.status,
        output: input.result.output,
        feedback: input.result.feedback,
        artifacts: input.result.artifacts,
        story: currentStory
          ? {
              id: currentStory.id,
              storyIndex: currentStory.storyIndex,
              storyKey: currentStory.storyKey,
              title: currentStory.title,
              status: currentStory.status,
              retryCount: currentStory.retryCount,
            }
          : null,
      }),
      startedAt: now,
      endedAt: now,
    },
  })

  if (Array.isArray(input.result.artifacts)) {
    for (const artifact of input.result.artifacts) {
      if (!artifact || typeof artifact !== 'string') continue
      await tx.artifact.create({
        data: {
          workOrderId: input.operation.workOrderId,
          operationId: input.operation.id,
          type: inferArtifactType(artifact),
          title: artifact,
          pathOrUrl: artifact,
          createdBy: currentAgentName,
          createdByAgentId: currentAgentId,
        },
      })
    }
  }
}

async function createNextStageOperationTx(
  tx: TxClient,
  input: {
    workOrderId: string
    workflow: WorkflowConfig
    workflowId: string
    fromStageIndex: number
    iterationCount: number
    initialContext: Record<string, unknown>
  }
): Promise<{ nextOperationId: string | null }> {
  let nextIndex = input.fromStageIndex + 1

  while (nextIndex < input.workflow.stages.length) {
    const stage = input.workflow.stages[nextIndex]
    if (stage.optional && stage.condition) {
      const conditionMet = evaluateCondition(stage.condition, input.initialContext)
      if (!conditionMet) {
        await tx.activity.create({
          data: {
            type: 'workflow.stage_skipped',
            actor: MANAGER_ACTIVITY_ACTOR,
            actorType: 'system',
            actorAgentId: null,
            entityType: 'work_order',
            entityId: input.workOrderId,
            summary: `Skipped optional stage: ${stage.ref} (${stage.condition})`,
            payloadJson: JSON.stringify({
              workflowId: input.workflowId,
              stageIndex: nextIndex,
              stageRef: stage.ref,
              condition: stage.condition,
            }),
          },
        })
        nextIndex += 1
        continue
      }
    }
    break
  }

  if (nextIndex >= input.workflow.stages.length) {
    await tx.workOrder.update({
      where: { id: input.workOrderId },
      data: {
        state: 'shipped',
        shippedAt: new Date(),
        blockedReason: null,
      },
    })

    await tx.activity.create({
      data: {
        type: 'work_order.shipped',
        actor: MANAGER_ACTIVITY_ACTOR,
        actorType: 'system',
        actorAgentId: null,
        entityType: 'work_order',
        entityId: input.workOrderId,
        summary: 'Work order completed all workflow stages',
        payloadJson: JSON.stringify({
          workflowId: input.workflowId,
        }),
      },
    })

    return { nextOperationId: null }
  }

  const nextStage = input.workflow.stages[nextIndex]
  const nextStageAgent = await resolveWorkflowStageAgent(tx, nextStage.agent)
  if (!nextStageAgent) {
    throw new Error(`No available agent for workflow stage: ${nextStage.agent}`)
  }

  const nextOperation = await tx.operation.create({
    data: {
      workOrderId: input.workOrderId,
      station: mapAgentToStation({ station: nextStageAgent.station }),
      title: `${nextStageAgent.displayName} — Stage ${nextIndex + 1}/${input.workflow.stages.length}`,
      status: 'todo',
      workflowId: input.workflowId,
      workflowStageIndex: nextIndex,
      iterationCount: input.iterationCount,
      assigneeAgentIds: JSON.stringify([nextStageAgent.id]),
      executionType: nextStage.type ?? 'single',
      loopConfigJson: nextStage.loop ? safeJsonStringify(nextStage.loop) : null,
      currentStoryId: null,
      retryCount: 0,
      maxRetries: 2,
      claimedBy: null,
      claimExpiresAt: null,
      lastClaimedAt: null,
    },
  })

  await tx.workOrder.update({
    where: { id: input.workOrderId },
    data: {
      state: 'active',
      blockedReason: null,
      currentStage: nextIndex,
    },
  })

  await tx.activity.create({
    data: {
      type: 'workflow.advanced',
      actor: MANAGER_ACTIVITY_ACTOR,
      actorType: 'system',
      actorAgentId: null,
      entityType: 'operation',
      entityId: nextOperation.id,
      summary: `Advanced to stage ${nextIndex + 1}/${input.workflow.stages.length} (${nextStage.ref})`,
      payloadJson: JSON.stringify({
        workflowId: input.workflowId,
        fromStageIndex: input.fromStageIndex,
        toStageIndex: nextIndex,
        stageRef: nextStage.ref,
        agentId: nextStageAgent.id,
        agentName: nextStageAgent.displayName,
      }),
    },
  })

  return { nextOperationId: nextOperation.id }
}

async function escalateOperationTx(
  tx: TxClient,
  input: {
    operationId: string
    workOrderId: string
    workflowId: string
    stageIndex: number
    stageLabel: string
    totalStages: number
    iterationCount: number
    maxIterations: number | null
    reason: 'security_veto' | 'iteration_cap_exceeded' | 'story_retry_exhausted' | 'stale_timeout_exceeded'
    feedback: string | null
    approvalType: 'risky_action' | 'scope_change'
  }
): Promise<string> {
  const escalationMessage = buildEscalationMessage({
    workOrderId: input.workOrderId,
    workflowId: input.workflowId,
    stageLabel: input.stageLabel,
    stageIndex: input.stageIndex,
    totalStages: input.totalStages,
    iterationCount: input.iterationCount,
    maxIterations: input.maxIterations,
    reason: input.reason,
    feedback: input.feedback,
  })

  await tx.operation.update({
    where: { id: input.operationId },
    data: {
      status: 'blocked',
      escalatedAt: new Date(),
      escalationReason: input.reason,
      blockedReason: input.feedback ?? input.reason,
      claimedBy: null,
      claimExpiresAt: null,
    },
  })

  await tx.workOrder.update({
    where: { id: input.workOrderId },
    data: {
      state: 'blocked',
      blockedReason: input.feedback ?? input.reason,
    },
  })

  await tx.approval.create({
    data: {
      workOrderId: input.workOrderId,
      operationId: input.operationId,
      type: input.approvalType,
      questionMd: escalationMessage,
      status: 'pending',
    },
  })

  await tx.activity.create({
    data: {
      type: `escalation.${input.reason}`,
      actor: MANAGER_ACTIVITY_ACTOR,
      actorType: 'system',
      actorAgentId: null,
      entityType: 'operation',
      entityId: input.operationId,
      summary: `Escalated to CEO: ${input.reason}`,
      payloadJson: JSON.stringify({
        workflowId: input.workflowId,
        stageIndex: input.stageIndex,
        stageRef: input.stageLabel,
        feedback: input.feedback,
      }),
    },
  })

  return escalationMessage
}

async function buildLoopDispatchContext(operationId: string, currentStoryId: string | null): Promise<Record<string, unknown>> {
  const stories = await prisma.operationStory.findMany({
    where: { operationId },
    orderBy: { storyIndex: 'asc' },
    select: {
      id: true,
      storyIndex: true,
      storyKey: true,
      title: true,
      description: true,
      status: true,
      retryCount: true,
      outputJson: true,
    },
  })

  const completed = stories.filter((story) => story.status === 'done')
  const remaining = stories.filter((story) => story.status !== 'done')
  const currentStory = currentStoryId
    ? stories.find((story) => story.id === currentStoryId) ?? null
    : null

  const currentStoryOutput = currentStory ? safeJsonParse(currentStory.outputJson) : null
  const verifyFeedback =
    currentStoryOutput &&
    typeof currentStoryOutput === 'object' &&
    typeof (currentStoryOutput as Record<string, unknown>).verify_feedback === 'string'
      ? (currentStoryOutput as Record<string, string>).verify_feedback
      : null

  return {
    current_story: currentStory
      ? {
          id: currentStory.id,
          story_index: currentStory.storyIndex,
          story_key: currentStory.storyKey,
          title: currentStory.title,
          description: currentStory.description,
          retry_count: currentStory.retryCount,
        }
      : null,
    current_story_id: currentStory?.id ?? null,
    completed_stories: completed.length,
    stories_remaining: remaining.length,
    verify_feedback: verifyFeedback,
  }
}

async function tryClaimOperation(operationId: string): Promise<boolean> {
  const now = new Date()
  const claimExpiresAt = new Date(now.getTime() + DEFAULT_OPERATION_CLAIM_TTL_MS)

  const claimed = await prisma.operation.updateMany({
    where: {
      id: operationId,
      status: { in: [...CLAIMABLE_OPERATION_STATUSES] },
      OR: [
        { claimExpiresAt: null },
        { claimExpiresAt: { lt: now } },
      ],
    },
    data: {
      status: 'in_progress',
      blockedReason: null,
      claimedBy: MANAGER_ACTIVITY_ACTOR,
      claimExpiresAt,
      lastClaimedAt: now,
    },
  })

  return claimed.count > 0
}

async function dispatchOperation(operationId: string): Promise<DispatchOperationResult> {
  const operation = await prisma.operation.findUnique({
    where: { id: operationId },
    include: { workOrder: true },
  })

  if (!operation) {
    return {
      dispatched: false,
      workflowId: '',
      stageIndex: 0,
      operationId,
      workOrderId: '',
      agentId: null,
      agentName: null,
      sessionKey: null,
      error: 'Operation not found',
    }
  }

  const workflowId = operation.workflowId ?? operation.workOrder.workflowId
  if (!workflowId) {
    return {
      dispatched: false,
      workflowId: '',
      stageIndex: operation.workflowStageIndex,
      operationId: operation.id,
      workOrderId: operation.workOrderId,
      agentId: null,
      agentName: null,
      sessionKey: null,
      error: 'Operation missing workflowId',
    }
  }

  const workflow = await resolveWorkflowOrThrow(workflowId)
  const stageIndex = operation.workflowStageIndex
  const stage = workflow.stages[stageIndex]

  if (!stage) {
    return {
      dispatched: false,
      workflowId,
      stageIndex,
      operationId: operation.id,
      workOrderId: operation.workOrderId,
      agentId: null,
      agentName: null,
      sessionKey: null,
      error: `Workflow stage out of range: ${stageIndex}`,
    }
  }

  const claimed = await tryClaimOperation(operation.id)
  if (!claimed) {
    return {
      dispatched: false,
      workflowId,
      stageIndex,
      operationId: operation.id,
      workOrderId: operation.workOrderId,
      agentId: null,
      agentName: null,
      sessionKey: null,
      error: 'Operation claim failed',
    }
  }

  const agent = await resolveWorkflowStageAgent(prisma, stage.agent)
  if (!agent) {
    await prisma.operation.update({
      where: { id: operation.id },
      data: {
        status: 'blocked',
        blockedReason: `No available agent for workflow stage: ${stage.agent}`,
        claimedBy: null,
        claimExpiresAt: null,
      },
    })

    return {
      dispatched: false,
      workflowId,
      stageIndex,
      operationId: operation.id,
      workOrderId: operation.workOrderId,
      agentId: null,
      agentName: null,
      sessionKey: null,
      error: `No available agent for workflow stage: ${stage.agent}`,
    }
  }

  try {
    await enforceWorkflowTeamHierarchy({
      operationId: operation.id,
      workOrderId: operation.workOrderId,
      workflowId,
      stageIndex,
      stageRef: stage.ref,
      targetAgent: {
        id: agent.id,
        displayName: agent.displayName,
        teamId: (agent as { teamId?: string | null }).teamId ?? null,
        templateId: (agent as { templateId?: string | null }).templateId ?? null,
      },
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Hierarchy policy blocked dispatch'
    const details = error instanceof TeamHierarchyPolicyViolation ? error.details : null

    await prisma.operation.update({
      where: { id: operation.id },
      data: {
        status: 'blocked',
        blockedReason: reason,
        claimedBy: null,
        claimExpiresAt: null,
      },
    })

    await prisma.activity.create({
      data: {
        type: 'workflow.dispatch_blocked_hierarchy',
        actor: MANAGER_ACTIVITY_ACTOR,
        actorType: 'system',
        actorAgentId: null,
        entityType: 'operation',
        entityId: operation.id,
        summary: `Dispatch blocked by team hierarchy for ${agent.displayName}`,
        payloadJson: JSON.stringify({
          workflowId,
          stageIndex,
          stageRef: stage.ref,
          targetAgentId: agent.id,
          targetAgentName: agent.displayName,
          reason,
          details,
        }),
      },
    })

    return {
      dispatched: false,
      workflowId,
      stageIndex,
      operationId: operation.id,
      workOrderId: operation.workOrderId,
      agentId: agent.id,
      agentName: agent.displayName,
      sessionKey: null,
      error: reason,
    }
  }

  await prisma.operation.update({
    where: { id: operation.id },
    data: {
      station: mapAgentToStation({ station: agent.station }),
      assigneeAgentIds: JSON.stringify([agent.id]),
      blockedReason: null,
    },
  })

  if (operation.executionType === 'loop' && operation.currentStoryId) {
    await prisma.operationStory.update({
      where: { id: operation.currentStoryId },
      data: { status: 'running' },
    }).catch(() => {})
  }

  const loopContext = operation.executionType === 'loop'
    ? await buildLoopDispatchContext(operation.id, operation.currentStoryId)
    : {}

  const task = [
    operation.workOrder.goalMd ?? '',
    '',
    operation.notes ? '---\nContext:\n' + operation.notes : '',
  ]
    .filter(Boolean)
    .join('\n')

  try {
    const spawned = await dispatchToAgent({
      agentId: agent.id,
      workOrderId: operation.workOrderId,
      operationId: operation.id,
      task,
      context: {
        workOrderId: operation.workOrderId,
        operationId: operation.id,
        workflowId,
        stageIndex,
        stageRef: stage.ref,
        stageAgentRef: stage.agent,
        executionType: operation.executionType,
        ...loopContext,
      },
    })

    await prisma.activity.create({
      data: {
        type: 'workflow.dispatched',
        actor: MANAGER_ACTIVITY_ACTOR,
        actorType: 'system',
        actorAgentId: null,
        entityType: 'operation',
        entityId: operation.id,
        summary: `Dispatched ${agent.displayName} for stage ${stageIndex + 1}`,
        payloadJson: JSON.stringify({
          workflowId,
          stageIndex,
          stageRef: stage.ref,
          agentId: agent.id,
          agentName: agent.displayName,
          sessionKey: spawned.sessionKey,
          sessionId: spawned.sessionId,
          storyId: operation.currentStoryId,
        }),
      },
    })

    return {
      dispatched: true,
      workflowId,
      stageIndex,
      operationId: operation.id,
      workOrderId: operation.workOrderId,
      agentId: agent.id,
      agentName: agent.displayName,
      sessionKey: spawned.sessionKey,
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    await prisma.operation.update({
      where: { id: operation.id },
      data: {
        status: 'blocked',
        blockedReason: reason,
        claimedBy: null,
        claimExpiresAt: null,
      },
    })

    await prisma.activity.create({
      data: {
        type: 'workflow.dispatch_failed',
        actor: MANAGER_ACTIVITY_ACTOR,
        actorType: 'system',
        actorAgentId: null,
        entityType: 'operation',
        entityId: operation.id,
        summary: `Dispatch failed for ${agent.displayName}`,
        payloadJson: JSON.stringify({
          workflowId,
          stageIndex,
          stageRef: stage.ref,
          agentId: agent.id,
          agentName: agent.displayName,
          error: reason,
        }),
      },
    })

    return {
      dispatched: false,
      workflowId,
      stageIndex,
      operationId: operation.id,
      workOrderId: operation.workOrderId,
      agentId: agent.id,
      agentName: agent.displayName,
      sessionKey: null,
      error: reason,
    }
  }
}

function parseVerifyLoopMetadata(operation: { loopConfigJson: string | null }): VerifyLoopMetadata | null {
  const parsed = safeJsonParse(operation.loopConfigJson)
  if (!parsed || typeof parsed !== 'object') return null
  const record = parsed as Record<string, unknown>
  if (record.kind !== 'story_verify') return null
  if (typeof record.parentOperationId !== 'string') return null
  if (typeof record.storyId !== 'string') return null
  if (typeof record.loopStageIndex !== 'number') return null
  return {
    kind: 'story_verify',
    parentOperationId: record.parentOperationId,
    storyId: record.storyId,
    loopStageIndex: record.loopStageIndex,
  }
}

async function handleLoopFailureTx(
  tx: TxClient,
  input: {
    operation: {
      id: string
      workOrderId: string
      workflowId: string | null
      workflowStageIndex: number
      iterationCount: number
      currentStoryId: string | null
    }
    workflowId: string
    workflow: WorkflowConfig
    stageRef: string
    storyId: string
    feedback: string | null
    reasonLabel: string
  }
): Promise<CompletionTxOutcome> {
  const story = await tx.operationStory.findUnique({
    where: { id: input.storyId },
  })

  if (!story) {
    throw new Error(`Story not found: ${input.storyId}`)
  }

  const nextRetry = story.retryCount + 1
  if (nextRetry > story.maxRetries) {
    await tx.operationStory.update({
      where: { id: story.id },
      data: {
        status: 'failed',
        retryCount: nextRetry,
        outputJson: safeJsonStringify({
          verify_feedback: input.feedback,
          reason: input.reasonLabel,
        }),
      },
    })

    const message = await escalateOperationTx(tx, {
      operationId: input.operation.id,
      workOrderId: input.operation.workOrderId,
      workflowId: input.workflowId,
      stageIndex: input.operation.workflowStageIndex,
      stageLabel: input.stageRef,
      totalStages: input.workflow.stages.length,
      iterationCount: input.operation.iterationCount,
      maxIterations: story.maxRetries,
      reason: 'story_retry_exhausted',
      feedback: input.feedback,
      approvalType: 'scope_change',
    })

    return {
      workOrderId: input.operation.workOrderId,
      workflowId: input.workflowId,
      dispatchOperationId: null,
      notifyCeoMessage: message,
      notifyCeoType: 'escalation',
    }
  }

  await tx.operationStory.update({
    where: { id: story.id },
    data: {
      status: 'pending',
      retryCount: nextRetry,
      outputJson: safeJsonStringify({
        verify_feedback: input.feedback,
        reason: input.reasonLabel,
      }),
    },
  })

  await tx.operation.update({
    where: { id: input.operation.id },
    data: {
      status: 'todo',
      currentStoryId: story.id,
      blockedReason: null,
      claimedBy: null,
      claimExpiresAt: null,
    },
  })

  await tx.activity.create({
    data: {
      type: 'workflow.story_retry',
      actor: MANAGER_ACTIVITY_ACTOR,
      actorType: 'system',
      actorAgentId: null,
      entityType: 'operation',
      entityId: input.operation.id,
      summary: `Retrying story ${story.storyIndex + 1}: ${story.title}`,
      payloadJson: JSON.stringify({
        workflowId: input.workflowId,
        stageRef: input.stageRef,
        storyId: story.id,
        storyIndex: story.storyIndex,
        retryCount: nextRetry,
      }),
    },
  })

  return {
    workOrderId: input.operation.workOrderId,
    workflowId: input.workflowId,
    dispatchOperationId: input.operation.id,
    notifyCeoMessage: null,
    notifyCeoType: null,
  }
}

async function handleVerifyStoryCompletionTx(
  tx: TxClient,
  input: {
    operation: {
      id: string
      workOrderId: string
      workflowId: string | null
      workflowStageIndex: number
      iterationCount: number
      currentStoryId: string | null
      loopConfigJson: string | null
    }
    workflowId: string
    workflow: WorkflowConfig
    stageRef: string
    result: StageResult
    initialContext: Record<string, unknown>
  }
): Promise<CompletionTxOutcome> {
  const metadata = parseVerifyLoopMetadata(input.operation)
  if (!metadata) {
    throw new Error(`Invalid verify operation metadata for operation ${input.operation.id}`)
  }

  const parentOperation = await tx.operation.findUnique({
    where: { id: metadata.parentOperationId },
  })
  if (!parentOperation) {
    throw new Error(`Parent loop operation not found: ${metadata.parentOperationId}`)
  }

  const parentStage = input.workflow.stages[metadata.loopStageIndex]
  const parentStageRef = parentStage?.ref ?? `stage_${metadata.loopStageIndex}`
  const success = isCompletionSuccess(input.result.status)

  await tx.operation.update({
    where: { id: input.operation.id },
    data: {
      status: success ? 'done' : 'blocked',
      notes: input.result.feedback ?? null,
      blockedReason: success ? null : (input.result.feedback ?? input.result.status),
      claimedBy: null,
      claimExpiresAt: null,
    },
  })

  if (!success) {
    return handleLoopFailureTx(tx, {
      operation: parentOperation,
      workflowId: input.workflowId,
      workflow: input.workflow,
      stageRef: parentStageRef,
      storyId: metadata.storyId,
      feedback: input.result.feedback ?? null,
      reasonLabel: 'verify_rejected',
    })
  }

  await tx.operationStory.update({
    where: { id: metadata.storyId },
    data: {
      status: 'done',
      outputJson: safeJsonStringify({
        output: input.result.output,
        verify_feedback: input.result.feedback ?? null,
      }),
    },
  })

  const nextStory = await tx.operationStory.findFirst({
    where: {
      operationId: parentOperation.id,
      status: 'pending',
    },
    orderBy: { storyIndex: 'asc' },
  })

  if (nextStory) {
    await tx.operation.update({
      where: { id: parentOperation.id },
      data: {
        status: 'todo',
        currentStoryId: nextStory.id,
        blockedReason: null,
        claimedBy: null,
        claimExpiresAt: null,
      },
    })

    return {
      workOrderId: parentOperation.workOrderId,
      workflowId: input.workflowId,
      dispatchOperationId: parentOperation.id,
      notifyCeoMessage: null,
      notifyCeoType: null,
    }
  }

  await tx.operation.update({
    where: { id: parentOperation.id },
    data: {
      status: 'done',
      currentStoryId: null,
      blockedReason: null,
      claimedBy: null,
      claimExpiresAt: null,
    },
  })

  const next = await createNextStageOperationTx(tx, {
    workOrderId: parentOperation.workOrderId,
    workflow: input.workflow,
    workflowId: input.workflowId,
    fromStageIndex: metadata.loopStageIndex,
    iterationCount: parentOperation.iterationCount,
    initialContext: input.initialContext,
  })

  if (!next.nextOperationId) {
    return {
      workOrderId: parentOperation.workOrderId,
      workflowId: input.workflowId,
      dispatchOperationId: null,
      notifyCeoMessage: `Work Order Complete: ${parentOperation.workOrderId}\n\nWorkflow: ${input.workflowId}`,
      notifyCeoType: 'completion',
    }
  }

  return {
    workOrderId: parentOperation.workOrderId,
    workflowId: input.workflowId,
    dispatchOperationId: next.nextOperationId,
    notifyCeoMessage: null,
    notifyCeoType: null,
  }
}

async function handleLoopStageCompletionTx(
  tx: TxClient,
  input: {
    operation: {
      id: string
      workOrderId: string
      workflowId: string | null
      workflowStageIndex: number
      iterationCount: number
      currentStoryId: string | null
      maxRetries: number
    }
    workflowId: string
    workflow: WorkflowConfig
    stage: WorkflowConfig['stages'][number]
    result: StageResult
    initialContext: Record<string, unknown>
  }
): Promise<CompletionTxOutcome> {
  const configuredMaxStories = input.stage.loop?.maxStories ?? 25
  const maxStories = resolveLoopMaxStories({
    stageRef: input.stage.ref,
    configuredMaxStories,
    initialContext: input.initialContext,
  })
  const currentStoryId = input.operation.currentStoryId
  const success = isCompletionSuccess(input.result.status)

  if (!currentStoryId) {
    const stories = parseStoriesFromOutput(input.result.output, maxStories)
    if (stories.length === 0) {
      const message = await escalateOperationTx(tx, {
        operationId: input.operation.id,
        workOrderId: input.operation.workOrderId,
        workflowId: input.workflowId,
        stageIndex: input.operation.workflowStageIndex,
        stageLabel: input.stage.ref,
        totalStages: input.workflow.stages.length,
        iterationCount: input.operation.iterationCount,
        maxIterations: input.operation.maxRetries,
        reason: 'story_retry_exhausted',
        feedback: input.result.feedback ?? 'Loop stage did not return STORIES_JSON.',
        approvalType: 'scope_change',
      })

      return {
        workOrderId: input.operation.workOrderId,
        workflowId: input.workflowId,
        dispatchOperationId: null,
        notifyCeoMessage: message,
        notifyCeoType: 'escalation',
      }
    }

    await tx.operationStory.deleteMany({
      where: { operationId: input.operation.id },
    })

    for (let index = 0; index < stories.length; index++) {
      const story = stories[index]
      await tx.operationStory.create({
        data: {
          operationId: input.operation.id,
          workOrderId: input.operation.workOrderId,
          storyIndex: index,
          storyKey: story.storyKey,
          title: story.title,
          description: story.description,
          acceptanceCriteriaJson: safeJsonStringify(story.acceptanceCriteria),
          status: 'pending',
          outputJson: null,
          retryCount: 0,
          maxRetries: input.operation.maxRetries,
        },
      })
    }

    const firstStory = await tx.operationStory.findFirst({
      where: { operationId: input.operation.id },
      orderBy: { storyIndex: 'asc' },
    })

    if (!firstStory) {
      throw new Error('Failed to initialize loop stories')
    }

    await tx.operation.update({
      where: { id: input.operation.id },
      data: {
        status: 'todo',
        currentStoryId: firstStory.id,
        blockedReason: null,
        claimedBy: null,
        claimExpiresAt: null,
      },
    })

    await tx.activity.create({
      data: {
        type: 'workflow.loop_initialized',
        actor: MANAGER_ACTIVITY_ACTOR,
        actorType: 'system',
        actorAgentId: null,
        entityType: 'operation',
        entityId: input.operation.id,
        summary: `Initialized ${stories.length} stories`,
        payloadJson: JSON.stringify({
          workflowId: input.workflowId,
          stageRef: input.stage.ref,
          storyCount: stories.length,
          maxStoriesConfigured: configuredMaxStories,
          maxStoriesUsed: maxStories,
        }),
      },
    })

    return {
      workOrderId: input.operation.workOrderId,
      workflowId: input.workflowId,
      dispatchOperationId: input.operation.id,
      notifyCeoMessage: null,
      notifyCeoType: null,
    }
  }

  if (!success) {
    return handleLoopFailureTx(tx, {
      operation: input.operation,
      workflowId: input.workflowId,
      workflow: input.workflow,
      stageRef: input.stage.ref,
      storyId: currentStoryId,
      feedback: input.result.feedback ?? null,
      reasonLabel: 'story_rejected',
    })
  }

  if (input.stage.loop?.verifyEach && input.stage.loop.verifyStageRef) {
    const verifyStageIndex = findStageIndexByRef(input.workflow, input.stage.loop.verifyStageRef)
    if (verifyStageIndex === -1) {
      throw new Error(`verifyStageRef not found: ${input.stage.loop.verifyStageRef}`)
    }

    const verifyStage = input.workflow.stages[verifyStageIndex]
    const verifyAgent = await resolveWorkflowStageAgent(tx, verifyStage.agent)
    if (!verifyAgent) {
      throw new Error(`No available agent for verify stage: ${verifyStage.agent}`)
    }

    const verifyOperation = await tx.operation.create({
      data: {
        workOrderId: input.operation.workOrderId,
        station: mapAgentToStation({ station: verifyAgent.station }),
        title: `${verifyAgent.displayName} — Verify story`,
        notes: input.result.feedback ?? null,
        status: 'todo',
        workflowId: input.workflowId,
        workflowStageIndex: verifyStageIndex,
        iterationCount: input.operation.iterationCount,
        assigneeAgentIds: JSON.stringify([verifyAgent.id]),
        executionType: 'single',
        loopConfigJson: safeJsonStringify({
          kind: 'story_verify',
          parentOperationId: input.operation.id,
          storyId: currentStoryId,
          loopStageIndex: input.operation.workflowStageIndex,
        } satisfies VerifyLoopMetadata),
        currentStoryId: currentStoryId,
        retryCount: 0,
        maxRetries: input.operation.maxRetries,
      },
    })

    await tx.operation.update({
      where: { id: input.operation.id },
      data: {
        status: 'review',
        blockedReason: null,
        claimedBy: null,
        claimExpiresAt: null,
      },
    })

    await tx.activity.create({
      data: {
        type: 'workflow.story_verify_requested',
        actor: MANAGER_ACTIVITY_ACTOR,
        actorType: 'system',
        actorAgentId: null,
        entityType: 'operation',
        entityId: verifyOperation.id,
        summary: 'Created story verification step',
        payloadJson: JSON.stringify({
          workflowId: input.workflowId,
          parentOperationId: input.operation.id,
          storyId: currentStoryId,
          verifyStageRef: verifyStage.ref,
        }),
      },
    })

    return {
      workOrderId: input.operation.workOrderId,
      workflowId: input.workflowId,
      dispatchOperationId: verifyOperation.id,
      notifyCeoMessage: null,
      notifyCeoType: null,
    }
  }

  await tx.operationStory.update({
    where: { id: currentStoryId },
    data: {
      status: 'done',
      outputJson: safeJsonStringify({
        output: input.result.output,
        feedback: input.result.feedback ?? null,
      }),
    },
  })

  const nextStory = await tx.operationStory.findFirst({
    where: {
      operationId: input.operation.id,
      status: 'pending',
    },
    orderBy: { storyIndex: 'asc' },
  })

  if (nextStory) {
    await tx.operation.update({
      where: { id: input.operation.id },
      data: {
        status: 'todo',
        currentStoryId: nextStory.id,
        blockedReason: null,
        claimedBy: null,
        claimExpiresAt: null,
      },
    })

    return {
      workOrderId: input.operation.workOrderId,
      workflowId: input.workflowId,
      dispatchOperationId: input.operation.id,
      notifyCeoMessage: null,
      notifyCeoType: null,
    }
  }

  await tx.operation.update({
    where: { id: input.operation.id },
    data: {
      status: 'done',
      currentStoryId: null,
      blockedReason: null,
      claimedBy: null,
      claimExpiresAt: null,
    },
  })

  const next = await createNextStageOperationTx(tx, {
    workOrderId: input.operation.workOrderId,
    workflow: input.workflow,
    workflowId: input.workflowId,
    fromStageIndex: input.operation.workflowStageIndex,
    iterationCount: input.operation.iterationCount,
    initialContext: input.initialContext,
  })

  if (!next.nextOperationId) {
    return {
      workOrderId: input.operation.workOrderId,
      workflowId: input.workflowId,
      dispatchOperationId: null,
      notifyCeoMessage: `Work Order Complete: ${input.operation.workOrderId}\n\nWorkflow: ${input.workflowId}`,
      notifyCeoType: 'completion',
    }
  }

  return {
    workOrderId: input.operation.workOrderId,
    workflowId: input.workflowId,
    dispatchOperationId: next.nextOperationId,
    notifyCeoMessage: null,
    notifyCeoType: null,
  }
}

async function handleSingleStageCompletionTx(
  tx: TxClient,
  input: {
    operation: {
      id: string
      workOrderId: string
      workflowId: string | null
      workflowStageIndex: number
      iterationCount: number
    }
    workflowId: string
    workflow: WorkflowConfig
    stage: WorkflowConfig['stages'][number]
    result: StageResult
    initialContext: Record<string, unknown>
  }
): Promise<CompletionTxOutcome> {
  if (input.result.status === 'vetoed' && input.stage.canVeto) {
    const reason = input.result.feedback?.trim()
      ? `${SECURITY_VETO_REASON}: ${input.result.feedback.trim()}`
      : SECURITY_VETO_REASON

    await tx.operation.update({
      where: { id: input.operation.id },
      data: {
        status: 'blocked',
        notes: input.result.feedback ?? null,
        blockedReason: reason,
        escalationReason: SECURITY_VETO_REASON,
        escalatedAt: new Date(),
        claimedBy: null,
        claimExpiresAt: null,
      },
    })

    await tx.workOrder.update({
      where: { id: input.operation.workOrderId },
      data: {
        state: 'blocked',
        blockedReason: reason,
      },
    })

    await tx.activity.create({
      data: {
        type: 'workflow.security_veto',
        actor: MANAGER_ACTIVITY_ACTOR,
        actorType: 'system',
        actorAgentId: null,
        entityType: 'work_order',
        entityId: input.operation.workOrderId,
        summary: `Security veto at stage ${input.stage.ref} permanently blocked the run`,
        payloadJson: JSON.stringify({
          workflowId: input.workflowId,
          stageIndex: input.operation.workflowStageIndex,
          stageRef: input.stage.ref,
          operationId: input.operation.id,
          feedback: input.result.feedback ?? null,
          final: true,
        }),
      },
    })

    return {
      workOrderId: input.operation.workOrderId,
      workflowId: input.workflowId,
      dispatchOperationId: null,
      notifyCeoMessage: `Security Veto Finalized: ${input.operation.workOrderId}\n\nStage: ${input.stage.ref}\nReason: ${input.result.feedback ?? 'Security veto issued'}`,
      notifyCeoType: 'escalation',
    }
  }

  if (input.result.status === 'rejected' && input.stage.loopTarget) {
    const maxIterations = input.stage.maxIterations ?? 2
    if (input.operation.iterationCount >= maxIterations) {
      const message = await escalateOperationTx(tx, {
        operationId: input.operation.id,
        workOrderId: input.operation.workOrderId,
        workflowId: input.workflowId,
        stageIndex: input.operation.workflowStageIndex,
        stageLabel: input.stage.ref,
        totalStages: input.workflow.stages.length,
        iterationCount: input.operation.iterationCount,
        maxIterations,
        reason: 'iteration_cap_exceeded',
        feedback: input.result.feedback ?? null,
        approvalType: 'scope_change',
      })

      return {
        workOrderId: input.operation.workOrderId,
        workflowId: input.workflowId,
        dispatchOperationId: null,
        notifyCeoMessage: message,
        notifyCeoType: 'escalation',
      }
    }

    const targetIndex = findStageIndexByRef(input.workflow, input.stage.loopTarget)
    if (targetIndex === -1) {
      throw new Error(`Loop target not found: ${input.stage.loopTarget}`)
    }

    const targetStage = input.workflow.stages[targetIndex]
    const targetAgent = await resolveWorkflowStageAgent(tx, targetStage.agent)
    if (!targetAgent) {
      throw new Error(`No available agent for workflow stage: ${targetStage.agent}`)
    }

    const nextIteration = input.operation.iterationCount + 1
    const loopOp = await tx.operation.create({
      data: {
        workOrderId: input.operation.workOrderId,
        station: mapAgentToStation({ station: targetAgent.station }),
        title: `[Rework] ${targetAgent.displayName} (iteration ${nextIteration})`,
        notes: input.result.feedback ?? null,
        status: 'todo',
        workflowId: input.workflowId,
        workflowStageIndex: targetIndex,
        iterationCount: nextIteration,
        loopTargetOpId: input.operation.id,
        assigneeAgentIds: JSON.stringify([targetAgent.id]),
        executionType: targetStage.type ?? 'single',
        loopConfigJson: targetStage.loop ? safeJsonStringify(targetStage.loop) : null,
        retryCount: 0,
        maxRetries: 2,
      },
    })

    await tx.operation.update({
      where: { id: input.operation.id },
      data: {
        status: 'rework',
        notes: input.result.feedback ?? null,
        blockedReason: null,
        claimedBy: null,
        claimExpiresAt: null,
      },
    })

    await tx.workOrder.update({
      where: { id: input.operation.workOrderId },
      data: {
        state: 'active',
        blockedReason: null,
        currentStage: targetIndex,
      },
    })

    await tx.activity.create({
      data: {
        type: 'workflow.loop',
        actor: MANAGER_ACTIVITY_ACTOR,
        actorType: 'system',
        actorAgentId: null,
        entityType: 'operation',
        entityId: loopOp.id,
        summary: `Looped back to ${targetStage.ref} (iteration ${nextIteration})`,
        payloadJson: JSON.stringify({
          workflowId: input.workflowId,
          fromStageIndex: input.operation.workflowStageIndex,
          toStageIndex: targetIndex,
          stageRef: targetStage.ref,
          previousOpId: input.operation.id,
        }),
      },
    })

    return {
      workOrderId: input.operation.workOrderId,
      workflowId: input.workflowId,
      dispatchOperationId: loopOp.id,
      notifyCeoMessage: null,
      notifyCeoType: null,
    }
  }

  const success = isCompletionSuccess(input.result.status)
  await tx.operation.update({
    where: { id: input.operation.id },
    data: {
      status: success ? 'done' : 'blocked',
      notes: input.result.feedback ?? null,
      blockedReason: success ? null : (input.result.feedback ?? input.result.status),
      claimedBy: null,
      claimExpiresAt: null,
    },
  })

  if (!success) {
    await tx.workOrder.update({
      where: { id: input.operation.workOrderId },
      data: {
        state: 'blocked',
        blockedReason: input.result.feedback ?? input.result.status,
      },
    })

    return {
      workOrderId: input.operation.workOrderId,
      workflowId: input.workflowId,
      dispatchOperationId: null,
      notifyCeoMessage: null,
      notifyCeoType: null,
    }
  }

  const next = await createNextStageOperationTx(tx, {
    workOrderId: input.operation.workOrderId,
    workflow: input.workflow,
    workflowId: input.workflowId,
    fromStageIndex: input.operation.workflowStageIndex,
    iterationCount: input.operation.iterationCount,
    initialContext: input.initialContext,
  })

  if (!next.nextOperationId) {
    return {
      workOrderId: input.operation.workOrderId,
      workflowId: input.workflowId,
      dispatchOperationId: null,
      notifyCeoMessage: `Work Order Complete: ${input.operation.workOrderId}\n\nWorkflow: ${input.workflowId}`,
      notifyCeoType: 'completion',
    }
  }

  return {
    workOrderId: input.operation.workOrderId,
    workflowId: input.workflowId,
    dispatchOperationId: next.nextOperationId,
    notifyCeoMessage: null,
    notifyCeoType: null,
  }
}

async function runCompletionTx(
  operationId: string,
  result: StageResult
): Promise<CompletionTxOutcome> {
  return prisma.$transaction(async (tx) => {
    const operation = await tx.operation.findUnique({
      where: { id: operationId },
      include: { workOrder: true },
    })

    if (!operation) {
      throw new Error(`Operation not found: ${operationId}`)
    }

    const workflowId = operation.workflowId ?? operation.workOrder.workflowId
    if (!workflowId) {
      throw new Error(`Operation ${operationId} missing workflowId`)
    }

    const workflow = await resolveWorkflowOrThrow(workflowId)
    const stage = workflow.stages[operation.workflowStageIndex]
    if (!stage) {
      throw new Error(`Workflow stage out of range: ${workflowId} idx=${operation.workflowStageIndex}`)
    }

    await writeCompletionReceiptAndArtifactsTx(tx, {
      operation,
      workflowId,
      stageRef: stage.ref,
      result,
    })

    const initialContext = await loadInitialContext(tx, operation.workOrderId)
    const verifyMetadata = parseVerifyLoopMetadata(operation)
    if (verifyMetadata) {
      return handleVerifyStoryCompletionTx(tx, {
        operation,
        workflowId,
        workflow,
        stageRef: stage.ref,
        result,
        initialContext,
      })
    }

    if (operation.executionType === 'loop' || stage.type === 'loop') {
      return handleLoopStageCompletionTx(tx, {
        operation: {
          ...operation,
          maxRetries: operation.maxRetries,
        },
        workflowId,
        workflow,
        stage,
        result,
        initialContext,
      })
    }

    return handleSingleStageCompletionTx(tx, {
      operation,
      workflowId,
      workflow,
      stage,
      result,
      initialContext,
    })
  })
}

async function notifyCeoIfNeeded(outcome: CompletionTxOutcome): Promise<void> {
  if (!outcome.notifyCeoMessage || !outcome.notifyCeoType) return

  try {
    const ceoSessionKey = await getCeoSessionKey()
    await sendToSession(ceoSessionKey, outcome.notifyCeoMessage)
    await prisma.activity.create({
      data: {
        type: 'manager.notify_ceo',
        actor: MANAGER_ACTIVITY_ACTOR,
        actorType: 'system',
        actorAgentId: null,
        entityType: 'work_order',
        entityId: outcome.workOrderId,
        summary: `Notified CEO: ${outcome.notifyCeoType}`,
        payloadJson: JSON.stringify({
          workflowId: outcome.workflowId,
          type: outcome.notifyCeoType,
        }),
      },
    })
  } catch (error) {
    await prisma.activity.create({
      data: {
        type: 'manager.notify_ceo_failed',
        actor: MANAGER_ACTIVITY_ACTOR,
        actorType: 'system',
        actorAgentId: null,
        entityType: 'work_order',
        entityId: outcome.workOrderId,
        summary: `Failed to notify CEO (${outcome.notifyCeoType})`,
        payloadJson: JSON.stringify({
          workflowId: outcome.workflowId,
          error: error instanceof Error ? error.message : String(error),
        }),
      },
    })
  }
}

export async function startWorkOrder(
  workOrderId: string,
  options?: StartWorkOrderOptions
): Promise<StartWorkOrderResult> {
  const workOrder = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    select: {
      id: true,
      code: true,
      title: true,
      goalMd: true,
      state: true,
      workflowId: true,
      currentStage: true,
      priority: true,
      tags: true,
      blockedReason: true,
    },
  })

  if (!workOrder) {
    throw new Error(`Work order not found: ${workOrderId}`)
  }

  if (workOrder.state === 'blocked') {
    throw new Error(`Work order ${workOrderId} is blocked; use resume flow instead of start`)
  }

  if (isSecurityVetoReason(workOrder.blockedReason)) {
    throw new Error(`Work order ${workOrderId} is permanently blocked by security veto`)
  }

  if (!options?.force && workOrder.state !== 'planned') {
    throw new Error(`Work order ${workOrderId} is not startable from state ${workOrder.state}`)
  }

  const openOperationCount = await prisma.operation.count({
    where: {
      workOrderId,
      status: { in: [...OPEN_OPERATION_STATUSES] },
    },
  })

  if (!options?.force && openOperationCount > 0) {
    throw new Error(`Work order ${workOrderId} already has active operations`)
  }

  const initialContext = options?.context ?? {}
  const selected = await selectWorkflow(workOrder, {
    workflowIdOverride: options?.workflowIdOverride ?? null,
  })
  const workflow = await resolveWorkflowOrThrow(selected.workflowId)

  let stageIndex = 0
  while (stageIndex < workflow.stages.length) {
    const stage = workflow.stages[stageIndex]
    if (stage.optional && stage.condition) {
      const conditionMet = evaluateCondition(stage.condition, initialContext)
      if (!conditionMet) {
        stageIndex += 1
        continue
      }
    }
    break
  }

  if (stageIndex >= workflow.stages.length) {
    throw new Error(`Workflow ${workflow.id} has no runnable stages`)
  }

  const stage = workflow.stages[stageIndex]
  const stageAgent = await resolveWorkflowStageAgent(prisma, stage.agent)
  if (!stageAgent) {
    throw new Error(`No available agent for workflow stage: ${stage.agent}`)
  }

  const operation = await prisma.$transaction(async (tx) => {
    if (options?.force) {
      await tx.operation.updateMany({
        where: {
          workOrderId,
          status: { in: ['todo', 'in_progress', 'review', 'rework'] },
        },
        data: {
          status: 'blocked',
          blockedReason: 'Superseded by workflow restart',
          claimedBy: null,
          claimExpiresAt: null,
        },
      })
    }

    await tx.workOrder.update({
      where: { id: workOrderId },
      data: {
        workflowId: workflow.id,
        currentStage: stageIndex,
        state: 'active',
        blockedReason: null,
      },
    })

    await tx.activity.create({
      data: {
        type: 'workflow.started',
        actor: MANAGER_ACTIVITY_ACTOR,
        actorType: 'system',
        actorAgentId: null,
        entityType: 'work_order',
        entityId: workOrderId,
        summary: `Started workflow: ${workflow.id}`,
        payloadJson: JSON.stringify({
          workflowId: workflow.id,
          startIndex: stageIndex,
          stageRef: stage.ref,
          selectedBy: selected.reason,
          selectedRule: selected.matchedRuleId,
          initialContext,
        }),
      },
    })

    return tx.operation.create({
      data: {
        workOrderId,
        station: mapAgentToStation({ station: stageAgent.station }),
        title: `${stageAgent.displayName} — Stage ${stageIndex + 1}/${workflow.stages.length}`,
        status: 'todo',
        workflowId: workflow.id,
        workflowStageIndex: stageIndex,
        iterationCount: 0,
        assigneeAgentIds: JSON.stringify([stageAgent.id]),
        executionType: stage.type ?? 'single',
        loopConfigJson: stage.loop ? safeJsonStringify(stage.loop) : null,
        currentStoryId: null,
        retryCount: 0,
        maxRetries: 2,
      },
    })
  })

  const dispatch = await dispatchOperation(operation.id)
  if (!dispatch.dispatched) {
    const dispatchError = dispatch.error ?? 'Failed to dispatch workflow start operation'
    await prisma.workOrder.update({
      where: { id: workOrderId },
      data: {
        state: 'blocked',
        blockedReason: dispatchError,
      },
    })
    throw new Error(dispatch.error ?? 'Failed to dispatch workflow start operation')
  }

  return {
    success: true,
    workOrderId,
    workflowId: workflow.id,
    operationId: operation.id,
    stageIndex,
    agentId: dispatch.agentId ?? stageAgent.id,
    agentName: dispatch.agentName ?? stageAgent.displayName,
    sessionKey: dispatch.sessionKey,
  }
}

export async function advanceOnCompletion(
  operationId: string,
  result: StageResult,
  options?: { completionToken?: string | null }
): Promise<CompletionResult> {
  const operation = await prisma.operation.findUnique({
    where: { id: operationId },
    select: {
      status: true,
      workOrderId: true,
      workOrder: {
        select: {
          state: true,
        },
      },
    },
  })
  if (!operation) throw new Error(`Operation not found: ${operationId}`)

  if (operation.status === 'done') {
    return {
      success: true,
      operationId,
      duplicate: false,
      noop: true,
      code: 'COMPLETION_STALE_IGNORED',
      reason: 'Operation already completed',
    }
  }

  if (operation.status !== 'in_progress') {
    await prisma.activity.create({
      data: {
        type: 'workflow.completion_ignored',
        actor: MANAGER_ACTIVITY_ACTOR,
        actorType: 'system',
        actorAgentId: null,
        entityType: 'operation',
        entityId: operationId,
        summary: `Ignored completion: operation not in_progress (${operation.status})`,
        payloadJson: JSON.stringify({
          operationId,
          status: operation.status,
          resultStatus: result.status,
        }),
      },
    })
    return {
      success: true,
      operationId,
      duplicate: false,
      noop: true,
      code: 'COMPLETION_INVALID_STATE',
      reason: `Operation is ${operation.status}, expected in_progress`,
    }
  }

  if (operation.workOrder.state !== 'active') {
    await prisma.activity.create({
      data: {
        type: 'workflow.completion_stale',
        actor: MANAGER_ACTIVITY_ACTOR,
        actorType: 'system',
        actorAgentId: null,
        entityType: 'operation',
        entityId: operationId,
        summary: `Ignored stale completion for non-active work order (${operation.workOrder.state})`,
        payloadJson: JSON.stringify({
          operationId,
          workOrderId: operation.workOrderId,
          workOrderState: operation.workOrder.state,
          resultStatus: result.status,
        }),
      },
    })
    return {
      success: true,
      operationId,
      duplicate: false,
      noop: true,
      code: 'COMPLETION_STALE_IGNORED',
      reason: `Work order is ${operation.workOrder.state}, expected active`,
    }
  }

  const completionToken = options?.completionToken?.trim()
  if (completionToken) {
    try {
      await prisma.operationCompletionToken.create({
        data: {
          token: completionToken,
          operationId,
          workOrderId: operation.workOrderId,
        },
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return {
          success: true,
          operationId,
          duplicate: true,
          noop: true,
          code: 'COMPLETION_STALE_IGNORED',
          reason: 'Duplicate completion token for operation',
        }
      }
      throw error
    }
  }

  const outcome = await runCompletionTx(operationId, result)
  if (outcome.dispatchOperationId) {
    await dispatchOperation(outcome.dispatchOperationId)
  }
  await notifyCeoIfNeeded(outcome)

  return {
    success: true,
    operationId,
    duplicate: false,
    noop: false,
  }
}

async function recoverStaleOperationsCore(options?: {
  limit?: number
  autoDispatch?: boolean
}): Promise<StaleRecoveryResult> {
  const now = new Date()
  const staleCutoff = new Date(now.getTime() - STALE_OPERATION_AGE_MS)
  const activeSessionCutoff = new Date(now.getTime() - ACTIVE_SESSION_MAX_AGE_MS)
  const limit = Math.min(Math.max(options?.limit ?? DEFAULT_TICK_LIMIT, 1), MAX_TICK_LIMIT)

  const candidates = await prisma.operation.findMany({
    where: {
      status: 'in_progress',
      OR: [
        { claimExpiresAt: { lt: now } },
        { updatedAt: { lt: staleCutoff } },
      ],
    },
    orderBy: { updatedAt: 'asc' },
    take: limit,
  })

  let recovered = 0
  let escalated = 0
  let failures = 0

  for (const operation of candidates) {
    try {
      const activeSession = await prisma.agentSession.findFirst({
        where: {
          operationId: operation.id,
          state: 'active',
          lastSeenAt: { gte: activeSessionCutoff },
        },
      })
      if (activeSession) continue

      if (operation.retryCount < operation.maxRetries) {
        await prisma.operation.update({
          where: { id: operation.id },
          data: {
            status: 'todo',
            retryCount: operation.retryCount + 1,
            timeoutCount: operation.timeoutCount + 1,
            claimedBy: null,
            claimExpiresAt: null,
            blockedReason: null,
          },
        })

        await prisma.activity.create({
          data: {
            type: 'workflow.stale_recovered',
            actor: MANAGER_ACTIVITY_ACTOR,
            actorType: 'system',
            actorAgentId: null,
            entityType: 'operation',
            entityId: operation.id,
            summary: 'Recovered stale operation and queued retry',
            payloadJson: JSON.stringify({
              operationId: operation.id,
              retryCount: operation.retryCount + 1,
              maxRetries: operation.maxRetries,
            }),
          },
        })

        recovered += 1
        if (options?.autoDispatch !== false) {
          await dispatchOperation(operation.id)
        }
        continue
      }

      await prisma.$transaction(async (tx) => {
        const row = await tx.operation.findUnique({
          where: { id: operation.id },
        })
        if (!row) return

        const workflowId = row.workflowId ?? 'unknown'
        const workflow = await getWorkflowConfig(workflowId)
        const stageRef = workflow?.stages[row.workflowStageIndex]?.ref ?? `stage_${row.workflowStageIndex}`
        const escalation = await escalateOperationTx(tx, {
          operationId: row.id,
          workOrderId: row.workOrderId,
          workflowId,
          stageIndex: row.workflowStageIndex,
          stageLabel: stageRef,
          totalStages: workflow?.stages.length ?? 0,
          iterationCount: row.iterationCount,
          maxIterations: row.maxRetries,
          reason: 'stale_timeout_exceeded',
          feedback: 'Operation timed out with no active session and exceeded retry budget.',
          approvalType: 'scope_change',
        })

        await tx.activity.create({
          data: {
            type: 'workflow.stale_escalated',
            actor: MANAGER_ACTIVITY_ACTOR,
            actorType: 'system',
            actorAgentId: null,
            entityType: 'operation',
            entityId: row.id,
            summary: 'Escalated stale operation after retry budget exhaustion',
            payloadJson: JSON.stringify({
              escalation,
            }),
          },
        })
      })
      escalated += 1
    } catch (error) {
      failures += 1
      await prisma.activity.create({
        data: {
          type: 'workflow.stale_recovery_failed',
          actor: MANAGER_ACTIVITY_ACTOR,
          actorType: 'system',
          actorAgentId: null,
          entityType: 'operation',
          entityId: operation.id,
          summary: 'Failed stale recovery attempt',
          payloadJson: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
        },
      }).catch(() => {})
    }
  }

  return {
    scanned: candidates.length,
    recovered,
    escalated,
    failures,
  }
}

export async function recoverStaleOperations(options?: {
  limit?: number
  autoDispatch?: boolean
}): Promise<StaleRecoveryResult> {
  const leased = await withIngestionLease(
    WORKFLOW_ENGINE_RECOVERY_LEASE,
    () => recoverStaleOperationsCore(options),
    { ttlMs: 60_000 }
  )

  if (!leased.lockAcquired || !leased.value) {
    return {
      scanned: 0,
      recovered: 0,
      escalated: 0,
      failures: 0,
    }
  }

  return leased.value
}

export async function resumeWorkOrder(
  workOrderId: string,
  options?: { reason?: string }
): Promise<StartWorkOrderResult | null> {
  const workOrder = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    select: {
      id: true,
      state: true,
      workflowId: true,
      currentStage: true,
      title: true,
      goalMd: true,
      priority: true,
      tags: true,
      code: true,
      blockedReason: true,
    },
  })
  if (!workOrder) throw new Error(`Work order not found: ${workOrderId}`)
  if (isSecurityVetoReason(workOrder.blockedReason)) {
    throw new Error(`Work order ${workOrderId} is permanently blocked by security veto`)
  }

  if (workOrder.state === 'planned') {
    return startWorkOrder(workOrderId, {
      context: { resumed: true, reason: options?.reason ?? 'manual' },
    })
  }

  const candidate = await prisma.operation.findFirst({
    where: {
      workOrderId,
      status: { in: ['blocked', 'todo', 'rework'] },
    },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
  })

  if (!candidate) {
    return startWorkOrder(workOrderId, {
      force: true,
      context: { resumed: true, reason: options?.reason ?? 'manual' },
    })
  }

  await prisma.$transaction(async (tx) => {
    await tx.workOrder.update({
      where: { id: workOrderId },
      data: {
        state: 'active',
        blockedReason: null,
      },
    })

    await tx.operation.update({
      where: { id: candidate.id },
      data: {
        status: 'todo',
        blockedReason: null,
        claimedBy: null,
        claimExpiresAt: null,
      },
    })

    await tx.activity.create({
      data: {
        type: 'workflow.resumed',
        actor: MANAGER_ACTIVITY_ACTOR,
        actorType: 'system',
        actorAgentId: null,
        entityType: 'work_order',
        entityId: workOrderId,
        summary: 'Resumed workflow execution',
        payloadJson: JSON.stringify({
          operationId: candidate.id,
          reason: options?.reason ?? 'manual',
        }),
      },
    })
  })

  const dispatch = await dispatchOperation(candidate.id)
  if (!dispatch.dispatched) {
    await prisma.workOrder.update({
      where: { id: workOrderId },
      data: {
        state: 'blocked',
        blockedReason: dispatch.error ?? 'Failed to dispatch resumed operation',
      },
    })
    throw new Error(dispatch.error ?? 'Failed to dispatch resumed operation')
  }

  return {
    success: true,
    workOrderId,
    workflowId: dispatch.workflowId,
    operationId: candidate.id,
    stageIndex: dispatch.stageIndex,
    agentId: dispatch.agentId ?? '',
    agentName: dispatch.agentName ?? '',
    sessionKey: dispatch.sessionKey,
  }
}

export async function tickQueue(options?: {
  limit?: number
  dryRun?: boolean
}): Promise<QueueTickResult> {
  const limit = Math.min(Math.max(options?.limit ?? DEFAULT_TICK_LIMIT, 1), MAX_TICK_LIMIT)
  const dryRun = Boolean(options?.dryRun)

  const leased = await withIngestionLease(
    WORKFLOW_ENGINE_TICK_LEASE,
    async () => {
      const stale = dryRun
        ? { recovered: 0 }
        : await recoverStaleOperationsCore({ limit, autoDispatch: true })

      const planned = await prisma.workOrder.findMany({
        where: {
          state: 'planned',
          id: { notIn: ['system', 'console'] },
        },
        orderBy: { createdAt: 'asc' },
        take: limit,
        select: { id: true },
      })

      const startedWorkOrders: string[] = []
      const skippedWorkOrders: Array<{ workOrderId: string; reason: string }> = []
      const failureWorkOrders: Array<{ workOrderId: string; reason: string }> = []

      for (const workOrder of planned) {
        const openOps = await prisma.operation.count({
          where: {
            workOrderId: workOrder.id,
            status: { in: [...OPEN_OPERATION_STATUSES] },
          },
        })

        if (openOps > 0) {
          skippedWorkOrders.push({
            workOrderId: workOrder.id,
            reason: 'Work order already has open operations',
          })
          continue
        }

        if (dryRun) {
          startedWorkOrders.push(workOrder.id)
          continue
        }

        try {
          await startWorkOrder(workOrder.id, {
            context: { source: 'queue_tick' },
          })
          startedWorkOrders.push(workOrder.id)
        } catch (error) {
          failureWorkOrders.push({
            workOrderId: workOrder.id,
            reason: error instanceof Error ? error.message : String(error),
          })
        }
      }

      return {
        scanned: planned.length,
        startedWorkOrders,
        skippedWorkOrders,
        failureWorkOrders,
        staleRecovered: stale.recovered,
      }
    },
    { ttlMs: 60_000 }
  )

  if (!leased.lockAcquired || !leased.value) {
    return {
      dryRun,
      scanned: 0,
      started: 0,
      skipped: 1,
      staleRecovered: 0,
      failures: 0,
      overlapPrevented: true,
      startedWorkOrders: [],
      skippedWorkOrders: [{ workOrderId: '', reason: 'workflow_engine_tick lease already held' }],
      failureWorkOrders: [],
    }
  }

  return {
    dryRun,
    scanned: leased.value.scanned,
    started: leased.value.startedWorkOrders.length,
    skipped: leased.value.skippedWorkOrders.length,
    staleRecovered: leased.value.staleRecovered,
    failures: leased.value.failureWorkOrders.length,
    overlapPrevented: false,
    startedWorkOrders: leased.value.startedWorkOrders,
    skippedWorkOrders: leased.value.skippedWorkOrders,
    failureWorkOrders: leased.value.failureWorkOrders,
  }
}
