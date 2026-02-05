/**
 * Database client for clawcontrol
 *
 * Provides a singleton Prisma client instance with WAL mode enabled.
 * WAL (Write-Ahead Logging) provides better concurrency for local-first apps.
 */

import { PrismaClient } from '@prisma/client'

// Prevent multiple instances during development hot reload
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

/**
 * Singleton Prisma client instance
 *
 * In development, stores the client on globalThis to survive hot reloads.
 * In production, creates a fresh instance.
 */
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

/**
 * Enable WAL mode for SQLite
 *
 * WAL mode provides:
 * - Better concurrency (readers don't block writers)
 * - Improved crash recovery
 * - Better performance for read-heavy workloads
 *
 * This should be called once on app startup.
 */
export async function enableWalMode(): Promise<void> {
  try {
    // Use $queryRawUnsafe since PRAGMA commands return results
    await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL;')
    await prisma.$queryRawUnsafe('PRAGMA synchronous = NORMAL;')
    await prisma.$queryRawUnsafe('PRAGMA foreign_keys = ON;')
    console.log('[db] WAL mode enabled')
  } catch (error) {
    console.error('[db] Failed to enable WAL mode:', error)
  }
}

/**
 * Check if database is accessible
 */
export async function checkConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`
    return true
  } catch {
    return false
  }
}

/**
 * Get current journal mode
 */
export async function getJournalMode(): Promise<string> {
  // Avoid relying on Prisma generic typing here; it may be unavailable before `prisma generate`.
  const result = (await prisma.$queryRawUnsafe(
    'PRAGMA journal_mode;'
  )) as Array<{ journal_mode: string }>

  return result[0]?.journal_mode ?? 'unknown'
}

type ReservedWorkOrderSeed = {
  id: string
  code: string
  title: string
  goalMd: string
  state: string
  priority: string
  owner: string
  routingTemplate: string
}

const RESERVED_WORK_ORDERS: ReservedWorkOrderSeed[] = [
  {
    id: 'system',
    code: 'WO-SYS',
    title: 'System Operations',
    goalMd: 'Internal work order for system maintenance actions and receipts.',
    state: 'active',
    priority: 'P3',
    owner: 'system',
    routingTemplate: 'system',
  },
  {
    id: 'console',
    code: 'WO-CONSOLE',
    title: 'Console Operations',
    goalMd: 'Internal work order for OpenClaw console sessions and receipts.',
    state: 'active',
    priority: 'P3',
    owner: 'system',
    routingTemplate: 'system',
  },
]

export const RESERVED_WORK_ORDER_IDS = RESERVED_WORK_ORDERS.map((wo) => wo.id)

/**
 * Ensure reserved/system work orders exist.
 *
 * Many internal routes create receipts that must satisfy the required
 * `Receipt.workOrderId` FK. On existing DBs, seed scripts may not have run,
 * so we upsert these work orders at startup.
 */
export async function ensureReservedWorkOrders(): Promise<void> {
  for (const wo of RESERVED_WORK_ORDERS) {
    await prisma.workOrder.upsert({
      where: { id: wo.id },
      create: {
        id: wo.id,
        code: wo.code,
        title: wo.title,
        goalMd: wo.goalMd,
        state: wo.state,
        priority: wo.priority,
        owner: wo.owner,
        routingTemplate: wo.routingTemplate,
      },
      update: {},
    })
  }
}
