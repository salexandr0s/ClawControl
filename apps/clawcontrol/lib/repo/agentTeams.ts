import { prisma } from '@/lib/db'
import { slugifyDisplayName } from '@/lib/agent-identity'
import {
  assertValidTeamHierarchy,
  createDefaultTeamHierarchy,
} from '@/lib/services/team-hierarchy'
import type {
  AgentTeamDTO,
  AgentTeamMemberDTO,
  TeamHierarchyConfig,
} from './types'

export interface CreateAgentTeamInput {
  name: string
  slug?: string
  description?: string | null
  source?: AgentTeamDTO['source']
  workflowIds?: string[]
  templateIds?: string[]
  hierarchy?: TeamHierarchyConfig
  healthStatus?: AgentTeamDTO['healthStatus']
  memberAgentIds?: string[]
}

export interface UpdateAgentTeamInput {
  name?: string
  description?: string | null
  workflowIds?: string[]
  templateIds?: string[]
  hierarchy?: TeamHierarchyConfig
  healthStatus?: AgentTeamDTO['healthStatus']
  memberAgentIds?: string[]
}

export interface AgentTeamsRepo {
  list(): Promise<AgentTeamDTO[]>
  getById(id: string): Promise<AgentTeamDTO | null>
  getBySlug(slug: string): Promise<AgentTeamDTO | null>
  create(input: CreateAgentTeamInput): Promise<AgentTeamDTO>
  update(id: string, input: UpdateAgentTeamInput): Promise<AgentTeamDTO | null>
  delete(id: string): Promise<boolean>
}

type TeamRow = {
  id: string
  slug: string
  name: string
  description: string | null
  source: string
  workflowIds: string
  templateIds: string
  hierarchyJson: string
  healthStatus: string
  createdAt: Date
  updatedAt: Date
}

function safeParseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  } catch {
    return []
  }
}

function dedupe(values: string[] | undefined): string[] {
  if (!values || values.length === 0) return []
  const out = new Set<string>()
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed) continue
    out.add(trimmed)
  }
  return Array.from(out).sort((left, right) => left.localeCompare(right))
}

function normalizeTeamMember(row: {
  id: string
  displayName: string | null
  name: string
  slug: string | null
  templateId: string | null
  role: string
  station: string
  status: string
}): AgentTeamMemberDTO {
  const displayName = row.displayName?.trim() || row.name
  return {
    id: row.id,
    displayName,
    slug: row.slug?.trim() || slugifyDisplayName(displayName),
    templateId: row.templateId ?? null,
    role: row.role,
    station: row.station,
    status: (row.status as AgentTeamMemberDTO['status']) ?? 'idle',
  }
}

function parseTeamHierarchy(value: string, templateIds: string[]): TeamHierarchyConfig {
  try {
    const parsed = JSON.parse(value) as unknown
    return assertValidTeamHierarchy(parsed, templateIds)
  } catch {
    return createDefaultTeamHierarchy(templateIds)
  }
}

function normalizeTeam(row: TeamRow, members: AgentTeamMemberDTO[]): AgentTeamDTO {
  const source = row.source as AgentTeamDTO['source']
  const healthStatus = row.healthStatus as AgentTeamDTO['healthStatus']

  const templateIds = safeParseStringArray(row.templateIds)
  const hierarchy = parseTeamHierarchy(row.hierarchyJson, templateIds)

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    source: source === 'imported' || source === 'builtin' ? source : 'custom',
    workflowIds: safeParseStringArray(row.workflowIds),
    templateIds,
    hierarchy,
    healthStatus: (
      healthStatus === 'healthy'
      || healthStatus === 'warning'
      || healthStatus === 'degraded'
      || healthStatus === 'unknown'
    )
      ? healthStatus
      : 'unknown',
    memberCount: members.length,
    members,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function buildTeamDTO(row: TeamRow): Promise<AgentTeamDTO> {
  const memberRows = await prisma.agent.findMany({
    where: { teamId: row.id },
    select: {
      id: true,
      displayName: true,
      name: true,
      slug: true,
      templateId: true,
      role: true,
      station: true,
      status: true,
    },
    orderBy: [{ displayName: 'asc' }, { name: 'asc' }],
  })

  const members = memberRows.map(normalizeTeamMember)
  return normalizeTeam(row, members)
}

async function ensureUniqueSlug(slug: string, excludeTeamId?: string): Promise<string> {
  const normalized = slugifyDisplayName(slug)
  const existing = await prisma.agentTeam.findMany({
    where: excludeTeamId ? { id: { not: excludeTeamId } } : undefined,
    select: { slug: true },
  })

  const used = new Set(
    existing
      .map((row) => row.slug.trim().toLowerCase())
      .filter(Boolean)
  )

  if (!used.has(normalized.toLowerCase())) return normalized

  let index = 2
  while (used.has(`${normalized}-${index}`.toLowerCase())) {
    index += 1
  }
  return `${normalized}-${index}`
}

async function applyTeamMembership(teamId: string, memberAgentIds: string[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.agent.updateMany({
      where: { teamId },
      data: { teamId: null },
    })

    if (memberAgentIds.length > 0) {
      await tx.agent.updateMany({
        where: { id: { in: memberAgentIds } },
        data: { teamId },
      })
    }
  })
}

