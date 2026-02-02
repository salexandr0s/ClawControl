import { NextRequest, NextResponse } from 'next/server'
import { mockPlugins } from '@savorgos/core'
import { enforceTypedConfirm } from '@/lib/with-governor'
import { getRepos } from '@/lib/repo'

/**
 * POST /api/plugins/restart
 * Queue a restart to apply plugin changes (danger level, requires approval)
 */
export async function POST(request: NextRequest) {
  // Get typed confirm from body
  let typedConfirmText: string | undefined
  try {
    const body = await request.json()
    typedConfirmText = body.typedConfirmText
  } catch {
    // Body might be empty
  }

  // Find plugins that require restart
  const pluginsNeedingRestart = mockPlugins.filter((p) => p.restartRequired)

  if (pluginsNeedingRestart.length === 0) {
    return NextResponse.json(
      { error: 'No plugins require restart' },
      { status: 400 }
    )
  }

  // Enforce Governor - plugin.restart is danger level
  const result = await enforceTypedConfirm({
    actionKind: 'plugin.restart',
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

  // Create a receipt for the restart operation
  const receipt = await repos.receipts.create({
    workOrderId: 'system',
    kind: 'manual',
    commandName: 'plugin.restart',
    commandArgs: {
      pluginCount: pluginsNeedingRestart.length,
      pluginNames: pluginsNeedingRestart.map((p) => p.name),
    },
  })

  // Simulate restart process - clear restartRequired flags
  const restartedPlugins: string[] = []
  for (let i = 0; i < mockPlugins.length; i++) {
    if (mockPlugins[i].restartRequired) {
      restartedPlugins.push(mockPlugins[i].name)
      mockPlugins[i] = {
        ...mockPlugins[i],
        restartRequired: false,
        updatedAt: new Date(),
      }
    }
  }

  // Finalize receipt
  await repos.receipts.finalize(receipt.id, {
    exitCode: 0,
    durationMs: 3000 + Math.random() * 2000, // Simulate 3-5s restart
    parsedJson: {
      status: 'restarted',
      pluginsRestarted: restartedPlugins,
      message: `Successfully restarted ${restartedPlugins.length} plugin(s)`,
    },
  })

  // Log activity
  await repos.activities.create({
    type: 'plugin.restarted',
    actor: 'user',
    entityType: 'plugin',
    entityId: 'system',
    summary: `Restarted ${restartedPlugins.length} plugin(s) to apply configuration changes`,
    payloadJson: {
      pluginsRestarted: restartedPlugins,
      receiptId: receipt.id,
    },
  })

  return NextResponse.json({
    data: {
      status: 'restarted',
      pluginsRestarted: restartedPlugins,
      message: `Successfully restarted ${restartedPlugins.length} plugin(s)`,
    },
    receiptId: receipt.id,
  })
}
