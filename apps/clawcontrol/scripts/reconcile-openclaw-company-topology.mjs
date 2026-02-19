#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const REQUIRED_STAGE_COVERAGE = [
  'research',
  'plan',
  'plan_review',
  'build',
  'build_review',
  'ui',
  'ui_review',
  'ops',
  'security',
]

const RESOLVER_HINTS = [
  'build',
  'build_review',
  'ops',
  'plan',
  'plan_review',
  'research',
  'security',
  'ui',
  'ui_review',
]

const TOPOLOGY = [
  { runtimeAgentId: 'manager', templateId: 'manager', station: 'orchestration', kind: 'manager', role: 'MANAGER', displayName: 'SavorgManager' },
  { runtimeAgentId: 'wf-research', templateId: 'research', station: 'spec', kind: 'worker', role: 'RESEARCH', displayName: 'SavorgResearch' },
  { runtimeAgentId: 'wf-plan', templateId: 'plan', station: 'spec', kind: 'worker', role: 'PLAN', displayName: 'SavorgPlan' },
  { runtimeAgentId: 'wf-plan-review', templateId: 'plan_review', station: 'qa', kind: 'worker', role: 'PLAN_REVIEW', displayName: 'SavorgPlanReview' },
  { runtimeAgentId: 'wf-build', templateId: 'build', station: 'build', kind: 'worker', role: 'BUILD', displayName: 'SavorgBuild' },
  { runtimeAgentId: 'wf-build-review', templateId: 'build_review', station: 'qa', kind: 'worker', role: 'BUILD_REVIEW', displayName: 'SavorgBuildReview' },
  { runtimeAgentId: 'wf-ui', templateId: 'ui', station: 'build', kind: 'worker', role: 'UI', displayName: 'SavorgUI' },
  { runtimeAgentId: 'wf-ui-review', templateId: 'ui_review', station: 'qa', kind: 'worker', role: 'UI_REVIEW', displayName: 'SavorgUIReview' },
  { runtimeAgentId: 'wf-ops', templateId: 'ops', station: 'ops', kind: 'worker', role: 'OPS', displayName: 'SavorgOps', enforceModel: 'anthropic/claude-sonnet-4-6' },
  { runtimeAgentId: 'wf-security', templateId: 'security', station: 'security', kind: 'worker', role: 'SECURITY', displayName: 'SavorgSecurity' },
]

function usage() {
  console.log(`reconcile-openclaw-company-topology

Usage:
  node scripts/reconcile-openclaw-company-topology.mjs [--dry-run] [--apply] [--root=/path/to/ClawControl]

Behavior:
  - Loads starter-pack team definition (clawcontrol-team).
  - Upserts agent_teams row.
  - Reconciles mapped runtime agents (team/template/station/capabilities/model).
  - Enforces wf-security station=security and wf-ops model policy.
`)
}

function parseArgs(argv) {
  const out = {
    apply: false,
    root: null,
  }

  for (const arg of argv) {
    if (arg === '--apply') out.apply = true
    if (arg === '--dry-run') out.apply = false
    if (arg.startsWith('--root=')) out.root = arg.slice('--root='.length).trim() || null
    if (arg === '--help' || arg === '-h') {
      usage()
      process.exit(0)
    }
  }

  return out
}

function normalizeArray(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

function stable(value) {
  if (Array.isArray(value)) return value.map((entry) => stable(entry))
  if (!value || typeof value !== 'object') return value
  const out = {}
  for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) {
    out[key] = stable(value[key])
  }
  return out
}

function stableStringify(value) {
  return JSON.stringify(stable(value))
}

function resolveRepoRoot(explicitRoot) {
  if (explicitRoot) return path.resolve(explicitRoot)

  let current = process.cwd()
  for (let i = 0; i < 6; i += 1) {
    const candidate = path.join(current, 'starter-packs', 'clawcontrol-starter-pack', 'input', 'teams', 'clawcontrol-team.yaml')
    if (existsSync(candidate)) return current
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }

  return process.cwd()
}

function baselineCapabilities(entry) {
  const capabilities = {
    [entry.station]: true,
    [entry.templateId]: true,
  }
  if (entry.templateId === 'manager') {
    capabilities.can_delegate = true
    capabilities.can_send_messages = true
    capabilities.orchestration = true
  }
  if (entry.templateId === 'security') {
    capabilities.security = true
    capabilities.can_send_messages = true
  }
  return capabilities
}

function mergeCapabilities(existingRaw, baseline) {
  let existing = {}
  try {
    const parsed = JSON.parse(existingRaw || '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      existing = parsed
    }
  } catch {
    existing = {}
  }
  return {
    ...existing,
    ...baseline,
  }
}

