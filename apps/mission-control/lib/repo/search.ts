/**
 * Search Repository
 *
 * Provides full-text search across work orders, operations, messages, and documents
 * using SQLite FTS5 with BM25 ranking.
 */

import { prisma } from '../db'
import { initializeFts } from '../db/fts'

// ============================================================================
// TYPES
// ============================================================================

export type SearchScope = 'all' | 'work_orders' | 'operations' | 'messages' | 'documents'

export interface SearchResult {
  id: string
  type: 'work_order' | 'operation' | 'message' | 'document'
  title: string
  snippet: string
  rank: number
  // Optional context for navigation
  workOrderId?: string
  workOrderCode?: string
}

export interface SearchOptions {
  limit?: number
  scope?: SearchScope
}

// ============================================================================
// SEARCH REPOSITORY
// ============================================================================

export interface SearchRepo {
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>
}

/**
 * Create the database search repository
 */
export function createDbSearchRepo(): SearchRepo {
  return {
    async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
      const { limit = 20, scope = 'all' } = options

      // Ensure FTS tables exist
      await initializeFts()

      // Sanitize query for FTS5
      const sanitizedQuery = sanitizeFtsQuery(query)
      if (!sanitizedQuery) return []

      const results: SearchResult[] = []
      const limitPerType = scope === 'all' ? Math.ceil(limit / 4) : limit

      // Search work orders
      if (scope === 'all' || scope === 'work_orders') {
        const woResults = await searchWorkOrders(sanitizedQuery, limitPerType)
        results.push(...woResults)
      }

      // Search operations
      if (scope === 'all' || scope === 'operations') {
        const opResults = await searchOperations(sanitizedQuery, limitPerType)
        results.push(...opResults)
      }

      // Search messages
      if (scope === 'all' || scope === 'messages') {
        const msgResults = await searchMessages(sanitizedQuery, limitPerType)
        results.push(...msgResults)
      }

      // Search documents
      if (scope === 'all' || scope === 'documents') {
        const docResults = await searchDocuments(sanitizedQuery, limitPerType)
        results.push(...docResults)
      }

      // Sort by rank (BM25 - lower is better) and return top results
      return results
        .sort((a, b) => a.rank - b.rank)
        .slice(0, limit)
    },
  }
}

/**
 * Create a mock search repository for testing
 */
export function createMockSearchRepo(): SearchRepo {
  return {
    async search(_query: string, _options?: SearchOptions): Promise<SearchResult[]> {
      // Return empty results in mock mode
      return []
    },
  }
}

// ============================================================================
// SEARCH HELPERS
// ============================================================================

/**
 * Sanitize query string for FTS5
 * - Escape special characters
 * - Add prefix matching for partial words
 */
function sanitizeFtsQuery(query: string): string {
  // Trim and normalize whitespace
  let sanitized = query.trim().replace(/\s+/g, ' ')

  if (!sanitized) return ''

  // Escape FTS5 special characters: " ( ) * : ^
  sanitized = sanitized.replace(/["()*:^]/g, ' ')

  // Add * for prefix matching on each word
  const words = sanitized.split(' ').filter(Boolean)
  return words.map((w) => `"${w}"*`).join(' ')
}

async function searchWorkOrders(query: string, limit: number): Promise<SearchResult[]> {
  try {
    const results = (await prisma.$queryRawUnsafe(
      `
      SELECT
        wo.id,
        wo.code,
        wo.title,
        wo.goal_md,
        bm25(work_orders_fts) as rank
      FROM work_orders_fts
      JOIN work_orders wo ON wo.id = work_orders_fts.id
      WHERE work_orders_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `,
      query,
      limit
    )) as Array<{
      id: string
      code: string
      title: string
      goal_md: string
      rank: number
    }>

    return results.map((r) => ({
      id: r.id,
      type: 'work_order' as const,
      title: `${r.code}: ${r.title}`,
      snippet: truncate(r.goal_md, 120),
      rank: r.rank,
      workOrderId: r.id,
      workOrderCode: r.code,
    }))
  } catch (error) {
    console.error('[search] Work orders search error:', error)
    return []
  }
}

async function searchOperations(query: string, limit: number): Promise<SearchResult[]> {
  try {
    const results = (await prisma.$queryRawUnsafe(
      `
      SELECT
        op.id,
        op.title,
        op.notes,
        op.work_order_id,
        wo.code as wo_code,
        bm25(operations_fts) as rank
      FROM operations_fts
      JOIN operations op ON op.id = operations_fts.id
      JOIN work_orders wo ON wo.id = op.work_order_id
      WHERE operations_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `,
      query,
      limit
    )) as Array<{
      id: string
      title: string
      notes: string | null
      work_order_id: string
      wo_code: string
      rank: number
    }>

    return results.map((r) => ({
      id: r.id,
      type: 'operation' as const,
      title: r.title,
      snippet: r.notes ? truncate(r.notes, 120) : `Operation in ${r.wo_code}`,
      rank: r.rank,
      workOrderId: r.work_order_id,
      workOrderCode: r.wo_code,
    }))
  } catch (error) {
    console.error('[search] Operations search error:', error)
    return []
  }
}

async function searchMessages(query: string, limit: number): Promise<SearchResult[]> {
  try {
    const results = (await prisma.$queryRawUnsafe(
      `
      SELECT
        msg.id,
        msg.content,
        msg.work_order_id,
        msg.role,
        wo.code as wo_code,
        bm25(messages_fts) as rank
      FROM messages_fts
      JOIN messages msg ON msg.id = messages_fts.id
      JOIN work_orders wo ON wo.id = msg.work_order_id
      WHERE messages_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `,
      query,
      limit
    )) as Array<{
      id: string
      content: string
      work_order_id: string
      wo_code: string
      role: string
      rank: number
    }>

    return results.map((r) => ({
      id: r.id,
      type: 'message' as const,
      title: `Message in ${r.wo_code}`,
      snippet: truncate(r.content, 120),
      rank: r.rank,
      workOrderId: r.work_order_id,
      workOrderCode: r.wo_code,
    }))
  } catch (error) {
    console.error('[search] Messages search error:', error)
    return []
  }
}

async function searchDocuments(query: string, limit: number): Promise<SearchResult[]> {
  try {
    const results = (await prisma.$queryRawUnsafe(
      `
      SELECT
        doc.id,
        doc.title,
        doc.content,
        doc.type,
        bm25(documents_fts) as rank
      FROM documents_fts
      JOIN documents doc ON doc.id = documents_fts.id
      WHERE documents_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `,
      query,
      limit
    )) as Array<{
      id: string
      title: string
      content: string
      type: string
      rank: number
    }>

    return results.map((r) => ({
      id: r.id,
      type: 'document' as const,
      title: r.title,
      snippet: truncate(r.content, 120),
      rank: r.rank,
    }))
  } catch (error) {
    console.error('[search] Documents search error:', error)
    return []
  }
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - 3) + '...'
}
