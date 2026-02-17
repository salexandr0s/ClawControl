#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REPO_ROOT = path.resolve(__dirname, '..')
const APP_DIR = path.join(REPO_ROOT, 'apps', 'clawcontrol')

const WORKSPACE_ROOT = '/Users/savorgserver/OpenClaw'
const DESKTOP_DB_PATH = '/Users/savorgserver/Library/Application Support/clawcontrol-desktop/clawcontrol.db'
const RESET_SQL_PATH = path.join(REPO_ROOT, 'scripts', 'reset-workorders-desktop.sql')
const WORKFLOW_SOURCE_DIR = path.join(
  REPO_ROOT,
  'starter-packs',
  'clawcontrol-starter-pack',
  'input',
  'workflows'
)
const WORKFLOW_SOURCE_SELECTION = path.join(
  REPO_ROOT,
  'starter-packs',
  'clawcontrol-starter-pack',
  'input',
  'selection',
  'workflow-selection.yaml'
)
const WORKFLOW_DEST_DIR = path.join(WORKSPACE_ROOT, 'workflows')
const REPORT_DIR = path.join(WORKSPACE_ROOT, 'tmp')
const BACKUP_DIR = path.join(REPORT_DIR, 'db-backups')
const HARNESS_LOCK_PATH = path.join(REPORT_DIR, 'workflow-test-desktop.lock')
const NEXT_BIN_PATH = path.join(REPO_ROOT, 'node_modules', 'next', 'dist', 'bin', 'next')

const SERVER_ORIGIN = 'http://127.0.0.1:3000'
const INTERNAL_TOKEN = 'clawcontrol-e2e-internal'
const OPERATOR_AUTH_SECRET = 'clawcontrol-e2e-operator'
const DATABASE_URL = `file:${DESKTOP_DB_PATH}`
const DISPATCH_MODE = 'auto'
const LONG_OPERATION_TIMEOUT_MS = 420_000
const SCENARIO_TIMEOUT_MS = 3_000_000

const EXPECTED_WORKFLOW_IDS = [
  'cc_bug_fix',
  'cc_content_creation',
  'cc_greenfield_project',
  'cc_ops_change',
  'cc_security_audit',
]

const AGENT_SPECS = [
  {
    displayName: 'wf-research',
    role: 'spec',
    purpose: 'Research stage specialist for deterministic workflow validation.',
    capabilities: ['research', 'analysis', 'spec'],
  },
  {
    displayName: 'wf-plan',
    role: 'spec',
    purpose: 'Planning stage specialist for deterministic workflow validation.',
    capabilities: ['plan', 'architecture', 'design'],
  },
  {
    displayName: 'wf-plan-review',
    role: 'qa',
    purpose: 'Plan review specialist for deterministic workflow validation.',
    capabilities: ['review', 'qa', 'audit', 'plan_review'],
  },
  {
    displayName: 'wf-build',
    role: 'build',
    purpose: 'Build stage specialist for deterministic workflow validation.',
    capabilities: ['build', 'implementation', 'code', 'dev'],
  },
  {
    displayName: 'wf-build-review',
    role: 'qa',
    purpose: 'Build review specialist for deterministic workflow validation.',
    capabilities: ['review', 'qa', 'audit', 'build_review'],
  },
  {
    displayName: 'wf-ui',
    role: 'build',
    purpose: 'UI stage specialist for deterministic workflow validation.',
    capabilities: ['ui', 'frontend', 'ux'],
  },
  {
    displayName: 'wf-ui-review',
    role: 'qa',
    purpose: 'UI review specialist for deterministic workflow validation.',
    capabilities: ['review', 'qa', 'ui_review', 'a11y'],
  },
  {
    displayName: 'wf-ops',
    role: 'ops',
    purpose: 'Ops stage specialist for deterministic workflow validation.',
    capabilities: ['ops', 'infra', 'deploy', 'sre'],
  },
  {
    displayName: 'wf-security',
    role: 'qa',
    purpose: 'Security stage specialist for deterministic workflow validation.',
    capabilities: ['security', 'vulnerability', 'auth'],
  },
]

const SCENARIOS = [
  {
    workflowId: 'cc_bug_fix',
    context: { hasUnknowns: true, touchesSecurity: true },
    rejectMainStages: ['plan_review', 'build_review'],
    rejectVerifyOnce: true,
    requiresReworkEvidence: true,
  },
  {
    workflowId: 'cc_content_creation',
    context: { hasUnknowns: true, touchesSecurity: true },
    rejectMainStages: ['plan_review', 'content_review'],
    rejectVerifyOnce: true,
    requiresReworkEvidence: true,
  },
  {
    workflowId: 'cc_greenfield_project',
    context: {
      hasUnknowns: true,
      touchesSecurity: true,
      needsDeployment: true,
    },
    rejectMainStages: ['plan_review', 'build_review'],
    rejectVerifyOnce: true,
    requiresReworkEvidence: true,
  },
  {
    workflowId: 'cc_ops_change',
    context: {},
    rejectMainStages: ['security'],
    rejectVerifyOnce: true,
    requiresReworkEvidence: true,
  },
  {
    workflowId: 'cc_security_audit',
    context: { hasCodeChanges: true },
    rejectMainStages: [],
    rejectVerifyOnce: false,
    requiresReworkEvidence: false,
  },
]

const cookieJar = new Map()

