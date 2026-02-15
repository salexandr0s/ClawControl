import { NextRequest, NextResponse } from 'next/server'
import { promises as fsp } from 'node:fs'
import { getRepos } from '@/lib/repo'
import { asAuthErrorResponse, verifyOperatorRequest } from '@/lib/auth/operator-auth'
import { ensureApprovalGate } from '@/lib/approval-gate'
import { enforceActionPolicy } from '@/lib/with-governor'
import { validateWorkspacePath } from '@/lib/fs/path-policy'

function normalizeSlug(value: string): string {
  return value.trim().toLowerCase()
}

function isSafeSlug(value: string): boolean {
  if (!value) return false
  if (value.length < 2 || value.length > 80) return false
  if (value.includes('..') || value.includes('/') || value.includes('\\') || value.includes('\0')) return false
  return /^[a-z0-9][a-z0-9-_]*[a-z0-9]$/.test(value)
}

function toApprovalError(reason: string) {
  if (reason === 'pending') return 'APPROVAL_PENDING'
  if (reason === 'rejected') return 'APPROVAL_REJECTED'
  return 'APPROVAL_REQUIRED'
}

async function safeRmWorkspaceDir(workspaceDir: string): Promise<void> {
  const validated = validateWorkspacePath(workspaceDir)
  if (!validated.valid || !validated.resolvedPath) {
    throw new Error(validated.error || `Invalid path: ${workspaceDir}`)
  }
  await fsp.rm(validated.resolvedPath, { recursive: true, force: true })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const normalizedSlug = normalizeSlug(slug)
  if (!isSafeSlug(normalizedSlug)) {
    return NextResponse.json({ error: 'Invalid slug' }, { status: 400 })
  }

  const auth = verifyOperatorRequest(request, { requireCsrf: true })
  if (!auth.ok) {
    return NextResponse.json(asAuthErrorResponse(auth), { status: auth.status })
  }

  const body = await request.json().catch(() => ({})) as {
    scope?: 'global' | 'agent'
    agentSlugs?: string[]
    agentIds?: string[]
    typedConfirmText?: string
  }

  const scope = body.scope
  const typedConfirmText = body.typedConfirmText

  if (scope !== 'global' && scope !== 'agent') {
    return NextResponse.json({ error: 'Invalid scope' }, { status: 400 })
  }

  const repos = getRepos()

  // Resolve agent slugs when scope=agent
  let agentSlugs: string[] = []
  if (scope === 'agent') {
    const fromSlugs = Array.isArray(body.agentSlugs) ? body.agentSlugs : []
    const fromIds = Array.isArray(body.agentIds) ? body.agentIds : []

    if (fromSlugs.length > 0) {
      agentSlugs = fromSlugs.map((s) => s.trim()).filter(Boolean)
    } else if (fromIds.length > 0) {
      const resolved = await Promise.all(
        fromIds.map(async (id) => {
          const agent = await repos.agents.getById(id)
          return agent?.slug ?? null
        })
      )
      agentSlugs = resolved.filter((v): v is string => Boolean(v))
    }

    agentSlugs = Array.from(new Set(agentSlugs.map((s) => s.trim()).filter(Boolean)))
    if (agentSlugs.length === 0) {
      return NextResponse.json({ error: 'At least one agent is required for agent scope' }, { status: 400 })
    }

    for (const agentSlug of agentSlugs) {
      if (!isSafeSlug(agentSlug)) {
        return NextResponse.json({ error: `Invalid agent slug: ${agentSlug}` }, { status: 400 })
      }
    }
  }

  const scopeLabel = scope === 'global'
    ? 'global'
    : `agents: ${agentSlugs.join(', ')}`
  const gate = await ensureApprovalGate({
    actionKind: 'skill.uninstall',
    workOrderId: 'system',
    questionMd: `Approve uninstalling ClawHub skill ${normalizedSlug} (${scopeLabel}).`,
    actor: auth.principal.actor,
  })

  if (!gate.allowed) {
    return NextResponse.json(
      {
        error: `Approval required for uninstalling ${normalizedSlug}`,
        code: toApprovalError(gate.reason),
        details: {
          approvalId: gate.approval?.id,
          actionKind: 'skill.uninstall',
        },
        policy: gate.policy,
      },
      { status: 403 }
    )
  }

  const policyEnforced = await enforceActionPolicy({
    actionKind: 'skill.uninstall',
    typedConfirmText,
    actor: auth.principal.actor,
  })

  if (!policyEnforced.allowed) {
    return NextResponse.json(
      {
        error: policyEnforced.errorType,
        policy: policyEnforced.policy,
      },
      { status: policyEnforced.status ?? (policyEnforced.errorType === 'TYPED_CONFIRM_REQUIRED' ? 428 : 403) }
    )
  }

  const receipt = await repos.receipts.create({
    workOrderId: 'system',
    kind: 'manual',
    commandName: 'skill.uninstall',
    commandArgs: {
      source: 'clawhub',
      slug: normalizedSlug,
      scope,
      agentSlugs,
    },
  })

  const startedAt = Date.now()

  try {
    const removedDirs: string[] = []

    if (scope === 'global') {
      const destDir = `/skills/${normalizedSlug}`
      await safeRmWorkspaceDir(destDir)
      removedDirs.push(destDir)
      await repos.clawhubInstalls.markUninstalled({ slug: normalizedSlug, scopeKey: '__global__', lastReceiptId: receipt.id })
    } else {
      for (const agentSlug of agentSlugs) {
        const destDir = `/agents/${agentSlug}/skills/${normalizedSlug}`
        await safeRmWorkspaceDir(destDir)
        removedDirs.push(destDir)
        await repos.clawhubInstalls.markUninstalled({ slug: normalizedSlug, scopeKey: agentSlug, lastReceiptId: receipt.id })
      }
    }

    await repos.receipts.finalize(receipt.id, {
      exitCode: 0,
      durationMs: Date.now() - startedAt,
      parsedJson: {
        status: 'success',
        source: 'clawhub',
        slug: normalizedSlug,
        scope,
        agentSlugs,
        removedDirs,
      },
    })

    await repos.activities.create({
      type: 'marketplace.skill.uninstalled',
      actor: auth.principal.actor,
      entityType: 'skill',
      entityId: normalizedSlug,
      summary: `Uninstalled ClawHub skill: ${normalizedSlug} (${scope})`,
      payloadJson: {
        slug: normalizedSlug,
        scope,
        agentSlugs,
        receiptId: receipt.id,
      },
    })

    return NextResponse.json({ success: true, receiptId: receipt.id })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Uninstall failed'

    await repos.receipts.finalize(receipt.id, {
      exitCode: 1,
      durationMs: Date.now() - startedAt,
      parsedJson: { status: 'failed', error: message },
    })

    return NextResponse.json({ error: message, receiptId: receipt.id }, { status: 500 })
  }
}

