import 'server-only'

import { prisma } from '../db'
import { getRepos } from '../repo'
import {
  teamHierarchyPolicyService,
  TeamHierarchyPolicyViolation,
} from '@/lib/services/team-hierarchy-policy'

export interface ToolRequest {
  agentId?: string
  agentName?: string
  tool: string
  args?: Record<string, unknown>
  operationId?: string
  workOrderId?: string
}

export interface PolicyResult {
  allowed: boolean
  reason?: string
  requiresApproval?: boolean
  approvalType?: string
  resolvedAgentId?: string
  resolvedAgentName?: string
}

function safeParseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

function isReviewLikeAgent(agent: { role: string; station: string; kind?: string | null }): boolean {
  const role = agent.role.toLowerCase()
  const station = agent.station.toLowerCase()
  const kind = (agent.kind ?? '').toLowerCase()

  return (
    kind === 'guard' ||
    station === 'qa' ||
    role.includes('review') ||
    role.includes('qa') ||
    role.includes('audit')
  )
}

async function findAgent(request: ToolRequest) {
  if (request.agentId) {
    const byId = await prisma.agent.findUnique({ where: { id: request.agentId } })
    if (byId) return byId
  }

  if (request.agentName) {
    const token = request.agentName
    const byName = await prisma.agent.findFirst({
      where: {
        OR: [
          { name: token },
          { displayName: token },
          { slug: token },
          { runtimeAgentId: token },
        ],
      },
    })
    if (byName) return byName
  }

  return null
}

async function findAgentByToken(token: string) {
  const trimmed = token.trim()
  if (!trimmed) return null

  return prisma.agent.findFirst({
    where: {
      OR: [
        { id: trimmed },
        { name: trimmed },
        { displayName: trimmed },
        { slug: trimmed },
        { runtimeAgentId: trimmed },
      ],
    },
  })
}

function firstStringArg(
  args: Record<string, unknown> | undefined,
  keys: string[]
): string | null {
  if (!args) return null
  for (const key of keys) {
    const value = args[key]
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed) return trimmed
  }
  return null
}

async function enforceTargetHierarchy(
  agentId: string,
  request: ToolRequest
): Promise<PolicyResult | null> {
  if (request.tool !== 'message' && request.tool !== 'sessions_spawn' && request.tool !== 'sessions_send') {
    return null
  }

  const targetToken = firstStringArg(request.args, [
    'targetAgentId',
    'toAgentId',
    'recipientAgentId',
    'targetAgent',
    'to',
    'agentId',
    'agent',
  ])
  if (!targetToken) return null

  const targetAgent = await findAgentByToken(targetToken)
  if (!targetAgent) {
    // Maintain previous behavior when a target cannot be resolved.
    return null
  }

  try {
    if (request.tool === 'message') {
      await teamHierarchyPolicyService.assertCanMessage(agentId, targetAgent.id, {
        source: 'tool_policy',
        workOrderId: request.workOrderId,
        operationId: request.operationId,
      })
    } else {
      await teamHierarchyPolicyService.assertCanDelegate(agentId, targetAgent.id, {
        source: 'tool_policy',
        workOrderId: request.workOrderId,
        operationId: request.operationId,
      })
    }
    return null
  } catch (error) {
    if (error instanceof TeamHierarchyPolicyViolation) {
      return {
        allowed: false,
        reason: error.message,
        resolvedAgentId: agentId,
      }
    }
    throw error
  }
}

/**
 * Checks if an agent is allowed to use a specific tool based on DB capabilities.
 */
