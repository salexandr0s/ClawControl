import { NextRequest, NextResponse } from 'next/server'
import { getRepos } from '@/lib/repo'
import { asAuthErrorResponse, verifyOperatorRequest } from '@/lib/auth/operator-auth'
import { ensureApprovalGate } from '@/lib/approval-gate'
import { enforceActionPolicy } from '@/lib/with-governor'
import { createHttpClawHubAdapter } from '@/lib/clawhub/http-adapter'
import { scanClawHubSkillVersion } from '@/lib/clawhub/scan'
import { ClawHubInstallConflictError, computeManifestHash, extractClawHubZipToWorkspaceDir } from '@/lib/clawhub/install'

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
    version?: string
    scope?: 'global' | 'agent'
    agentSlugs?: string[]
    agentIds?: string[]
    overwrite?: boolean
    typedConfirmText?: string
  }

  const version = (body.version ?? '').trim()
  const scope = body.scope
  const overwrite = Boolean(body.overwrite)
  const typedConfirmText = body.typedConfirmText

  if (!version) return NextResponse.json({ error: 'Missing version' }, { status: 400 })
  if (scope !== 'global' && scope !== 'agent') {
    return NextResponse.json({ error: 'Invalid scope' }, { status: 400 })
  }

  const repos = getRepos()
  const adapter = createHttpClawHubAdapter()

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

  // Approval gate (creates a pending approval if missing)
  const scopeLabel = scope === 'global'
    ? 'global'
    : `agents: ${agentSlugs.join(', ')}`
  const gate = await ensureApprovalGate({
    actionKind: 'skill.install',
    workOrderId: 'system',
    questionMd: `Approve installing ClawHub skill ${normalizedSlug}@${version} (${scopeLabel}).`,
    actor: auth.principal.actor,
  })

  if (!gate.allowed) {
    return NextResponse.json(
      {
        error: `Approval required for installing ${normalizedSlug}@${version}`,
        code: toApprovalError(gate.reason),
        details: {
          approvalId: gate.approval?.id,
          actionKind: 'skill.install',
        },
        policy: gate.policy,
      },
      { status: 403 }
    )
  }

  // Typed confirmation (danger-level)
  const policyEnforced = await enforceActionPolicy({
    actionKind: 'skill.install',
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

  // Create a receipt for the install attempt
  const receipt = await repos.receipts.create({
    workOrderId: 'system',
    kind: 'manual',
    commandName: 'skill.install',
    commandArgs: {
      source: 'clawhub',
      slug: normalizedSlug,
      version,
      scope,
      agentSlugs,
      overwrite,
    },
  })

  const startedAt = Date.now()

  try {
    const [skillDetail, versionDetail] = await Promise.all([
      adapter.getSkill(normalizedSlug),
      adapter.getSkillVersion(normalizedSlug, version),
    ])

    const scan = await scanClawHubSkillVersion({
      adapter,
      slug: normalizedSlug,
      version,
      skillDetail,
      versionDetail,
    })

    if (scan.blocked) {
      await repos.receipts.finalize(receipt.id, {
        exitCode: 1,
        durationMs: Date.now() - startedAt,
        parsedJson: {
          status: 'blocked',
          slug: normalizedSlug,
          version,
          scope,
          agentSlugs,
          warnings: scan.warnings,
        },
      })
      return NextResponse.json(
        { error: 'INSTALL_BLOCKED', message: 'Skill is blocked by ClawHub moderation', receiptId: receipt.id, warnings: scan.warnings },
        { status: 400 }
      )
    }

    const manifestHash = computeManifestHash(
      (versionDetail.version.files ?? []).map((f) => ({ path: f.path, sha256: f.sha256 }))
    )

    const zip = await adapter.downloadZip(normalizedSlug, version)

    const destDirs = scope === 'global'
      ? [`/skills/${normalizedSlug}`]
      : agentSlugs.map((agentSlug) => `/agents/${agentSlug}/skills/${normalizedSlug}`)

    const extracted: Array<{ destDir: string; writtenPaths: string[] }> = []
    for (const destDir of destDirs) {
      extracted.push(
        await extractClawHubZipToWorkspaceDir({
          zipBytes: zip.bytes,
          destDir,
          overwrite,
        })
      )
    }

    // Upsert DB install records per scope target
    const sourceUrl = `https://clawhub.ai/skills/${encodeURIComponent(normalizedSlug)}`
    if (scope === 'global') {
      await repos.clawhubInstalls.upsertInstall({
        slug: normalizedSlug,
        displayName: skillDetail.skill.displayName,
        version,
        scope,
        scopeKey: '__global__',
        agentId: null,
        sourceUrl,
        installMethod: 'clawhub_http_zip',
        manifestHash,
        installedBy: auth.principal.actor,
        lastReceiptId: receipt.id,
      })
    } else {
      for (const agentSlug of agentSlugs) {
        const agent = await repos.agents.getBySlug(agentSlug)
        await repos.clawhubInstalls.upsertInstall({
          slug: normalizedSlug,
          displayName: skillDetail.skill.displayName,
          version,
          scope,
          scopeKey: agentSlug,
          agentId: agent?.id ?? null,
          sourceUrl,
          installMethod: 'clawhub_http_zip',
          manifestHash,
          installedBy: auth.principal.actor,
          lastReceiptId: receipt.id,
        })
      }
    }

    await repos.receipts.finalize(receipt.id, {
      exitCode: 0,
      durationMs: Date.now() - startedAt,
      parsedJson: {
        status: 'success',
        source: 'clawhub',
        slug: normalizedSlug,
        version,
        scope,
        agentSlugs,
        overwrite,
        sourceUrl,
        manifestHash,
        moderation: scan.moderation,
        warnings: scan.warnings,
        filesWritten: extracted.flatMap((e) => e.writtenPaths),
        destinations: extracted.map((e) => ({ destDir: e.destDir, writtenCount: e.writtenPaths.length })),
      },
    })

    await repos.activities.create({
      type: 'marketplace.skill.installed',
      actor: auth.principal.actor,
      entityType: 'skill',
      entityId: normalizedSlug,
      summary: `Installed ClawHub skill: ${normalizedSlug}@${version} (${scope})`,
      payloadJson: {
        slug: normalizedSlug,
        version,
        scope,
        agentSlugs,
        receiptId: receipt.id,
        warnings: scan.warnings.map((w) => ({ code: w.code, severity: w.severity })),
      },
    })

    return NextResponse.json({
      data: {
        slug: normalizedSlug,
        version,
        scope,
        agentSlugs,
        manifestHash,
        warnings: scan.warnings,
      },
      receiptId: receipt.id,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Install failed'
    const status = err instanceof ClawHubInstallConflictError ? 409 : 500

    await repos.receipts.finalize(receipt.id, {
      exitCode: 1,
      durationMs: Date.now() - startedAt,
      parsedJson: {
        status: 'failed',
        error: message,
      },
    })

    return NextResponse.json(
      { error: status === 409 ? 'INSTALL_CONFLICT' : message, message, receiptId: receipt.id },
      { status }
    )
  }
}

