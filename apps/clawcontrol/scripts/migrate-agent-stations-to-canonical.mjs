#!/usr/bin/env node

import { PrismaClient } from '@prisma/client'
import { createSqliteAdapter } from '../lib/prisma-sqlite-adapter.js'

const CANONICAL_STATIONS = [
  'strategic',
  'orchestration',
  'spec',
  'build',
  'qa',
  'security',
  'ops',
  'ship',
  'compound',
  'update',
]

const CANONICAL_STATION_METADATA = {
  strategic: { name: 'strategic', icon: 'star', description: 'Strategic interface and executive direction', sortOrder: 0 },
  orchestration: { name: 'orchestration', icon: 'map', description: 'Workflow orchestration and stage routing', sortOrder: 5 },
  spec: { name: 'spec', icon: 'file-text', description: 'Planning and specification', sortOrder: 10 },
  build: { name: 'build', icon: 'hammer', description: 'Implementation and coding', sortOrder: 20 },
  qa: { name: 'qa', icon: 'check-circle', description: 'Quality assurance and review', sortOrder: 30 },
  security: { name: 'security', icon: 'shield-check', description: 'Security review and risk control', sortOrder: 35 },
  ops: { name: 'ops', icon: 'settings', description: 'Operations and deployment', sortOrder: 40 },
  ship: { name: 'ship', icon: 'zap', description: 'Release and rollout', sortOrder: 50 },
  compound: { name: 'compound', icon: 'brain', description: 'Learning and synthesis', sortOrder: 60 },
  update: { name: 'update', icon: 'wrench', description: 'Maintenance and updates', sortOrder: 70 },
}

const CANONICAL_SET = new Set(CANONICAL_STATIONS)

function parseArgs(argv) {
  const out = {
    apply: false,
  }

  for (const arg of argv) {
    if (arg === '--apply') out.apply = true
    if (arg === '--dry-run') out.apply = false
    if (arg === '--help' || arg === '-h') out.help = true
  }

  return out
}

function normalize(value) {
  return (value ?? '').trim().toLowerCase()
}

function includesAny(text, tokens) {
  return tokens.some((token) => text.includes(token))
}

function inferCanonicalStation(agent) {
  const tokens = normalize(
    [
      agent.station,
      agent.role,
      agent.displayName,
      agent.name,
      agent.runtimeAgentId,
      agent.slug,
    ]
      .filter(Boolean)
      .join(' ')
  )

  if (includesAny(tokens, ['ceo', 'chief', 'executive', 'strategic'])) return 'strategic'
  if (includesAny(tokens, ['manager', 'orchestrator', 'orchestration', 'router'])) return 'orchestration'
  if (includesAny(tokens, ['security', 'guard', 'audit', 'vuln', 'auth'])) return 'security'
  if (includesAny(tokens, ['spec', 'plan', 'planner', 'research', 'design', 'architecture'])) return 'spec'
  if (includesAny(tokens, ['qa', 'review', 'reviewer', 'test', 'verification'])) return 'qa'
  if (includesAny(tokens, ['ops', 'infra', 'sre', 'deploy', 'platform'])) return 'ops'
  if (includesAny(tokens, ['ship', 'release', 'rollout'])) return 'ship'
  if (includesAny(tokens, ['compound', 'learning', 'knowledge', 'memory'])) return 'compound'
  if (includesAny(tokens, ['update', 'maintenance', 'dependency'])) return 'update'
  if (includesAny(tokens, ['build', 'builder', 'dev', 'engineer', 'ui', 'frontend', 'backend', 'code'])) return 'build'
  return 'build'
}

function printHelp() {
  console.log(`migrate-agent-stations-to-canonical

Usage:
  node scripts/migrate-agent-stations-to-canonical.mjs [--dry-run] [--apply]

Behavior:
  - Scans agents with non-canonical station ids.
  - Infers canonical target station.
  - In --apply mode, updates agent.station and ensures canonical station rows exist.

Notes:
  - Default mode is --dry-run.
`)
}

async function ensureCanonicalStations(prisma) {
  for (const stationId of CANONICAL_STATIONS) {
    const meta = CANONICAL_STATION_METADATA[stationId]
    await prisma.station.upsert({
      where: { id: stationId },
      create: {
        id: stationId,
        name: meta.name,
        icon: meta.icon,
        description: meta.description,
        color: null,
        sortOrder: meta.sortOrder,
      },
      update: {},
    })
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }

  const prisma = new PrismaClient({
    adapter: createSqliteAdapter(process.env.DATABASE_URL),
  })
  const modeLabel = args.apply ? 'APPLY' : 'DRY-RUN'
  console.log(`[migrate-agent-stations-to-canonical] mode=${modeLabel}`)

  try {
    const agents = await prisma.agent.findMany({
      select: {
        id: true,
        name: true,
        displayName: true,
        slug: true,
        runtimeAgentId: true,
        role: true,
        station: true,
      },
      orderBy: [{ displayName: 'asc' }, { name: 'asc' }],
    })

    const candidates = []
    for (const agent of agents) {
      const currentStation = normalize(agent.station)
      if (CANONICAL_SET.has(currentStation)) continue
      const targetStation = inferCanonicalStation(agent)
      candidates.push({
        ...agent,
        currentStation,
        targetStation,
      })
    }

    console.log(`- scanned agents: ${agents.length}`)
    console.log(`- non-canonical station agents: ${candidates.length}`)

    if (candidates.length === 0) {
      console.log('- no changes needed')
      return
    }

    for (const candidate of candidates) {
      console.log(
        `[candidate] ${candidate.id} "${candidate.displayName ?? candidate.name}" ${candidate.currentStation} -> ${candidate.targetStation}`
      )
    }

    if (!args.apply) {
      console.log('[dry-run] no database updates were applied')
      return
    }

    await ensureCanonicalStations(prisma)

    let updated = 0
    for (const candidate of candidates) {
      await prisma.agent.update({
        where: { id: candidate.id },
        data: {
          station: candidate.targetStation,
        },
      })
      updated += 1
      console.log(`[updated] ${candidate.id} -> ${candidate.targetStation}`)
    }

    console.log(`- updated agents: ${updated}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(`[migrate-agent-stations-to-canonical] failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
