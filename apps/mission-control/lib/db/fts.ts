/**
 * FTS5 Full-Text Search for Mission Control
 *
 * Creates and manages SQLite FTS5 virtual tables for full-text search
 * across work orders, operations, messages, and documents.
 *
 * Uses contentless FTS5 tables (content='') for standalone search indexes.
 * We manually sync content via indexX/removeX functions.
 *
 * Indexed fields:
 * - work_orders_fts: code, title, goal_md
 * - operations_fts: title, notes
 * - messages_fts: content
 * - documents_fts: title, content
 */

import { prisma } from '../db'

// Track if FTS tables have been initialized this session
let ftsInitialized = false

/**
 * Initialize FTS5 virtual tables if they don't exist.
 * Safe to call multiple times - will skip if already initialized.
 */
export async function initializeFts(): Promise<void> {
  if (ftsInitialized) return

  try {
    // Create standalone FTS5 virtual tables (no content sync - we manage manually)
    // Using rowid as the document identifier

    // Work Orders FTS
    await prisma.$executeRawUnsafe(`
      CREATE VIRTUAL TABLE IF NOT EXISTS work_orders_fts USING fts5(
        id,
        code,
        title,
        goal_md
      );
    `)

    // Operations FTS
    await prisma.$executeRawUnsafe(`
      CREATE VIRTUAL TABLE IF NOT EXISTS operations_fts USING fts5(
        id,
        title,
        notes
      );
    `)

    // Messages FTS
    await prisma.$executeRawUnsafe(`
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        id,
        msg_content
      );
    `)

    // Documents FTS
    await prisma.$executeRawUnsafe(`
      CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
        id,
        title,
        doc_content
      );
    `)

    ftsInitialized = true
    console.log('[fts] FTS5 tables initialized')
  } catch (error) {
    // If tables already exist with different schema, this is fine
    if (String(error).includes('already exists')) {
      ftsInitialized = true
      return
    }
    console.error('[fts] Failed to initialize FTS5 tables:', error)
    throw error
  }
}

// ============================================================================
// WORK ORDERS FTS
// ============================================================================

export async function indexWorkOrder(
  id: string,
  code: string,
  title: string,
  goalMd: string
): Promise<void> {
  // Delete existing entry first, then insert (FTS5 doesn't support REPLACE)
  await prisma.$executeRawUnsafe(
    `DELETE FROM work_orders_fts WHERE id = ?`,
    id
  )
  await prisma.$executeRawUnsafe(
    `INSERT INTO work_orders_fts(id, code, title, goal_md) VALUES (?, ?, ?, ?)`,
    id, code, title, goalMd
  )
}

export async function removeWorkOrderFromIndex(id: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    `DELETE FROM work_orders_fts WHERE id = ?`,
    id
  )
}

// ============================================================================
// OPERATIONS FTS
// ============================================================================

export async function indexOperation(
  id: string,
  title: string,
  notes: string | null
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `DELETE FROM operations_fts WHERE id = ?`,
    id
  )
  await prisma.$executeRawUnsafe(
    `INSERT INTO operations_fts(id, title, notes) VALUES (?, ?, ?)`,
    id, title, notes ?? ''
  )
}

export async function removeOperationFromIndex(id: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    `DELETE FROM operations_fts WHERE id = ?`,
    id
  )
}

// ============================================================================
// MESSAGES FTS
// ============================================================================

export async function indexMessage(id: string, content: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    `DELETE FROM messages_fts WHERE id = ?`,
    id
  )
  await prisma.$executeRawUnsafe(
    `INSERT INTO messages_fts(id, msg_content) VALUES (?, ?)`,
    id, content
  )
}

export async function removeMessageFromIndex(id: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    `DELETE FROM messages_fts WHERE id = ?`,
    id
  )
}

// ============================================================================
// DOCUMENTS FTS
// ============================================================================

export async function indexDocument(
  id: string,
  title: string,
  content: string
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `DELETE FROM documents_fts WHERE id = ?`,
    id
  )
  await prisma.$executeRawUnsafe(
    `INSERT INTO documents_fts(id, title, doc_content) VALUES (?, ?, ?)`,
    id, title, content
  )
}

export async function removeDocumentFromIndex(id: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    `DELETE FROM documents_fts WHERE id = ?`,
    id
  )
}

// ============================================================================
// REBUILD INDEX (for maintenance)
// ============================================================================

/**
 * Rebuild all FTS indexes from source tables.
 * Use this after bulk imports or if indexes get out of sync.
 */
export async function rebuildAllIndexes(): Promise<void> {
  console.log('[fts] Rebuilding all FTS indexes...')

  // Clear existing FTS data
  await prisma.$executeRawUnsafe('DELETE FROM work_orders_fts')
  await prisma.$executeRawUnsafe('DELETE FROM operations_fts')
  await prisma.$executeRawUnsafe('DELETE FROM messages_fts')
  await prisma.$executeRawUnsafe('DELETE FROM documents_fts')

  // Rebuild from source tables
  await prisma.$executeRawUnsafe(`
    INSERT INTO work_orders_fts(id, code, title, goal_md)
    SELECT id, code, title, goal_md FROM work_orders
  `)

  await prisma.$executeRawUnsafe(`
    INSERT INTO operations_fts(id, title, notes)
    SELECT id, title, COALESCE(notes, '') FROM operations
  `)

  // Only rebuild messages if the table has data
  const messageCount = await prisma.$queryRawUnsafe<[{ cnt: number }]>(
    `SELECT COUNT(*) as cnt FROM messages`
  )
  if (messageCount[0]?.cnt > 0) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO messages_fts(id, msg_content)
      SELECT id, content FROM messages
    `)
  }

  // Only rebuild documents if the table has data
  const documentCount = await prisma.$queryRawUnsafe<[{ cnt: number }]>(
    `SELECT COUNT(*) as cnt FROM documents`
  )
  if (documentCount[0]?.cnt > 0) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO documents_fts(id, title, doc_content)
      SELECT id, title, content FROM documents
    `)
  }

  console.log('[fts] FTS indexes rebuilt')
}
