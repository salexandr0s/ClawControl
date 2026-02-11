import { NextRequest, NextResponse } from 'next/server'
import { getRepos } from '@/lib/repo'
import { enforceTypedConfirm } from '@/lib/with-governor'
import { upsertAgentToOpenClaw } from '@/lib/services/openclaw-config'
import { isCanonicalStationId, normalizeStationId, type ActionKind } from '@clawcontrol/core'

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
      const result = await enforceTypedConfirm({
        actionKind: protectedAction,
        typedConfirmText,
      })

      if (!result.allowed) {
        return NextResponse.json(
          {
            error: result.errorType,
            policy: result.policy,
          },
          { status: result.errorType === 'TYPED_CONFIRM_REQUIRED' ? 428 : 403 }
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
