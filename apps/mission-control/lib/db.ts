/**
 * Database client for Mission Control
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
  const result = await prisma.$queryRawUnsafe<[{ journal_mode: string }]>(
    'PRAGMA journal_mode;'
  )
  return result[0]?.journal_mode ?? 'unknown'
}
