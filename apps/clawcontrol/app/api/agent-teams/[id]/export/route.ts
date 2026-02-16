import { NextRequest, NextResponse } from 'next/server'
import yaml from 'js-yaml'
import { getRepos } from '@/lib/repo'
import { asAuthErrorResponse, verifyOperatorRequest } from '@/lib/auth/operator-auth'
import { enforceActionPolicy } from '@/lib/with-governor'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * GET /api/agent-teams/:id/export
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params

  const auth = verifyOperatorRequest(request)
  if (!auth.ok) {
    return NextResponse.json(asAuthErrorResponse(auth), { status: auth.status })
  }

  const typedConfirmText = request.nextUrl.searchParams.get('confirm') || undefined
  const enforcement = await enforceActionPolicy({
    actionKind: 'team.export',
    typedConfirmText,
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
  const team = await repos.agentTeams.getById(id)
  if (!team) {
    return NextResponse.json({ error: 'Team not found', code: 'TEAM_NOT_FOUND' }, { status: 404 })
  }

  const exported = {
    id: team.id,
    slug: team.slug,
    name: team.name,
    description: team.description,
    source: team.source,
    workflowIds: team.workflowIds,
    templateIds: team.templateIds,
    hierarchy: team.hierarchy,
    members: team.members.map((member) => ({
      id: member.id,
      slug: member.slug,
      templateId: member.templateId,
      displayName: member.displayName,
      role: member.role,
      station: member.station,
      status: member.status,
    })),
    exportedAt: new Date().toISOString(),
  }

  const content = yaml.dump(exported, {
    indent: 2,
    lineWidth: 100,
    noRefs: true,
    sortKeys: false,
  })

  return new NextResponse(content.endsWith('\n') ? content : `${content}\n`, {
    headers: {
      'Content-Type': 'application/x-yaml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${team.slug || team.id}.team.yaml"`,
    },
  })
}
