import { NextRequest, NextResponse } from 'next/server'
import { getRepos } from '@/lib/repo'
import { enforceTypedConfirm } from '@/lib/with-governor'
import { STATION_ICON_SET } from '@/lib/stations/icon-map'
import {
  areStationMutationsEnabled,
  STATION_MUTATIONS_DISABLED_ERROR,
  STATION_MUTATIONS_DISABLED_MESSAGE,
} from '@/lib/stations/policy'

function normalizeOptionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function normalizeName(value: unknown): string | null | undefined {
  const normalized = normalizeOptionalString(value)
  if (normalized === undefined) return undefined
  if (normalized === null) return null
  return normalized
}

function normalizeColor(value: unknown): string | null | undefined {
  const normalized = normalizeOptionalString(value)
  if (normalized === undefined) return undefined
  if (normalized === null) return null
  const hex = normalized.startsWith('#') ? normalized : `#${normalized}`
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return undefined
  return hex
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  if (!areStationMutationsEnabled()) {
    return NextResponse.json(
      { error: STATION_MUTATIONS_DISABLED_ERROR, message: STATION_MUTATIONS_DISABLED_MESSAGE },
      { status: 403 }
    )
  }

  const { id } = await context.params
  const body = await request.json().catch(() => ({}))
  const typedConfirmText = typeof body?.typedConfirmText === 'string' ? body.typedConfirmText : undefined

  const enforcement = await enforceTypedConfirm({
    actionKind: 'station.update',
    typedConfirmText,
  })
  if (!enforcement.allowed) {
    return NextResponse.json(
      { error: enforcement.errorType, policy: enforcement.policy },
      { status: enforcement.errorType === 'TYPED_CONFIRM_REQUIRED' ? 428 : 403 }
    )
  }

  const iconRaw = body?.icon
  if (iconRaw !== undefined && (typeof iconRaw !== 'string' || !STATION_ICON_SET.has(iconRaw))) {
    return NextResponse.json({ error: 'INVALID_ICON' }, { status: 400 })
  }

  const name = normalizeName(body?.name)
  if (name === null) {
    return NextResponse.json({ error: 'NAME_REQUIRED' }, { status: 400 })
  }

  const description = normalizeOptionalString(body?.description)
  const color = normalizeColor(body?.color)
  if (color === undefined && body?.color !== undefined) {
    return NextResponse.json({ error: 'INVALID_COLOR' }, { status: 400 })
  }

  const sortOrderRaw = body?.sortOrder
  const sortOrder = sortOrderRaw === undefined ? undefined : Number(sortOrderRaw)
  if (sortOrderRaw !== undefined && (!Number.isFinite(sortOrder) || !Number.isInteger(sortOrder))) {
    return NextResponse.json({ error: 'INVALID_SORT_ORDER' }, { status: 400 })
  }

  const repos = getRepos()
  const before = await repos.stations.getById(id)
  if (!before) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }

  if (typeof name === 'string' && name !== before.name) {
    const existingByName = await repos.stations.getByName(name)
    if (existingByName && existingByName.id !== id) {
      return NextResponse.json({ error: 'STATION_NAME_TAKEN' }, { status: 409 })
    }
  }

  const receipt = await repos.receipts.create({
    workOrderId: 'system',
    kind: 'manual',
    commandName: 'station.update',
    commandArgs: { stationId: id, patch: { name, icon: iconRaw, description, color, sortOrder } },
  })

  try {
    await repos.receipts.append(receipt.id, { stream: 'stdout', chunk: `Updating station "${id}"...\n` })

    const updated = await repos.stations.update(id, {
      ...(typeof name === 'string' ? { name } : {}),
      ...(typeof iconRaw === 'string' ? { icon: iconRaw } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(color !== undefined ? { color } : {}),
      ...(sortOrder !== undefined ? { sortOrder } : {}),
    })

    if (!updated) {
      await repos.receipts.finalize(receipt.id, { exitCode: 1, durationMs: 0, parsedJson: { error: 'NOT_FOUND' } })
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    }

    await repos.receipts.finalize(receipt.id, {
      exitCode: 0,
      durationMs: 0,
      parsedJson: { station: updated },
    })

    await repos.activities.create({
      type: 'station.updated',
      actor: 'user',
      entityType: 'station',
      entityId: updated.id,
      summary: `Updated station: ${updated.name}`,
      payloadJson: {
        receiptId: receipt.id,
        before,
        after: updated,
      },
    })

    return NextResponse.json({ data: updated, receiptId: receipt.id })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update station'
    await repos.receipts.append(receipt.id, { stream: 'stderr', chunk: `Error: ${message}\n` })
    await repos.receipts.finalize(receipt.id, {
      exitCode: 1,
      durationMs: 0,
      parsedJson: { error: message },
    })
    return NextResponse.json({ error: 'UPDATE_FAILED', message, receiptId: receipt.id }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  if (!areStationMutationsEnabled()) {
    return NextResponse.json(
      { error: STATION_MUTATIONS_DISABLED_ERROR, message: STATION_MUTATIONS_DISABLED_MESSAGE },
      { status: 403 }
    )
  }

  const { id } = await context.params
  const body = await request.json().catch(() => ({}))
  const typedConfirmText = typeof body?.typedConfirmText === 'string' ? body.typedConfirmText : undefined

  const enforcement = await enforceTypedConfirm({
    actionKind: 'station.delete',
    typedConfirmText,
  })
  if (!enforcement.allowed) {
    return NextResponse.json(
      { error: enforcement.errorType, policy: enforcement.policy },
      { status: enforcement.errorType === 'TYPED_CONFIRM_REQUIRED' ? 428 : 403 }
    )
  }

  const repos = getRepos()
  const existing = await repos.stations.getById(id)
  if (!existing) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }

  const assignedAgents = await repos.agents.list({ station: id })
  if (assignedAgents.length > 0) {
    return NextResponse.json(
      { error: 'STATION_IN_USE', details: { agentCount: assignedAgents.length } },
      { status: 409 }
    )
  }

  const receipt = await repos.receipts.create({
    workOrderId: 'system',
    kind: 'manual',
    commandName: 'station.delete',
    commandArgs: { stationId: id },
  })

  try {
    await repos.receipts.append(receipt.id, { stream: 'stdout', chunk: `Deleting station "${id}"...\n` })

    const ok = await repos.stations.delete(id)
    if (!ok) {
      await repos.receipts.finalize(receipt.id, { exitCode: 1, durationMs: 0, parsedJson: { error: 'NOT_FOUND' } })
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    }

    await repos.receipts.finalize(receipt.id, {
      exitCode: 0,
      durationMs: 0,
      parsedJson: { deleted: true, stationId: id },
    })

    await repos.activities.create({
      type: 'station.deleted',
      actor: 'user',
      entityType: 'station',
      entityId: id,
      summary: `Deleted station: ${existing.name}`,
      payloadJson: {
        receiptId: receipt.id,
        before: existing,
        after: null,
      },
    })

    return NextResponse.json({ ok: true, receiptId: receipt.id })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete station'
    await repos.receipts.append(receipt.id, { stream: 'stderr', chunk: `Error: ${message}\n` })
    await repos.receipts.finalize(receipt.id, {
      exitCode: 1,
      durationMs: 0,
      parsedJson: { error: message },
    })
    return NextResponse.json({ error: 'DELETE_FAILED', message, receiptId: receipt.id }, { status: 500 })
  }
}
