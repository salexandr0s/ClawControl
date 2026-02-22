import 'server-only'

import { createHash } from 'node:crypto'
import { prisma } from '@/lib/db'
import { getRepos } from '@/lib/repo'
import { extractAgentIdFromSessionKey } from '@/lib/agent-identity'
import { acquireIngestionLease, releaseIngestionLease } from './ingestion-lease'
import { sendMessageToAgent } from './console-client'
import type { ErrorSignatureListItem, ErrorSignatureInsightSnapshot } from './error-sync'

const DEFAULT_MAX_BATCH = 3
const INSIGHT_TTL_MS = 6 * 60 * 60 * 1000
const INSIGHT_TIMEOUT_MS = 12_000
const RETRY_FAILED_AFTER_MS = 15 * 60 * 1000

interface ResolvedInsightAgent {
  runtimeAgentId: string
  sourceAgentId: string | null
  sourceAgentName: string | null
}

function toInsightSnapshot(row: {
  status: string
  diagnosisMd: string
  failureReason: string | null
  generatedAt: Date | null
  sourceAgentId: string | null
  sourceAgentName: string | null
} | null): ErrorSignatureInsightSnapshot | null {
  if (!row) return null
  return {
    status: row.status === 'ready' || row.status === 'failed' ? row.status : 'pending',
    diagnosisMd: row.status === 'ready' ? row.diagnosisMd : null,
    failureReason: row.failureReason,
    generatedAt: row.generatedAt ? row.generatedAt.toISOString() : null,
    sourceAgentId: row.sourceAgentId,
    sourceAgentName: row.sourceAgentName,
  }
}

function buildInputHash(signature: ErrorSignatureListItem): string {
  return createHash('sha256')
    .update(JSON.stringify({
      signatureHash: signature.signatureHash,
      signatureText: signature.signatureText,
      sample: signature.sample,
      raw: signature.rawRedactedSample ?? '',
      category: signature.classification.category,
      severity: signature.classification.severity,
      count: signature.count,
      windowCount: signature.windowCount,
      allTimeCount: signature.allTimeCount,
      lastSeen: signature.lastSeen,
    }))
    .digest('hex')
}

function shouldGenerateInsight(existing: {
  status: string
  inputHash: string
  generatedAt: Date | null
  lastAttemptAt: Date | null
} | null, inputHash: string): boolean {
  if (!existing) return true
  if (existing.inputHash !== inputHash) return true

  const now = Date.now()
  if (existing.status === 'ready') {
    if (!existing.generatedAt) return true
    return now - existing.generatedAt.getTime() > INSIGHT_TTL_MS
  }

  if (existing.status === 'failed') {
    if (!existing.lastAttemptAt) return true
    return now - existing.lastAttemptAt.getTime() > RETRY_FAILED_AFTER_MS
  }

  if (existing.status === 'pending') {
    if (!existing.lastAttemptAt) return false
    return now - existing.lastAttemptAt.getTime() > INSIGHT_TIMEOUT_MS
  }

  return true
}

function formatList(items: string[]): string {
  if (items.length === 0) return '- none'
  return items.map((item) => `- ${item}`).join('\n')
}

