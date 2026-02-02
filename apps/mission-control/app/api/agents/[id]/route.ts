import { NextRequest, NextResponse } from 'next/server'
import { getRepos } from '@/lib/repo'
import { enforceTypedConfirm } from '@/lib/with-governor'
import type { ActionKind } from '@savorgos/core'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * GET /api/agents/:id
 *
 * Get a single agent
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext
) {
  const { id } = await context.params

  try {
    const repos = getRepos()
    const data = await repos.agents.getById(id)

    if (!data) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ data })
  } catch (error) {
    console.error('[api/agents/:id] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch agent' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/agents/:id
 *
 * Update an agent (status, currentWorkOrderId)
 *
 * Security: Status changes to 'active' or 'error' require typed confirmation
 * via the Governor system (agent.restart or agent.stop actions).
 */
export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  const { id } = await context.params

  try {
    const body = await request.json()
    const { status, currentWorkOrderId, typedConfirmText } = body

    const repos = getRepos()

    // Get current agent to check status change
    const currentAgent = await repos.agents.getById(id)
    if (!currentAgent) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 }
      )
    }

    // Determine if status change requires typed confirmation
    if (status && status !== currentAgent.status) {
      let actionKind: ActionKind | null = null

      // Restarting an agent (from error/idle to active)
      if (status === 'active' && (currentAgent.status === 'error' || currentAgent.status === 'idle')) {
        actionKind = 'agent.restart'
      }
      // Stopping an agent (from active to idle)
      else if (status === 'idle' && currentAgent.status === 'active') {
        actionKind = 'agent.stop'
      }

      // Enforce typed confirmation for protected status changes
      if (actionKind) {
        const result = await enforceTypedConfirm({
          actionKind,
          typedConfirmText,
        })

        if (!result.allowed) {
          return NextResponse.json(
            {
              error: `Typed confirmation required for "${result.policy.description}"`,
              code: result.errorType,
              details: {
                actionKind,
                confirmMode: result.policy.confirmMode,
                required: 'CONFIRM',
              },
            },
            { status: 403 }
          )
        }

        // Log the protected action
        await repos.activities.create({
          type: `agent.${actionKind === 'agent.restart' ? 'restarted' : 'stopped'}`,
          actor: 'user',
          entityType: 'agent',
          entityId: id,
          summary: `Agent ${currentAgent.name} ${actionKind === 'agent.restart' ? 'restarted' : 'stopped'}`,
          payloadJson: {
            previousStatus: currentAgent.status,
            newStatus: status,
            actionKind,
          },
        })
      }
    }

    const data = await repos.agents.update(id, {
      status,
      currentWorkOrderId,
    })

    return NextResponse.json({ data })
  } catch (error) {
    console.error('[api/agents/:id] PATCH error:', error)
    return NextResponse.json(
      { error: 'Failed to update agent' },
      { status: 500 }
    )
  }
}
