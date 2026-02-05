/**
 * Stations Repository
 *
 * Provides data access for stations.
 */

import { prisma } from '../db'
import type { StationDTO } from './types'

// ============================================================================
// REPOSITORY INTERFACE
// ============================================================================

export interface CreateStationInput {
  /** Stable, user-facing id (kebab-case slug). */
  id: string
  name: string
  icon: string
  description?: string | null
  color?: string | null
  sortOrder?: number
}

export interface UpdateStationInput {
  name?: string
  icon?: string
  description?: string | null
  color?: string | null
  sortOrder?: number
}

export interface StationsRepo {
  list(): Promise<StationDTO[]>
  getById(id: string): Promise<StationDTO | null>
  getByName(name: string): Promise<StationDTO | null>
  create(input: CreateStationInput): Promise<StationDTO>
  update(id: string, input: UpdateStationInput): Promise<StationDTO | null>
  delete(id: string): Promise<boolean>
}

// ============================================================================
// DATABASE IMPLEMENTATION
// ============================================================================

export function createDbStationsRepo(): StationsRepo {
  return {
    async list(): Promise<StationDTO[]> {
      const rows = await prisma.station.findMany({
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      })
      return rows.map(toDTO)
    },

    async getById(id: string): Promise<StationDTO | null> {
      const row = await prisma.station.findUnique({ where: { id } })
      return row ? toDTO(row) : null
    },

    async getByName(name: string): Promise<StationDTO | null> {
      const row = await prisma.station.findUnique({ where: { name } })
      return row ? toDTO(row) : null
    },

    async create(input: CreateStationInput): Promise<StationDTO> {
      const row = await prisma.station.create({
        data: {
          id: input.id,
          name: input.name,
          icon: input.icon,
          description: input.description ?? null,
          color: input.color ?? null,
          sortOrder: input.sortOrder ?? 0,
        },
      })
      return toDTO(row)
    },

    async update(id: string, input: UpdateStationInput): Promise<StationDTO | null> {
      const existing = await prisma.station.findUnique({ where: { id } })
      if (!existing) return null

      const row = await prisma.station.update({
        where: { id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.icon !== undefined && { icon: input.icon }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.color !== undefined && { color: input.color }),
          ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
        },
      })

      return toDTO(row)
    },

    async delete(id: string): Promise<boolean> {
      const existing = await prisma.station.findUnique({ where: { id } })
      if (!existing) return false
      await prisma.station.delete({ where: { id } })
      return true
    },
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function toDTO(row: {
  id: string
  name: string
  icon: string
  description: string | null
  color: string | null
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}): StationDTO {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    description: row.description,
    color: row.color,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