function safeParseObject(value, fallback = {}) {
  try {
    const parsed = JSON.parse(value || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

function safeParseArray(value) {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function hasTableColumn(tableName, columnName) {
  const rows = await prisma.$queryRawUnsafe(`PRAGMA table_info("${tableName}")`)
  return Array.isArray(rows) && rows.some((row) => String(row?.name || '').trim() === columnName)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const repoRoot = resolveRepoRoot(args.root)
  const mode = args.apply ? 'APPLY' : 'DRY-RUN'
  const hasGovernanceColumn = await hasTableColumn('agent_teams', 'governance_json')

  console.log(`[reconcile-openclaw-company-topology] mode=${mode}`)
  console.log(`[reconcile-openclaw-company-topology] root=${repoRoot}`)

  const missingInResolver = REQUIRED_STAGE_COVERAGE.filter((stage) => !RESOLVER_HINTS.includes(stage))
  const topologyTemplates = new Set(TOPOLOGY.map((entry) => entry.templateId))
  const missingInTopology = REQUIRED_STAGE_COVERAGE.filter((stage) => !topologyTemplates.has(stage))
  if (missingInResolver.length > 0 || missingInTopology.length > 0) {
    throw new Error(
      `Stage coverage invalid: missingInResolver=${missingInResolver.join(',') || 'none'} missingInTopology=${missingInTopology.join(',') || 'none'}`
    )
  }

  const teamPath = path.join(
    repoRoot,
    'starter-packs',
    'clawcontrol-starter-pack',
    'input',
    'teams',
    'clawcontrol-team.yaml'
  )
  const teamRaw = await readFile(teamPath, 'utf8')
  const teamYaml = yaml.load(teamRaw)
  const teamRecord = teamYaml && typeof teamYaml === 'object' ? teamYaml : {}

  const desiredTeam = {
    id: String(teamRecord.id || 'clawcontrol-team'),
    slug: String(teamRecord.slug || 'clawcontrol-team'),
    name: String(teamRecord.name || 'ClawControl Team'),
    description: teamRecord.description ? String(teamRecord.description) : null,
    source: ['imported', 'builtin'].includes(String(teamRecord.source)) ? String(teamRecord.source) : 'custom',
    workflowIds: normalizeArray(teamRecord.workflowIds),
    templateIds: normalizeArray(teamRecord.templateIds),
    hierarchy: teamRecord.hierarchy && typeof teamRecord.hierarchy === 'object' ? teamRecord.hierarchy : { version: 1, members: {} },
    governance: teamRecord.governance && typeof teamRecord.governance === 'object' ? teamRecord.governance : {},
    healthStatus: ['warning', 'degraded', 'unknown'].includes(String(teamRecord.healthStatus))
      ? String(teamRecord.healthStatus)
      : 'healthy',
  }

  const existingTeam = await prisma.agentTeam.findUnique({
    where: { slug: desiredTeam.slug },
    select: hasGovernanceColumn
      ? {
        id: true,
        slug: true,
        name: true,
        description: true,
        source: true,
        workflowIds: true,
        templateIds: true,
        hierarchyJson: true,
        governanceJson: true,
        healthStatus: true,
      }
      : {
        id: true,
        slug: true,
        name: true,
        description: true,
        source: true,
        workflowIds: true,
        templateIds: true,
        hierarchyJson: true,
        healthStatus: true,
      },
  })

  let teamId = existingTeam?.id ?? desiredTeam.id
  let teamCreated = false
  let teamUpdated = false

  if (!existingTeam) {
    teamCreated = true
    if (args.apply) {
      const created = await prisma.agentTeam.create({
        data: {
          id: desiredTeam.id,
          slug: desiredTeam.slug,
          name: desiredTeam.name,
          description: desiredTeam.description,
          source: desiredTeam.source,
          workflowIds: JSON.stringify(desiredTeam.workflowIds),
          templateIds: JSON.stringify(desiredTeam.templateIds),
          hierarchyJson: JSON.stringify(desiredTeam.hierarchy),
          ...(hasGovernanceColumn ? { governanceJson: JSON.stringify(desiredTeam.governance) } : {}),
          healthStatus: desiredTeam.healthStatus,
        },
      })
      teamId = created.id
    }
  } else {
    const existingComparable = {
      name: existingTeam.name,
      description: existingTeam.description,
      workflowIds: normalizeArray(safeParseArray(existingTeam.workflowIds || '[]')),
      templateIds: normalizeArray(safeParseArray(existingTeam.templateIds || '[]')),
      hierarchy: safeParseObject(existingTeam.hierarchyJson || '{"version":1,"members":{}}'),
      ...(hasGovernanceColumn ? { governance: safeParseObject(existingTeam.governanceJson || '{}') } : {}),
      healthStatus: existingTeam.healthStatus,
    }

    const desiredComparable = {
      name: desiredTeam.name,
      description: desiredTeam.description,
      workflowIds: desiredTeam.workflowIds,
      templateIds: desiredTeam.templateIds,
      hierarchy: desiredTeam.hierarchy,
      ...(hasGovernanceColumn ? { governance: desiredTeam.governance } : {}),
      healthStatus: desiredTeam.healthStatus,
    }

    teamUpdated = stableStringify(existingComparable) !== stableStringify(desiredComparable)
    if (teamUpdated && args.apply) {
      await prisma.agentTeam.update({
        where: { id: existingTeam.id },
        data: {
          name: desiredTeam.name,
          description: desiredTeam.description,
          workflowIds: JSON.stringify(desiredTeam.workflowIds),
          templateIds: JSON.stringify(desiredTeam.templateIds),
          hierarchyJson: JSON.stringify(desiredTeam.hierarchy),
          ...(hasGovernanceColumn ? { governanceJson: JSON.stringify(desiredTeam.governance) } : {}),
          healthStatus: desiredTeam.healthStatus,
        },
      })
    }
  }

  let agentsCreated = 0
  let agentsUpdated = 0
  let modelPinned = 0

  for (const entry of TOPOLOGY) {
    const existing = await prisma.agent.findFirst({
      where: {
        OR: [
          { runtimeAgentId: entry.runtimeAgentId },
          { sessionKey: `agent:${entry.runtimeAgentId}:${entry.runtimeAgentId}` },
          { slug: entry.runtimeAgentId },
          { name: entry.runtimeAgentId },
          { displayName: entry.runtimeAgentId },
        ],
      },
    })

    const capabilities = baselineCapabilities(entry)

    if (!existing) {
      agentsCreated += 1
      if (!args.apply) continue

      await prisma.agent.create({
        data: {
          name: entry.displayName,
          displayName: entry.displayName,
          slug: entry.displayName.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, ''),
          runtimeAgentId: entry.runtimeAgentId,
          kind: entry.kind,
          dispatchEligible: true,
          nameSource: 'openclaw',
          role: entry.role,
          station: entry.station,
          teamId,
          templateId: entry.templateId,
          status: 'idle',
          sessionKey: `agent:${entry.runtimeAgentId}:${entry.runtimeAgentId}`,
          capabilities: JSON.stringify(capabilities),
          wipLimit: entry.templateId === 'build' ? 3 : 2,
          isStale: false,
          staleAt: null,
          ...(entry.enforceModel ? { model: entry.enforceModel } : {}),
        },
      })

      if (entry.enforceModel) modelPinned += 1
      continue
    }

    const mergedCapabilities = mergeCapabilities(existing.capabilities, capabilities)
    const patch = {}

    if (existing.runtimeAgentId !== entry.runtimeAgentId) patch.runtimeAgentId = entry.runtimeAgentId
    if (existing.station !== entry.station) patch.station = entry.station
    if (existing.teamId !== teamId) patch.teamId = teamId
    if (existing.templateId !== entry.templateId) patch.templateId = entry.templateId
    if (existing.kind !== entry.kind) patch.kind = entry.kind
    if (existing.isStale) patch.isStale = false
    if (existing.staleAt !== null) patch.staleAt = null
    if (entry.templateId === 'manager') {
      if (existing.role !== entry.role) patch.role = entry.role
    } else if (existing.role === 'agent') {
      patch.role = entry.role
    }
    if (stableStringify(safeParseObject(existing.capabilities || '{}')) !== stableStringify(mergedCapabilities)) {
      patch.capabilities = JSON.stringify(mergedCapabilities)
    }
    if (entry.enforceModel && existing.model !== entry.enforceModel) {
      patch.model = entry.enforceModel
      modelPinned += 1
    }

    if (Object.keys(patch).length === 0) continue
    agentsUpdated += 1
    if (args.apply) {
      await prisma.agent.update({
        where: { id: existing.id },
        data: patch,
      })
    }
  }

  console.log(JSON.stringify({
    mode,
    team: {
      id: teamId,
      created: teamCreated,
      updated: teamUpdated,
    },
    agents: {
      created: agentsCreated,
      updated: agentsUpdated,
      modelPinned,
    },
    stageCoverage: {
      required: REQUIRED_STAGE_COVERAGE,
      resolverHints: RESOLVER_HINTS,
      missingInResolver,
      missingInTopology,
      ok: missingInResolver.length === 0 && missingInTopology.length === 0,
    },
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(`[reconcile-openclaw-company-topology] failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