function log(message) {
  console.log(`[workflow-test] ${message}`)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function runSyncOrThrow(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    encoding: 'utf8',
    ...options,
  })

  if (result.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(' ')} failed (${result.status ?? 'unknown'}): ${result.stderr || result.stdout}`
    )
  }

  return result
}

function sqlScalar(query) {
  const result = runSyncOrThrow('sqlite3', [DESKTOP_DB_PATH, query])
  return result.stdout.trim()
}

function sqlCount(query) {
  const value = Number(sqlScalar(query))
  if (Number.isFinite(value)) return value
  return 0
}

function sqlLines(query) {
  const result = runSyncOrThrow('sqlite3', [DESKTOP_DB_PATH, query])
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false

  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'EPERM') {
      return true
    }
    return false
  }
}

function getOpenClawDefaultModel() {
  const result = runSyncOrThrow('openclaw', ['models', 'status', '--json'])
  let parsed = null
  try {
    parsed = JSON.parse(result.stdout)
  } catch {
    parsed = null
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Failed to parse openclaw models status output')
  }

  const defaultModel = parsed.defaultModel
  return typeof defaultModel === 'string' ? defaultModel : null
}

function setOpenClawDefaultModel(model) {
  runSyncOrThrow('openclaw', ['models', 'set', model], {
    env: {
      ...process.env,
      OPENCLAW_DISABLE_MODEL_PROMPTS: '1',
    },
  })
}

function loadDispatchMetrics(workOrderId) {
  const escapedWorkOrderId = escapeSql(workOrderId)
  const baseWhere = `o.work_order_id='${escapedWorkOrderId}'`

  const dispatchCount = sqlCount(
    `SELECT COUNT(*) FROM activities a JOIN operations o ON a.entity_type='operation' AND a.entity_id=o.id WHERE ${baseWhere} AND a.type='workflow.dispatched'`
  )

  const dispatchWithSessionCount = sqlCount(
    `SELECT COUNT(*) FROM activities a JOIN operations o ON a.entity_type='operation' AND a.entity_id=o.id WHERE ${baseWhere} AND a.type='workflow.dispatched' AND COALESCE(json_extract(a.payload_json,'$.sessionId'),'') <> ''`
  )

  const dispatchFailedCount = sqlCount(
    `SELECT COUNT(*) FROM activities a JOIN operations o ON a.entity_type='operation' AND a.entity_id=o.id WHERE ${baseWhere} AND a.type='workflow.dispatch_failed'`
  )

  return {
    dispatchCount,
    dispatchWithSessionCount,
    dispatchFailedCount,
  }
}

function parseSetCookie(headerValue) {
  const firstSegment = headerValue.split(';', 1)[0] ?? ''
  const idx = firstSegment.indexOf('=')
  if (idx <= 0) return null
  const name = firstSegment.slice(0, idx).trim()
  const value = firstSegment.slice(idx + 1).trim()
  if (!name || !value) return null
  return { name, value }
}

function setCookiesFromResponse(response) {
  const values =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : []

  if (values.length === 0) {
    const single = response.headers.get('set-cookie')
    if (single) {
      const parsed = parseSetCookie(single)
      if (parsed) cookieJar.set(parsed.name, parsed.value)
    }
    return
  }

  for (const value of values) {
    const parsed = parseSetCookie(value)
    if (parsed) cookieJar.set(parsed.name, parsed.value)
  }
}

function getCookieHeader() {
  if (cookieJar.size === 0) return ''
  return Array.from(cookieJar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')
}

class HttpError extends Error {
  constructor(message, details) {
    super(message)
    this.name = 'HttpError'
    this.details = details
  }
}

function stringifyErrorDetail(value) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function describeRequestError(error) {
  if (error instanceof HttpError) {
    const details = error.details && typeof error.details === 'object' ? error.details : null
    const status = details && typeof details.status === 'number' ? details.status : null
    const body = details && 'body' in details ? stringifyErrorDetail(details.body) : ''
    const endpoint = details && typeof details.endpoint === 'string' ? details.endpoint : ''
    const parts = [
      error.message,
      status !== null ? `status=${status}` : '',
      endpoint ? `endpoint=${endpoint}` : '',
      body ? `body=${body}` : '',
    ].filter(Boolean)
    return parts.join(' | ')
  }

  const err = error instanceof Error ? error : new Error(String(error))
  const anyErr = err
  const cause = anyErr?.cause
  const causeCode =
    cause && typeof cause === 'object' && typeof cause.code === 'string'
      ? cause.code
      : ''
  const causeMessage =
    cause && typeof cause === 'object' && 'message' in cause
      ? stringifyErrorDetail(cause.message)
      : ''
  const directCode = typeof anyErr.code === 'string' ? anyErr.code : ''

  const segments = [
    err.message || '',
    directCode ? `code=${directCode}` : '',
    causeCode ? `cause_code=${causeCode}` : '',
    causeMessage ? `cause=${causeMessage}` : '',
  ].filter(Boolean)

  return segments.join(' | ') || String(error)
}

function isTransientNetworkError(error) {
  const message = describeRequestError(error).toLowerCase()
  return (
    message.includes('fetch failed')
    || message.includes('econnrefused')
    || message.includes('econnreset')
    || message.includes('etimedout')
    || message.includes('und_err_socket')
    || message.includes('socket hang up')
    || message.includes('other side closed')
    || message.includes('timed out')
  )
}

function isWorkOrderNotFoundError(error) {
  const message = describeRequestError(error).toLowerCase()
  return message.includes('http 404 for /api/work-orders/') && message.includes('work order not found')
}

async function requestJson(endpoint, options = {}) {
  const {
    method = 'GET',
    body,
    operator = false,
    internal = false,
    timeoutMs = 120_000,
  } = options

  const headers = {
    Accept: 'application/json',
  }

  const upperMethod = method.toUpperCase()

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  if (operator) {
    const cookieHeader = getCookieHeader()
    if (cookieHeader) {
      headers.Cookie = cookieHeader
    }

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(upperMethod)) {
      const csrf = cookieJar.get('cc_csrf')
      if (csrf) headers['x-clawcontrol-csrf'] = csrf
    }
  }

  if (internal) {
    headers['x-clawcontrol-internal-token'] = INTERNAL_TOKEN
  }

  const maxAttempts = upperMethod === 'GET' ? 5 : 1
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(`${SERVER_ORIGIN}${endpoint}`, {
        method: upperMethod,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      })

      setCookiesFromResponse(response)

      const text = await response.text()
      let parsed
      try {
        parsed = text ? JSON.parse(text) : null
      } catch {
        parsed = { raw: text }
      }

      if (!response.ok) {
        throw new HttpError(`HTTP ${response.status} for ${endpoint}`, {
          status: response.status,
          endpoint,
          body: parsed,
        })
      }

      return parsed
    } catch (error) {
      const message = describeRequestError(error).toLowerCase()
      const errorCode =
        error && typeof error === 'object' && typeof error.code === 'string'
          ? error.code.toUpperCase()
          : ''
      const causeCode =
        error
        && typeof error === 'object'
        && error.cause
        && typeof error.cause === 'object'
        && typeof error.cause.code === 'string'
          ? error.cause.code.toUpperCase()
          : ''
      const timeoutMsLowerBound = Math.max(1, timeoutMs)
      const retryableNetworkError =
        upperMethod === 'GET'
        && !(error instanceof HttpError)
        && (
          message.includes('fetch failed')
          || message.includes('The operation was aborted due to timeout')
          || message.includes('ECONNRESET')
          || message.includes('ECONNREFUSED')
          || message.includes('socket hang up')
          || message.includes('other side closed')
          || errorCode === 'ECONNRESET'
          || errorCode === 'ECONNREFUSED'
          || errorCode === 'ETIMEDOUT'
          || causeCode === 'ECONNRESET'
          || causeCode === 'ECONNREFUSED'
          || causeCode === 'ETIMEDOUT'
        )

      if (!retryableNetworkError || attempt >= maxAttempts) {
        const details = describeRequestError(error)
        throw new Error(
          `Request ${upperMethod} ${endpoint} failed (attempt ${attempt}/${maxAttempts}, timeoutMs=${timeoutMsLowerBound}): ${details}`
        )
      }

      await sleep(500 * attempt)
    }
  }
}

function stageRefByIndex(workflow) {
  const map = new Map()
  workflow.stages.forEach((stage, index) => {
    map.set(index, stage)
  })
  return map
}

function buildStories(workflowId, stageRef, batchNo) {
  return [1, 2].map((storyIdx) => ({
    storyKey: `${workflowId}_${stageRef}_${batchNo}_${storyIdx}`,
    title: `${stageRef} story ${storyIdx}`,
    description: `Deterministic validation story ${storyIdx} for ${workflowId}/${stageRef}.`,
    acceptanceCriteria: [
      'Behavior completes without manager guard violations.',
      'Workflow can transition to the next stage cleanly.',
    ],
  }))
}

function chooseCompletionPayload(input) {
  const {
    scenario,
    tracker,
    operation,
    stage,
  } = input

  const stageRef = stage?.ref ?? `stage_${operation.workflowStageIndex}`
  const isLoopOperation = operation.executionType === 'loop'
  const hasStoryContext = Boolean(operation.currentStoryId)
  const isVerifyOperation = !isLoopOperation && hasStoryContext

  if (isLoopOperation && !hasStoryContext) {
    tracker.storyBatch += 1
    return {
      status: 'completed',
      output: {
        stories: buildStories(scenario.workflowId, stageRef, tracker.storyBatch),
      },
      feedback: `Initialized deterministic story batch ${tracker.storyBatch} for ${stageRef}`,
      reason: 'loop_init',
    }
  }

  if (isLoopOperation && hasStoryContext) {
    return {
      status: 'completed',
      output: { storyResult: 'completed' },
      feedback: `Completed loop story for ${stageRef}`,
      reason: 'loop_story',
    }
  }

  if (isVerifyOperation) {
    if (scenario.rejectVerifyOnce && !tracker.verifyRejected) {
      tracker.verifyRejected = true
      return {
        status: 'rejected',
        output: { verifyResult: 'rejected_once' },
        feedback: `Intentional verify rejection for ${stageRef}`,
        reason: 'verify_reject_once',
      }
    }

    return {
      status: 'approved',
      output: { verifyResult: 'approved' },
      feedback: `Verification approved for ${stageRef}`,
      reason: 'verify_approve',
    }
  }

  if (scenario.rejectMainStages.includes(stageRef) && !tracker.rejectedMainStages.has(stageRef)) {
    tracker.rejectedMainStages.add(stageRef)
    return {
      status: 'rejected',
      output: { stageResult: 'rejected_once' },
      feedback: `Intentional main-stage rejection for ${stageRef}`,
      reason: 'main_reject_once',
    }
  }

  if (stageRef.includes('review') || stageRef === 'security' || stageRef === 'plan_review') {
    return {
      status: 'approved',
      output: { stageResult: 'approved' },
      feedback: `Approved stage ${stageRef}`,
      reason: 'review_approve',
    }
  }

  return {
    status: 'completed',
    output: { stageResult: 'completed' },
    feedback: `Completed stage ${stageRef}`,
    reason: 'default_complete',
  }
}

function capabilitySet(agent) {
  const caps = new Set()
  if (agent.capabilities && typeof agent.capabilities === 'object') {
    for (const [key, enabled] of Object.entries(agent.capabilities)) {
      if (enabled) caps.add(String(key).toLowerCase())
    }
  }
  return caps
}

function hasStrongCandidate(agents, stageRef) {
  for (const agent of agents) {
    const station = String(agent.station ?? '').toLowerCase()
    const role = String(agent.role ?? '').toLowerCase()
    const caps = capabilitySet(agent)

    if (stageRef === 'research') {
      if (station === 'spec' || caps.has('research') || caps.has('analysis') || caps.has('spec')) return true
    }

    if (stageRef === 'plan') {
      if (station === 'spec' || caps.has('plan') || caps.has('architecture') || caps.has('design')) return true
    }

    if (stageRef === 'plan_review') {
      if (station === 'qa' || station === 'spec' || caps.has('review') || caps.has('qa') || caps.has('audit')) {
        return true
      }
    }

    if (stageRef === 'build') {
      if (station === 'build' || caps.has('build') || caps.has('implementation') || caps.has('code')) return true
    }

    if (stageRef === 'build_review') {
      if (station === 'qa' || caps.has('review') || caps.has('qa') || caps.has('build_review')) return true
    }

    if (stageRef === 'ui') {
      if (station === 'build' || caps.has('ui') || caps.has('frontend') || caps.has('ux')) return true
    }

    if (stageRef === 'ui_review') {
      if (station === 'qa' || caps.has('review') || caps.has('qa') || caps.has('a11y') || caps.has('ui_review')) {
        return true
      }
    }

    if (stageRef === 'ops') {
      if (station === 'ops' || caps.has('ops') || caps.has('infra') || caps.has('deploy') || caps.has('sre')) {
        return true
      }
    }

    if (stageRef === 'security') {
      if (
        station === 'security'
        || caps.has('security')
        || caps.has('vulnerability')
        || caps.has('auth')
        || role.includes('security')
      ) {
        return true
      }
    }
  }

  return false
}

async function stopServerProcess(processRef) {
  if (!processRef) return

  const pid = Number(processRef.pid ?? 0)

  const killGroup = (signal) => {
    if (!Number.isInteger(pid) || pid <= 0) return false
    try {
      process.kill(-pid, signal)
      return true
    } catch {
      return false
    }
  }

  if (processRef.exitCode === null) {
    if (!killGroup('SIGTERM')) {
      try {
        processRef.kill('SIGTERM')
      } catch {
        // ignore
      }
    }
  }

  const waitUntil = Date.now() + 10_000
  while (Date.now() < waitUntil) {
    if (processRef.exitCode !== null && !isProcessAlive(pid)) return
    await sleep(250)
  }

  if (!killGroup('SIGKILL')) {
    try {
      processRef.kill('SIGKILL')
    } catch {
      // ignore
    }
  }

  const killWaitUntil = Date.now() + 2_000
  while (Date.now() < killWaitUntil) {
    if (!isProcessAlive(pid)) return
    await sleep(100)
  }
}

async function closeWritableStream(stream) {
  if (!stream) return
  if (stream.destroyed || stream.closed) return

  await new Promise((resolve) => {
    stream.end(() => resolve())
  })
}

async function waitForServerHealthy() {
  const timeoutAt = Date.now() + 120_000

  while (Date.now() < timeoutAt) {
    try {
      const response = await fetch(`${SERVER_ORIGIN}/api/system/init-status`, {
        method: 'GET',
        signal: AbortSignal.timeout(4_000),
      })

      if (!response.ok) {
        await sleep(750)
        continue
      }

      const payload = await response.json()
      const checks = payload?.data?.checks
      if (checks?.database?.state === 'ok' && checks?.workspace?.state === 'ok') {
        return payload
      }
    } catch {
      // server not ready yet
    }

    await sleep(750)
  }

  throw new Error('Timed out waiting for /api/system/init-status health check')
}

function findPort3000Pids() {
  const result = spawnSync('lsof', ['-nP', '-iTCP:3000', '-sTCP:LISTEN', '-t'], {
    encoding: 'utf8',
  })

  if (result.status !== 0) return []

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => Number.parseInt(line, 10))
    .filter((pid) => Number.isInteger(pid) && pid > 0)
}

function readProcessCommand(pid) {
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'command='], {
    encoding: 'utf8',
  })

  if (result.status !== 0) return ''
  return result.stdout.trim()
}

async function stopExistingClawcontrolOnPort3000() {
  const pids = findPort3000Pids()
  if (pids.length === 0) {
    log('No existing process is listening on port 3000')
    return
  }

  for (const pid of pids) {
    const command = readProcessCommand(pid)
    const normalized = command.toLowerCase()
    const looksLikeClawcontrol =
      normalized.includes('clawcontrol')
      || normalized.includes('local-only.mjs')
      || normalized.includes('next-server')
      || (normalized.includes('next') && normalized.includes('127.0.0.1'))

    if (!looksLikeClawcontrol) {
      throw new Error(`Port 3000 is occupied by non-clawcontrol process ${pid}: ${command}`)
    }

    log(`Stopping existing process on port 3000 (pid=${pid})`)
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      continue
    }
  }

  const timeoutAt = Date.now() + 8_000
  while (Date.now() < timeoutAt) {
    if (findPort3000Pids().length === 0) return
    await sleep(250)
  }

  for (const pid of findPort3000Pids()) {
    try {
      process.kill(pid, 'SIGKILL')
      log(`Force-killed lingering pid=${pid}`)
    } catch {
      // ignore
    }
  }
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function escapeSql(value) {
  return value.replace(/'/g, "''")
}

async function acquireRunLock(lockPath) {
  await fsp.mkdir(path.dirname(lockPath), { recursive: true })

  const payload = {
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
    cwd: process.cwd(),
  }

  const body = `${JSON.stringify(payload)}\n`

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await fsp.writeFile(lockPath, body, { flag: 'wx' })

      return async () => {
        try {
          const raw = await fsp.readFile(lockPath, 'utf8')
          const parsed = raw ? JSON.parse(raw) : null
          if (!parsed || Number(parsed.pid) === process.pid) {
            await fsp.unlink(lockPath)
          }
        } catch (error) {
          if (error && typeof error === 'object' && error.code === 'ENOENT') {
            return
          }
        }
      }
    } catch (error) {
      if (!error || typeof error !== 'object' || error.code !== 'EEXIST') {
        throw error
      }

      let existing = null
      try {
        const raw = await fsp.readFile(lockPath, 'utf8')
        existing = raw ? JSON.parse(raw) : null
      } catch {
        existing = null
      }

      const existingPid = Number(existing?.pid ?? 0)
      if (existingPid > 0 && isProcessAlive(existingPid)) {
        throw new Error(
          `Workflow harness lock is already held by pid=${existingPid} (${lockPath}).`
        )
      }

      try {
        await fsp.unlink(lockPath)
      } catch (unlinkError) {
        if (!unlinkError || typeof unlinkError !== 'object' || unlinkError.code !== 'ENOENT') {
          throw unlinkError
        }
      }
    }
  }

  throw new Error(`Failed to acquire workflow harness lock: ${lockPath}`)
}

function buildMarkdownReport(report) {
  const lines = []

  lines.push('# Workflow Validation Report')
  lines.push('')
  lines.push(`- Generated At: ${report.generatedAt}`)
  lines.push(`- Runtime DB: ${report.runtimeDbPath}`)
  lines.push(`- Workspace: ${report.workspaceRoot}`)
  lines.push(`- Backup: ${report.backupPath}`)
  lines.push(`- Server Log: ${report.serverLogPath}`)
  lines.push('')
  lines.push('## Acceptance Checks')
  lines.push('')

  for (const check of report.checks) {
    lines.push(`- ${check.pass ? '[PASS]' : '[FAIL]'} ${check.name}: ${check.details}`)
  }

  lines.push('')
  lines.push('## Workflow Runs')
  lines.push('')

  for (const run of report.workflowRuns) {
    lines.push(`### ${run.workflowId}`)
    lines.push(`- Result: ${run.passed ? 'PASS' : 'FAIL'}`)
    lines.push(`- Work Order: ${run.workOrderId ?? 'n/a'} (${run.workOrderCode ?? 'n/a'})`)
    lines.push(`- Final State: ${run.finalState ?? 'n/a'}`)
    lines.push(`- Pending Approvals: ${run.pendingApprovals}`)
    lines.push(`- Rework Evidence: ${run.reworkEvidence ? 'yes' : 'no'}`)
    lines.push(`- Completions Sent: ${run.completionCount}`)
    lines.push(`- Dispatch Count: ${run.dispatchCount ?? 0}`)
    lines.push(`- Dispatch With Session: ${run.dispatchWithSessionCount ?? 0}`)
    lines.push(`- Dispatch Failed: ${run.dispatchFailedCount ?? 0}`)

    if (run.error) {
      lines.push(`- Error: ${run.error}`)
    }

    if (Array.isArray(run.rejectionSummary) && run.rejectionSummary.length > 0) {
      lines.push(`- Rejections: ${run.rejectionSummary.join(', ')}`)
    }

    lines.push('')
  }

  return `${lines.join('\n')}\n`
}

