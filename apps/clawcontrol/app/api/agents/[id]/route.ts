import { NextRequest, NextResponse } from 'next/server'
import { getRepos } from '@/lib/repo'
import { enforceActionPolicy } from '@/lib/with-governor'
import { asAuthErrorResponse, verifyOperatorRequest } from '@/lib/auth/operator-auth'
import { extractAgentIdFromSessionKey } from '@/lib/agent-identity'
import { removeAgentFromOpenClaw, upsertAgentToOpenClaw } from '@/lib/services/openclaw-config'
import { isCanonicalStationId, normalizeStationId, type ActionKind } from '@clawcontrol/core'

interface RouteContext {
  params: Promise<{ id: string }>
}

function isMainAgent(agent: {
  slug?: string | null
  runtimeAgentId?: string | null
  displayName?: string | null
  name?: string | null
  sessionKey?: string | null
}): boolean {
  const slug = (agent.slug ?? '').trim().toLowerCase()
  const runtime = (agent.runtimeAgentId ?? '').trim().toLowerCase()
  const display = (agent.displayName ?? agent.name ?? '').trim().toLowerCase()
  const sessionAgentId = extractAgentIdFromSessionKey(agent.sessionKey ?? '')?.trim().toLowerCase() ?? ''
  return slug === 'main' || runtime === 'main' || display === 'main' || sessionAgentId === 'main'
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
    const {
      status,
      currentWorkOrderId,
      role,
      station,
      capabilities,
      wipLimit,
      sessionKey,
      model,
      fallbacks,
      displayName,
      slug,
      runtimeAgentId,
	      typedConfirmText,
	    } = body

		    const repos = getRepos()

    let normalizedStation: string | undefined
    if (station !== undefined) {
      if (typeof station !== 'string') {
        return NextResponse.json(
          { error: 'INVALID_STATION', message: 'Station must be a string' },
          { status: 400 }
        )
      }
      normalizedStation = normalizeStationId(station)
      if (!isCanonicalStationId(normalizedStation)) {
        return NextResponse.json(
          { error: 'INVALID_STATION', message: `Station "${station}" is not canonical` },
          { status: 400 }
        )
      }
    }

	    if (slug !== undefined || runtimeAgentId !== undefined) {
	      return NextResponse.json(
	        { error: 'Slug and runtimeAgentId are immutable via this endpoint' },
	        { status: 400 }
	      )
	    }

	    // Get current agent to check status change
	    const currentAgent = await repos.agents.getById(id)
    if (!currentAgent) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 }
      )
    }

    // Determine if any protected change requires typed confirmation
    let protectedAction: ActionKind | null = null

    // Status changes
    if (status && status !== currentAgent.status) {
      // Restarting an agent (from error/idle to active)
      if (status === 'active' && (currentAgent.status === 'error' || currentAgent.status === 'idle')) {
        protectedAction = 'agent.restart'
      }
      // Stopping an agent (from active to idle)
      else if (status === 'idle' && currentAgent.status === 'active') {
        protectedAction = 'agent.stop'
      }
    }

    // Admin edits
    const wantsAdminEdit =
      role !== undefined ||
      station !== undefined ||
      capabilities !== undefined ||
      wipLimit !== undefined ||
      sessionKey !== undefined ||
      displayName !== undefined ||
      model !== undefined ||
      fallbacks !== undefined

    if (wantsAdminEdit) {
      protectedAction = protectedAction ?? 'agent.edit'
    }

    if (protectedAction) {
      const result = await enforceActionPolicy({
        actionKind: protectedAction,
        typedConfirmText,
      })

      if (!result.allowed) {
        return NextResponse.json(
          {
            error: result.errorType,
            policy: result.policy,
          },
          { status: result.status ?? (result.errorType === 'TYPED_CONFIRM_REQUIRED' ? 428 : 403) }
        )
      }

      await repos.activities.create({
        type: `agent.action`,
        actor: 'user',
        entityType: 'agent',
        entityId: id,
        summary: `Agent ${currentAgent.name} updated (${protectedAction})`,
	        payloadJson: {
	          actionKind: protectedAction,
	          previous: currentAgent,
	          next: { status, role, station: normalizedStation ?? station, wipLimit, sessionKey, displayName },
	        },
	      })
	    }

    // Normalize fallbacks to JSON string for DB storage
    const fallbacksForDb = fallbacks !== undefined
      ? (typeof fallbacks === 'string' ? fallbacks : JSON.stringify(fallbacks))
      : undefined
    
    // Parse fallbacks array for OpenClaw sync
    const fallbacksArray = fallbacks !== undefined
      ? (typeof fallbacks === 'string' ? JSON.parse(fallbacks) : fallbacks)
      : undefined

	    const data = await repos.agents.update(id, {
	      status,
	      currentWorkOrderId,
	      role,
	      station: normalizedStation,
	      capabilities,
	      wipLimit,
      sessionKey,
      displayName,
      ...(displayName !== undefined ? { nameSource: 'user' as const } : {}),
      model,
      fallbacks: fallbacksForDb,
    })

    // Sync identity/model to OpenClaw config if changed.
    if (data && (displayName !== undefined || model !== undefined || fallbacks !== undefined)) {
      const syncResult = await upsertAgentToOpenClaw({
        agentId: data.runtimeAgentId,
        runtimeAgentId: data.runtimeAgentId,
        slug: data.slug,
        displayName: data.displayName,
        sessionKey: data.sessionKey,
        model: model ?? data.model,
        fallbacks: fallbacksArray ?? data.fallbacks,
      })

      if (!syncResult.ok) {
        console.warn('[api/agents/:id] OpenClaw sync warning:', syncResult.error)
      } else if (syncResult.restartNeeded) {
        console.log('[api/agents/:id] OpenClaw config updated, gateway restart recommended')
      }
    }

    return NextResponse.json({ data })
  } catch (error) {
    console.error('[api/agents/:id] PATCH error:', error)
    return NextResponse.json(
      { error: 'Failed to update agent' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/agents/:id
 *
 * Delete an agent (except main).
 */
export async function DELETE(
  request: NextRequest,
  context: RouteContext
) {
  const auth = verifyOperatorRequest(request, { requireCsrf: true })
  if (!auth.ok) {
    return NextResponse.json(asAuthErrorResponse(auth), { status: auth.status })
  }

  const { id } = await context.params

  try {
    const body = (await request.json().catch(() => ({}))) as { typedConfirmText?: string }
    const repos = getRepos()
    const currentAgent = await repos.agents.getById(id)

    if (!currentAgent) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 }
      )
    }

    if (isMainAgent(currentAgent)) {
      return NextResponse.json(
        { error: 'Main agent cannot be deleted', code: 'AGENT_MAIN_PROTECTED' },
        { status: 409 }
      )
    }

    const enforcement = await enforceActionPolicy({
      actionKind: 'agent.delete',
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

    const deleted = await repos.agents.delete(id)
    if (!deleted) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 }
      )
    }

    const removeResult = await removeAgentFromOpenClaw(
      currentAgent.runtimeAgentId
      || extractAgentIdFromSessionKey(currentAgent.sessionKey)
      || currentAgent.slug
      || null
    )
    if (!removeResult.ok) {
      console.warn('[api/agents/:id] OpenClaw remove warning:', removeResult.error)
    }

    await repos.activities.create({
      type: 'agent.deleted',
      actor: 'user',
      entityType: 'agent',
      entityId: id,
      summary: `Deleted agent ${currentAgent.displayName}`,
      riskLevel: 'danger',
      payloadJson: {
        previous: currentAgent,
        openclawRemoved: removeResult.removed ?? false,
      },
    })

    return NextResponse.json({
      success: true,
      data: {
        id,
        openclawRemoved: removeResult.removed ?? false,
      },
    })
  } catch (error) {
    console.error('[api/agents/:id] DELETE error:', error)
    return NextResponse.json(
      { error: 'Failed to delete agent' },
      { status: 500 }
    )
  }
}
