import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { asAuthErrorResponse, verifyOperatorRequest } from '@/lib/auth/operator-auth'
import { enforceActionPolicy } from '@/lib/with-governor'
import { listWorkflowDefinitions } from '@/lib/workflows/registry'
import {
  createCustomWorkflow,
  type WorkflowServiceError,
} from '@/lib/workflows/service'

type WorkflowTrustLevel = 'unscanned' | 'scanned' | 'blocked' | 'verified'

interface WorkflowTrustMeta {
  level: WorkflowTrustLevel
  title: string
  subtitle: string
}

function asWorkflowError(error: unknown): WorkflowServiceError | null {
  if (error instanceof Error && error.name === 'WorkflowServiceError') {
    return error as WorkflowServiceError
  }
  return null
}

async function buildUsageMap(ids: string[]): Promise<Map<string, number>> {
  const usageMap = new Map<string, number>()
  await Promise.all(
    ids.map(async (workflowId) => {
      const count = await prisma.workOrder.count({ where: { workflowId } })
      usageMap.set(workflowId, count)
    })
  )
  return usageMap
}

function trustFromOutcome(outcome: string, scannerVersion: string): WorkflowTrustMeta {
  if (outcome === 'pass') {
    return {
      level: 'verified',
      title: 'Verified',
      subtitle: `Security scan passed (${scannerVersion})`,
    }
  }

  if (outcome === 'warn') {
    return {
      level: 'scanned',
      title: 'Scanned',
      subtitle: `Security scan completed with warnings (${scannerVersion})`,
    }
  }

  if (outcome === 'block') {
    return {
      level: 'blocked',
      title: 'Blocked',
      subtitle: `Security scan flagged dangerous findings (${scannerVersion})`,
    }
  }

  return {
    level: 'unscanned',
    title: 'Unscanned',
    subtitle: 'No scan metadata available',
  }
}

async function buildTrustMap(ids: string[]): Promise<Map<string, WorkflowTrustMeta>> {
  const trustMap = new Map<string, WorkflowTrustMeta>()
  if (ids.length === 0) return trustMap

  const records = await prisma.artifactScanRecord.findMany({
    where: {
      artifactType: 'workflow_yaml',
      artifactKey: { in: ids },
    },
  })

  for (const record of records) {
    trustMap.set(record.artifactKey, trustFromOutcome(record.outcome, record.scannerVersion))
  }

  return trustMap
}

/**
 * GET /api/workflows
 * List available workflows from workspace and imported packages.
 */
export async function GET() {
  const definitions = await listWorkflowDefinitions()
  const workflowIds = definitions.map((item) => item.id)

  const [usage, trustMap] = await Promise.all([
    buildUsageMap(workflowIds),
    buildTrustMap(workflowIds),
  ])

  return NextResponse.json({
    data: definitions.map((item) => ({
      id: item.id,
      description: item.workflow.description,
      source: item.source,
      editable: item.editable,
      sourcePath: item.sourcePath,
      trustLevel: trustMap.get(item.id)?.level ?? 'unscanned',
      trustTitle: trustMap.get(item.id)?.title ?? 'Unscanned',
      trustSubtitle: trustMap.get(item.id)?.subtitle ?? 'Workflow has no scan metadata',
      stages: item.stages,
      loops: item.loops,
      inUse: usage.get(item.id) ?? 0,
      updatedAt: item.updatedAt,
    })),
  })
}

/**
 * POST /api/workflows
 * Create a custom workflow in workspace /workflows
 */
export async function POST(request: NextRequest) {
  const auth = verifyOperatorRequest(request, { requireCsrf: true })
  if (!auth.ok) {
    return NextResponse.json(asAuthErrorResponse(auth), { status: auth.status })
  }

  const body = (await request.json().catch(() => null)) as {
    workflow?: unknown
    typedConfirmText?: string
  } | null

  if (!body) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const enforcement = await enforceActionPolicy({
    actionKind: 'workflow.create',
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

  try {
    const workflow = await createCustomWorkflow(body.workflow)
    return NextResponse.json({ data: workflow }, { status: 201 })
  } catch (error) {
    const workflowError = asWorkflowError(error)
    if (workflowError) {
      return NextResponse.json(
        {
          error: workflowError.message,
          code: workflowError.code,
          details: workflowError.details,
        },
        { status: workflowError.status }
      )
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create workflow' },
      { status: 500 }
    )
  }
}
