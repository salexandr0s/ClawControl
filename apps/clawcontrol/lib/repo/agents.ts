/**
 * Agents Repository
 *
 * Provides data access for agents.
 */

import { prisma } from '../db'
import { buildUniqueSlug, extractAgentIdFromSessionKey, slugifyDisplayName } from '../agent-identity'
import type { AgentDTO, AgentFilters, AgentKind, AgentNameSource } from './types'

// ============================================================================
// REPOSITORY INTERFACE
// ============================================================================

export interface UpdateAgentInput {
  status?: string
  currentWorkOrderId?: string | null

  // Admin-editable fields
  name?: string // legacy alias for displayName
  displayName?: string
  role?: string
  station?: string
  teamId?: string | null
  templateId?: string | null
  capabilities?: Record<string, unknown>
  wipLimit?: number
  sessionKey?: string
  avatarPath?: string | null
  model?: string | null
  fallbacks?: string | null
  kind?: AgentKind
  dispatchEligible?: boolean
  nameSource?: AgentNameSource
  isStale?: boolean
  staleAt?: Date | null

  // Identity fields (internal use only; API routes should guard these)
  slug?: string
  runtimeAgentId?: string
}

export interface CreateAgentInput {
  name: string // legacy alias (kept for callers); stored as displayName
  displayName?: string
  slug?: string
  runtimeAgentId?: string
  kind?: AgentKind
  dispatchEligible?: boolean
  nameSource?: AgentNameSource
  role: string
  station: string
  teamId?: string | null
  templateId?: string | null
  sessionKey: string
  capabilities: Record<string, unknown>
  wipLimit?: number
  model?: string | null
  fallbacks?: string | null
  isStale?: boolean
  staleAt?: Date | null
}

export interface AgentsRepo {
  list(filters?: AgentFilters): Promise<AgentDTO[]>
  getById(id: string): Promise<AgentDTO | null>
  getByName(name: string): Promise<AgentDTO | null>
  getBySlug(slug: string): Promise<AgentDTO | null>
  getBySessionKey(sessionKey: string): Promise<AgentDTO | null>
  countByStatus(): Promise<Record<string, number>>
  create(input: CreateAgentInput): Promise<AgentDTO>
  update(id: string, input: UpdateAgentInput): Promise<AgentDTO | null>
  delete(id: string): Promise<boolean>
}

// ============================================================================
// DATABASE IMPLEMENTATION
// ============================================================================

