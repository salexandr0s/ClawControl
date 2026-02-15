import { NextRequest, NextResponse } from 'next/server'
import { promises as fsp } from 'node:fs'
import { enforceActionPolicy } from '@/lib/with-governor'
import { getRepos } from '@/lib/repo'
import { asAuthErrorResponse, verifyOperatorRequest } from '@/lib/auth/operator-auth'
import { validateWorkspacePath } from '@/lib/fs/path-policy'
import { upsertAgentToOpenClaw } from '@/lib/services/openclaw-config'
import { buildCapabilitiesForTemplate } from '@/lib/services/agent-provisioning'
import { generateSessionKey, AGENT_ROLE_MAP } from '@/lib/workspace'
import { getTemplateById, materializeTemplateFiles, previewTemplateRender, renderTemplate } from '@/lib/templates'
import { isCanonicalStationId, normalizeStationId, type StationId } from '@clawcontrol/core'

interface RouteContext {
  params: Promise<{ id: string }>
}

async function ensureWorkspaceFilesExist(paths: string[]): Promise<{ ok: true } | { ok: false; missing: string[] }> {
  const missing: string[] = []
  for (const workspacePath of paths) {
    const validated = validateWorkspacePath(workspacePath)
    if (!validated.valid || !validated.resolvedPath) {
      missing.push(workspacePath)
      continue
    }

    try {
      await fsp.access(validated.resolvedPath)
    } catch {
      missing.push(workspacePath)
    }
  }

  if (missing.length > 0) return { ok: false, missing }
  return { ok: true }
}

