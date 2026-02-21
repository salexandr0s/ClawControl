#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { PrismaClient } from '@prisma/client'
import { createSqliteAdapter } from '../lib/prisma-sqlite-adapter.js'

const prisma = new PrismaClient({
  adapter: createSqliteAdapter(process.env.DATABASE_URL),
})

const GOVERNANCE_ACTIVE_PROFILES_KEY = 'governance.activeProfiles'
const LEGACY_COMPANY_PROFILE_ID = 'clawcontrol-company-v1'

function usage() {
  console.log(`reconcile-ops-cron-governance

Usage:
  node scripts/reconcile-ops-cron-governance.mjs [--dry-run] [--apply]

Behavior:
  - Iterates governed teams and resolves each team's ops runtime agent.
  - Ensures one poller per team: ops-main-poller:<teamSlug> (sessionTarget=main).
  - Patches enabled ops jobs for that team's ops runtime agent only.
  - Enforces actionable ingest contract + no direct delivery for isolated sessions.
`)
}

function parseArgs(argv) {
  const out = { apply: false }
  for (const arg of argv) {
    if (arg === '--apply') out.apply = true
    if (arg === '--dry-run') out.apply = false
    if (arg === '--help' || arg === '-h') {
      usage()
      process.exit(0)
    }
  }
  return out
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function parseJsonArray(raw) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.map((item) => normalizeText(item)).filter(Boolean))]
  } catch {
    return []
  }
}

function parseGovernance(raw) {
  let parsed = {}
  try {
    parsed = JSON.parse(raw || '{}')
  } catch {
    parsed = {}
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) parsed = {}

  const ops = parsed.ops && typeof parsed.ops === 'object' && !Array.isArray(parsed.ops)
    ? parsed.ops
    : {}

  const pollerEnabled = ops.pollerEnabled === undefined ? true : ops.pollerEnabled === true

  return {
    orchestratorTemplateId: normalizeText(parsed.orchestratorTemplateId) || 'manager',
    agentIdentityMode: normalizeText(parsed.agentIdentityMode) || 'legacy_global',
    ops: {
      templateId: normalizeText(ops.templateId) || 'ops',
      relayMode: normalizeText(ops.relayMode) || 'decision_only',
      relayTargetSessionKey: normalizeText(ops.relayTargetSessionKey) || 'agent:main:main',
      pollerEnabled,
      pollIntervalCron: normalizeText(ops.pollIntervalCron) || '*/15 * * * *',
      timezone: normalizeText(ops.timezone) || 'Europe/Zurich',
    },
  }
}

function parseRuntimeIdFromSessionKey(sessionKey) {
  const normalized = normalizeText(sessionKey)
  if (!normalized.startsWith('agent:')) return null
  const runtimeId = normalized.split(':')[1]
  return normalizeText(runtimeId) || null
}

async function hasTableColumn(tableName, columnName) {
  const rows = await prisma.$queryRawUnsafe(`PRAGMA table_info("${tableName}")`)
  return Array.isArray(rows) && rows.some((row) => normalizeText(row?.name) === columnName)
}

function runOpenClaw(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('openclaw', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `openclaw ${args.join(' ')} exited with ${code}`))
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

async function cronList() {
  const { stdout } = await runOpenClaw(['cron', 'list', '--json'])
  const parsed = JSON.parse(stdout)
  const jobs = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.jobs) ? parsed.jobs : []
  return jobs
}

async function loadActiveProfiles() {
  const row = await prisma.setting.findUnique({
    where: { key: GOVERNANCE_ACTIVE_PROFILES_KEY },
    select: { value: true },
  })
  const configured = parseJsonArray(row?.value)
  if (configured.length > 0) return configured

  const team = await prisma.agentTeam.findFirst({
    where: { slug: 'clawcontrol-team' },
    select: { id: true },
  })
  if (!team) return []

  const rows = await prisma.agent.findMany({
    where: {
      OR: [
        { runtimeAgentId: { in: ['manager', 'wf-ops'] } },
        { sessionKey: { in: ['agent:manager:manager', 'agent:wf-ops:wf-ops'] } },
      ],
    },
    select: {
      runtimeAgentId: true,
      sessionKey: true,
    },
  })

  const seen = new Set()
  for (const item of rows) {
    const runtimeId = normalizeText(item.runtimeAgentId) || parseRuntimeIdFromSessionKey(item.sessionKey)
    if (!runtimeId) continue
    seen.add(runtimeId)
  }

  return seen.has('manager') && seen.has('wf-ops')
    ? [LEGACY_COMPANY_PROFILE_ID]
    : []
}