export function createDbAgentsRepo(): AgentsRepo {
  return {
    async list(filters?: AgentFilters): Promise<AgentDTO[]> {
      const where = buildWhere(filters)
      const rows = await prisma.agent.findMany({
        where,
        orderBy: [{ displayName: 'asc' }, { name: 'asc' }],
      })
      return rows.map((row) => toDTO(row as unknown as PrismaAgentRow))
    },

    async getById(id: string): Promise<AgentDTO | null> {
      const row = await prisma.agent.findUnique({ where: { id } })
      return row ? toDTO(row as unknown as PrismaAgentRow) : null
    },

    async getByName(name: string): Promise<AgentDTO | null> {
      const row = await prisma.agent.findFirst({
        where: {
          OR: [
            { name },
            { displayName: name },
            { slug: name },
            { runtimeAgentId: name },
          ],
        },
      })
      return row ? toDTO(row as unknown as PrismaAgentRow) : null
    },

    async getBySlug(slug: string): Promise<AgentDTO | null> {
      const row = await prisma.agent.findFirst({ where: { slug } })
      return row ? toDTO(row as unknown as PrismaAgentRow) : null
    },

    async getBySessionKey(sessionKey: string): Promise<AgentDTO | null> {
      const row = await prisma.agent.findUnique({ where: { sessionKey } })
      return row ? toDTO(row as unknown as PrismaAgentRow) : null
    },

    async countByStatus(): Promise<Record<string, number>> {
      const groups = await prisma.agent.groupBy({
        by: ['status'],
        _count: { id: true },
      })
      return Object.fromEntries(
        groups.map((g) => [g.status, g._count.id])
      )
    },

    async create(input: CreateAgentInput): Promise<AgentDTO> {
      const displayName = normalizeDisplayName(input.displayName ?? input.name)
      const slug = await resolveUniqueSlug(input.slug ?? displayName)
      const runtimeAgentId = normalizeRuntimeAgentId(input.runtimeAgentId, input.sessionKey, slug)

      const row = await prisma.agent.create({
        data: {
          name: displayName,
          displayName,
          slug,
          runtimeAgentId,
          kind: input.kind ?? 'worker',
          dispatchEligible: input.dispatchEligible ?? true,
          nameSource: input.nameSource ?? 'system',
          role: input.role,
          station: input.station,
          ...(input.teamId !== undefined ? { teamId: input.teamId } : {}),
          ...(input.templateId !== undefined ? { templateId: input.templateId } : {}),
          status: 'idle',
          sessionKey: input.sessionKey,
          capabilities: JSON.stringify(input.capabilities),
          wipLimit: input.wipLimit ?? 2,
          ...(input.model !== undefined ? { model: input.model } : {}),
          ...(input.fallbacks !== undefined ? { fallbacks: input.fallbacks } : {}),
          ...(input.isStale !== undefined ? { isStale: input.isStale } : {}),
          ...(input.staleAt !== undefined ? { staleAt: input.staleAt } : {}),
        },
      })
      return toDTO(row as unknown as PrismaAgentRow)
    },

    async update(id: string, input: UpdateAgentInput): Promise<AgentDTO | null> {
      const existing = await prisma.agent.findUnique({ where: { id } })
      if (!existing) return null

      const updateData: Record<string, unknown> = {}

      if (input.status !== undefined) {
        updateData.status = input.status
        // `lastSeenAt` should track runtime activity, not generic metadata edits.
        if (input.status === 'active') {
          updateData.lastSeenAt = new Date()
        }
      }
      if (input.role !== undefined) updateData.role = input.role
      if (input.station !== undefined) updateData.station = input.station
      if (input.teamId !== undefined) updateData.teamId = input.teamId
      if (input.templateId !== undefined) updateData.templateId = input.templateId
      if (input.capabilities !== undefined) updateData.capabilities = JSON.stringify(input.capabilities)
      if (input.wipLimit !== undefined) updateData.wipLimit = input.wipLimit
      if (input.sessionKey !== undefined) updateData.sessionKey = input.sessionKey
      if (input.avatarPath !== undefined) updateData.avatarPath = input.avatarPath
      if (input.model !== undefined) updateData.model = input.model
      if (input.fallbacks !== undefined) updateData.fallbacks = input.fallbacks
      if (input.kind !== undefined) updateData.kind = input.kind
      if (input.dispatchEligible !== undefined) updateData.dispatchEligible = input.dispatchEligible
      if (input.nameSource !== undefined) updateData.nameSource = input.nameSource
      if (input.isStale !== undefined) updateData.isStale = input.isStale
      if (input.staleAt !== undefined) updateData.staleAt = input.staleAt

      if (input.slug !== undefined) {
        const normalizedSlug = slugifyDisplayName(input.slug)
        if (normalizedSlug !== normalizeText(existing.slug)) {
          updateData.slug = await resolveUniqueSlug(normalizedSlug, existing.id)
        }
      }

      if (input.runtimeAgentId !== undefined) {
        updateData.runtimeAgentId = input.runtimeAgentId.trim() || null
      }

      const nextDisplayName = input.displayName ?? input.name
      if (nextDisplayName !== undefined) {
        const normalized = normalizeDisplayName(nextDisplayName)
        updateData.displayName = normalized
        updateData.name = normalized // keep legacy alias in sync
      }

      if (input.sessionKey !== undefined && input.runtimeAgentId === undefined && input.slug === undefined) {
        updateData.runtimeAgentId = normalizeRuntimeAgentId(
          existing.runtimeAgentId ?? undefined,
          input.sessionKey,
          existing.slug ?? undefined
        )
      }

      const row = await prisma.agent.update({
        where: { id },
        data: updateData,
      })

      return toDTO(row as unknown as PrismaAgentRow)
    },

    async delete(id: string): Promise<boolean> {
      const existing = await prisma.agent.findUnique({ where: { id } })
      if (!existing) return false
      await prisma.agent.delete({ where: { id } })
      return true
    },
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function buildWhere(filters?: AgentFilters) {
  if (!filters) return {}
  const where: Record<string, unknown> = {}
  if (filters.status) {
    where.status = Array.isArray(filters.status) ? { in: filters.status } : filters.status
  }
  if (filters.station) {
    where.station = Array.isArray(filters.station) ? { in: filters.station } : filters.station
  }
  return where
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function normalizeDisplayName(input: string): string {
  const trimmed = input.trim()
  return trimmed || 'Unnamed Agent'
}

function normalizeRuntimeAgentId(runtimeAgentId: string | null | undefined, sessionKey: string, slug?: string): string {
  const explicit = runtimeAgentId?.trim()
  if (explicit) return explicit

  const fromSession = extractAgentIdFromSessionKey(sessionKey)
  if (fromSession) return fromSession

  const normalizedSlug = slug?.trim()
  if (normalizedSlug) return normalizedSlug

  return 'agent'
}

async function resolveUniqueSlug(base: string, currentAgentId?: string): Promise<string> {
  const normalizedBase = slugifyDisplayName(base)
  const existing = await prisma.agent.findMany({
    where: currentAgentId
      ? { id: { not: currentAgentId } }
      : undefined,
    select: { slug: true },
  })

  const used = existing
    .map((row) => row.slug)
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)

  return buildUniqueSlug(normalizedBase, used)
}

function safeParseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, unknown>
  } catch {
    return {}
  }
}

