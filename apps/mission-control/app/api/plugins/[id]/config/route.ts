import { NextRequest, NextResponse } from 'next/server'
import { mockPlugins, mockPluginConfigs } from '@savorg/core'
import { enforceTypedConfirm } from '@/lib/with-governor'
import { getRepos } from '@/lib/repo'
import Ajv from 'ajv'

const ajv = new Ajv({ allErrors: true, strict: false })

function findPluginIndex(id: string) {
  return mockPlugins.findIndex((p) => p.id === id)
}

/**
 * Validate config against schema if available
 */
function validateConfig(
  config: Record<string, unknown>,
  schema: Record<string, unknown> | undefined
): { valid: boolean; errors?: string[] } {
  if (!schema) {
    // No schema, accept any config
    return { valid: true }
  }

  try {
    const validate = ajv.compile(schema)
    const valid = validate(config)

    if (!valid && validate.errors) {
      const errors = validate.errors.map((e) => {
        const path = e.instancePath || '(root)'
        return `${path}: ${e.message}`
      })
      return { valid: false, errors }
    }

    return { valid: true }
  } catch {
    return { valid: false, errors: ['Invalid schema'] }
  }
}

/**
 * PUT /api/plugins/:id/config
 * Update plugin configuration (danger level, requires approval)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const pluginIndex = findPluginIndex(id)

  if (pluginIndex === -1) {
    return NextResponse.json({ error: 'Plugin not found' }, { status: 404 })
  }

  const body = await request.json()
  const { config, typedConfirmText } = body

  if (!config || typeof config !== 'object') {
    return NextResponse.json(
      { error: 'Config must be a JSON object' },
      { status: 400 }
    )
  }

  const plugin = mockPlugins[pluginIndex]

  // Validate against schema if available
  if (plugin.configSchema) {
    const validation = validateConfig(config, plugin.configSchema as unknown as Record<string, unknown>)
    if (!validation.valid) {
      return NextResponse.json(
        {
          error: 'CONFIG_VALIDATION_FAILED',
          message: 'Config does not match schema',
          validationErrors: validation.errors,
        },
        { status: 422 }
      )
    }
  }

  // Enforce Governor - plugin.edit_config is danger level
  const result = await enforceTypedConfirm({
    actionKind: 'plugin.edit_config',
    typedConfirmText,
  })

  if (!result.allowed) {
    return NextResponse.json(
      {
        error: result.errorType,
        policy: result.policy,
      },
      { status: result.errorType === 'TYPED_CONFIRM_REQUIRED' ? 428 : 403 }
    )
  }

  const repos = getRepos()

  // Create a receipt for the config update
  const receipt = await repos.receipts.create({
    workOrderId: 'system',
    kind: 'manual',
    commandName: 'plugin.config_update',
    commandArgs: {
      pluginId: id,
      pluginName: plugin.name,
    },
  })

  // Update config
  mockPluginConfigs[id] = config

  // Update plugin record
  mockPlugins[pluginIndex] = {
    ...plugin,
    hasConfig: true,
    configJson: config,
    restartRequired: true, // Config changes require restart
    updatedAt: new Date(),
  }

  // Finalize receipt
  await repos.receipts.finalize(receipt.id, {
    exitCode: 0,
    durationMs: 100 + Math.random() * 100,
    parsedJson: {
      pluginId: id,
      pluginName: plugin.name,
      status: 'config_updated',
      hasSchema: !!plugin.configSchema,
    },
  })

  // Log activity
  await repos.activities.create({
    type: 'plugin.config_updated',
    actor: 'user',
    entityType: 'plugin',
    entityId: id,
    summary: `Updated config for plugin: ${plugin.name}`,
    payloadJson: {
      pluginName: plugin.name,
      version: plugin.version,
      receiptId: receipt.id,
    },
  })

  const updatedPlugin = mockPlugins[pluginIndex]

  return NextResponse.json({
    data: {
      ...updatedPlugin,
      configJson: mockPluginConfigs[id] ?? {},
    },
    receiptId: receipt.id,
  })
}
