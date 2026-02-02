import { NextRequest, NextResponse } from 'next/server'
import { enforceTypedConfirm } from '@/lib/with-governor'
import { getRepos } from '@/lib/repo'
import {
  executeCommand,
  isAllowedCommand,
  getCommandSpec,
  type AllowedCommandId,
} from '@savorgos/adapters-openclaw'
import type { ActionKind } from '@savorgos/core'

// Map action paths to command IDs and Governor action kinds
const ACTION_MAP: Record<string, {
  commandId: AllowedCommandId
  actionKind: ActionKind
  activityType: string
}> = {
  'health': {
    commandId: 'health.json',
    actionKind: 'maintenance.health_check',
    activityType: 'maintenance.health_checked',
  },
  'status': {
    commandId: 'status.json',
    actionKind: 'maintenance.health_check',
    activityType: 'maintenance.status_checked',
  },
  'doctor': {
    commandId: 'doctor.json',
    actionKind: 'doctor.run',
    activityType: 'maintenance.doctor_ran',
  },
  'doctor-fix': {
    commandId: 'doctor.fix',
    actionKind: 'doctor.fix',
    activityType: 'maintenance.doctor_fix_ran',
  },
  'gateway-restart': {
    commandId: 'gateway.restart',
    actionKind: 'gateway.restart',
    activityType: 'maintenance.gateway_restarted',
  },
  // New documented commands (see docs/audit/openclaw-command-allowlist.md)
  'security-audit': {
    commandId: 'security.audit',
    actionKind: 'security.audit',
    activityType: 'maintenance.security_audit_ran',
  },
  'security-audit-deep': {
    commandId: 'security.audit.deep',
    actionKind: 'security.audit',
    activityType: 'maintenance.security_audit_ran',
  },
  'security-audit-fix': {
    commandId: 'security.audit.fix',
    actionKind: 'security.audit.fix',
    activityType: 'maintenance.security_audit_fix_ran',
  },
  'status-all': {
    commandId: 'status.all',
    actionKind: 'maintenance.health_check',
    activityType: 'maintenance.status_checked',
  },
  'gateway-discover': {
    commandId: 'gateway.discover',
    actionKind: 'gateway.discover',
    activityType: 'maintenance.gateway_discovered',
  },
}

/**
 * POST /api/maintenance/:action
 * Execute a maintenance action with receipt streaming
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ action: string }> }
) {
  const { action } = await params

  // Validate action exists
  const actionConfig = ACTION_MAP[action]
  if (!actionConfig) {
    return NextResponse.json(
      { error: `Unknown action: ${action}` },
      { status: 400 }
    )
  }

  // Validate command is in allowlist
  if (!isAllowedCommand(actionConfig.commandId)) {
    return NextResponse.json(
      { error: `Command not allowed: ${actionConfig.commandId}` },
      { status: 403 }
    )
  }

  // Get typed confirm from body
  let typedConfirmText: string | undefined
  try {
    const body = await request.json()
    typedConfirmText = body.typedConfirmText
  } catch {
    // Body might be empty
  }

  // Enforce Governor gating
  const result = await enforceTypedConfirm({
    actionKind: actionConfig.actionKind,
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
  const commandSpec = getCommandSpec(actionConfig.commandId)

  // Create a receipt for this command
  const receipt = await repos.receipts.create({
    workOrderId: 'system',
    kind: 'manual',
    commandName: `maintenance.${action}`,
    commandArgs: {
      action,
      commandId: actionConfig.commandId,
      description: commandSpec.description,
    },
  })

  // Execute the command and collect output
  let stdout = ''
  let stderr = ''
  let exitCode = 0

  try {
    const startTime = Date.now()

    // Stream command output and append to receipt
    for await (const chunk of executeCommand(actionConfig.commandId)) {
      if (chunk.type === 'stdout') {
        stdout += chunk.chunk
        await repos.receipts.append(receipt.id, { stream: 'stdout', chunk: chunk.chunk })
      } else if (chunk.type === 'stderr') {
        stderr += chunk.chunk
        await repos.receipts.append(receipt.id, { stream: 'stderr', chunk: chunk.chunk })
      } else if (chunk.type === 'exit') {
        exitCode = chunk.code
      }
    }

    const durationMs = Date.now() - startTime

    // Parse JSON output if applicable
    let parsedJson: Record<string, unknown> | undefined
    if (actionConfig.commandId.endsWith('.json') && stdout) {
      try {
        parsedJson = JSON.parse(stdout)
      } catch {
        // Not valid JSON, that's OK
      }
    }

    // Finalize receipt
    await repos.receipts.finalize(receipt.id, {
      exitCode,
      durationMs,
      parsedJson: parsedJson || {
        action,
        exitCode,
        hasOutput: !!stdout,
        hasErrors: !!stderr,
      },
    })

    // Log activity
    await repos.activities.create({
      type: actionConfig.activityType,
      actor: 'user',
      entityType: 'system',
      entityId: 'gateway',
      summary: `Ran ${commandSpec.description}`,
      payloadJson: {
        action,
        commandId: actionConfig.commandId,
        exitCode,
        receiptId: receipt.id,
      },
    })

    return NextResponse.json({
      data: {
        action,
        exitCode,
        stdout,
        stderr,
        parsedJson,
        receiptId: receipt.id,
      },
    })
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Command execution failed'

    // Finalize receipt with error
    await repos.receipts.finalize(receipt.id, {
      exitCode: 1,
      durationMs: 0,
      parsedJson: {
        action,
        error: errorMessage,
      },
    })

    return NextResponse.json(
      {
        error: errorMessage,
        receiptId: receipt.id,
      },
      { status: 500 }
    )
  }
}
