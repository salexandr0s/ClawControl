import { NextRequest, NextResponse } from 'next/server'
import { mockPlugins, mockPluginConfigs } from '@savorgos/core'
import { enforceTypedConfirm } from '@/lib/with-governor'
import { getRepos } from '@/lib/repo'
import type { ActionKind } from '@savorgos/core'

function findPlugin(id: string) {
  return mockPlugins.find((p) => p.id === id)
}

function findPluginIndex(id: string) {
  return mockPlugins.findIndex((p) => p.id === id)
}

/**
 * GET /api/plugins/:id
 * Get plugin details with config
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const plugin = findPlugin(id)

  if (!plugin) {
    return NextResponse.json({ error: 'Plugin not found' }, { status: 404 })
  }

  // Return full plugin data including config
  return NextResponse.json({
    data: {
      ...plugin,
      configJson: mockPluginConfigs[id] ?? {},
    },
  })
}

/**
 * PATCH /api/plugins/:id
 * Update plugin (enable/disable)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const pluginIndex = findPluginIndex(id)

  if (pluginIndex === -1) {
    return NextResponse.json({ error: 'Plugin not found' }, { status: 404 })
  }

  const body = await request.json()
  const { enabled, typedConfirmText } = body

  const plugin = mockPlugins[pluginIndex]

  // Determine action kind
  let actionKind: ActionKind = 'action.safe'
  if (typeof enabled === 'boolean') {
    actionKind = enabled ? 'plugin.enable' : 'plugin.disable'
  }

  // Enforce Governor
  const result = await enforceTypedConfirm({
    actionKind,
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

  // Update enabled state
  if (typeof enabled === 'boolean') {
    mockPlugins[pluginIndex] = {
      ...plugin,
      enabled,
      status: enabled ? 'active' : 'inactive',
      updatedAt: new Date(),
    }

    // Log activity
    const repos = getRepos()
    await repos.activities.create({
      type: enabled ? 'plugin.enabled' : 'plugin.disabled',
      actor: 'user',
      entityType: 'plugin',
      entityId: id,
      summary: `${enabled ? 'Enabled' : 'Disabled'} plugin: ${plugin.name}`,
      payloadJson: {
        pluginName: plugin.name,
        version: plugin.version,
        enabled,
      },
    })
  }

  const updatedPlugin = mockPlugins[pluginIndex]

  return NextResponse.json({
    data: {
      ...updatedPlugin,
      configJson: mockPluginConfigs[id] ?? {},
    },
  })
}

/**
 * DELETE /api/plugins/:id
 * Uninstall a plugin (danger level, requires approval)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const pluginIndex = findPluginIndex(id)

  if (pluginIndex === -1) {
    return NextResponse.json({ error: 'Plugin not found' }, { status: 404 })
  }

  const plugin = mockPlugins[pluginIndex]

  // Get typed confirm from body
  let typedConfirmText: string | undefined
  try {
    const body = await request.json()
    typedConfirmText = body.typedConfirmText
  } catch {
    // Body might be empty
  }

  // Enforce Governor - plugin.uninstall is danger level
  const result = await enforceTypedConfirm({
    actionKind: 'plugin.uninstall',
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

  // Create a receipt for the uninstall attempt
  const receipt = await repos.receipts.create({
    workOrderId: 'system',
    kind: 'manual',
    commandName: 'plugin.uninstall',
    commandArgs: {
      pluginId: id,
      pluginName: plugin.name,
      version: plugin.version,
    },
  })

  // Remove plugin from mock array
  mockPlugins.splice(pluginIndex, 1)

  // Remove config if exists
  if (mockPluginConfigs[id]) {
    delete mockPluginConfigs[id]
  }

  // Finalize receipt with success
  await repos.receipts.finalize(receipt.id, {
    exitCode: 0,
    durationMs: 1000 + Math.random() * 500, // Simulate 1-1.5s uninstall
    parsedJson: {
      pluginId: id,
      pluginName: plugin.name,
      status: 'removed',
    },
  })

  // Log activity
  await repos.activities.create({
    type: 'plugin.removed',
    actor: 'user',
    entityType: 'plugin',
    entityId: id,
    summary: `Uninstalled plugin: ${plugin.name}`,
    payloadJson: {
      pluginName: plugin.name,
      version: plugin.version,
      receiptId: receipt.id,
    },
  })

  return NextResponse.json({
    success: true,
    receiptId: receipt.id,
  })
}