function safeParseArray(value: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(value ?? '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string')
  } catch {
    return []
  }
}

// Extended type to handle new fields that may not be in generated Prisma client
interface PrismaAgentRow {
  id: string
  name: string
  displayName?: string | null
  slug?: string | null
  runtimeAgentId?: string | null
  kind?: string | null
  dispatchEligible?: boolean | null
  nameSource?: string | null
  role: string
  station: string
  teamId?: string | null
  templateId?: string | null
  status: string
  sessionKey: string
  capabilities: string
  wipLimit: number
  avatarPath?: string | null
  fallbacks?: string | null
  model?: string | null
  isStale?: boolean | null
  staleAt?: Date | null
  lastSeenAt: Date | null
  lastHeartbeatAt: Date | null
  createdAt: Date
  updatedAt: Date
}

function toDTO(row: PrismaAgentRow): AgentDTO {
  const displayName = row.displayName?.trim() || row.name
  const slug = row.slug?.trim() || slugifyDisplayName(displayName)
  const runtimeAgentId = row.runtimeAgentId?.trim() || extractAgentIdFromSessionKey(row.sessionKey) || slug || row.id

  return {
    id: row.id,
    name: displayName, // legacy alias
    displayName,
    slug,
    runtimeAgentId,
    kind: (row.kind as AgentKind) || 'worker',
    dispatchEligible: row.dispatchEligible !== false,
    nameSource: (row.nameSource as AgentNameSource) || 'system',
    role: row.role,
    station: row.station,
    teamId: row.teamId ?? null,
    templateId: row.templateId ?? null,
    status: row.status as AgentDTO['status'],
    sessionKey: row.sessionKey,
    capabilities: safeParseObject(row.capabilities),
    wipLimit: row.wipLimit,
    avatarPath: row.avatarPath ?? null,
    model: row.model ?? null,
    fallbacks: safeParseArray(row.fallbacks),
    isStale: row.isStale === true,
    staleAt: row.staleAt ?? null,
    lastSeenAt: row.lastSeenAt,
    lastHeartbeatAt: row.lastHeartbeatAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
