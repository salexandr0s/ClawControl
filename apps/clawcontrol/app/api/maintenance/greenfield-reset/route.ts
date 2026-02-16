import { NextRequest, NextResponse } from 'next/server'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/db'
import { enforceActionPolicy } from '@/lib/with-governor'
import { getRepos } from '@/lib/repo'
import { asAuthErrorResponse, verifyOperatorRequest } from '@/lib/auth/operator-auth'
import { validateWorkspacePath } from '@/lib/fs/path-policy'
import { getWorkflowRegistrySnapshot, syncResolvedWorkflowSnapshots } from '@/lib/workflows/registry'
import { deleteWorkspaceSelectionOverlay, deleteWorkspaceWorkflowConfig } from '@/lib/workflows/storage'

interface GreenfieldResetSummary {
  teamsDeleted: number
  agentsDeleted: number
  workflowsDeleted: number
  selectionOverlayDeleted: boolean
  agentWorkspaceEntriesDeleted: number
  workOrdersDeleted: number
  operationsDeleted: number
  operationStoriesDeleted: number
  approvalsDeleted: number
  receiptsDeleted: number
  messagesDeleted: number
  activitiesDeleted: number
  artifactsDeleted: number
}

function isMainAgent(agent: {
  id: string
  slug: string | null
  runtimeAgentId: string | null
  name: string
  displayName: string | null
}): boolean {
  const slug = (agent.slug ?? '').trim().toLowerCase()
  const runtime = (agent.runtimeAgentId ?? '').trim().toLowerCase()
  const display = (agent.displayName ?? agent.name).trim().toLowerCase()
  return slug === 'main' || runtime === 'main' || display === 'main'
}

async function wipeAgentWorkspace(): Promise<number> {
  const agentsPath = validateWorkspacePath('/agents')
  if (!agentsPath.valid || !agentsPath.resolvedPath) return 0

  let deleted = 0
  try {
    const entries = await fsp.readdir(agentsPath.resolvedPath, { withFileTypes: true })
    for (const entry of entries) {
      const name = entry.name
      if (name === 'main' || name === 'main.md') continue
      const target = join(agentsPath.resolvedPath, name)
      await fsp.rm(target, { recursive: true, force: true })
      deleted += 1
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }

  return deleted
}

async function wipeCustomWorkflows(): Promise<number> {
  const snapshot = await getWorkflowRegistrySnapshot({ forceReload: true })
  const custom = snapshot.definitions.filter((item) => item.source === 'custom').map((item) => item.id)
  for (const workflowId of custom) {
    await deleteWorkspaceWorkflowConfig(workflowId).catch(() => {})
  }
  return custom.length
}

export async function POST(request: NextRequest) {
  const auth = verifyOperatorRequest(request, { requireCsrf: true })
  if (!auth.ok) {
    return NextResponse.json(asAuthErrorResponse(auth), { status: auth.status })
  }

  const body = (await request.json().catch(() => ({}))) as { typedConfirmText?: string }

  const enforcement = await enforceActionPolicy({
    actionKind: 'maintenance.greenfield_reset',
    typedConfirmText: body.typedConfirmText,
  })

  if (!enforcement.allowed) {
    return NextResponse.json(
      {
        error: enforcement.errorType,
        policy: enforcement.policy,
      },
      { status: enforcement.status ?? 403 }
    )
  }

  const repos = getRepos()

  const agents = await prisma.agent.findMany({
    select: {
      id: true,
      slug: true,
      runtimeAgentId: true,
      name: true,
      displayName: true,
    },
    orderBy: [{ createdAt: 'asc' }],
  })
  const mainAgent = agents.find(isMainAgent) ?? null
  const removeAgentIds = agents
    .filter((agent) => !mainAgent || agent.id !== mainAgent.id)
    .map((agent) => agent.id)

  const summary: GreenfieldResetSummary = {
    teamsDeleted: 0,
    agentsDeleted: 0,
    workflowsDeleted: 0,
    selectionOverlayDeleted: false,
    agentWorkspaceEntriesDeleted: 0,
    workOrdersDeleted: 0,
    operationsDeleted: 0,
    operationStoriesDeleted: 0,
    approvalsDeleted: 0,
    receiptsDeleted: 0,
    messagesDeleted: 0,
    activitiesDeleted: 0,
    artifactsDeleted: 0,
  }

  try {
    summary.workflowsDeleted = await wipeCustomWorkflows()
    try {
      await deleteWorkspaceSelectionOverlay()
      summary.selectionOverlayDeleted = true
    } catch {
      summary.selectionOverlayDeleted = false
    }
    summary.agentWorkspaceEntriesDeleted = await wipeAgentWorkspace()

    await prisma.$transaction(async (tx) => {
      summary.teamsDeleted = (await tx.agentTeam.deleteMany({})).count

      if (removeAgentIds.length > 0) {
        summary.agentsDeleted = (await tx.agent.deleteMany({
          where: { id: { in: removeAgentIds } },
        })).count
      }

      if (mainAgent) {
        await tx.agent.update({
          where: { id: mainAgent.id },
          data: {
            teamId: null,
            templateId: null,
          },
        })
      }

      summary.operationStoriesDeleted = (await tx.operationStory.deleteMany({})).count
      summary.approvalsDeleted = (await tx.approval.deleteMany({})).count
      summary.artifactsDeleted = (await tx.artifact.deleteMany({})).count
      summary.messagesDeleted = (await tx.message.deleteMany({})).count
      summary.receiptsDeleted = (await tx.receipt.deleteMany({})).count
      summary.operationsDeleted = (await tx.operation.deleteMany({})).count
      summary.workOrdersDeleted = (await tx.workOrder.deleteMany({})).count
      summary.activitiesDeleted = (await tx.activity.deleteMany({})).count
    })

    await syncResolvedWorkflowSnapshots({ forceReload: true }).catch(() => {})

    const receipt = await repos.receipts.create({
      workOrderId: 'system',
      kind: 'manual',
      commandName: 'maintenance.greenfield_reset',
      commandArgs: {
        typedConfirmText: 'RESET_GREENFIELD',
      },
    })
    await repos.receipts.finalize(receipt.id, {
      exitCode: 0,
      durationMs: 0,
      parsedJson: summary as unknown as Record<string, unknown>,
    })

    await repos.activities.create({
      type: 'maintenance.greenfield_reset',
      actor: 'user',
      entityType: 'system',
      entityId: 'workspace',
      category: 'system',
      riskLevel: 'danger',
      summary: `Greenfield reset completed (teams=${summary.teamsDeleted}, agents=${summary.agentsDeleted})`,
      payloadJson: {
        ...summary,
        keptMainAgentId: mainAgent?.id ?? null,
        receiptId: receipt.id,
      },
    })

    return NextResponse.json({
      data: summary,
      receiptId: receipt.id,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Greenfield reset failed',
        details: summary,
      },
      { status: 500 }
    )
  }
}