async function ensureAgentExists(spec) {
  const listResponse = await requestJson('/api/agents?includeSessionOverlay=0&syncSessions=0&includeModelOverlay=0&cacheTtlMs=0')
  const agents = Array.isArray(listResponse?.data) ? listResponse.data : []

  const existing = agents.find((agent) => {
    const displayName = String(agent.displayName ?? agent.name ?? '').toLowerCase()
    const slug = String(agent.slug ?? '').toLowerCase()
    const target = spec.displayName.toLowerCase()
    return displayName === target || slug === target
  })

  if (existing) {
    return { created: false, agent: existing }
  }

  const payload = {
    role: spec.role,
    purpose: spec.purpose,
    capabilities: spec.capabilities,
    displayName: spec.displayName,
    typedConfirmText: 'CONFIRM',
  }

  await requestJson('/api/agents/create', {
    method: 'POST',
    body: payload,
    operator: true,
    timeoutMs: 45_000,
  })

  const refreshed = await requestJson('/api/agents?includeSessionOverlay=0&syncSessions=0&includeModelOverlay=0&cacheTtlMs=0')
  const refreshedAgents = Array.isArray(refreshed?.data) ? refreshed.data : []

  const createdAgent = refreshedAgents.find((agent) => {
    const displayName = String(agent.displayName ?? agent.name ?? '').toLowerCase()
    const slug = String(agent.slug ?? '').toLowerCase()
    const target = spec.displayName.toLowerCase()
    return displayName === target || slug === target
  })

  if (!createdAgent) {
    throw new Error(`Agent creation did not produce expected agent: ${spec.displayName}`)
  }

  return { created: true, agent: createdAgent }
}

