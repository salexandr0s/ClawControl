#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const GOVERNANCE_ACTIVE_PROFILES_KEY = 'governance.activeProfiles'
const LEGACY_COMPANY_PROFILE_ID = 'clawcontrol-company-v1'
const LEGACY_COMPANY_POLICY = {
  main: 'anthropic/claude-opus-4-6',
  'wf-ops': 'anthropic/claude-sonnet-4-6',
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function parseRuntimeIdFromSessionKey(sessionKey) {
  const normalized = normalizeText(sessionKey)
  if (!normalized.startsWith('agent:')) return null
  const runtimeId = normalized.split(':')[1]
  return normalizeText(runtimeId) || null
}

function parseJsonArray(raw) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.map((item) => normalizeText(item)).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

function parseJsonObject(raw) {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed
  } catch {
    return {}
  }
}

async function hasTableColumn(tableName, columnName) {
  const rows = await prisma.$queryRawUnsafe(`PRAGMA table_info("${tableName}")`)
  return Array.isArray(rows) && rows.some((row) => normalizeText(row?.name) === columnName)
}

function objectStringMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out = {}
  for (const [key, model] of Object.entries(value)) {
    const normalizedKey = normalizeText(key)
    const normalizedModel = normalizeText(model)
    if (!normalizedKey || !normalizedModel) continue
    out[normalizedKey] = normalizedModel
  }
  return out
}

function extractRuntimeModel(agentRecord) {
  if (!agentRecord || typeof agentRecord !== 'object') return null
  if (typeof agentRecord.model === 'string') return normalizeText(agentRecord.model) || null
  if (agentRecord.model && typeof agentRecord.model === 'object') {
    const model = normalizeText(agentRecord.model.primary || agentRecord.model.model || agentRecord.model.id || '')
    return model || null
  }
  return null
}

async function loadRuntimeModels() {
  const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json')
  if (!existsSync(configPath)) return new Map()

  const raw = await readFile(configPath, 'utf8')
  const parsed = JSON.parse(raw)
  const agentsNode = parsed?.agents
  const list = Array.isArray(agentsNode)
    ? agentsNode
    : Array.isArray(agentsNode?.list)
      ? agentsNode.list
      : []

  const byRuntimeId = new Map()
  for (const entry of list) {
    const runtimeId = normalizeText(entry?.id)
    if (!runtimeId) continue
    byRuntimeId.set(runtimeId, extractRuntimeModel(entry))
  }
  return byRuntimeId
}

async function loadDbAgentRows() {
  const rows = await prisma.agent.findMany({
    select: {
      teamId: true,
      templateId: true,
      runtimeAgentId: true,
      sessionKey: true,
      model: true,
    },
  })

  return rows.map((row) => {
    const runtimeId = normalizeText(row.runtimeAgentId) || parseRuntimeIdFromSessionKey(row.sessionKey)
    return {
      teamId: row.teamId,
      templateId: normalizeText(row.templateId) || null,
      runtimeId,
      model: normalizeText(row.model) || null,
    }
  })
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

async function buildExpectedPolicyMap() {
  const activeProfiles = await loadActiveProfiles()
  const expected = {}

  if (activeProfiles.includes(LEGACY_COMPANY_PROFILE_ID)) {
    for (const [runtimeId, model] of Object.entries(LEGACY_COMPANY_POLICY)) {
      expected[runtimeId] = model
    }
  }

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

  const agentRows = await loadDbAgentRows()
  const agentsByTeam = new Map()
  for (const row of agentRows) {
    if (!row.teamId) continue
    if (!agentsByTeam.has(row.teamId)) agentsByTeam.set(row.teamId, [])
    agentsByTeam.get(row.teamId).push(row)
  }

  for (const team of teams) {
    const governance = parseJsonObject(hasGovernanceColumn ? team.governanceJson : '{}')
    const modelPolicy = objectStringMap(governance?.modelPolicy)
    if (Object.keys(modelPolicy).length === 0) continue

    const teamAgents = agentsByTeam.get(team.id) || []

    for (const agent of teamAgents) {
      if (!agent.runtimeId) continue
      const templateId = normalizeText(agent.templateId)
      const candidateKeys = [
        agent.runtimeId,
        `runtime:${agent.runtimeId}`,
        templateId,
        templateId ? `template:${templateId}` : '',
      ].filter(Boolean)

      for (const key of candidateKeys) {
        const mapped = modelPolicy[key]
        if (!mapped) continue
        expected[agent.runtimeId] = mapped
        break
      }
    }

    for (const [policyKey, model] of Object.entries(modelPolicy)) {
      if (!policyKey.includes(':') && !expected[policyKey]) {
        const isTemplateKey = teamAgents.some((row) => row.templateId && row.templateId === policyKey)
        if (!isTemplateKey) {
          expected[policyKey] = model
        }
      }
    }
  }

  return {
    activeProfiles,
    policy: expected,
  }
}

async function main() {
  const runtimeModels = await loadRuntimeModels()
  const dbAgentRows = await loadDbAgentRows()
  const { activeProfiles, policy } = await buildExpectedPolicyMap()

  const dbModels = new Map()
  for (const row of dbAgentRows) {
    if (!row.runtimeId) continue
    dbModels.set(row.runtimeId, row.model)
  }

  const trackedRuntimeIds = new Set(Object.keys(policy))
  for (const runtimeId of runtimeModels.keys()) {
    if (dbModels.has(runtimeId)) trackedRuntimeIds.add(runtimeId)
  }

  const drift = []

  for (const runtimeId of Array.from(trackedRuntimeIds).sort((a, b) => a.localeCompare(b))) {
    const runtimeModel = runtimeModels.get(runtimeId) ?? null
    const dbModel = dbModels.get(runtimeId) ?? null

    if (runtimeModel && dbModel && runtimeModel !== dbModel) {
      drift.push({
        runtimeId,
        kind: 'runtime_db_mismatch',
        runtimeModel,
        dbModel,
      })
    }

    const expectedModel = policy[runtimeId]
    if (!expectedModel) continue

    if (runtimeModel && runtimeModel !== expectedModel) {
      drift.push({
        runtimeId,
        kind: 'runtime_policy_mismatch',
        runtimeModel,
        expected: expectedModel,
      })
    }

    if (dbModel && dbModel !== expectedModel) {
      drift.push({
        runtimeId,
        kind: 'db_policy_mismatch',
        dbModel,
        expected: expectedModel,
      })
    }
  }

  const result = {
    ok: drift.length === 0,
    activeProfiles,
    trackedAgents: trackedRuntimeIds.size,
    policy,
    drift,
  }

  console.log(JSON.stringify(result, null, 2))
  process.exit(drift.length === 0 ? 0 : 1)
}

main()
  .catch((error) => {
    console.error(`[check-openclaw-model-policy] failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