async function resolveGovernedTeams() {
  const activeProfiles = await loadActiveProfiles()
  const hasGovernanceColumn = await hasTableColumn('agent_teams', 'governance_json')
  const teams = await prisma.agentTeam.findMany({
    select: hasGovernanceColumn
      ? {
        id: true,
        slug: true,
        governanceJson: true,
      }
      : {
        id: true,
        slug: true,
      },
  })

  const teamIds = teams.map((team) => team.id)
  if (teamIds.length === 0) {
    return {
      activeProfiles,
      teams: [],
    }
  }

  const agents = await prisma.agent.findMany({
    where: {
      teamId: { in: teamIds },
    },
    select: {
      teamId: true,
      templateId: true,
      runtimeAgentId: true,
      sessionKey: true,
    },
  })

  const agentsByTeam = new Map()
  for (const agent of agents) {
    if (!agent.teamId) continue
    if (!agentsByTeam.has(agent.teamId)) agentsByTeam.set(agent.teamId, [])
    agentsByTeam.get(agent.teamId).push(agent)
  }

  const governed = []
  for (const team of teams) {
    const governance = parseGovernance(hasGovernanceColumn ? team.governanceJson : '{}')
    const opsTemplateId = governance.ops.templateId
    const teamAgents = agentsByTeam.get(team.id) || []

    const opsAgents = teamAgents
      .filter((agent) => normalizeText(agent.templateId) === opsTemplateId)
      .map((agent) => normalizeText(agent.runtimeAgentId) || parseRuntimeIdFromSessionKey(agent.sessionKey))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))

    const opsRuntimeAgentId = opsAgents[0] || null
    if (!opsRuntimeAgentId) continue

    governed.push({
      teamId: team.id,
      teamSlug: team.slug,
      activeProfiles,
      governance,
      opsRuntimeAgentId,
      relayKey: governance.ops.relayTargetSessionKey,
      pollerEnabled: governance.ops.pollerEnabled,
      pollIntervalCron: governance.ops.pollIntervalCron,
      timezone: governance.ops.timezone,
    })
  }

  return {
    activeProfiles,
    teams: governed,
  }
}

function toIsoFromMs(ms) {
  if (!Number.isFinite(ms)) return null
  return new Date(ms).toISOString()
}

function removeFooter(text) {
  if (typeof text !== 'string') return ''

  return text
    .replace(/\n*\[CC_OPS_REPORTING_V1\][\s\S]*?\[\/CC_OPS_REPORTING_V1\]\s*$/m, '')
    .replace(/\n*\[CC_OPS_REPORTING_V2\][\s\S]*?\[\/CC_OPS_REPORTING_V2\]\s*$/m, '')
    .trim()
}

function slugifyCronToken(value) {
  const normalized = normalizeText(value).toLowerCase()
  const slug = normalized
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'job'
}

function resolveLogicalOpsJobId(job, teamScope) {
  const teamToken = slugifyCronToken(teamScope.teamSlug || teamScope.teamId || 'team')
  const jobToken = slugifyCronToken(job.name || '')
  return `ops:${teamToken}:${jobToken}`
}

function footerForJob(job, teamScope) {
  const logicalJobId = resolveLogicalOpsJobId(job, teamScope).replaceAll('"', '\\"')
  const escapedJobName = (job.name || '').replaceAll('"', '\\"')

  return `

[CC_OPS_REPORTING_V2]
Keep existing business logic unchanged. Reporting contract:
1) If outcome is non-actionable noise/FYI, output exactly NO_ACTION.
2) If actionable (decision required, blocker/failure, or security-risk change), send exactly one ingestion POST:
   BASE_URL="\${CLAWCONTROL_INTERNAL_BASE_URL:-http://127.0.0.1:3000}"
   TOKEN="\${CLAWCONTROL_INTERNAL_TOKEN:-\${OPENCLAW_INTERNAL_TOKEN:-}}"
   if [ -z "$TOKEN" ]; then
     TOKEN="$(node -e 'const c=require("node:crypto");const s=process.env.CLAWCONTROL_OPERATOR_AUTH_SECRET||process.env.OPENCLAW_OPERATOR_AUTH_SECRET||"clawcontrol-local-operator-secret";process.stdout.write(c.createHmac("sha256",s).update("clawcontrol:internal").digest("base64url"));')"
   fi
   RUN_AT_MS=$(($(date +%s)*1000))
   curl -sS -X POST "$BASE_URL/api/internal/ops/actionable" \\
     -H "content-type: application/json" \\
     -H "x-clawcontrol-internal-token: $TOKEN" \\
     -d "{\\"source\\":\\"cron\\",\\"jobId\\":\\"${logicalJobId}\\",\\"jobName\\":\\"${escapedJobName}\\",\\"runAtMs\\":$RUN_AT_MS,\\"teamId\\":\\"${teamScope.teamId}\\",\\"opsRuntimeAgentId\\":\\"${teamScope.opsRuntimeAgentId}\\",\\"relayKey\\":\\"${teamScope.relayKey}\\",\\"severity\\":\\"medium\\",\\"decisionRequired\\":true,\\"summary\\":\\"<short actionable summary>\\",\\"recommendation\\":\\"<decision-ready recommendation>\\",\\"evidenceJson\\":{\\"pointer\\":\\"<path/url/log ref>\\"}}"
3) On successful POST, output exactly ACTIONABLE_RECORDED.
4) Do not send direct user-facing actionable messages from this job.
[/CC_OPS_REPORTING_V2]`.trim()
}

