import { NextRequest, NextResponse } from 'next/server'
import { getRepos } from '@/lib/repo'
import { enforceTypedConfirm } from '@/lib/with-governor'
import { STATION_ICON_SET } from '@/lib/stations/icon-map'
import {
  areStationMutationsEnabled,
  STATION_MUTATIONS_DISABLED_ERROR,
  STATION_MUTATIONS_DISABLED_MESSAGE,
} from '@/lib/stations/policy'

function normalizeName(name: unknown): string | null {
  if (typeof name !== 'string') return null
  const trimmed = name.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeOptionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function normalizeColor(value: unknown): string | null | undefined {
  const normalized = normalizeOptionalString(value)
  if (normalized === undefined) return undefined
  if (normalized === null) return null
  const hex = normalized.startsWith('#') ? normalized : `#${normalized}`
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return undefined
  return hex
}

function slugifyStationId(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')

  const fallback = base.length > 0 ? base : 'station'
  const truncated = fallback.slice(0, 48).replace(/-+$/g, '').replace(/^-+/g, '')
  return truncated.length > 0 ? truncated : 'station'
}

async function generateAvailableStationId(name: string): Promise<string | { error: 'STATION_ID_TAKEN' }> {
  const repos = getRepos()
  const base = slugifyStationId(name)

  const existingBase = await repos.stations.getById(base)
  if (!existingBase) return base

  for (let i = 2; i <= 50; i++) {
    const suffix = `-${i}`
    const maxBaseLen = 48 - suffix.length
    const prefix = base.slice(0, maxBaseLen).replace(/-+$/g, '').replace(/^-+/g, '') || 'station'
    const candidate = `${prefix}${suffix}`
    const existing = await repos.stations.getById(candidate)
    if (!existing) return candidate
  }

  return { error: 'STATION_ID_TAKEN' }
}

/**
 * GET /api/stations
 * List stations
 */
export async function GET() {
  const repos = getRepos()
  const stations = await repos.stations.list()
  return NextResponse.json({ data: stations })
}

/**
 * POST /api/stations
 * Create a station (slug id, typed confirm, receipt + activity)
 */
export async function POST(request: NextRequest) {
  if (!areStationMutationsEnabled()) {
    return NextResponse.json(
      { error: STATION_MUTATIONS_DISABLED_ERROR, message: STATION_MUTATIONS_DISABLED_MESSAGE },
      { status: 403 }
    )
  }

  const body = await request.json().catch(() => ({}))
  const typedConfirmText = typeof body?.typedConfirmText === 'string' ? body.typedConfirmText : undefined

  const enforcement = await enforceTypedConfirm({
    actionKind: 'station.create',
    typedConfirmText,
  })
  if (!enforcement.allowed) {
    return NextResponse.json(
      { error: enforcement.errorType, policy: enforcement.policy },
      { status: enforcement.errorType === 'TYPED_CONFIRM_REQUIRED' ? 428 : 403 }
    )
  }

  const name = normalizeName(body?.name)
  if (!name) {
    return NextResponse.json({ error: 'NAME_REQUIRED' }, { status: 400 })
  }

  const icon = body?.icon
  if (typeof icon !== 'string' || !STATION_ICON_SET.has(icon)) {
    return NextResponse.json({ error: 'INVALID_ICON' }, { status: 400 })
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

  const existingByName = await repos.stations.getByName(name)
  if (existingByName) {
    return NextResponse.json({ error: 'STATION_NAME_TAKEN' }, { status: 409 })
  }

  const idResult = await generateAvailableStationId(name)
  if (typeof idResult !== 'string') {
    return NextResponse.json({ error: idResult.error }, { status: 409 })
  }

  const receipt = await repos.receipts.create({
    workOrderId: 'system',
    kind: 'manual',
    commandName: 'station.create',
    commandArgs: { name, icon, description, color, sortOrder, stationId: idResult },
  })

  try {
    await repos.receipts.append(receipt.id, { stream: 'stdout', chunk: `Creating station "${name}"...\n` })

    const station = await repos.stations.create({
      id: idResult,
      name,
      icon,
      description: description ?? null,
      color: color ?? null,
      sortOrder: sortOrder ?? 0,
    })

    await repos.receipts.finalize(receipt.id, {
      exitCode: 0,
      durationMs: 0,
      parsedJson: { station },
    })

    await repos.activities.create({
      type: 'station.created',
      actor: 'user',
      entityType: 'station',
      entityId: station.id,
      summary: `Created station: ${station.name}`,
      payloadJson: {
        receiptId: receipt.id,
        before: null,
        after: station,
      },
    })

    return NextResponse.json({ data: station, receiptId: receipt.id }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create station'
    await repos.receipts.append(receipt.id, { stream: 'stderr', chunk: `Error: ${message}\n` })
    await repos.receipts.finalize(receipt.id, {
      exitCode: 1,
      durationMs: 0,
      parsedJson: { error: message },
    })
    return NextResponse.json({ error: 'CREATE_FAILED', message, receiptId: receipt.id }, { status: 500 })
  }
}
