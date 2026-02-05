import { NextResponse } from 'next/server'
import { getRepos } from '@/lib/repo'
import { prisma } from '@/lib/db'
import { runCommand } from '@clawcontrol/adapters-openclaw'

type OpenClawAgentConfig = {
  id: string
  name?: string
  identity?: {
    name?: string
    emoji?: string
  }
}

function inferDisplayName(agentId: string, cfg: OpenClawAgentConfig): string {
  return cfg.name || cfg.identity?.name || agentId
}

function inferSessionKey(agentId: string): string {
  // Matches OpenClaw session key convention for agent stores.
  // main is special because it's typically agent:main:main
  if (agentId === 'main') return 'agent:main:main'
  return `agent:${agentId}:${agentId}`
}

async function getDefaultStationId(): Promise<string> {
  const repos = getRepos()

  const ops = await repos.stations.getById('ops')
  if (ops) return 'ops'

  const stations = await repos.stations.list()
  return stations[0]?.id ?? 'ops'
}

function stderrExcerpt(stderr: string): string {
  const max = 2000
  if (stderr.length <= max) return stderr
  return '...(truncated)\n' + stderr.slice(-max)
}

/**
 * POST /api/openclaw/agents/sync
 *
 * Pull OpenClaw agent definitions from local OpenClaw config and upsert them
 * into clawcontrol's DB.
 */
export async function POST() {
  const repos = getRepos()

  // Pull from OpenClaw local config (authoritative list of agent ids)
  const cmd = await runCommand('config.agents.list.json')
  if (cmd.exitCode !== 0) {
    return NextResponse.json(
      {
        error: 'OPENCLAW_SYNC_FAILED',
        detail: cmd.stderr || cmd.error || `Command failed with exit code ${cmd.exitCode}`,
        stderr: cmd.stderr ? stderrExcerpt(cmd.stderr) : undefined,
      },
      { status: 502 }
    )
  }

  let agents: OpenClawAgentConfig[] = []
  try {
    agents = JSON.parse(cmd.stdout) as OpenClawAgentConfig[]
  } catch {
    return NextResponse.json(
      {
        error: 'OPENCLAW_SYNC_FAILED',
        detail: 'Failed to parse JSON output',
        stderr: cmd.stderr ? stderrExcerpt(cmd.stderr) : undefined,
      },
      { status: 502 }
    )
  }

  let created = 0
  let updated = 0
  let pruned = 0
  let pruneSkippedInUse = 0

  const defaultStationId = await getDefaultStationId()
  const openclawSessionKeys = new Set<string>()

  for (const a of agents) {
    if (!a?.id) continue

    const name = inferDisplayName(a.id, a)
    const sessionKey = inferSessionKey(a.id)
    openclawSessionKeys.add(sessionKey)

    // Upsert by sessionKey (unique)
    const existing = await repos.agents.getBySessionKey(sessionKey)

    if (!existing) {
      await repos.agents.create({
        name,
        role: 'agent',
        station: defaultStationId,
        sessionKey,
        capabilities: { [defaultStationId]: true },
        wipLimit: a.id === 'clawbuild' ? 3 : 2,
      })
      created++
    } else {
      await repos.agents.update(existing.id, {
        name,
      })
      updated++
    }
  }

  // Prune: delete DB agents missing from OpenClaw (OpenClaw-sourced only)
  const operations = await repos.operations.list({})
  const assignedAgentIds = new Set<string>()
  for (const op of operations) {
    for (const agentId of op.assigneeAgentIds) assignedAgentIds.add(agentId)
  }

  const dbOpenclawAgents = await prisma.agent.findMany({
    where: { sessionKey: { startsWith: 'agent:' } },
    select: { id: true, sessionKey: true },
  })

  for (const dbAgent of dbOpenclawAgents) {
    if (openclawSessionKeys.has(dbAgent.sessionKey)) continue
    if (assignedAgentIds.has(dbAgent.id)) {
      pruneSkippedInUse++
      continue
    }
    await prisma.agent.delete({ where: { id: dbAgent.id } })
    pruned++
  }

  const data = await repos.agents.list({})

  return NextResponse.json({
    data,
    stats: {
      seen: agents.length,
      created,
      updated,
      pruned,
      pruneSkippedInUse,
    },
  })
}