function buildInsightPrompt(signature: ErrorSignatureListItem): string {
  const suggestedActions = signature.classification.suggestedActions.map((action) => {
    const scope = action.maintenanceAction ? `${action.label} (maintenance:${action.maintenanceAction})` : action.label
    return `${scope}: ${action.description}`
  })

  const evidence = signature.rawRedactedSample || signature.sample

  return [
    'You are assisting with OpenClaw gateway incident remediation.',
    'Produce concise markdown with these exact headings:',
    '## Likely Cause',
    '## Action Plan',
    '## Verification',
    '## Escalation Trigger',
    '',
    'Context:',
    `- Signature hash: ${signature.signatureHash}`,
    `- Signature text: ${signature.signatureText}`,
    `- Category: ${signature.classification.category}`,
    `- Severity: ${signature.classification.severity}`,
    `- Detectability: ${signature.classification.detectability} (${Math.round(signature.classification.confidence * 100)}%)`,
    `- Window count: ${signature.windowCount}`,
    `- All-time count: ${signature.allTimeCount}`,
    `- Last seen: ${signature.lastSeen}`,
    '',
    'Deterministic suggested actions:',
    formatList(suggestedActions),
    '',
    'Evidence (redacted):',
    '```text',
    evidence || 'no sample captured',
    '```',
    '',
    'Requirements:',
    '- Keep output under 220 words.',
    '- Include explicit commands only if they are safe and already implied by context.',
    '- Avoid mentioning unknown internals or secret values.',
  ].join('\n')
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Insight generation timed out after ${timeoutMs}ms`)), timeoutMs)

    promise
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch((error) => {
        clearTimeout(timer)
        reject(error)
      })
  })
}

function truncate(text: string, maxLen: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxLen) return trimmed
  return `${trimmed.slice(0, maxLen - 1)}…`
}

async function resolveInsightAgent(): Promise<ResolvedInsightAgent | null> {
  const main = await prisma.agent.findFirst({
    where: {
      OR: [
        { runtimeAgentId: 'main' },
        { slug: 'main' },
        { name: 'main' },
        { sessionKey: { startsWith: 'agent:main:' } },
      ],
    },
    orderBy: { updatedAt: 'desc' },
  })

  const fallback = main ?? await prisma.agent.findFirst({
    where: {
      dispatchEligible: true,
      status: { not: 'error' },
    },
    orderBy: { updatedAt: 'desc' },
  })

  if (!fallback) return null

  const runtimeAgentId =
    fallback.runtimeAgentId?.trim()
    || extractAgentIdFromSessionKey(fallback.sessionKey)
    || fallback.slug?.trim()
    || fallback.name

  if (!runtimeAgentId) return null

  return {
    runtimeAgentId,
    sourceAgentId: fallback.id,
    sourceAgentName: fallback.displayName ?? fallback.name ?? runtimeAgentId,
  }
}

async function writeActivitySafe(input: {
  type: string
  summary: string
  payload: Record<string, unknown>
}): Promise<void> {
  try {
    const repos = getRepos()
    await repos.activities.create({
      type: input.type,
      actor: 'system',
      actorType: 'system',
      entityType: 'error_signature',
      entityId: String(input.payload.signatureHash ?? 'unknown'),
      summary: input.summary,
      payloadJson: input.payload,
    })
  } catch {
    // Activity logging should never block dashboard operations.
  }
}

async function markInsight(
  signatureHash: string,
  data: {
    status: 'pending' | 'ready' | 'failed'
    inputHash: string
    diagnosisMd?: string
    failureReason?: string | null
    sourceAgentId?: string | null
    sourceAgentName?: string | null
    generatedAt?: Date | null
    lastAttemptAt?: Date | null
  }
): Promise<void> {
  await prisma.errorSignatureInsight.upsert({
    where: { signatureHash },
    create: {
      signatureHash,
      status: data.status,
      inputHash: data.inputHash,
      diagnosisMd: data.diagnosisMd ?? '',
      failureReason: data.failureReason ?? null,
      sourceAgentId: data.sourceAgentId ?? null,
      sourceAgentName: data.sourceAgentName ?? null,
      generatedAt: data.generatedAt ?? null,
      lastAttemptAt: data.lastAttemptAt ?? new Date(),
    },
    update: {
      status: data.status,
      inputHash: data.inputHash,
      diagnosisMd: data.diagnosisMd ?? '',
      failureReason: data.failureReason ?? null,
      sourceAgentId: data.sourceAgentId ?? null,
      sourceAgentName: data.sourceAgentName ?? null,
      generatedAt: data.generatedAt ?? null,
      lastAttemptAt: data.lastAttemptAt ?? new Date(),
    },
  })
}

export async function autoGenerateErrorInsights(
  signatures: ErrorSignatureListItem[],
  options?: { maxBatch?: number }
): Promise<Map<string, ErrorSignatureInsightSnapshot | null>> {
  const maxBatch = Math.max(1, Math.min(10, options?.maxBatch ?? DEFAULT_MAX_BATCH))
  const actionable = signatures.filter((signature) => signature.classification.actionable)

  if (actionable.length === 0) {
    return new Map(signatures.map((signature) => [signature.signatureHash, signature.insight]))
  }

  const hashes = actionable.map((signature) => signature.signatureHash)
  const existingRows = await prisma.errorSignatureInsight.findMany({
    where: { signatureHash: { in: hashes } },
  })
  const existingByHash = new Map(existingRows.map((row) => [row.signatureHash, row]))

  const candidates = actionable.filter((signature) => {
    const inputHash = buildInputHash(signature)
    const existing = existingByHash.get(signature.signatureHash) ?? null
    return shouldGenerateInsight(existing, inputHash)
  }).slice(0, maxBatch)

  const resolvedAgent = candidates.length > 0 ? await resolveInsightAgent() : null
  const output = new Map<string, ErrorSignatureInsightSnapshot | null>(
    signatures.map((signature) => [signature.signatureHash, signature.insight])
  )

  for (const signature of candidates) {
    const leaseName = `error-insight:${signature.signatureHash}`
    const lease = await acquireIngestionLease(leaseName, 30_000)
    if (!lease.acquired) continue

    const inputHash = buildInputHash(signature)

    try {
      if (!resolvedAgent) {
        await markInsight(signature.signatureHash, {
          status: 'failed',
          inputHash,
          failureReason: 'No eligible analysis agent available',
          sourceAgentId: null,
          sourceAgentName: null,
          generatedAt: null,
        })

        output.set(signature.signatureHash, {
          status: 'failed',
          diagnosisMd: null,
          failureReason: 'No eligible analysis agent available',
          generatedAt: null,
          sourceAgentId: null,
          sourceAgentName: null,
        })

        continue
      }

      await markInsight(signature.signatureHash, {
        status: 'pending',
        inputHash,
        sourceAgentId: resolvedAgent.sourceAgentId,
        sourceAgentName: resolvedAgent.sourceAgentName,
        lastAttemptAt: new Date(),
      })

      const prompt = buildInsightPrompt(signature)
      const response = await withTimeout(
        sendMessageToAgent(resolvedAgent.runtimeAgentId, prompt),
        INSIGHT_TIMEOUT_MS
      )

      if (response.error) {
        throw new Error(response.error)
      }

      const diagnosisMd = truncate(response.response || '', 6000)
      if (!diagnosisMd) {
        throw new Error('Insight agent returned empty output')
      }

      const generatedAt = new Date()
      await markInsight(signature.signatureHash, {
        status: 'ready',
        inputHash,
        diagnosisMd,
        failureReason: null,
        sourceAgentId: resolvedAgent.sourceAgentId,
        sourceAgentName: resolvedAgent.sourceAgentName,
        generatedAt,
        lastAttemptAt: generatedAt,
      })

      output.set(signature.signatureHash, {
        status: 'ready',
        diagnosisMd,
        failureReason: null,
        generatedAt: generatedAt.toISOString(),
        sourceAgentId: resolvedAgent.sourceAgentId,
        sourceAgentName: resolvedAgent.sourceAgentName,
      })

      await writeActivitySafe({
        type: 'errors.insight_ready',
        summary: `Generated remediation insight for signature ${signature.signatureHash.slice(0, 8)}`,
        payload: {
          signatureHash: signature.signatureHash,
          sourceAgentId: resolvedAgent.sourceAgentId,
          sourceAgentName: resolvedAgent.sourceAgentName,
          category: signature.classification.category,
          severity: signature.classification.severity,
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Insight generation failed'
      const failedAt = new Date()

      await markInsight(signature.signatureHash, {
        status: 'failed',
        inputHash,
        failureReason: truncate(message, 800),
        sourceAgentId: resolvedAgent?.sourceAgentId ?? null,
        sourceAgentName: resolvedAgent?.sourceAgentName ?? null,
        generatedAt: null,
        lastAttemptAt: failedAt,
      })

      output.set(signature.signatureHash, {
        status: 'failed',
        diagnosisMd: null,
        failureReason: truncate(message, 800),
        generatedAt: null,
        sourceAgentId: resolvedAgent?.sourceAgentId ?? null,
        sourceAgentName: resolvedAgent?.sourceAgentName ?? null,
      })

      await writeActivitySafe({
        type: 'errors.insight_failed',
        summary: `Insight generation failed for signature ${signature.signatureHash.slice(0, 8)}`,
        payload: {
          signatureHash: signature.signatureHash,
          reason: truncate(message, 800),
          category: signature.classification.category,
        },
      })
    } finally {
      await releaseIngestionLease(leaseName, lease.ownerId)
    }
  }

  // Refresh snapshots from DB to make route responses consistent with persisted state.
  const refreshedRows = await prisma.errorSignatureInsight.findMany({
    where: {
      signatureHash: {
        in: signatures.map((signature) => signature.signatureHash),
      },
    },
  })

  const refreshedByHash = new Map(refreshedRows.map((row) => [row.signatureHash, row]))
  for (const signature of signatures) {
    output.set(signature.signatureHash, toInsightSnapshot(refreshedByHash.get(signature.signatureHash) ?? null))
  }

  return output
}