export function createDbAgentTeamsRepo(): AgentTeamsRepo {
  return {
    async list(): Promise<AgentTeamDTO[]> {
      const rows = await prisma.agentTeam.findMany({
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      })
      return Promise.all(rows.map((row) => buildTeamDTO(row as unknown as TeamRow)))
    },

    async getById(id: string): Promise<AgentTeamDTO | null> {
      const row = await prisma.agentTeam.findUnique({ where: { id } })
      if (!row) return null
      return buildTeamDTO(row as unknown as TeamRow)
    },

    async getBySlug(slug: string): Promise<AgentTeamDTO | null> {
      const row = await prisma.agentTeam.findUnique({ where: { slug } })
      if (!row) return null
      return buildTeamDTO(row as unknown as TeamRow)
    },

    async create(input: CreateAgentTeamInput): Promise<AgentTeamDTO> {
      const rawName = input.name.trim()
      const baseSlug = input.slug?.trim() || rawName
      const slug = await ensureUniqueSlug(baseSlug)
      const workflowIds = dedupe(input.workflowIds)
      const templateIds = dedupe(input.templateIds)
      const hierarchy = input.hierarchy
        ? assertValidTeamHierarchy(input.hierarchy, templateIds)
        : createDefaultTeamHierarchy(templateIds)

      const row = await prisma.agentTeam.create({
        data: {
          name: rawName,
          slug,
          description: input.description ?? null,
          source: input.source ?? 'custom',
          workflowIds: JSON.stringify(workflowIds),
          templateIds: JSON.stringify(templateIds),
          hierarchyJson: JSON.stringify(hierarchy),
          healthStatus: input.healthStatus ?? 'healthy',
        },
      })

      const memberIds = dedupe(input.memberAgentIds)
      if (memberIds.length > 0) {
        await applyTeamMembership(row.id, memberIds)
      }

      return buildTeamDTO(row as unknown as TeamRow)
    },

    async update(id: string, input: UpdateAgentTeamInput): Promise<AgentTeamDTO | null> {
      const existing = await prisma.agentTeam.findUnique({ where: { id } })
      if (!existing) return null

      const nextWorkflowIds = input.workflowIds !== undefined
        ? JSON.stringify(dedupe(input.workflowIds))
        : undefined
      const nextTemplateIds = input.templateIds !== undefined
        ? JSON.stringify(dedupe(input.templateIds))
        : undefined
      const resolvedTemplateIds = input.templateIds !== undefined
        ? dedupe(input.templateIds)
        : safeParseStringArray(existing.templateIds)
      const existingHierarchy = parseTeamHierarchy(
        (existing as unknown as TeamRow).hierarchyJson ?? '{"version":1,"members":{}}',
        safeParseStringArray(existing.templateIds)
      )
      const nextHierarchy = input.hierarchy !== undefined
        ? assertValidTeamHierarchy(input.hierarchy, resolvedTemplateIds)
        : input.templateIds !== undefined
          ? assertValidTeamHierarchy(existingHierarchy, resolvedTemplateIds)
          : undefined

      const row = await prisma.agentTeam.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(nextWorkflowIds !== undefined ? { workflowIds: nextWorkflowIds } : {}),
          ...(nextTemplateIds !== undefined ? { templateIds: nextTemplateIds } : {}),
          ...(nextHierarchy !== undefined ? { hierarchyJson: JSON.stringify(nextHierarchy) } : {}),
          ...(input.healthStatus !== undefined ? { healthStatus: input.healthStatus } : {}),
        },
      })

      if (input.memberAgentIds !== undefined) {
        await applyTeamMembership(id, dedupe(input.memberAgentIds))
      }

      return buildTeamDTO(row as unknown as TeamRow)
    },

    async delete(id: string): Promise<boolean> {
      const existing = await prisma.agentTeam.findUnique({ where: { id } })
      if (!existing) return false

      await prisma.$transaction(async (tx) => {
        await tx.agent.updateMany({
          where: { teamId: id },
          data: { teamId: null },
        })
        await tx.agentTeam.delete({ where: { id } })
      })

      return true
    },
  }
}
