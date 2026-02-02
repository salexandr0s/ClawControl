import { NextRequest, NextResponse } from 'next/server'
import { enforceTypedConfirm } from '@/lib/with-governor'
import { getRepos } from '@/lib/repo'
import {
  executeCommand,
  runCommandJson,
  checkOpenClawAvailable,
} from '@savorgos/adapters-openclaw'

/**
 * Recovery Playbook Steps
 */
type RecoveryStep =
  | 'check_availability'
  | 'health_check'
  | 'doctor_run'
  | 'doctor_fix'
  | 'gateway_restart'
  | 'health_recheck'
  | 'complete'
  | 'failed'

interface RecoveryState {
  currentStep: RecoveryStep
  steps: Array<{
    step: RecoveryStep
    status: 'pending' | 'running' | 'success' | 'failed' | 'skipped'
    message?: string
    receiptId?: string
  }>
  finalStatus: 'healthy' | 'recovered' | 'needs_manual_intervention' | 'failed' | null
}

/**
 * POST /api/maintenance/recover
 * Run the gateway recovery playbook with branching logic:
 * 1. Check CLI availability
 * 2. Health check → if OK, done
 * 3. If health fails → run doctor
 * 4. If doctor finds issues → run doctor --fix
 * 5. Restart gateway
 * 6. Re-run health check
 * 7. If still failing → escalate to manual intervention
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

  // Enforce Governor - recovery is danger level
  const result = await enforceTypedConfirm({
    actionKind: 'maintenance.recover_gateway',
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

  // Create a parent receipt for the entire recovery flow
  const parentReceipt = await repos.receipts.create({
    workOrderId: 'system',
    kind: 'manual',
    commandName: 'maintenance.recover_gateway',
    commandArgs: { type: 'playbook', name: 'gateway-recovery' },
  })

  const state: RecoveryState = {
    currentStep: 'check_availability',
    steps: [
      { step: 'check_availability', status: 'pending' },
      { step: 'health_check', status: 'pending' },
      { step: 'doctor_run', status: 'pending' },
      { step: 'doctor_fix', status: 'pending' },
      { step: 'gateway_restart', status: 'pending' },
      { step: 'health_recheck', status: 'pending' },
    ],
    finalStatus: null,
  }

  const receipts: string[] = [parentReceipt.id]

  // Helper to update step status
  const updateStep = (step: RecoveryStep, status: RecoveryState['steps'][0]['status'], message?: string, receiptId?: string) => {
    const stepObj = state.steps.find(s => s.step === step)
    if (stepObj) {
      stepObj.status = status
      if (message) stepObj.message = message
      if (receiptId) {
        stepObj.receiptId = receiptId
        receipts.push(receiptId)
      }
    }
  }

  // Helper to append to parent receipt
  const log = async (message: string) => {
    await repos.receipts.append(parentReceipt.id, { stream: 'stdout', chunk: message + '\n' })
  }

  try {
    // Step 1: Check CLI availability
    await log('=== Gateway Recovery Playbook ===')
    await log('')
    await log('[1/6] Checking OpenClaw CLI availability...')
    updateStep('check_availability', 'running')

    const cliCheck = await checkOpenClawAvailable()
    if (!cliCheck.available) {
      updateStep('check_availability', 'failed', cliCheck.error || 'CLI not available')
      await log(`  FAILED: ${cliCheck.error}`)
      state.finalStatus = 'failed'

      // Skip remaining steps
      state.steps.filter(s => s.status === 'pending').forEach(s => s.status = 'skipped')

      await repos.receipts.finalize(parentReceipt.id, {
        exitCode: 1,
        durationMs: 0,
        parsedJson: { state, error: 'OpenClaw CLI not available' },
      })

      await repos.activities.create({
        type: 'maintenance.recover_failed',
        actor: 'user',
        entityType: 'system',
        entityId: 'gateway',
        summary: 'Gateway recovery failed: OpenClaw CLI not available',
        payloadJson: { state, receiptIds: receipts },
      })

      return NextResponse.json({ data: state, receiptId: parentReceipt.id }, { status: 503 })
    }

    updateStep('check_availability', 'success', `CLI version: ${cliCheck.version}`)
    await log(`  OK: OpenClaw CLI v${cliCheck.version}`)
    await log('')

    // Step 2: Initial health check
    await log('[2/6] Running initial health check...')
    updateStep('health_check', 'running')

    const healthResult = await runCommandJson<{ status: string; message?: string }>('health.json')

    if (healthResult.exitCode === 0 && healthResult.data?.status === 'ok') {
      updateStep('health_check', 'success', 'Gateway is healthy')
      await log('  OK: Gateway is already healthy!')

      // Skip remaining steps - gateway is fine
      state.steps.filter(s => s.status === 'pending').forEach(s => s.status = 'skipped')
      state.finalStatus = 'healthy'

      await repos.receipts.finalize(parentReceipt.id, {
        exitCode: 0,
        durationMs: 0,
        parsedJson: { state, message: 'Gateway is already healthy' },
      })

      await repos.activities.create({
        type: 'maintenance.recover_completed',
        actor: 'user',
        entityType: 'system',
        entityId: 'gateway',
        summary: 'Gateway recovery: Already healthy, no action needed',
        payloadJson: { state, receiptIds: receipts },
      })

      return NextResponse.json({ data: state, receiptId: parentReceipt.id })
    }

    updateStep('health_check', 'failed', healthResult.data?.message || healthResult.error)
    await log(`  ISSUE: ${healthResult.data?.message || healthResult.error}`)
    await log('')

    // Step 3: Run doctor
    await log('[3/6] Running diagnostics (doctor)...')
    updateStep('doctor_run', 'running')

    const doctorReceipt = await repos.receipts.create({
      workOrderId: 'system',
      kind: 'manual',
      commandName: 'maintenance.doctor',
      commandArgs: { parent: parentReceipt.id },
    })

    let doctorOutput = ''
    for await (const chunk of executeCommand('doctor.json')) {
      if (chunk.type === 'stdout') {
        doctorOutput += chunk.chunk
        await repos.receipts.append(doctorReceipt.id, { stream: 'stdout', chunk: chunk.chunk })
      } else if (chunk.type === 'stderr') {
        await repos.receipts.append(doctorReceipt.id, { stream: 'stderr', chunk: chunk.chunk })
      }
    }

    await repos.receipts.finalize(doctorReceipt.id, {
      exitCode: 0,
      durationMs: 0,
      parsedJson: { output: doctorOutput },
    })

    let doctorData: { ok: boolean; issues?: unknown[] } = { ok: true }
    try {
      doctorData = JSON.parse(doctorOutput)
    } catch {
      // Not JSON, assume issues
      doctorData = { ok: false, issues: [{ message: 'Unable to parse doctor output' }] }
    }

    if (doctorData.ok) {
      updateStep('doctor_run', 'success', 'No issues found', doctorReceipt.id)
      await log('  OK: No issues found')
      updateStep('doctor_fix', 'skipped', 'Not needed')
    } else {
      updateStep('doctor_run', 'failed', `Found ${doctorData.issues?.length || 0} issues`, doctorReceipt.id)
      await log(`  ISSUES: Found ${doctorData.issues?.length || 0} problems`)
      await log('')

      // Step 4: Run doctor --fix
      await log('[4/6] Attempting automatic fixes (doctor --fix)...')
      updateStep('doctor_fix', 'running')

      const fixReceipt = await repos.receipts.create({
        workOrderId: 'system',
        kind: 'manual',
        commandName: 'maintenance.doctor_fix',
        commandArgs: { parent: parentReceipt.id },
      })

      let fixExitCode = 0
      for await (const chunk of executeCommand('doctor.fix')) {
        if (chunk.type === 'stdout') {
          await repos.receipts.append(fixReceipt.id, { stream: 'stdout', chunk: chunk.chunk })
          await log(`  ${chunk.chunk.trim()}`)
        } else if (chunk.type === 'stderr') {
          await repos.receipts.append(fixReceipt.id, { stream: 'stderr', chunk: chunk.chunk })
        } else if (chunk.type === 'exit') {
          fixExitCode = chunk.code
        }
      }

      await repos.receipts.finalize(fixReceipt.id, {
        exitCode: fixExitCode,
        durationMs: 0,
        parsedJson: { exitCode: fixExitCode },
      })

      if (fixExitCode === 0) {
        updateStep('doctor_fix', 'success', 'Fixes applied', fixReceipt.id)
        await log('  OK: Fixes applied successfully')
      } else {
        updateStep('doctor_fix', 'failed', 'Some fixes failed', fixReceipt.id)
        await log('  WARN: Some fixes may have failed')
      }
    }
    await log('')

    // Step 5: Restart gateway
    await log('[5/6] Restarting gateway...')
    updateStep('gateway_restart', 'running')

    const restartReceipt = await repos.receipts.create({
      workOrderId: 'system',
      kind: 'manual',
      commandName: 'maintenance.gateway_restart',
      commandArgs: { parent: parentReceipt.id },
    })

    let restartExitCode = 0
    for await (const chunk of executeCommand('gateway.restart')) {
      if (chunk.type === 'stdout') {
        await repos.receipts.append(restartReceipt.id, { stream: 'stdout', chunk: chunk.chunk })
      } else if (chunk.type === 'stderr') {
        await repos.receipts.append(restartReceipt.id, { stream: 'stderr', chunk: chunk.chunk })
      } else if (chunk.type === 'exit') {
        restartExitCode = chunk.code
      }
    }

    await repos.receipts.finalize(restartReceipt.id, {
      exitCode: restartExitCode,
      durationMs: 0,
      parsedJson: { exitCode: restartExitCode },
    })

    if (restartExitCode === 0) {
      updateStep('gateway_restart', 'success', 'Gateway restarted', restartReceipt.id)
      await log('  OK: Gateway restarted')
    } else {
      updateStep('gateway_restart', 'failed', 'Restart failed', restartReceipt.id)
      await log('  FAILED: Gateway restart failed')
    }
    await log('')

    // Wait a moment for gateway to stabilize
    await new Promise(r => setTimeout(r, 2000))

    // Step 6: Recheck health
    await log('[6/6] Re-checking health...')
    updateStep('health_recheck', 'running')

    const recheckResult = await runCommandJson<{ status: string; message?: string }>('health.json')

    if (recheckResult.exitCode === 0 && recheckResult.data?.status === 'ok') {
      updateStep('health_recheck', 'success', 'Gateway is now healthy')
      await log('  OK: Gateway is now healthy!')
      state.finalStatus = 'recovered'
    } else {
      updateStep('health_recheck', 'failed', recheckResult.data?.message || recheckResult.error)
      await log(`  STILL FAILING: ${recheckResult.data?.message || recheckResult.error}`)
      await log('')
      await log('*** MANUAL INTERVENTION REQUIRED ***')
      await log('The gateway could not be automatically recovered.')
      await log('Please check the logs and receipts for more details.')
      state.finalStatus = 'needs_manual_intervention'
    }

    await log('')
    await log('=== Recovery Complete ===')
    await log(`Final Status: ${state.finalStatus}`)

    // Get final status for comparison (cast to string to avoid narrowing issues)
    const finalStatus = state.finalStatus as string | null

    // Finalize parent receipt
    const isSuccess = finalStatus === 'recovered' || finalStatus === 'healthy'
    await repos.receipts.finalize(parentReceipt.id, {
      exitCode: isSuccess ? 0 : 1,
      durationMs: 0,
      parsedJson: { state },
    })

    // Determine activity type and summary
    let activityType = 'maintenance.recover_completed'
    let activitySummary = 'Gateway recovery requires manual intervention'

    if (finalStatus === 'recovered') {
      activitySummary = 'Gateway recovery completed successfully'
    } else if (finalStatus === 'healthy') {
      activitySummary = 'Gateway was already healthy'
    } else if (finalStatus === 'needs_manual_intervention') {
      activityType = 'maintenance.recover_escalated'
    }

    // Log activity
    await repos.activities.create({
      type: activityType,
      actor: 'user',
      entityType: 'system',
      entityId: 'gateway',
      summary: activitySummary,
      payloadJson: { state, receiptIds: receipts },
    })

    return NextResponse.json({
      data: state,
      receiptId: parentReceipt.id,
    })

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Recovery failed'

    await log('')
    await log(`ERROR: ${errorMessage}`)
    state.finalStatus = 'failed'

    await repos.receipts.finalize(parentReceipt.id, {
      exitCode: 1,
      durationMs: 0,
      parsedJson: { state, error: errorMessage },
    })

    await repos.activities.create({
      type: 'maintenance.recover_failed',
      actor: 'user',
      entityType: 'system',
      entityId: 'gateway',
      summary: `Gateway recovery failed: ${errorMessage}`,
      payloadJson: { state, error: errorMessage, receiptIds: receipts },
    })

    return NextResponse.json(
      { error: errorMessage, data: state, receiptId: parentReceipt.id },
      { status: 500 }
    )
  }
}
