import { NextRequest, NextResponse } from 'next/server'
import { getRepos } from '@/lib/repo'
import { asAuthErrorResponse, verifyOperatorRequest } from '@/lib/auth/operator-auth'
import { enforceActionPolicy } from '@/lib/with-governor'
import { getTemplateById } from '@/lib/templates'
import {
  assertValidTeamHierarchy,
  buildTeamHierarchyFromTemplateDefaults,
  TeamHierarchyValidationError,
} from '@/lib/services/team-hierarchy'
import type { TeamHierarchyConfig } from '@/lib/repo/types'

function dedupe(values: string[] | undefined): string[] {
  if (!values || values.length === 0) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

async function buildHierarchyFromDefaults(templateIds: string[]): Promise<TeamHierarchyConfig> {
  const templatesById = new Map()
  for (const templateId of templateIds) {
    const template = await getTemplateById(templateId)
    if (template) templatesById.set(templateId, template)
  }
  return buildTeamHierarchyFromTemplateDefaults(templateIds, templatesById)
}

/**
 * GET /api/agent-teams
 */
export async function GET() {
  const repos = getRepos()
  const data = await repos.agentTeams.list()
  return NextResponse.json({ data })
}

/**
 * POST /api/agent-teams
 */
export async function POST(request: NextRequest) {
  const auth = verifyOperatorRequest(request, { requireCsrf: true })
  if (!auth.ok) {
    return NextResponse.json(asAuthErrorResponse(auth), { status: auth.status })
  }

  const body = (await request.json().catch(() => null)) as {
    name?: string
    slug?: string
    description?: string | null
    source?: 'builtin' | 'custom' | 'imported'
    workflowIds?: string[]
    templateIds?: string[]
    hierarchy?: TeamHierarchyConfig
    healthStatus?: 'healthy' | 'warning' | 'degraded' | 'unknown'
    memberAgentIds?: string[]
    typedConfirmText?: string
  } | null

  if (!body || typeof body.name !== 'string' || !body.name.trim()) {
    return NextResponse.json({ error: 'Team name is required' }, { status: 400 })
  }

  const enforcement = await enforceActionPolicy({
    actionKind: 'team.create',
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
  const templateIds = dedupe(body.templateIds)

  try {
    const hierarchy = body.hierarchy
      ? assertValidTeamHierarchy(body.hierarchy, templateIds)
      : await buildHierarchyFromDefaults(templateIds)

    const data = await repos.agentTeams.create({
      name: body.name,
      slug: body.slug,
      description: body.description,
      source: body.source,
      workflowIds: body.workflowIds,
      templateIds,
      hierarchy,
      healthStatus: body.healthStatus,
      memberAgentIds: body.memberAgentIds,
    })

    return NextResponse.json({ data }, { status: 201 })
  } catch (error) {
    if (error instanceof TeamHierarchyValidationError) {
      return NextResponse.json(
        {
          error: 'TEAM_HIERARCHY_INVALID',
          code: 'TEAM_HIERARCHY_INVALID',
          details: { issues: error.details },
        },
        { status: 400 }
      )
    }
    throw error
  }
}
