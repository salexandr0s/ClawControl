/**
 * ClawHub Marketplace Installs Repository
 *
 * Tracks which ClawHub skills are installed (global or per-agent), and links
 * install/uninstall actions to receipts for auditability.
 */

import { prisma } from '../db'
import type { ClawHubSkillInstallDTO } from './types'

export type ClawHubInstallScope = 'global' | 'agent'

export interface UpsertClawHubSkillInstallInput {
  slug: string
  displayName: string
  version: string
  scope: ClawHubInstallScope
  /** '__global__' for global installs; otherwise the agent slug */
  scopeKey: string
  agentId?: string | null
  sourceUrl: string
  installMethod: string
  manifestHash?: string | null
  installedBy: string
  lastReceiptId?: string | null
}

export interface ClawHubInstallsRepo {
  listActiveBySlugs(slugs: string[]): Promise<ClawHubSkillInstallDTO[]>
  listActiveBySlug(slug: string): Promise<ClawHubSkillInstallDTO[]>
  upsertInstall(input: UpsertClawHubSkillInstallInput): Promise<ClawHubSkillInstallDTO>
  markUninstalled(params: { slug: string; scopeKey: string; lastReceiptId?: string | null }): Promise<number>
}

export function createDbClawHubInstallsRepo(): ClawHubInstallsRepo {
  return {
    async listActiveBySlugs(slugs: string[]): Promise<ClawHubSkillInstallDTO[]> {
      const normalized = slugs
        .map((s) => (typeof s === 'string' ? s.trim().toLowerCase() : ''))
        .filter(Boolean)

      if (normalized.length === 0) return []

      const rows = await prisma.clawHubSkillInstall.findMany({
        where: {
          slug: { in: normalized },
          uninstalledAt: null,
        },
        orderBy: [{ slug: 'asc' }, { scopeKey: 'asc' }],
      })

      return rows.map(toDTO)
    },

    async listActiveBySlug(slug: string): Promise<ClawHubSkillInstallDTO[]> {
      const normalized = slug.trim().toLowerCase()
      if (!normalized) return []

      const rows = await prisma.clawHubSkillInstall.findMany({
        where: { slug: normalized, uninstalledAt: null },
        orderBy: [{ scopeKey: 'asc' }],
      })
      return rows.map(toDTO)
    },

    async upsertInstall(input: UpsertClawHubSkillInstallInput): Promise<ClawHubSkillInstallDTO> {
      const slug = input.slug.trim().toLowerCase()
      const scopeKey = input.scopeKey.trim()

      const row = await prisma.clawHubSkillInstall.upsert({
        where: {
          slug_scopeKey: {
            slug,
            scopeKey,
          },
        },
        create: {
          slug,
          displayName: input.displayName,
          version: input.version,
          scope: input.scope,
          scopeKey,
          agentId: input.agentId ?? null,
          sourceUrl: input.sourceUrl,
          installMethod: input.installMethod,
          manifestHash: input.manifestHash ?? null,
          installedBy: input.installedBy,
          lastReceiptId: input.lastReceiptId ?? null,
        },
        update: {
          displayName: input.displayName,
          version: input.version,
          scope: input.scope,
          agentId: input.agentId ?? null,
          sourceUrl: input.sourceUrl,
          installMethod: input.installMethod,
          manifestHash: input.manifestHash ?? null,
          installedBy: input.installedBy,
          lastReceiptId: input.lastReceiptId ?? null,
          uninstalledAt: null,
        },
      })

      return toDTO(row)
    },

    async markUninstalled(params: { slug: string; scopeKey: string; lastReceiptId?: string | null }): Promise<number> {
      const slug = params.slug.trim().toLowerCase()
      const scopeKey = params.scopeKey.trim()
      if (!slug || !scopeKey) return 0

      const res = await prisma.clawHubSkillInstall.updateMany({
        where: {
          slug,
          scopeKey,
          uninstalledAt: null,
        },
        data: {
          uninstalledAt: new Date(),
          ...(params.lastReceiptId !== undefined ? { lastReceiptId: params.lastReceiptId } : {}),
        },
      })

      return res.count
    },
  }
}

function toDTO(row: {
  id: string
  slug: string
  displayName: string
  version: string
  scope: string
  scopeKey: string
  agentId: string | null
  sourceUrl: string
  installMethod: string
  manifestHash: string | null
  installedAt: Date
  installedBy: string
  lastReceiptId: string | null
  uninstalledAt: Date | null
  updatedAt: Date
}): ClawHubSkillInstallDTO {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.displayName,
    version: row.version,
    scope: row.scope as ClawHubSkillInstallDTO['scope'],
    scopeKey: row.scopeKey,
    agentId: row.agentId,
    sourceUrl: row.sourceUrl,
    installMethod: row.installMethod,
    manifestHash: row.manifestHash,
    installedAt: row.installedAt,
    installedBy: row.installedBy,
    lastReceiptId: row.lastReceiptId,
    uninstalledAt: row.uninstalledAt,
    updatedAt: row.updatedAt,
  }
}