/**
 * POST /api/agent-teams/:id/instantiate
 *
 * Instantiate the team's agents from its linked templateIds and materialize required workspace files.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params

  const auth = verifyOperatorRequest(request, { requireCsrf: true })
  if (!auth.ok) {
    return NextResponse.json(asAuthErrorResponse(auth), { status: auth.status })
  }

  const body = (await request.json().catch(() => ({}))) as { typedConfirmText?: string }

  const enforcement = await enforceActionPolicy({
    actionKind: 'team.instantiate_agents',
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
  const team = await repos.agentTeams.getById(id)
  if (!team) {
    return NextResponse.json({ error: 'Team not found', code: 'TEAM_NOT_FOUND' }, { status: 404 })
  }

  const receipt = await repos.receipts.create({
    workOrderId: 'system',
    kind: 'manual',
    commandName: 'team.instantiate_agents',
    commandArgs: { teamId: team.id, teamSlug: team.slug, templateIds: team.templateIds },
  })

  const createdAgents: Array<{ id: string; slug: string; displayName: string }> = []
  const existingAgents: Array<{ id: string; slug: string; displayName: string }> = []
  const outcomes: Array<{
    templateId: string
    status: 'created' | 'existing'
    agentId: string
    agentSlug: string
    filesWritten: string[]
    filesSkipped: string[]
  }> = []

  const filesWritten: string[] = []
  const filesSkipped: string[] = []

  try {
    await repos.receipts.append(receipt.id, {
      stream: 'stdout',
      chunk: `Instantiating agents for team ${team.name} (${team.slug})...\n`,
    })

    for (const templateId of team.templateIds) {
      const template = await getTemplateById(templateId)
      if (!template) {
        throw new Error(`Missing template in workspace: ${templateId}`)
      }
      if (!template.isValid || !template.config) {
        throw new Error(`Template is invalid: ${templateId}`)
      }

      const role = template.config.role || template.role
      const roleMapping = AGENT_ROLE_MAP[role.toLowerCase()]
      const stationResolved = normalizeStationId(roleMapping?.station || 'build')
      if (!isCanonicalStationId(stationResolved)) {
        throw new Error(`Resolved station "${stationResolved}" is not canonical for template ${templateId}`)
      }
      const stationId: StationId = templateId === 'security' ? 'security' : stationResolved

      const existing = await repos.agents.getBySlug(templateId)

      let agent = existing
      let created = false
      let openClawAgentId: string | null = null

      if (!existing) {
        const agentDisplayName = template.name
        const agentSlug = templateId

        const sessionKeyPattern = template.config.sessionKeyPattern
        const sessionKey = sessionKeyPattern
          ? renderTemplate(sessionKeyPattern, {
              agentName: agentDisplayName,
              agentDisplayName: agentDisplayName,
              agentSlug,
            })
          : generateSessionKey(agentSlug)

        const capabilitiesObj = buildCapabilitiesForTemplate({ templateId, stationId })

        await repos.receipts.append(receipt.id, {
          stream: 'stdout',
          chunk: `Creating agent ${agentDisplayName} (${agentSlug}) from template ${template.name}...\n`,
        })

        const openClawSync = await upsertAgentToOpenClaw({
          agentId: agentSlug,
          runtimeAgentId: agentSlug,
          slug: agentSlug,
          displayName: agentDisplayName,
          sessionKey,
        })

        if (!openClawSync.ok) {
          throw new Error(`Failed to register agent in OpenClaw: ${openClawSync.error}`)
        }

        openClawAgentId = openClawSync.agentId ?? agentSlug

        agent = await repos.agents.create({
          name: agentDisplayName,
          displayName: agentDisplayName,
          slug: agentSlug,
          runtimeAgentId: openClawAgentId,
          nameSource: 'system',
          role,
          station: stationId,
          teamId: team.id,
          sessionKey,
          capabilities: capabilitiesObj as unknown as Record<string, boolean>,
          wipLimit: 2,
        })

        createdAgents.push({ id: agent.id, slug: agent.slug, displayName: agent.displayName })
        created = true

      } else {
        existingAgents.push({ id: existing.id, slug: existing.slug, displayName: existing.displayName })

        if (existing.teamId !== team.id) {
          await repos.agents.update(existing.id, { teamId: team.id })
        }
      }

      if (!agent) {
        throw new Error(`Failed to resolve or create agent for template ${templateId}`)
      }

      const mergedParams = {
        ...template.config.defaults,
        agentName: agent.displayName,
        agentDisplayName: agent.displayName,
        agentSlug: agent.slug,
        sessionKey: agent.sessionKey,
      }

      const renderedFiles = await previewTemplateRender(templateId, mergedParams)
      const expectsOverlay = renderedFiles.some((file) => file.destination === `workspace/agents/${agent.slug}.md`)

      const materialized = await materializeTemplateFiles(templateId, mergedParams)
      if (!materialized.ok) {
        throw new Error(materialized.error || `Failed to materialize template files for ${templateId}`)
      }

      filesWritten.push(...materialized.writtenPaths)
      filesSkipped.push(...materialized.skippedPaths)

      const requiredWorkspaceFiles = [
        `/agents/${agent.slug}/SOUL.md`,
        `/agents/${agent.slug}/HEARTBEAT.md`,
        `/agents/${agent.slug}/MEMORY.md`,
      ]
      if (expectsOverlay) requiredWorkspaceFiles.push(`/agents/${agent.slug}.md`)

      const verify = await ensureWorkspaceFilesExist(requiredWorkspaceFiles)
      if (!verify.ok) {
        throw new Error(`Missing required agent files after provisioning (${templateId}): ${verify.missing.join(', ')}`)
      }

      outcomes.push({
        templateId,
        status: created ? 'created' : 'existing',
        agentId: agent.id,
        agentSlug: agent.slug,
        filesWritten: materialized.writtenPaths,
        filesSkipped: materialized.skippedPaths,
      })
    }

    await repos.receipts.append(receipt.id, {
      stream: 'stdout',
      chunk: `Instantiated agents: created=${createdAgents.length}, existing=${existingAgents.length}\n`,
    })

    await repos.receipts.finalize(receipt.id, {
      exitCode: 0,
      durationMs: 0,
      parsedJson: {
        teamId: team.id,
        createdAgents,
        existingAgents,
        outcomes,
        filesWritten,
        filesSkipped,
      },
    })

    return NextResponse.json({
      data: {
        teamId: team.id,
        createdAgents,
        existingAgents,
        outcomes,
        filesWritten,
        filesSkipped,
        receiptId: receipt.id,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    await repos.receipts.append(receipt.id, {
      stream: 'stderr',
      chunk: `Error: ${message}\n`,
    })

    await repos.receipts.finalize(receipt.id, {
      exitCode: 1,
      durationMs: 0,
      parsedJson: {
        error: message,
        teamId: team.id,
        createdAgents,
        existingAgents,
        outcomes,
        filesWritten,
        filesSkipped,
      },
    })

    return NextResponse.json(
      {
        error: message,
        receiptId: receipt.id,
        details: {
          teamId: team.id,
          createdAgents,
          existingAgents,
          outcomes,
          filesWritten,
          filesSkipped,
        },
      },
      { status: 500 }
    )
  }
}