async function runScenario(scenario, workflowDefinition, runtime = {}) {
  const workflowId = scenario.workflowId
  const stageMap = stageRefByIndex(workflowDefinition)
  const scenarioToken = randomUUID().slice(0, 8)
  const workOrderTitle = `[E2E:${scenarioToken}] ${workflowId} real-workorder validation`
  const workOrderTags = ['e2e', 'workflow-test', workflowId, `scenario:${scenarioToken}`]
  const recoverServer =
    typeof runtime.recoverServer === 'function'
      ? runtime.recoverServer
      : async (_workflowId, _stepLabel, _options = {}) => {
          await waitForServerHealthy()
          try {
            await bootstrapOperatorSession()
          } catch {
            // best-effort only
          }
          }

  async function waitForStartMaterialization(workOrderId, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs
    let lastState = ''
    let lastOperationCount = 0

    while (Date.now() < deadline) {
      lastState = sqlScalar(`SELECT state FROM work_orders WHERE id='${escapeSql(workOrderId)}'`)
      lastOperationCount = sqlCount(
        `SELECT COUNT(*) FROM operations WHERE work_order_id='${escapeSql(workOrderId)}'`
      )

      if ((lastState === 'active' || lastState === 'blocked') && lastOperationCount > 0) {
        return { started: true, state: lastState, operationCount: lastOperationCount }
      }

      await sleep(500)
    }

    return { started: false, state: lastState, operationCount: lastOperationCount }
  }

  function workOrderExistsInDesktopDb(workOrderId) {
    return sqlCount(`SELECT COUNT(*) FROM work_orders WHERE id='${escapeSql(workOrderId)}'`) > 0
  }

  let workOrder = null
  let step = 'create_workorder'

  try {
    let createResponse = null
    try {
      createResponse = await requestJson('/api/work-orders', {
        method: 'POST',
        operator: true,
        body: {
          title: workOrderTitle,
          goalMd: `Execute deterministic real-workorder validation for ${workflowId}.`,
          priority: 'P1',
          tags: workOrderTags,
          workflowId,
        },
      })
    } catch (error) {
      if (!isTransientNetworkError(error)) {
        throw error
      }

      await recoverServer(workflowId, 'create_workorder')

      const recoveredId = sqlScalar(
        `SELECT id FROM work_orders WHERE title='${escapeSql(workOrderTitle)}' ORDER BY created_at DESC LIMIT 1`
      )

      if (recoveredId) {
        workOrder = { id: recoveredId }
      } else {
        createResponse = await requestJson('/api/work-orders', {
          method: 'POST',
          operator: true,
          body: {
            title: workOrderTitle,
            goalMd: `Execute deterministic real-workorder validation for ${workflowId}.`,
            priority: 'P1',
            tags: workOrderTags,
            workflowId,
          },
        })
      }
    }

    if (!workOrder) {
      workOrder = createResponse?.data ?? null
    }
    if (!workOrder?.id) {
      throw new Error(`Failed to create work order for ${workflowId}`)
    }

    if (!workOrderExistsInDesktopDb(workOrder.id)) {
      await recoverServer(workflowId, 'create_workorder_visibility')

      const recoveredId = sqlScalar(
        `SELECT id FROM work_orders WHERE title='${escapeSql(workOrderTitle)}' ORDER BY created_at DESC LIMIT 1`
      )
      if (recoveredId && workOrderExistsInDesktopDb(recoveredId)) {
        workOrder = { id: recoveredId }
      } else {
        const retryCreate = await requestJson('/api/work-orders', {
          method: 'POST',
          operator: true,
          body: {
            title: workOrderTitle,
            goalMd: `Execute deterministic real-workorder validation for ${workflowId}.`,
            priority: 'P1',
            tags: workOrderTags,
            workflowId,
          },
        })
        const retryWorkOrder = retryCreate?.data
        if (retryWorkOrder?.id) {
          workOrder = retryWorkOrder
        }
      }
    }

    if (!workOrder?.id || !workOrderExistsInDesktopDb(workOrder.id)) {
      throw new Error(
        `Created work order is not visible in desktop DB: ${workOrder?.id ?? 'unknown'}`
      )
    }

    step = 'start_workorder'
    let startSucceeded = false
    try {
      const startResponse = await requestJson(`/api/work-orders/${encodeURIComponent(workOrder.id)}/start`, {
        method: 'POST',
        operator: true,
        timeoutMs: LONG_OPERATION_TIMEOUT_MS,
        body: {
          context: scenario.context,
          workflowId,
        },
      })
      startSucceeded = Boolean(startResponse?.success)
    } catch (error) {
      if (!isTransientNetworkError(error)) {
        throw error
      }

      await recoverServer(workflowId, 'start_workorder')

      const materialized = await waitForStartMaterialization(workOrder.id)

      if (materialized.started) {
        startSucceeded = true
      } else {
        const retryStart = await requestJson(`/api/work-orders/${encodeURIComponent(workOrder.id)}/start`, {
          method: 'POST',
          operator: true,
          timeoutMs: LONG_OPERATION_TIMEOUT_MS,
          body: {
            context: scenario.context,
            workflowId,
          },
        })
        startSucceeded = Boolean(retryStart?.success)
      }
    }

    if (!startSucceeded) {
      throw new Error(`Failed to start work order ${workOrder.id} for ${workflowId}`)
    }

    const tracker = {
      verifyRejected: false,
      rejectedMainStages: new Set(),
      storyBatch: 0,
      completionCount: 0,
      rejectionSummary: [],
    }

    const timeoutAt = Date.now() + SCENARIO_TIMEOUT_MS
    while (Date.now() < timeoutAt) {
      step = 'poll_workorder'
      let workOrderResponse
      try {
        workOrderResponse = await requestJson(`/api/work-orders/${encodeURIComponent(workOrder.id)}`)
      } catch (error) {
        if (isWorkOrderNotFoundError(error) && workOrderExistsInDesktopDb(workOrder.id)) {
          await recoverServer(workflowId, 'poll_workorder_not_found', { forceRestart: true })
          await sleep(600)
          continue
        }
        if (!isTransientNetworkError(error)) throw error
        await recoverServer(workflowId, 'poll_workorder')
        await sleep(500)
        continue
      }
      const currentWorkOrder = workOrderResponse?.data

      if (currentWorkOrder?.state === 'shipped') {
        step = 'collect_final_operations'
        let finalOperationsResponse
        try {
          finalOperationsResponse = await requestJson(
            `/api/operations?workOrderId=${encodeURIComponent(workOrder.id)}&limit=500`
          )
        } catch (error) {
          if (!isTransientNetworkError(error)) throw error
          await recoverServer(workflowId, 'collect_final_operations')
          finalOperationsResponse = await requestJson(
            `/api/operations?workOrderId=${encodeURIComponent(workOrder.id)}&limit=500`
          )
        }
        const finalOperations = Array.isArray(finalOperationsResponse?.data) ? finalOperationsResponse.data : []

        const pendingApprovals = Number(
          sqlScalar(
            `SELECT COUNT(*) FROM approvals WHERE work_order_id='${escapeSql(workOrder.id)}' AND status='pending'`
          )
        )

        const reworkEvidence = finalOperations.some((op) => {
          const iterationCount = Number(op.iterationCount ?? 0)
          return op.status === 'rework' || iterationCount > 0
        })

        const dispatchMetrics = loadDispatchMetrics(workOrder.id)
        const dispatchStrictPass =
          dispatchMetrics.dispatchCount > 0
          && dispatchMetrics.dispatchFailedCount === 0
          && dispatchMetrics.dispatchWithSessionCount === dispatchMetrics.dispatchCount

        return {
          workflowId,
          passed: dispatchStrictPass && pendingApprovals === 0,
          workOrderId: workOrder.id,
          workOrderCode: currentWorkOrder.code,
          finalState: currentWorkOrder.state,
          pendingApprovals,
          reworkEvidence,
          completionCount: tracker.completionCount,
          dispatchCount: dispatchMetrics.dispatchCount,
          dispatchWithSessionCount: dispatchMetrics.dispatchWithSessionCount,
          dispatchFailedCount: dispatchMetrics.dispatchFailedCount,
          dispatchStrictPass,
          rejectionSummary: tracker.rejectionSummary,
          operations: finalOperations,
        }
      }

      if (currentWorkOrder?.state === 'blocked' || currentWorkOrder?.state === 'cancelled') {
        throw new Error(`Work order ${workOrder.id} entered terminal failure state: ${currentWorkOrder.state}`)
      }

      step = 'poll_operations'
      let operationsResponse
      try {
        operationsResponse = await requestJson(
          `/api/operations?workOrderId=${encodeURIComponent(workOrder.id)}&limit=500`
        )
      } catch (error) {
        if (!isTransientNetworkError(error)) throw error
        await recoverServer(workflowId, 'poll_operations')
        await sleep(400)
        continue
      }
      const operations = Array.isArray(operationsResponse?.data) ? operationsResponse.data : []

      const inProgress = operations
        .filter((operation) => operation.status === 'in_progress')
        .sort((left, right) => {
          const leftTs = Date.parse(left.updatedAt ?? left.createdAt ?? '') || 0
          const rightTs = Date.parse(right.updatedAt ?? right.createdAt ?? '') || 0
          return rightTs - leftTs
        })

      if (inProgress.length === 0) {
        await sleep(500)
        continue
      }

      const operation = inProgress[0]
      const stage = stageMap.get(Number(operation.workflowStageIndex))

      const completion = chooseCompletionPayload({
        scenario,
        tracker,
        operation,
        stage,
      })

      if (completion.status === 'rejected') {
        const stageRef = stage?.ref ?? `stage_${operation.workflowStageIndex}`
        tracker.rejectionSummary.push(`${stageRef}:${completion.reason}`)
      }

      step = 'send_completion'
      const completionToken = `${workflowId}:${operation.id}:${tracker.completionCount}:${randomUUID()}`
      const completionBody = {
        operationId: operation.id,
        status: completion.status,
        output: completion.output,
        feedback: completion.feedback,
        completionToken,
      }

      try {
        await requestJson('/api/agents/completion', {
          method: 'POST',
          internal: true,
          timeoutMs: LONG_OPERATION_TIMEOUT_MS,
          body: completionBody,
        })
      } catch (error) {
        if (!isTransientNetworkError(error)) throw error

        await recoverServer(workflowId, 'send_completion')
        const operationStatus = sqlScalar(`SELECT status FROM operations WHERE id='${escapeSql(operation.id)}'`)
        if (operationStatus === 'in_progress') {
          await requestJson('/api/agents/completion', {
            method: 'POST',
            internal: true,
            timeoutMs: LONG_OPERATION_TIMEOUT_MS,
            body: completionBody,
          })
        }
      }

      tracker.completionCount += 1

      await sleep(300)
    }

    throw new Error(`Scenario timeout for ${workflowId} (${workOrder.id})`)
  } catch (error) {
    const detail = describeRequestError(error)
    const workOrderText = workOrder?.id ? ` workOrder=${workOrder.id}` : ''
    throw new Error(`Scenario ${workflowId} failed at ${step}.${workOrderText} ${detail}`)
  }
}

