/**
 * Receipts Repository
 *
 * Provides data access for receipts (command execution logs) with both DB and mock implementations.
 * Publishes receipt events to the pub/sub system for SSE streaming.
 */

import { prisma } from '../db'
import { publishReceiptChunk, publishReceiptFinalized } from '../pubsub'
import type { ReceiptDTO, ReceiptFilters } from './types'

// ============================================================================
// REPOSITORY INTERFACE
// ============================================================================

export interface CreateReceiptInput {
  workOrderId: string
  operationId?: string | null
  kind: 'playbook_step' | 'cron_run' | 'agent_run' | 'manual'
  commandName: string
  commandArgs?: Record<string, unknown>
}

export interface AppendReceiptInput {
  stream: 'stdout' | 'stderr'
  chunk: string
}

export interface FinalizeReceiptInput {
  exitCode: number
  durationMs: number
  parsedJson?: Record<string, unknown>
}

export interface ReceiptsRepo {
  list(filters?: ReceiptFilters): Promise<ReceiptDTO[]>
  getById(id: string): Promise<ReceiptDTO | null>
  listForWorkOrder(workOrderId: string): Promise<ReceiptDTO[]>
  listForOperation(operationId: string): Promise<ReceiptDTO[]>
  listRunning(): Promise<ReceiptDTO[]>
  create(input: CreateReceiptInput): Promise<ReceiptDTO>
  append(id: string, input: AppendReceiptInput): Promise<ReceiptDTO | null>
  finalize(id: string, input: FinalizeReceiptInput): Promise<ReceiptDTO | null>
}

// ============================================================================
// DATABASE IMPLEMENTATION
// ============================================================================

export function createDbReceiptsRepo(): ReceiptsRepo {
  return {
    async list(filters?: ReceiptFilters): Promise<ReceiptDTO[]> {
      const where = buildWhere(filters)
      const rows = await prisma.receipt.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        take: 100,
      })
      return rows.map(toDTO)
    },

    async getById(id: string): Promise<ReceiptDTO | null> {
      const row = await prisma.receipt.findUnique({ where: { id } })
      return row ? toDTO(row) : null
    },

    async listForWorkOrder(workOrderId: string): Promise<ReceiptDTO[]> {
      const rows = await prisma.receipt.findMany({
        where: { workOrderId },
        orderBy: { startedAt: 'desc' },
      })
      return rows.map(toDTO)
    },

    async listForOperation(operationId: string): Promise<ReceiptDTO[]> {
      const rows = await prisma.receipt.findMany({
        where: { operationId },
        orderBy: { startedAt: 'desc' },
      })
      return rows.map(toDTO)
    },

    async listRunning(): Promise<ReceiptDTO[]> {
      const rows = await prisma.receipt.findMany({
        where: { endedAt: null },
        orderBy: { startedAt: 'desc' },
      })
      return rows.map(toDTO)
    },

    async create(input: CreateReceiptInput): Promise<ReceiptDTO> {
      const row = await prisma.receipt.create({
        data: {
          workOrderId: input.workOrderId,
          operationId: input.operationId ?? null,
          kind: input.kind,
          commandName: input.commandName,
          commandArgsJson: JSON.stringify(input.commandArgs ?? {}),
          startedAt: new Date(),
        },
      })
      return toDTO(row)
    },

    async append(id: string, input: AppendReceiptInput): Promise<ReceiptDTO | null> {
      const existing = await prisma.receipt.findUnique({ where: { id } })
      if (!existing) return null

      // Append to the appropriate excerpt
      const field = input.stream === 'stdout' ? 'stdoutExcerpt' : 'stderrExcerpt'
      const currentValue = existing[field]
      const newValue = currentValue + input.chunk

      // Keep only the last 10KB as excerpt
      const maxLength = 10 * 1024
      const truncatedValue =
        newValue.length > maxLength
          ? '...(truncated)\n' + newValue.slice(-maxLength)
          : newValue

      const row = await prisma.receipt.update({
        where: { id },
        data: { [field]: truncatedValue },
      })

      // Publish to SSE stream
      publishReceiptChunk(id, input.stream, input.chunk)

      return toDTO(row)
    },

    async finalize(id: string, input: FinalizeReceiptInput): Promise<ReceiptDTO | null> {
      const existing = await prisma.receipt.findUnique({ where: { id } })
      if (!existing) return null

      const row = await prisma.receipt.update({
        where: { id },
        data: {
          exitCode: input.exitCode,
          durationMs: input.durationMs,
          parsedJson: input.parsedJson ? JSON.stringify(input.parsedJson) : null,
          endedAt: new Date(),
        },
      })

      // Publish to SSE stream
      publishReceiptFinalized(id, input.exitCode, input.durationMs)

      return toDTO(row)
    },
  }
}