function withFooter(originalText, job, teamScope) {
  const base = removeFooter(originalText)
  const footer = footerForJob(job, teamScope)
  if (!base) return footer
  return `${base}\n\n${footer}`
}

function createArgsForJob(job, payloadText, agentId) {
  const args = ['cron', 'add', '--json']
  const push = (flag, value) => {
    if (value === undefined || value === null || value === '') return
    args.push(flag, String(value))
  }
  const pushBool = (flag, enabled) => {
    if (!enabled) return
    args.push(flag)
  }

  push('--name', job.name)
  push('--session', job.sessionTarget === 'main' ? 'main' : 'isolated')
  push('--wake', job.wakeMode === 'next-heartbeat' ? 'next-heartbeat' : 'now')
  push('--agent', agentId)
  push('--description', job.description)
  pushBool('--delete-after-run', Boolean(job.deleteAfterRun))

  const schedule = job.schedule || {}
  if (schedule.kind === 'cron') {
    push('--cron', schedule.expr)
    push('--tz', schedule.tz)
    push('--stagger', schedule.stagger)
    pushBool('--exact', Boolean(schedule.exact))
  } else if (schedule.kind === 'every') {
    push('--every', schedule.every || schedule.everyMs)
  } else if (schedule.kind === 'at') {
    push('--at', schedule.at || toIsoFromMs(schedule.atMs))
  }

  if (job.sessionTarget === 'main' || job.payload?.kind === 'systemEvent') {
    push('--system-event', payloadText)
  } else {
    push('--message', payloadText)
  }

  if (job.sessionTarget !== 'main') {
    pushBool('--no-deliver', true)
  }

  return args
}

function buildPollerPayload(teamScope) {
  return [
    `Ops main poller contract for team ${teamScope.teamSlug}:`,
    '1) Resolve BASE_URL=${CLAWCONTROL_INTERNAL_BASE_URL:-http://127.0.0.1:3000}.',
    '2) Resolve TOKEN from CLAWCONTROL_INTERNAL_TOKEN/OPENCLAW_INTERNAL_TOKEN, or derive fallback token via node:crypto hmac("clawcontrol:internal").',
    '3) POST /api/internal/ops/actionable/poll-relay with internal token + team scope.',
    `4) Team scope: teamId=${teamScope.teamId}, relayKey=${teamScope.relayKey}.`,
    '5) If count=0, output exactly NO_REPLY.',
    '6) If items exist, send decision-only digest to main with team tag + severity + summary + recommendation + workOrderId + evidence pointer.',
    '7) No FYI/noise output.',
  ].join('\n')
}

async function recreateJob({ job, payloadText, apply, agentId }) {
  const deleteArgs = ['cron', 'delete', '--json', job.id]
  const createArgs = createArgsForJob(job, payloadText, agentId)

  if (!apply) {
    return {
      deleted: deleteArgs.join(' '),
      created: createArgs.join(' '),
    }
  }

  await runOpenClaw(deleteArgs)
  await runOpenClaw(createArgs)
  return {
    deleted: 'ok',
    created: 'ok',
  }
}

