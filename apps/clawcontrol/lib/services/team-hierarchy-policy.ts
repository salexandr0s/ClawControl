import 'server-only'

import { prisma } from '@/lib/db'
import { getRepos } from '@/lib/repo'

type PolicyAction = 'delegate' | 'message'

export class TeamHierarchyPolicyViolation extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'AGENT_NOT_FOUND'
      | 'TEAM_REQUIRED'
      | 'TEAM_MISMATCH'
      | 'TEAM_NOT_FOUND'
      | 'MISSING_TEMPLATE_BINDING'
      | 'LINK_NOT_ALLOWED',
    public readonly details: Record<string, unknown> = {}
  ) {
    super(message)
    this.name = 'TeamHierarchyPolicyViolation'
  }
}

interface PolicyContext {
  source?: string
  workOrderId?: string
  operationId?: string
}

interface PolicyAgent {
  id: string
  displayName: string | null
  name: string
  slug: string | null
  teamId: string | null
  templateId: string | null
}

function labelAgent(agent: PolicyAgent): string {
  return agent.displayName?.trim() || agent.name
}

async function loadAgent(agentId: string): Promise<PolicyAgent | null> {
  return prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      id: true,
      displayName: true,
      name: true,
      slug: true,
      teamId: true,
      templateId: true,
    },
  })
}

function assertSameTeam(from: PolicyAgent, to: PolicyAgent, context: PolicyContext): string {
  if (!from.teamId || !to.teamId) {
    throw new TeamHierarchyPolicyViolation(
      'Hierarchy enforcement requires both agents to belong to a team',
      'TEAM_REQUIRED',
      {
        fromAgentId: from.id,
        toAgentId: to.id,
        fromTeamId: from.teamId,
        toTeamId: to.teamId,
        ...context,
      }
    )
  }

  if (from.teamId !== to.teamId) {
    throw new TeamHierarchyPolicyViolation(
      'Agent-to-agent operation blocked: agents belong to different teams',
      'TEAM_MISMATCH',
      {
        fromAgentId: from.id,
        toAgentId: to.id,
        fromTeamId: from.teamId,
        toTeamId: to.teamId,
        ...context,
      }
    )
  }

  return from.teamId
}

function isAllowedByHierarchy(input: {
  action: PolicyAction
  sourceTemplateId: string
  targetTemplateId: string
  member: {
    delegatesTo: string[]
    canMessage: string[]
    capabilities: {
      canDelegate?: boolean
      canSendMessages?: boolean
    }
  }
}): boolean {
  if (input.sourceTemplateId === input.targetTemplateId) return true

  if (input.action === 'delegate') {
    if (input.member.capabilities.canDelegate === false) return false
    return input.member.delegatesTo.includes(input.targetTemplateId)
  }

  if (input.member.capabilities.canSendMessages === false) return false
  return input.member.canMessage.includes(input.targetTemplateId)
}

async function assertByAction(
  action: PolicyAction,
  fromAgentId: string,
  toAgentId: string,
  context: PolicyContext
): Promise<void> {
  const [fromAgent, toAgent] = await Promise.all([
    loadAgent(fromAgentId),
    loadAgent(toAgentId),
  ])

  if (!fromAgent || !toAgent) {
    throw new TeamHierarchyPolicyViolation(
      'Agent not found',
      'AGENT_NOT_FOUND',
      {
        fromAgentId,
        toAgentId,
        ...context,
      }
    )
  }

  const teamId = assertSameTeam(fromAgent, toAgent, context)
  if (!fromAgent.templateId || !toAgent.templateId) {
    throw new TeamHierarchyPolicyViolation(
      'Hierarchy enforcement requires templateId on both agents',
      'MISSING_TEMPLATE_BINDING',
      {
        fromAgentId: fromAgent.id,
        toAgentId: toAgent.id,
        fromTemplateId: fromAgent.templateId,
        toTemplateId: toAgent.templateId,
        teamId,
        ...context,
      }
    )
  }

  const team = await getRepos().agentTeams.getById(teamId)
  if (!team) {
    throw new TeamHierarchyPolicyViolation(
      'Team not found for hierarchy enforcement',
      'TEAM_NOT_FOUND',
      {
        teamId,
        fromAgentId: fromAgent.id,
        toAgentId: toAgent.id,
        ...context,
      }
    )
  }

  const fromMember = team.hierarchy.members[fromAgent.templateId]
  if (!fromMember) {
    throw new TeamHierarchyPolicyViolation(
      `Hierarchy member missing for source template "${fromAgent.templateId}"`,
      'LINK_NOT_ALLOWED',
      {
        teamId,
        sourceTemplateId: fromAgent.templateId,
        targetTemplateId: toAgent.templateId,
        ...context,
      }
    )
  }

  const allowed = isAllowedByHierarchy({
    action,
    sourceTemplateId: fromAgent.templateId,
    targetTemplateId: toAgent.templateId,
    member: fromMember,
  })

  if (allowed) return

  const relation = action === 'delegate' ? 'delegatesTo' : 'canMessage'
  throw new TeamHierarchyPolicyViolation(
    `Hierarchy policy blocked ${action}: ${labelAgent(fromAgent)} -> ${labelAgent(toAgent)}`,
    'LINK_NOT_ALLOWED',
    {
      teamId,
      action,
      relation,
      fromAgentId: fromAgent.id,
      toAgentId: toAgent.id,
      sourceTemplateId: fromAgent.templateId,
      targetTemplateId: toAgent.templateId,
      allowedTargets: fromMember[relation],
      ...context,
    }
  )
}

export class TeamHierarchyPolicyService {
  async assertCanDelegate(
    fromAgentId: string,
    toAgentId: string,
    context: PolicyContext = {}
  ): Promise<void> {
    await assertByAction('delegate', fromAgentId, toAgentId, context)
  }

  async assertCanMessage(
    fromAgentId: string,
    toAgentId: string,
    context: PolicyContext = {}
  ): Promise<void> {
    await assertByAction('message', fromAgentId, toAgentId, context)
  }
}

export const teamHierarchyPolicyService = new TeamHierarchyPolicyService()