// ============================================================================
// MOCK IMPLEMENTATION
// ============================================================================

const mockReceipts: ReceiptDTO[] = []

export function createMockReceiptsRepo(): ReceiptsRepo {
  return {
    async list(_filters?: ReceiptFilters): Promise<ReceiptDTO[]> {
      return [...mockReceipts].sort(
        (a, b) => b.startedAt.getTime() - a.startedAt.getTime()
      )
    },

    async getById(id: string): Promise<ReceiptDTO | null> {
      return mockReceipts.find((r) => r.id === id) ?? null
    },

    async listForWorkOrder(workOrderId: string): Promise<ReceiptDTO[]> {
      return mockReceipts.filter((r) => r.workOrderId === workOrderId)
    },

    async listForOperation(operationId: string): Promise<ReceiptDTO[]> {
      return mockReceipts.filter((r) => r.operationId === operationId)
    },

    async listRunning(): Promise<ReceiptDTO[]> {
      return mockReceipts.filter((r) => r.endedAt === null)
    },

    async create(input: CreateReceiptInput): Promise<ReceiptDTO> {
      const receipt: ReceiptDTO = {
        id: `rcpt_mock_${Date.now()}`,
        workOrderId: input.workOrderId,
        operationId: input.operationId ?? null,
        kind: input.kind,
        commandName: input.commandName,
        commandArgsJson: input.commandArgs ?? {},
        exitCode: null,
        durationMs: null,
        stdoutExcerpt: '',
        stderrExcerpt: '',
        parsedJson: null,
        startedAt: new Date(),
        endedAt: null,
      }
      mockReceipts.push(receipt)
      return receipt
    },

    async append(id: string, input: AppendReceiptInput): Promise<ReceiptDTO | null> {
      const receipt = mockReceipts.find((r) => r.id === id)
      if (!receipt) return null

      if (input.stream === 'stdout') {
        receipt.stdoutExcerpt += input.chunk
      } else {
        receipt.stderrExcerpt += input.chunk
      }

      // Publish to SSE stream
      publishReceiptChunk(id, input.stream, input.chunk)

      return receipt
    },

    async finalize(id: string, input: FinalizeReceiptInput): Promise<ReceiptDTO | null> {
      const receipt = mockReceipts.find((r) => r.id === id)
      if (!receipt) return null

      receipt.exitCode = input.exitCode
      receipt.durationMs = input.durationMs
      receipt.parsedJson = input.parsedJson ?? null
      receipt.endedAt = new Date()

      // Publish to SSE stream
      publishReceiptFinalized(id, input.exitCode, input.durationMs)

      return receipt
    },
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function buildWhere(filters?: ReceiptFilters) {
  if (!filters) return {}
  const where: Record<string, unknown> = {}
  if (filters.workOrderId) {
    where.workOrderId = filters.workOrderId
  }
  if (filters.operationId) {
    where.operationId = filters.operationId
  }
  if (filters.kind) {
    where.kind = Array.isArray(filters.kind) ? { in: filters.kind } : filters.kind
  }
  if (filters.running !== undefined) {
    where.endedAt = filters.running ? null : { not: null }
  }
  return where
}

function toDTO(row: {
  id: string
  workOrderId: string
  operationId: string | null
  kind: string
  commandName: string
  commandArgsJson: string
  exitCode: number | null
  durationMs: number | null
  stdoutExcerpt: string
  stderrExcerpt: string
  parsedJson: string | null
  startedAt: Date
  endedAt: Date | null
}): ReceiptDTO {
  return {
    id: row.id,
    workOrderId: row.workOrderId,
    operationId: row.operationId,
    kind: row.kind as ReceiptDTO['kind'],
    commandName: row.commandName,
    commandArgsJson: JSON.parse(row.commandArgsJson),
    exitCode: row.exitCode,
    durationMs: row.durationMs,
    stdoutExcerpt: row.stdoutExcerpt,
    stderrExcerpt: row.stderrExcerpt,
    parsedJson: row.parsedJson ? JSON.parse(row.parsedJson) : null,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
  }
}