async function ensurePoller({ existingJobs, apply, teamScope }) {
  const pollerName = `ops-main-poller:${teamScope.teamSlug}`
  const existing = existingJobs.filter((job) => (
    job.name === pollerName
    || job.name === 'ops-main-poller'
  ))
  const expectedPayload = buildPollerPayload(teamScope)

  const createArgs = [
    'cron',
    'add',
    '--json',
    '--name',
    pollerName,
    '--agent',
    teamScope.opsRuntimeAgentId,
    '--session',
    'main',
    '--wake',
    'next-heartbeat',
    '--cron',
    teamScope.pollIntervalCron,
    '--tz',
    teamScope.timezone,
    '--system-event',
    expectedPayload,
  ]

  const alreadyCanonical = existing.length === 1
    && existing[0]?.agentId === teamScope.opsRuntimeAgentId
    && existing[0]?.enabled === true
    && existing[0]?.sessionTarget === 'main'
    && (existing[0]?.wakeMode === 'next-heartbeat')
    && (existing[0]?.schedule?.kind === 'cron')
    && (existing[0]?.schedule?.expr === teamScope.pollIntervalCron)
    && ((existing[0]?.schedule?.tz || '') === teamScope.timezone)
    && ((existing[0]?.payload?.kind || '') === 'systemEvent')
    && ((existing[0]?.payload?.text || '').trim() === expectedPayload.trim())

  if (alreadyCanonical) {
    return {
      name: pollerName,
      removed: [],
      created: 'noop',
    }
  }

  if (!apply) {
    return {
      name: pollerName,
      removed: existing.map((job) => job.id),
      created: createArgs.join(' '),
    }
  }

  for (const job of existing) {
    await runOpenClaw(['cron', 'delete', '--json', job.id])
  }
  await runOpenClaw(createArgs)
  return {
    name: pollerName,
    removed: existing.map((job) => job.id),
    created: 'ok',
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const jobs = await cronList()
  const scoped = await resolveGovernedTeams()

  const scopesByAgentId = new Map(
    scoped.teams.map((scope) => [scope.opsRuntimeAgentId, scope])
  )

  const enabledScopedOpsJobs = jobs.filter((job) => {
    if (!job.enabled) return false
    if (String(job.name || '').startsWith('ops-main-poller')) return false
    return scopesByAgentId.has(job.agentId)
  })

  const patchedJobs = []

  for (const job of enabledScopedOpsJobs) {
    const teamScope = scopesByAgentId.get(job.agentId)
    if (!teamScope) continue

    const currentText =
      job.payload?.kind === 'systemEvent'
        ? (job.payload?.text || '')
        : (job.payload?.message || job.payload?.text || '')

    const payloadText = withFooter(currentText, job, teamScope)
    const needsFooter = payloadText.trim() !== String(currentText || '').trim()
    const needsDeliveryFix = job.sessionTarget !== 'main' && (job.delivery?.mode || 'none') !== 'none'
    const needsAgentFix = job.agentId !== teamScope.opsRuntimeAgentId

    if (!needsFooter && !needsDeliveryFix && !needsAgentFix) {
      continue
    }

    const result = await recreateJob({
      job,
      payloadText,
      apply: args.apply,
      agentId: teamScope.opsRuntimeAgentId,
    })

    patchedJobs.push({
      id: job.id,
      name: job.name,
      teamSlug: teamScope.teamSlug,
      opsRuntimeAgentId: teamScope.opsRuntimeAgentId,
      recreated: true,
      ...result,
    })
  }

  const pollers = []
  for (const teamScope of scoped.teams.filter((scope) => scope.pollerEnabled)) {
    const ensured = await ensurePoller({
      existingJobs: jobs,
      apply: args.apply,
      teamScope,
    })
    pollers.push(ensured)
  }

  const unrelatedEnabledJobs = jobs
    .filter((job) => job.enabled === true && !scopesByAgentId.has(job.agentId))
    .map((job) => ({ id: job.id, name: job.name, agentId: job.agentId }))

  console.log(JSON.stringify({
    mode: args.apply ? 'APPLY' : 'DRY-RUN',
    activeProfiles: scoped.activeProfiles,
    governedTeams: scoped.teams.map((scope) => ({
      teamId: scope.teamId,
      teamSlug: scope.teamSlug,
      opsRuntimeAgentId: scope.opsRuntimeAgentId,
      relayKey: scope.relayKey,
      pollerEnabled: scope.pollerEnabled,
      pollIntervalCron: scope.pollIntervalCron,
      timezone: scope.timezone,
    })),
    enabledOpsJobsPatched: patchedJobs.length,
    patchedJobs,
    pollers,
    unrelatedEnabledJobs,
  }, null, 2))
}

main().catch((error) => {
  console.error(`[reconcile-ops-cron-governance] failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}).finally(async () => {
  await prisma.$disconnect()
})
