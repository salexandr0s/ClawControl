/**
 * Models API Route
 *
 * GET /api/models - List models and status
 * POST /api/models - Run model operations (list all, probe status)
 */

import { NextRequest, NextResponse } from 'next/server'
import { runCommandJson } from '@clawcontrol/adapters-openclaw'
import { withRouteTiming } from '@/lib/perf/route-timing'
import { getOrLoadWithCache, invalidateAsyncCache } from '@/lib/perf/async-cache'
import { classifyOpenClawError } from '@/lib/openclaw/error-shape'

// ============================================================================
// TYPES
// ============================================================================

interface ModelListItem {
  key: string
  name: string
  input: string
  contextWindow: number
  local: boolean
  available: boolean
  tags: string[]
  missing: boolean
}

interface _ModelListResponse {
  count: number
  models: ModelListItem[]
}

interface AuthProfile {
  profileId: string
  provider: string
  type: 'oauth' | 'token' | 'apiKey'
  status: 'ok' | 'expiring' | 'expired' | 'missing' | 'static'
  expiresAt?: number
  remainingMs?: number
  source: string
  label: string
}

interface ProviderAuth {
  provider: string
  status: 'ok' | 'expiring' | 'expired' | 'missing'
  profiles: AuthProfile[]
  expiresAt?: number
  remainingMs?: number
}

interface ModelStatusResponse {
  configPath: string
  agentDir: string
  defaultModel: string
  resolvedDefault: string
  fallbacks: string[]
  imageModel: string | null
  imageFallbacks: string[]
  aliases: Record<string, string>
  allowed: string[]
  auth: {
    storePath: string
    shellEnvFallback: {
      enabled: boolean
      appliedKeys: string[]
    }
    providersWithOAuth: string[]
    missingProvidersInUse: string[]
    providers: {
      provider: string
      effective: {
        kind: string
        detail: string
      }
      profiles: {
        count: number
        oauth: number
        token: number
        apiKey: number
        labels: string[]
      }
    }[]
    unusableProfiles: string[]
    oauth: {
      warnAfterMs: number
      profiles: AuthProfile[]
      providers: ProviderAuth[]
    }
  }
}

// ============================================================================
// GET - Get model status
// ============================================================================

const MODELS_STATUS_TTL_MS = 15_000
const MODELS_LIST_TTL_MS = 15_000

function failureDetails(error: string, options: { parseFailed?: boolean } = {}) {
  return classifyOpenClawError(error, options)
}

const getModels = async () => {
  try {
    const { value: statusResult, cacheHit, sharedInFlight } = await getOrLoadWithCache(
      'api.models.get:models.status.json',
      MODELS_STATUS_TTL_MS,
      async () => runCommandJson<ModelStatusResponse>('models.status.json')
    )

    if (statusResult.error || !statusResult.data) {
      const details = failureDetails(
        statusResult.error ?? 'Failed to parse model status JSON',
        { parseFailed: !statusResult.error && !statusResult.data }
      )
      return NextResponse.json(
        {
          error: 'Failed to get model status',
          details: statusResult.error ?? null,
          code: details.code,
          ...(details.fixHint ? { fixHint: details.fixHint } : {}),
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      data: {
        status: statusResult.data,
        cache: {
          cacheHit,
          sharedInFlight,
        },
      },
    })
  } catch (err) {
    console.error('Models API error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
export const GET = withRouteTiming('api.models.get', getModels)

// ============================================================================
// POST - Run model operations
// ============================================================================

const postModels = async (request: NextRequest) => {
  try {
    const body = await request.json()
    const { action } = body as { action: 'list' | 'list-all' | 'status' | 'probe' }

    let result: { data?: unknown; error?: string; exitCode: number }
    let cacheMeta: { cacheHit: boolean; sharedInFlight: boolean } | null = null
    switch (action) {
      case 'list':
        {
          const cached = await getOrLoadWithCache(
            'api.models.post:models.list.json',
            MODELS_LIST_TTL_MS,
            async () => runCommandJson('models.list.json')
          )
          result = cached.value
          cacheMeta = {
            cacheHit: cached.cacheHit,
            sharedInFlight: cached.sharedInFlight,
          }
        }
        break
      case 'list-all':
        {
          const cached = await getOrLoadWithCache(
            'api.models.post:models.list.all.json',
            MODELS_LIST_TTL_MS,
            async () => runCommandJson('models.list.all.json')
          )
          result = cached.value
          cacheMeta = {
            cacheHit: cached.cacheHit,
            sharedInFlight: cached.sharedInFlight,
          }
        }
        break
      case 'status':
        {
          const cached = await getOrLoadWithCache(
            'api.models.post:models.status.json',
            MODELS_STATUS_TTL_MS,
            async () => runCommandJson('models.status.json')
          )
          result = cached.value
          cacheMeta = {
            cacheHit: cached.cacheHit,
            sharedInFlight: cached.sharedInFlight,
          }
        }
        break
      case 'probe':
        invalidateAsyncCache('api.models.get:models.status.json')
        invalidateAsyncCache('api.models.post:models.status.json')
        invalidateAsyncCache('api.models.post:models.list.json')
        invalidateAsyncCache('api.models.post:models.list.all.json')
        result = await runCommandJson('models.status.probe.json')
        break
      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        )
    }

    if (result.error) {
      const details = failureDetails(result.error)
      return NextResponse.json(
        {
          error: `Command failed: ${result.error}`,
          code: details.code,
          ...(details.fixHint ? { fixHint: details.fixHint } : {}),
        },
        { status: 500 }
      )
    }

    if (result.data === undefined) {
      const details = failureDetails('Failed to parse JSON output', { parseFailed: true })
      return NextResponse.json(
        {
          error: 'Failed to parse JSON output',
          code: details.code,
          ...(details.fixHint ? { fixHint: details.fixHint } : {}),
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      data: result.data,
      ...(cacheMeta
        ? {
            meta: {
              cache: cacheMeta,
            },
          }
        : {}),
    })
  } catch (err) {
    console.error('Models API POST error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
export const POST = withRouteTiming('api.models.post', postModels)
