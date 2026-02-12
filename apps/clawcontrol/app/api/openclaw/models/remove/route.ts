import { NextRequest, NextResponse } from 'next/server'
import { runCommandJson, runDynamicCommand } from '@clawcontrol/adapters-openclaw'
import { invalidateAsyncCache } from '@/lib/perf/async-cache'

type ModelListResponse = {
  models?: Array<{
    key?: string
    tags?: string[]
  }>
}

type RemovalAction =
  | {
      kind: 'fallback'
      command: 'models.fallbacks.remove'
      params: { model: string }
      dedupeKey: string
    }
  | {
      kind: 'alias'
      command: 'models.aliases.remove'
      params: { alias: string }
      dedupeKey: string
    }

type ConfiguredModelEntry = {
  key: string
  tags: string[]
}

const PROVIDER_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/
const MODEL_KEY_RE = /^[a-zA-Z0-9._:/-]{1,256}$/

function invalidateModelCaches() {
  invalidateAsyncCache('api.models.get:models.status.json')
  invalidateAsyncCache('api.models.post:models.status.json')
  invalidateAsyncCache('api.models.post:models.list.json')
  invalidateAsyncCache('api.models.post:models.list.all.json')
}

function parseConfiguredModels(payload: ModelListResponse | undefined): ConfiguredModelEntry[] {
  if (!payload?.models) return []

  return payload.models.flatMap((model) => {
    const key = typeof model.key === 'string' ? model.key.trim() : ''
    if (!key) return []
    const tags = Array.isArray(model.tags)
      ? model.tags.filter((tag): tag is string => typeof tag === 'string')
      : []
    return [{ key, tags }]
  })
}

function getAliasTag(tags: string[]): string | null {
  const aliasTag = tags.find((tag) => tag.startsWith('alias:'))
  if (!aliasTag) return null
  const alias = aliasTag.slice('alias:'.length).trim()
  return alias.length > 0 ? alias : null
}

function deriveRemovalActions(model: ConfiguredModelEntry): {
  actions: RemovalAction[]
  blockedReason?: string
} {
  if (model.tags.includes('default')) {
    return {
      actions: [],
      blockedReason:
        `Cannot remove "${model.key}" because it is currently the default model. ` +
        'Set another default model first.',
    }
  }

  const actions: RemovalAction[] = []

  if (model.tags.some((tag) => tag.startsWith('fallback'))) {
    actions.push({
      kind: 'fallback',
      command: 'models.fallbacks.remove',
      params: { model: model.key },
      dedupeKey: `fallback:${model.key}`,
    })
  }

  const alias = getAliasTag(model.tags)
  if (alias) {
    actions.push({
      kind: 'alias',
      command: 'models.aliases.remove',
      params: { alias },
      dedupeKey: `alias:${alias}`,
    })
  }

  if (actions.length === 0) {
    return {
      actions: [],
      blockedReason:
        `Model "${model.key}" cannot be removed directly here. ` +
        'Only fallback and alias entries support in-place removal.',
    }
  }

  return { actions }
}

async function loadConfiguredModels(): Promise<{ models?: ConfiguredModelEntry[]; error?: string }> {
  const result = await runCommandJson<ModelListResponse>('models.list.json')

  if (result.error) {
    return { error: result.error }
  }

  return { models: parseConfiguredModels(result.data) }
}

function dedupeActions(actions: RemovalAction[]): RemovalAction[] {
  const seen = new Set<string>()
  const unique: RemovalAction[] = []

  for (const action of actions) {
    if (seen.has(action.dedupeKey)) continue
    seen.add(action.dedupeKey)
    unique.push(action)
  }

  return unique
}

async function executeRemovalActions(actions: RemovalAction[]): Promise<{ error?: string }> {
  for (const action of actions) {
    const result = await runDynamicCommand(action.command, action.params)
    if (result.exitCode !== 0) {
      const details = result.error || result.stderr.trim() || `Command failed: ${action.command}`
      return { error: details }
    }
  }

  return {}
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    )
  }
  const mode = body.mode

  if (mode !== 'model' && mode !== 'provider') {
    return NextResponse.json(
      { error: 'mode must be model or provider' },
      { status: 400 }
    )
  }

  const loaded = await loadConfiguredModels()
  if (!loaded.models) {
    return NextResponse.json(
      { error: loaded.error || 'Failed to load configured models' },
      { status: 500 }
    )
  }

  if (mode === 'model') {
    const modelKey = typeof body.modelKey === 'string' ? body.modelKey.trim() : ''
    if (!modelKey || !MODEL_KEY_RE.test(modelKey)) {
      return NextResponse.json(
        { error: 'modelKey is required and must be a valid model id' },
        { status: 400 }
      )
    }

    const target = loaded.models.find((model) => model.key === modelKey)
    if (!target) {
      return NextResponse.json(
        { error: `Model "${modelKey}" is not configured` },
        { status: 404 }
      )
    }

    const derived = deriveRemovalActions(target)
    if (derived.actions.length === 0) {
      return NextResponse.json(
        {
          error: derived.blockedReason || 'Model cannot be removed',
          code: 'MODEL_REMOVE_BLOCKED',
        },
        { status: 409 }
      )
    }

    const execution = await executeRemovalActions(derived.actions)
    if (execution.error) {
      return NextResponse.json(
        {
          error: execution.error,
          code: 'MODEL_REMOVE_FAILED',
        },
        { status: 500 }
      )
    }

    invalidateModelCaches()

    return NextResponse.json({
      data: {
        mode: 'model' as const,
        modelKey,
        provider: modelKey.split('/')[0] || null,
        removedActions: derived.actions.length,
      },
    })
  }

  const provider = typeof body.provider === 'string' ? body.provider.trim() : ''
  if (!provider || !PROVIDER_ID_RE.test(provider)) {
    return NextResponse.json(
      { error: 'provider is required and must be a valid provider id' },
      { status: 400 }
    )
  }

  const providerModels = loaded.models.filter((model) => model.key.startsWith(`${provider}/`))
  if (providerModels.length === 0) {
    return NextResponse.json({
      data: {
        mode: 'provider' as const,
        provider,
        removedModels: 0,
        removedActions: 0,
      },
    })
  }

  if (providerModels.some((model) => model.tags.includes('default'))) {
    return NextResponse.json(
      {
        error:
          `Cannot clear provider "${provider}" because one of its models is the current default. ` +
          'Set a different default model first.',
        code: 'PROVIDER_REMOVE_BLOCKED',
      },
      { status: 409 }
    )
  }

  const providerRemovals = providerModels
    .map((model) => ({ model, derived: deriveRemovalActions(model) }))

  const removableModelKeys = providerRemovals
    .filter((entry) => entry.derived.actions.length > 0)
    .map((entry) => entry.model.key)

  const actions = dedupeActions(
    providerRemovals.flatMap((entry) => entry.derived.actions)
  )

  if (actions.length === 0) {
    return NextResponse.json({
      data: {
        mode: 'provider' as const,
        provider,
        removedModels: 0,
        removedActions: 0,
      },
    })
  }

  const execution = await executeRemovalActions(actions)
  if (execution.error) {
    return NextResponse.json(
      {
        error: execution.error,
        code: 'PROVIDER_REMOVE_FAILED',
      },
      { status: 500 }
    )
  }

  invalidateModelCaches()

  return NextResponse.json({
    data: {
      mode: 'provider' as const,
      provider,
      removedModels: removableModelKeys.length,
      removedActions: actions.length,
    },
  })
}