async function bootstrapOperatorSession() {
  const response = await fetch(`${SERVER_ORIGIN}/api/auth/bootstrap`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(10_000),
  })

  setCookiesFromResponse(response)

  if (!response.ok) {
    throw new Error(`Failed bootstrap auth session: HTTP ${response.status}`)
  }

  const payload = await response.json()
  if (payload?.csrfToken && !cookieJar.has('cc_csrf')) {
    cookieJar.set('cc_csrf', payload.csrfToken)
  }

  assert(cookieJar.has('cc_operator_session'), 'Missing cc_operator_session after bootstrap')
  assert(cookieJar.has('cc_csrf'), 'Missing cc_csrf after bootstrap')
}

async function loadExpectedWorkflowDefinition(workflowId) {
  const sourcePath = path.join(WORKFLOW_SOURCE_DIR, `${workflowId}.yaml`)
  const raw = await fsp.readFile(sourcePath, 'utf8')
  const parsed = yaml.load(raw)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Invalid YAML workflow definition: ${sourcePath}`)
  }
  return parsed
}

async function main() {
  const stamp = nowStamp()
  const backupPath = path.join(BACKUP_DIR, `clawcontrol-desktop-${stamp}.db`)
  const serverLogPath = path.join(REPORT_DIR, `workflow-test-server-${stamp}.log`)
  const reportJsonPath = path.join(REPORT_DIR, `workflow-test-report-${stamp}.json`)
  const reportMdPath = path.join(REPORT_DIR, `workflow-test-report-${stamp}.md`)

  let serverProcess = null
  let serverLogStream = null
  let serverExit = null
  let stoppingServer = false
  let originalOpenClawDefaultModel = null
  let openClawModelOverridden = false
  let releaseRunLock = async () => {}

  const report = {
    generatedAt: new Date().toISOString(),
    runtimeDbPath: DESKTOP_DB_PATH,
    workspaceRoot: WORKSPACE_ROOT,
    backupPath,
    serverLogPath,
    checks: [],
    workflowRuns: [],
  }

  const selectedScenarioIds = String(process.env.WORKFLOW_TEST_SCENARIOS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const scenariosToRun =
    selectedScenarioIds.length > 0
      ? SCENARIOS.filter((scenario) => selectedScenarioIds.includes(scenario.workflowId))
      : SCENARIOS
  assert(
    scenariosToRun.length > 0,
    `No matching scenarios for WORKFLOW_TEST_SCENARIOS=${selectedScenarioIds.join(',')}`
  )

  const runtimeEnv = {
    ...process.env,
    DATABASE_URL,
    OPENCLAW_WORKSPACE: WORKSPACE_ROOT,
    CLAWCONTROL_WORKSPACE_ROOT: WORKSPACE_ROOT,
    CLAWCONTROL_INTERNAL_TOKEN: INTERNAL_TOKEN,
    CLAWCONTROL_OPERATOR_AUTH_SECRET: OPERATOR_AUTH_SECRET,
    CLAWCONTROL_OPENCLAW_DISPATCH_MODE: DISPATCH_MODE,
  }

  const serverArgs = [
    'scripts/local-only.mjs',
    'node',
    NEXT_BIN_PATH,
    'dev',
    '--webpack',
    '--hostname',
    '127.0.0.1',
    '--port',
    '3000',
  ]

  function spawnRuntimeServerProcess() {
    serverExit = null

    const proc = spawn('node', serverArgs, {
      cwd: APP_DIR,
      env: runtimeEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    })

    proc.on('exit', (code, signal) => {
      serverExit = {
        code,
        signal,
        at: new Date().toISOString(),
      }
      if (!stoppingServer) {
        log(`Server process exited unexpectedly: code=${String(code)} signal=${String(signal)}`)
      }
    })

    proc.stdout.on('data', (chunk) => {
      if (serverLogStream && !serverLogStream.destroyed) {
        serverLogStream.write(chunk)
      }
    })
    proc.stderr.on('data', (chunk) => {
      if (serverLogStream && !serverLogStream.destroyed) {
        serverLogStream.write(chunk)
      }
    })

    return proc
  }

  async function restartRuntimeServer(reason) {
    log(`(Re)starting runtime server: ${reason}`)

    if (serverProcess && serverProcess.exitCode === null) {
      await stopServerProcess(serverProcess)
    }

    await stopExistingClawcontrolOnPort3000()
    serverProcess = spawnRuntimeServerProcess()
  }

  async function recoverServer(workflowId, stepLabel, options = {}) {
    const forceRestart = Boolean(options.forceRestart)
    const maxAttempts = 3
    let lastError = null

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const shouldRestart =
        forceRestart
        || !serverProcess
        || serverProcess.exitCode !== null
        || attempt > 1

      if (shouldRestart) {
        const suffix = attempt > 1 ? ` attempt=${attempt}/${maxAttempts}` : ''
        const reasonBase = forceRestart ? `${workflowId}/${stepLabel} (forced)` : `${workflowId}/${stepLabel}`
        await restartRuntimeServer(`${reasonBase}${suffix}`)
      }

      try {
        const health = await waitForServerHealthy()

        try {
          await bootstrapOperatorSession()
        } catch {
          // best-effort only during recovery
        }

        log(
          forceRestart
            ? `Recovered server health during ${workflowId}/${stepLabel} with forced restart`
            : `Recovered server health during ${workflowId}/${stepLabel}`
        )
        return health
      } catch (error) {
        lastError = error
        const message = error instanceof Error ? error.message : String(error)
        log(`Recovery attempt ${attempt}/${maxAttempts} failed for ${workflowId}/${stepLabel}: ${message}`)

        await stopServerProcess(serverProcess)
        serverProcess = null

        try {
          await stopExistingClawcontrolOnPort3000()
        } catch {
          // continue retry path
        }

        if (attempt < maxAttempts) {
          await sleep(1_000 * attempt)
        }
      }
    }

    throw lastError ?? new Error(`Server recovery failed for ${workflowId}/${stepLabel}`)
  }

  try {
    log('Phase 1: Preflight + safety checks')

    releaseRunLock = await acquireRunLock(HARNESS_LOCK_PATH)
    report.checks.push({
      name: 'exclusive_run_lock',
      pass: true,
      details: HARNESS_LOCK_PATH,
    })

    assert(fs.existsSync(DESKTOP_DB_PATH), `Desktop DB not found: ${DESKTOP_DB_PATH}`)
    assert(fs.existsSync(WORKSPACE_ROOT), `Workspace root not found: ${WORKSPACE_ROOT}`)
    assert(fs.existsSync(WORKFLOW_SOURCE_DIR), `Workflow source directory missing: ${WORKFLOW_SOURCE_DIR}`)
    assert(fs.existsSync(NEXT_BIN_PATH), `Next binary not found: ${NEXT_BIN_PATH}`)

    for (const workflowId of EXPECTED_WORKFLOW_IDS) {
      const workflowPath = path.join(WORKFLOW_SOURCE_DIR, `${workflowId}.yaml`)
      assert(fs.existsSync(workflowPath), `Missing starter workflow file: ${workflowPath}`)
    }
    assert(fs.existsSync(WORKFLOW_SOURCE_SELECTION), `Missing workflow selection file: ${WORKFLOW_SOURCE_SELECTION}`)

    const desiredOpenClawModel = 'openai/gpt-5.2'
    originalOpenClawDefaultModel = getOpenClawDefaultModel()
    if (originalOpenClawDefaultModel !== desiredOpenClawModel) {
      setOpenClawDefaultModel(desiredOpenClawModel)
      openClawModelOverridden = true
      log(
        `OpenClaw default model set to ${desiredOpenClawModel} (was ${originalOpenClawDefaultModel ?? 'unknown'})`
      )
    } else {
      log(`OpenClaw default model already ${desiredOpenClawModel}`)
    }
    report.checks.push({
      name: 'openclaw_default_model_ready',
      pass: true,
      details: `model=${desiredOpenClawModel}`,
    })

    await stopExistingClawcontrolOnPort3000()

    await fsp.mkdir(BACKUP_DIR, { recursive: true })
    await fsp.copyFile(DESKTOP_DB_PATH, backupPath)
    log(`Backed up DB to ${backupPath}`)

    log('Phase 2: Workorder-only DB reset')
    const resetSql = await fsp.readFile(RESET_SQL_PATH, 'utf8')
    runSyncOrThrow('sqlite3', [DESKTOP_DB_PATH], { input: resetSql })

    const resetAssertions = {
      nonReservedWorkOrders: Number(sqlScalar("SELECT COUNT(*) FROM work_orders WHERE id NOT IN ('system','console')")) === 0,
      reservedWorkOrders: Number(sqlScalar("SELECT COUNT(*) FROM work_orders WHERE id IN ('system','console')")) === 2,
      operations: Number(sqlScalar('SELECT COUNT(*) FROM operations')) === 0,
      operationStories: Number(sqlScalar('SELECT COUNT(*) FROM operation_stories')) === 0,
      approvals: Number(sqlScalar('SELECT COUNT(*) FROM approvals')) === 0,
      completionTokens: Number(sqlScalar('SELECT COUNT(*) FROM operation_completion_tokens')) === 0,
    }

    for (const [key, pass] of Object.entries(resetAssertions)) {
      report.checks.push({
        name: `db_reset_${key}`,
        pass,
        details: pass ? 'ok' : 'failed',
      })
    }

    assert(Object.values(resetAssertions).every(Boolean), 'DB reset assertions failed')

    log('Phase 3: Seed starter workflow files')
    await fsp.mkdir(WORKFLOW_DEST_DIR, { recursive: true })

    for (const workflowId of EXPECTED_WORKFLOW_IDS) {
      const source = path.join(WORKFLOW_SOURCE_DIR, `${workflowId}.yaml`)
      const dest = path.join(WORKFLOW_DEST_DIR, `${workflowId}.yaml`)
      await fsp.copyFile(source, dest)
    }

    await fsp.copyFile(
      WORKFLOW_SOURCE_SELECTION,
      path.join(WORKFLOW_DEST_DIR, 'workflow-selection.yaml')
    )

    const seededWorkflowFiles = (await fsp.readdir(WORKFLOW_DEST_DIR))
      .filter((name) => /^cc_.*\.ya?ml$/i.test(name))
      .sort((left, right) => left.localeCompare(right))

    const seededIds = seededWorkflowFiles.map((name) => name.replace(/\.ya?ml$/i, ''))
    const seededOk =
      seededIds.length === EXPECTED_WORKFLOW_IDS.length
      && EXPECTED_WORKFLOW_IDS.every((id) => seededIds.includes(id))

    report.checks.push({
      name: 'workflow_seed_files',
      pass: seededOk,
      details: seededWorkflowFiles.join(', '),
    })
    assert(seededOk, `Seeded workflow files mismatch: ${seededWorkflowFiles.join(', ')}`)

    log('Phase 4: Start test runtime')
    await fsp.mkdir(REPORT_DIR, { recursive: true })
    serverLogStream = fs.createWriteStream(serverLogPath, { flags: 'w' })

    await restartRuntimeServer('initial startup')

    const health = await recoverServer('startup', 'initial_health')
    const dbHealthy = health?.data?.checks?.database?.state === 'ok'
    const workspaceHealthy = health?.data?.checks?.workspace?.state === 'ok'

    report.checks.push({
      name: 'runtime_health',
      pass: dbHealthy && workspaceHealthy,
      details: `database=${health?.data?.checks?.database?.state}, workspace=${health?.data?.checks?.workspace?.state}`,
    })
    assert(dbHealthy && workspaceHealthy, 'Runtime health check failed')

    log('Phase 5: Bootstrap operator session + ensure stage-capable agents')
    await bootstrapOperatorSession()

    const agentResults = []
    for (const spec of AGENT_SPECS) {
      const result = await ensureAgentExists(spec)
      agentResults.push(result)
      log(`${result.created ? 'Created' : 'Reused'} agent ${spec.displayName}`)
    }

    const agentsResponse = await requestJson('/api/agents?includeSessionOverlay=0&syncSessions=0&includeModelOverlay=0&cacheTtlMs=0')
    const agents = Array.isArray(agentsResponse?.data) ? agentsResponse.data : []

    const stageRefs = new Set()
    for (const workflowId of EXPECTED_WORKFLOW_IDS) {
      const definition = await loadExpectedWorkflowDefinition(workflowId)
      for (const stage of definition.stages ?? []) {
        if (stage?.agent) stageRefs.add(String(stage.agent))
      }
    }

    const stageCoverage = {}
    let stageCoveragePass = true
    for (const stageRef of stageRefs) {
      const pass = hasStrongCandidate(agents, stageRef)
      stageCoverage[stageRef] = pass
      if (!pass) stageCoveragePass = false
    }

    report.checks.push({
      name: 'stage_candidate_coverage',
      pass: stageCoveragePass,
      details: JSON.stringify(stageCoverage),
    })
    assert(stageCoveragePass, `Missing strong stage candidate: ${JSON.stringify(stageCoverage)}`)

    log('Phase 6: Validate workflow registry and execute real workorders')

    const workflowsResponse = await requestJson('/api/workflows')
    const workflowRows = Array.isArray(workflowsResponse?.data) ? workflowsResponse.data : []
    const workflowIds = workflowRows.map((row) => String(row.id)).sort((a, b) => a.localeCompare(b))
    const expectedSorted = [...EXPECTED_WORKFLOW_IDS].sort((a, b) => a.localeCompare(b))

    const workflowsExact =
      workflowIds.length === expectedSorted.length
      && expectedSorted.every((id, index) => id === workflowIds[index])

    report.checks.push({
      name: 'workflow_registry_exact',
      pass: workflowsExact,
      details: workflowIds.join(', '),
    })
    assert(workflowsExact, `Workflow registry mismatch: ${workflowIds.join(', ')}`)

    const workflowDefinitions = new Map()
    for (const workflowId of EXPECTED_WORKFLOW_IDS) {
      const response = await requestJson(`/api/workflows/${encodeURIComponent(workflowId)}`)
      workflowDefinitions.set(workflowId, response?.data?.workflow)
    }

    for (const scenario of scenariosToRun) {
      const definition = workflowDefinitions.get(scenario.workflowId)
      if (!definition || !Array.isArray(definition.stages)) {
        throw new Error(`Missing workflow definition for scenario ${scenario.workflowId}`)
      }

      await recoverServer(scenario.workflowId, 'scenario_preflight')
      log(`Running scenario ${scenario.workflowId}`)
      try {
        const runResult = await runScenario(scenario, definition, { recoverServer })
        report.workflowRuns.push(runResult)
      } catch (error) {
        const baseMessage = error instanceof Error ? error.message : String(error)
        const exitSuffix = serverExit
          ? ` | server_exit_code=${String(serverExit.code)} server_exit_signal=${String(serverExit.signal)} at=${serverExit.at}`
          : ''
        const message = `${baseMessage}${exitSuffix}`
        const failedRun = {
          workflowId: scenario.workflowId,
          passed: false,
          workOrderId: null,
          workOrderCode: null,
          finalState: null,
          pendingApprovals: -1,
          reworkEvidence: false,
          completionCount: 0,
          dispatchCount: 0,
          dispatchWithSessionCount: 0,
          dispatchFailedCount: 0,
          dispatchStrictPass: false,
          rejectionSummary: [],
          error: message,
          diagnostics: {
            recentActivities: sqlLines(
              "SELECT ts || ' | ' || type || ' | ' || entity_type || ':' || entity_id || ' | ' || summary FROM activities ORDER BY ts DESC LIMIT 30"
            ),
          },
        }
        report.workflowRuns.push(failedRun)
      }
    }

    const dispatchFailuresZero = report.workflowRuns.every(
      (run) => Number(run.dispatchFailedCount) === 0
    )
    report.checks.push({
      name: 'dispatch_failures_zero',
      pass: dispatchFailuresZero,
      details: report.workflowRuns
        .map((run) => `${run.workflowId}:${run.dispatchFailedCount ?? 0}`)
        .join(', '),
    })

    const dispatchSessionsPresent = report.workflowRuns.every(
      (run) =>
        Number(run.dispatchCount) > 0
        && Number(run.dispatchWithSessionCount) === Number(run.dispatchCount)
    )
    report.checks.push({
      name: 'dispatch_sessions_non_null',
      pass: dispatchSessionsPresent,
      details: report.workflowRuns
        .map((run) => `${run.workflowId}:${run.dispatchWithSessionCount ?? 0}/${run.dispatchCount ?? 0}`)
        .join(', '),
    })

    const strictDispatchPerRun = report.workflowRuns.every((run) => Boolean(run.dispatchStrictPass))
    report.checks.push({
      name: 'dispatch_strict_per_workflow',
      pass: strictDispatchPerRun,
      details: report.workflowRuns
        .map((run) => `${run.workflowId}:${run.dispatchStrictPass ? 'yes' : 'no'}`)
        .join(', '),
    })

    const allShipped = report.workflowRuns.every((run) => run.finalState === 'shipped')
    report.checks.push({
      name: 'all_workflows_shipped',
      pass: allShipped,
      details: report.workflowRuns.map((run) => `${run.workflowId}:${run.finalState ?? 'failed'}`).join(', '),
    })

    const noBlockedOrPending = report.workflowRuns.every(
      (run) => run.finalState !== 'blocked' && run.finalState !== 'cancelled' && Number(run.pendingApprovals) === 0
    )
    report.checks.push({
      name: 'no_blocked_cancelled_pending_approvals',
      pass: noBlockedOrPending,
      details: report.workflowRuns
        .map((run) => `${run.workflowId}:state=${run.finalState ?? 'n/a'}:pending=${run.pendingApprovals}`)
        .join(', '),
    })

    const reworkRuns = report.workflowRuns.filter((run) => {
      const scenario = SCENARIOS.find((candidate) => candidate.workflowId === run.workflowId)
      return Boolean(scenario?.requiresReworkEvidence)
    })
    const reworkEvidenceOk = reworkRuns.every((run) => Boolean(run.reworkEvidence))

    report.checks.push({
      name: 'rework_evidence_loop_workflows',
      pass: reworkEvidenceOk,
      details: reworkRuns.map((run) => `${run.workflowId}:${run.reworkEvidence ? 'yes' : 'no'}`).join(', '),
    })

    report.generatedAt = new Date().toISOString()

    const jsonOutput = `${JSON.stringify(report, null, 2)}\n`
    await fsp.writeFile(reportJsonPath, jsonOutput, 'utf8')

    const markdownOutput = buildMarkdownReport(report)
    await fsp.writeFile(reportMdPath, markdownOutput, 'utf8')

    report.checks.push({
      name: 'report_files_written',
      pass: fs.existsSync(reportJsonPath) && fs.existsSync(reportMdPath),
      details: `${reportJsonPath}, ${reportMdPath}`,
    })

    const allChecksPass = report.checks.every((check) => check.pass)

    log(`Report JSON: ${reportJsonPath}`)
    log(`Report Markdown: ${reportMdPath}`)

    if (!allChecksPass) {
      log('One or more acceptance checks failed')
      process.exitCode = 1
      return
    }

    log('All acceptance checks passed')
    process.exitCode = 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    report.checks.push({
      name: 'fatal_error',
      pass: false,
      details: message,
    })

    await fsp.mkdir(REPORT_DIR, { recursive: true })
    await fsp.writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    await fsp.writeFile(reportMdPath, buildMarkdownReport(report), 'utf8')

    log(`Fatal error: ${message}`)
    log(`Failure report JSON: ${reportJsonPath}`)
    log(`Failure report Markdown: ${reportMdPath}`)

    process.exitCode = 1
  } finally {
    stoppingServer = true
    await stopServerProcess(serverProcess)
    try {
      await stopExistingClawcontrolOnPort3000()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log(`Final cleanup warning: ${message}`)
    }

    if (openClawModelOverridden && originalOpenClawDefaultModel) {
      try {
        setOpenClawDefaultModel(originalOpenClawDefaultModel)
        log(`Restored OpenClaw default model to ${originalOpenClawDefaultModel}`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log(`Failed to restore OpenClaw default model: ${message}`)
      }
    }

    await closeWritableStream(serverLogStream)

    try {
      await releaseRunLock()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log(`Run lock cleanup warning: ${message}`)
    }
  }
}

main()
  .then(() => {
    process.exit(process.exitCode ?? 0)
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