export async function checkToolPolicy(request: ToolRequest): Promise<PolicyResult> {
  const agent = await findAgent(request)

  if (!agent) {
    const token = request.agentId || request.agentName || 'unknown'
    return { allowed: false, reason: `Unknown agent: ${token}` }
  }

  const capabilities = safeParseJsonObject(agent.capabilities)
  if (!capabilities) {
    return { allowed: false, reason: `Invalid capabilities JSON for agent: ${agent.id}` }
  }

  const toolRequirements: Record<string, string[]> = {
    exec: ['can_execute_code'],
    write: ['can_modify_files'],
    edit: ['can_modify_files'],
    message: ['can_send_messages'],
    sessions_spawn: ['can_delegate'],
    sessions_send: ['can_delegate'],
    web_search: ['can_web_search'],
    web_fetch: ['can_web_search'],
    browser: ['can_execute_code'],
  }

  const requiredCaps = toolRequirements[request.tool] ?? []

  for (const cap of requiredCaps) {
    if (!capabilities[cap]) {
      return {
        allowed: false,
        reason: `Agent ${agent.id} lacks capability: ${cap}`,
        resolvedAgentId: agent.id,
        resolvedAgentName: agent.displayName ?? agent.name,
      }
    }
  }

  // Review-style agents should only run explicitly allowlisted commands.
  if (request.tool === 'exec') {
    const allowlist = Array.isArray(capabilities.exec_allowlist)
      ? (capabilities.exec_allowlist as unknown[]).filter((x): x is string => typeof x === 'string')
      : []

    const reviewLike = isReviewLikeAgent({
      role: agent.role,
      station: agent.station,
      kind: agent.kind,
    })
    if (!reviewLike && allowlist.length === 0) {
      return {
        allowed: true,
        resolvedAgentId: agent.id,
        resolvedAgentName: agent.displayName ?? agent.name,
      }
    }

    const command = String(request.args?.command ?? request.args?.cmd ?? '').trim()
    if (!command) {
      return {
        allowed: false,
        reason: 'Missing command for exec policy evaluation',
        resolvedAgentId: agent.id,
        resolvedAgentName: agent.displayName ?? agent.name,
      }
    }

    if (allowlist.length === 0) {
      return {
        allowed: false,
        reason: `Review agent ${agent.id} has no exec allowlist configured`,
        resolvedAgentId: agent.id,
        resolvedAgentName: agent.displayName ?? agent.name,
      }
    }

    const isAllowed = allowlist.some((pattern) => command.startsWith(pattern))

    if (!isAllowed) {
      return {
        allowed: false,
        reason: `Command not in review exec allowlist: ${command}`,
        resolvedAgentId: agent.id,
        resolvedAgentName: agent.displayName ?? agent.name,
      }
    }
  }

  const hierarchyResult = await enforceTargetHierarchy(agent.id, request)
  if (hierarchyResult) {
    return hierarchyResult
  }

  return {
    allowed: true,
    resolvedAgentId: agent.id,
    resolvedAgentName: agent.displayName ?? agent.name,
  }
}

/**
 * Route helper that enforces tool policies based on JSON body fields:
 * - agentId (preferred)
 * - agentName (compatibility fallback)
 * - tool
 * - args (optional)
 *
 * Notes:
 * - Uses request.clone().json() so the downstream handler can still read req.json().
 * - Logs denials to Activity for auditability.
 */
export function withToolPolicy<
  TRequest extends Request,
  TContext = unknown,
  TResult extends Response | Promise<Response> = Promise<Response>
>(
  handler: (req: TRequest, ctx: TContext) => TResult,
  options?: {
    resolveRequest?: (
      req: TRequest,
      ctx: TContext,
      body: unknown
    ) => ToolRequest | null | Promise<ToolRequest | null>
  }
) {
  return async (req: TRequest, ctx: TContext): Promise<Response> => {
    let body: unknown = null

    try {
      body = await req.clone().json()
    } catch {
      // Ignore non-JSON
    }

    const fallbackBody = body as Partial<ToolRequest> | null
    const resolved = options?.resolveRequest
      ? await options.resolveRequest(req, ctx, body)
      : (fallbackBody?.tool
        ? {
            agentId: fallbackBody.agentId ? String(fallbackBody.agentId) : undefined,
            agentName: fallbackBody.agentName ? String(fallbackBody.agentName) : undefined,
            tool: String(fallbackBody.tool),
            args: (fallbackBody as { args?: unknown }).args as Record<string, unknown> | undefined,
            operationId: fallbackBody.operationId ? String(fallbackBody.operationId) : undefined,
            workOrderId: fallbackBody.workOrderId ? String(fallbackBody.workOrderId) : undefined,
          }
        : null)

    if (resolved && (resolved.agentId || resolved.agentName) && resolved.tool) {
      const result = await checkToolPolicy(resolved)

      if (!result.allowed) {
        const resolvedAgentId = result.resolvedAgentId
        const actorToken = resolvedAgentId ?? String(resolved.agentId ?? resolved.agentName ?? 'unknown')
        const entityType = resolved.operationId ? 'operation' : 'agent'
        const entityId = resolved.operationId ? String(resolved.operationId) : actorToken

        await getRepos()
          .activities
          .create({
            type: 'policy.tool_denied',
            actor: `agent:${actorToken}`,
            actorType: 'agent',
            actorAgentId: resolvedAgentId ?? null,
            entityType,
            entityId,
            category: 'system',
            riskLevel: 'danger',
            summary: `Tool policy denied: ${resolved.tool}`,
            payloadJson: {
              agentId: resolvedAgentId ?? resolved.agentId ?? null,
              agentName: resolved.agentName ?? result.resolvedAgentName ?? null,
              tool: resolved.tool,
              args: resolved.args ?? null,
              reason: result.reason ?? null,
            },
          })
          .catch(() => {})

        return new Response(JSON.stringify({ error: 'POLICY_DENIED', reason: result.reason }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        })
      }
    }

    return handler(req, ctx) as unknown as Response
  }
}
