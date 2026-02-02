import { NextRequest, NextResponse } from 'next/server'
import { mockPlugins } from '@savorgos/core'
import { enforceTypedConfirm } from '@/lib/with-governor'
import { getRepos } from '@/lib/repo'
import type { PluginDoctorResult, PluginDoctorCheck } from '@savorgos/core'

function findPluginIndex(id: string) {
  return mockPlugins.findIndex((p) => p.id === id)
}

/**
 * Simulate running plugin doctor checks
 * In production, this would call openclaw doctor
 */
function runDoctorChecks(pluginName: string): PluginDoctorCheck[] {
  // Simulate different results based on plugin
  const baseChecks: PluginDoctorCheck[] = [
    {
      name: 'Module Load',
      status: 'pass',
      message: 'Plugin module loaded successfully',
    },
    {
      name: 'Dependencies',
      status: 'pass',
      message: 'All dependencies satisfied',
    },
  ]

  // Add plugin-specific checks
  if (pluginName === 'github-integration') {
    baseChecks.push(
      {
        name: 'API Connection',
        status: 'pass',
        message: 'GitHub API reachable',
      },
      {
        name: 'Authentication',
        status: 'pass',
        message: 'Token valid',
      },
      {
        name: 'Rate Limit',
        status: 'warn',
        message: 'Rate limit at 75%',
        details: 'Consider reducing API call frequency',
      }
    )
  } else if (pluginName === 'slack-notifications') {
    baseChecks.push(
      {
        name: 'Webhook',
        status: 'fail',
        message: 'Webhook URL invalid or expired',
        details: 'Received 404 response from Slack',
      },
      {
        name: 'Channel Access',
        status: 'fail',
        message: 'Cannot access configured channel',
        details: 'Bot may have been removed from #alerts',
      }
    )
  } else if (pluginName === 'database-tools') {
    baseChecks.push(
      {
        name: 'Connection',
        status: 'fail',
        message: 'Cannot connect to database',
        details: 'Connection refused: localhost:5432',
      }
    )
  } else {
    baseChecks.push({
      name: 'Health Check',
      status: 'pass',
      message: 'Plugin responding normally',
    })
  }

  return baseChecks
}

function computeDoctorStatus(checks: PluginDoctorCheck[]): PluginDoctorResult['status'] {
  const hasFail = checks.some((c) => c.status === 'fail')
  const hasWarn = checks.some((c) => c.status === 'warn')

  if (hasFail) return 'unhealthy'
  if (hasWarn) return 'warning'
  return 'healthy'
}

function computeSummary(checks: PluginDoctorCheck[]): string {
  const fails = checks.filter((c) => c.status === 'fail').length
  const warns = checks.filter((c) => c.status === 'warn').length

  if (fails === 0 && warns === 0) return 'All checks passed'
  const parts: string[] = []
  if (fails > 0) parts.push(`${fails} failed`)
  if (warns > 0) parts.push(`${warns} warning${warns > 1 ? 's' : ''}`)
  return parts.join(', ')
}

/**
 * POST /api/plugins/:id/doctor
 * Run plugin diagnostics
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const pluginIndex = findPluginIndex(id)

  if (pluginIndex === -1) {
    return NextResponse.json({ error: 'Plugin not found' }, { status: 404 })
  }

  // Get typed confirm from body
  let typedConfirmText: string | undefined
  try {
    const body = await request.json()
    typedConfirmText = body.typedConfirmText
  } catch {
    // Body might be empty
  }

  // Enforce Governor - plugin.doctor is caution level
  const result = await enforceTypedConfirm({
    actionKind: 'plugin.doctor',
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

  const plugin = mockPlugins[pluginIndex]

  // Run doctor checks (simulated)
  const checks = runDoctorChecks(plugin.name)
  const status = computeDoctorStatus(checks)
  const summary = computeSummary(checks)

  // Create a receipt for the doctor run
  const repos = getRepos()
  const receipt = await repos.receipts.create({
    workOrderId: 'system', // Standalone operation not tied to a work order
    kind: 'manual',
    commandName: 'plugin.doctor',
    commandArgs: { pluginId: id, pluginName: plugin.name },
  })

  // Finalize receipt immediately (in production, this would stream output)
  await repos.receipts.finalize(receipt.id, {
    exitCode: status === 'unhealthy' ? 1 : 0,
    durationMs: 1200 + Math.random() * 800, // Simulate 1.2-2s
    parsedJson: { checks, status, summary },
  })

  // Build doctor result
  const doctorResult: PluginDoctorResult = {
    status,
    checks,
    summary,
    checkedAt: new Date(),
    receiptId: receipt.id,
  }

  // Update plugin with doctor result
  mockPlugins[pluginIndex] = {
    ...plugin,
    doctorResult,
    // Update status based on doctor result if currently in error
    status: status === 'unhealthy' ? 'error' : (plugin.enabled ? 'active' : 'inactive'),
    lastError: status === 'unhealthy' ? summary : undefined,
    updatedAt: new Date(),
  }

  // Log activity
  await repos.activities.create({
    type: 'plugin.doctor_ran',
    actor: 'user',
    entityType: 'plugin',
    entityId: id,
    summary: `Ran doctor for plugin: ${plugin.name} (${status})`,
    payloadJson: {
      pluginName: plugin.name,
      version: plugin.version,
      status,
      checkCount: checks.length,
      receiptId: receipt.id,
    },
  })

  return NextResponse.json({
    data: {
      doctorResult,
      receiptId: receipt.id,
    },
  })
}
