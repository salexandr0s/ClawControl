import 'server-only'

import { prisma } from '@/lib/db'
import { getRepos } from '@/lib/repo'
import { getWorkflowRegistrySnapshot } from '@/lib/workflows/registry'
import type { ClawPackageManifest, ScanReport } from '@clawcontrol/core'

function formatFindingLine(finding: { severity: string; title: string; path?: string }): string {
  const loc = finding.path ? ` (${finding.path})` : ''
  return `- [${finding.severity}] ${finding.title}${loc}`
}

async function pickSecurityWorkflowId(): Promise<string | null> {
  const snapshot = await getWorkflowRegistrySnapshot({ forceReload: true })
  const ids = new Set(snapshot.definitions.map((d) => d.id))
  if (ids.has('cc_security_audit')) return 'cc_security_audit'
  if (ids.has('security_audit')) return 'security_audit'
  if (ids.has('starter_security_audit')) return 'starter_security_audit'
  return null
}

export async function ensureBlockedScanWorkOrder(input: {
  sha256: string
  manifest: ClawPackageManifest
  scan: ScanReport
}): Promise<{ workOrderId: string; created: boolean }> {
  const existing = await prisma.securityAlert.findUnique({
    where: { artifactKey: input.sha256 },
  })
  if (existing) {
    return { workOrderId: existing.workOrderId, created: false }
  }

  const workflowId = await pickSecurityWorkflowId()
  const repos = getRepos()

  const topFindings = input.scan.findings.slice(0, 12)
  const goalMd = [
    `A package import was blocked by the Clawpack security scanner.`,
    ``,
    `- manifest: ${input.manifest.name} (${input.manifest.id}@${input.manifest.version})`,
    `- sha256: \`${input.sha256}\``,
    `- outcome: **${input.scan.outcome}**`,
    `- counts: danger=${input.scan.summaryCounts.danger}, warning=${input.scan.summaryCounts.warning}, info=${input.scan.summaryCounts.info}`,
    ``,
    `## Top findings`,
    ...topFindings.map((f) => formatFindingLine(f)),
    ``,
    `## Next actions`,
    `1. Inspect the package contents and verify no secrets or bypass instructions exist.`,
    `2. If the package is legitimate, rebuild it without blocked findings and re-import.`,
    `3. If you must deploy anyway, use the governed override path and capture explicit approval.`,
  ].join('\n')

  const wo = await repos.workOrders.create({
    title: `Security alert: blocked package ${input.manifest.name}`,
    goalMd,
    priority: 'P0',
    owner: 'system',
    ownerType: 'system',
    tags: ['security', 'incident', 'package'],
    workflowId,
  })

  try {
    await prisma.securityAlert.create({
      data: {
        artifactKey: input.sha256,
        workOrderId: wo.id,
      },
    })
  } catch (error) {
    // Best-effort idempotency: if someone raced us, clean up the orphaned work order.
    const existingAfter = await prisma.securityAlert.findUnique({
      where: { artifactKey: input.sha256 },
    })
    if (existingAfter) {
      try {
        await prisma.workOrder.delete({ where: { id: wo.id } })
      } catch {
        // ignore cleanup failures
      }
      return { workOrderId: existingAfter.workOrderId, created: false }
    }
    throw error
  }

  await repos.activities.create({
    type: 'security.scan_blocked',
    actor: 'system',
    actorType: 'system',
    entityType: 'work_order',
    entityId: wo.id,
    category: 'security',
    riskLevel: 'danger',
    summary: `Blocked package import: ${input.manifest.id}@${input.manifest.version}`,
    payloadJson: {
      sha256: input.sha256,
      manifest: {
        id: input.manifest.id,
        name: input.manifest.name,
        version: input.manifest.version,
        kind: input.manifest.kind,
      },
      scan: {
        outcome: input.scan.outcome,
        summaryCounts: input.scan.summaryCounts,
        scannerVersion: input.scan.scannerVersion,
      },
      workOrderId: wo.id,
    },
  })

  return { workOrderId: wo.id, created: true }
}
