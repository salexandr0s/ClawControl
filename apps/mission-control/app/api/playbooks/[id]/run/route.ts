import { NextRequest, NextResponse } from 'next/server'
import { mockPlaybooks } from '@savorg/core'
import { useMockData, getRepos } from '@/lib/repo'
import { enforceTypedConfirm } from '@/lib/with-governor'
import { getPlaybook } from '@/lib/fs/playbooks-fs'
import type { ActionKind } from '@savorg/core'

// Playbook execution uses caution level (critical playbooks require danger)
const PLAYBOOK_RUN_ACTION: ActionKind = 'action.caution'

/**
 * POST /api/playbooks/:id/run
 *
 * Execute a playbook. This is a simulated execution that:
 * 1. Parses the YAML content
 * 2. Records a receipt for auditing
 * 3. Returns step-by-step results
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // Get playbook from mock or real filesystem
  let playbook: { id: string; name: string; content: string; severity?: string } | null = null

  if (useMockData()) {
    const found = mockPlaybooks.find((p) => p.id === id)
    if (found) {
      playbook = found
    }
  } else {
    try {
      playbook = await getPlaybook(id)
    } catch {
      return NextResponse.json({ error: 'Failed to read playbook' }, { status: 500 })
    }
  }

  if (!playbook) {
    return NextResponse.json({ error: 'Playbook not found' }, { status: 404 })
  }

  const body = await request.json()
  const { typedConfirmText, workOrderId } = body

  // Critical playbooks require danger-level confirmation
  const actionKind: ActionKind = playbook.severity === 'critical'
    ? 'action.danger'
    : PLAYBOOK_RUN_ACTION

  // Enforce typed confirmation for playbook execution
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

  // Parse the playbook YAML to extract steps (simplified parsing)
  const steps = parsePlaybookSteps(playbook.content)

  // Create a receipt for this execution
  const repos = getRepos()
  const receipt = await repos.receipts.create({
    workOrderId: workOrderId || 'system',
    operationId: null,
    kind: 'playbook_step',
    commandName: `playbook:${playbook.name}`,
    commandArgs: { playbookId: id, steps: steps.length },
  })

  // Simulate execution of steps
  const stepResults = steps.map((step, index) => ({
    index,
    name: step.name,
    status: 'success' as const,
    message: `Step "${step.name}" completed successfully`,
    durationMs: Math.floor(Math.random() * 500) + 100,
  }))

  // Finalize the receipt
  const totalDurationMs = stepResults.reduce((sum, s) => sum + s.durationMs, 0)
  await repos.receipts.finalize(receipt.id, {
    exitCode: 0,
    durationMs: totalDurationMs,
    parsedJson: {
      playbook: playbook.name,
      steps: stepResults,
      success: true,
    },
  })

  return NextResponse.json({
    data: {
      playbookId: id,
      playbookName: playbook.name,
      status: 'completed',
      steps: stepResults,
      totalDurationMs,
    },
    receiptId: receipt.id,
  })
}

/**
 * Simple YAML step parser for playbooks.
 * Extracts step names from YAML-like structure.
 */
function parsePlaybookSteps(content: string): Array<{ name: string; command?: string }> {
  const steps: Array<{ name: string; command?: string }> = []
  const lines = content.split('\n')

  let inSteps = false
  let currentStep: { name: string; command?: string } | null = null

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed === 'steps:') {
      inSteps = true
      continue
    }

    if (inSteps) {
      // Check for new step (- name:)
      const nameMatch = trimmed.match(/^-\s*name:\s*(.+)$/)
      if (nameMatch) {
        if (currentStep) {
          steps.push(currentStep)
        }
        currentStep = { name: nameMatch[1].replace(/['"]/g, '') }
        continue
      }

      // Check for command in current step
      const cmdMatch = trimmed.match(/^(run|command):\s*(.+)$/)
      if (cmdMatch && currentStep) {
        currentStep.command = cmdMatch[2].replace(/['"]/g, '')
        continue
      }

      // Check for end of steps section (new top-level key)
      if (/^\w+:/.test(trimmed) && !trimmed.startsWith('-')) {
        if (currentStep) {
          steps.push(currentStep)
          currentStep = null
        }
        inSteps = false
      }
    }
  }

  // Push final step if exists
  if (currentStep) {
    steps.push(currentStep)
  }

  // If no steps found, create a default one
  if (steps.length === 0) {
    steps.push({ name: 'Execute playbook' })
  }

  return steps
}
