#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const BASELINE_ENDPOINTS = resolve(process.cwd(), process.env.PERF_BASELINE_ENDPOINTS || 'artifacts/perf/baseline-endpoints.json')
const BASELINE_PAGES = resolve(process.cwd(), process.env.PERF_BASELINE_PAGES || 'artifacts/perf/baseline-pages.json')
const AFTER_ENDPOINTS = resolve(process.cwd(), process.env.PERF_AFTER_ENDPOINTS || 'artifacts/perf/after-endpoints.json')
const AFTER_PAGES = resolve(process.cwd(), process.env.PERF_AFTER_PAGES || 'artifacts/perf/after-pages.json')
const OUTPUT = resolve(process.cwd(), process.env.PERF_REPORT_OUT || 'artifacts/perf/performance-report.md')

function fmtMs(value) {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)} ms` : 'n/a'
}

function pctDelta(before, after) {
  if (typeof before !== 'number' || typeof after !== 'number' || !Number.isFinite(before) || before === 0) {
    return 'n/a'
  }
  const delta = ((after - before) / before) * 100
  const prefix = delta > 0 ? '+' : ''
  return `${prefix}${delta.toFixed(1)}%`
}

function fmtDelta(before, after) {
  if (typeof before !== 'number' || typeof after !== 'number' || !Number.isFinite(before) || !Number.isFinite(after)) {
    return 'n/a'
  }
  const delta = after - before
  const prefix = delta > 0 ? '+' : ''
  return `${prefix}${delta.toFixed(1)} ms (${pctDelta(before, after)})`
}

function endpointRows(baseline, after) {
  const afterByPath = new Map(after.results.map((row) => [row.pathname, row]))
  const rows = []

  for (const beforeRow of baseline.results) {
    const nextRow = afterByPath.get(beforeRow.pathname)
    if (!nextRow) continue

    rows.push({
      pathname: beforeRow.pathname,
      coldBefore: beforeRow.cold.durationMs,
      coldAfter: nextRow.cold.durationMs,
      warmP50Before: beforeRow.warmStats.p50Ms,
      warmP50After: nextRow.warmStats.p50Ms,
      warmP95Before: beforeRow.warmStats.p95Ms,
      warmP95After: nextRow.warmStats.p95Ms,
    })
  }

  return rows
}

function pageRows(baseline, after) {
  const afterByPage = new Map(after.pages.map((row) => [row.pageId, row]))
  const rows = []

  for (const beforeRow of baseline.pages) {
    const nextRow = afterByPage.get(beforeRow.pageId)
    if (!nextRow) continue

    rows.push({
      pageId: beforeRow.pageId,
      path: beforeRow.path,
      coldP50Before: beforeRow.stats.coldPageReadyP50Ms,
      coldP50After: nextRow.stats.coldPageReadyP50Ms,
      coldP95Before: beforeRow.stats.coldPageReadyP95Ms,
      coldP95After: nextRow.stats.coldPageReadyP95Ms,
      warmP50Before: beforeRow.stats.warmPageReadyP50Ms,
      warmP50After: nextRow.stats.warmPageReadyP50Ms,
      warmP95Before: beforeRow.stats.warmPageReadyP95Ms,
      warmP95After: nextRow.stats.warmPageReadyP95Ms,
      criticalAfter: nextRow.criticalPath.warmTopFetches?.[0] ?? null,
    })
  }

  return rows
}

async function main() {
  const [baselineEndpointsRaw, baselinePagesRaw, afterEndpointsRaw, afterPagesRaw] = await Promise.all([
    readFile(BASELINE_ENDPOINTS, 'utf8'),
    readFile(BASELINE_PAGES, 'utf8'),
    readFile(AFTER_ENDPOINTS, 'utf8'),
    readFile(AFTER_PAGES, 'utf8'),
  ])

  const baselineEndpoints = JSON.parse(baselineEndpointsRaw)
  const baselinePages = JSON.parse(baselinePagesRaw)
  const afterEndpoints = JSON.parse(afterEndpointsRaw)
  const afterPages = JSON.parse(afterPagesRaw)

  const apiTableRows = endpointRows(baselineEndpoints, afterEndpoints)
  const pageTableRows = pageRows(baselinePages, afterPages)

  const lines = []
  lines.push('# ClawControl Performance Sweep')
  lines.push('')
  lines.push(`Generated: ${new Date().toISOString()}`)
  lines.push('')
  lines.push('## Methodology')
  lines.push('')
  lines.push('- App target: `http://127.0.0.1:3000`')
  lines.push('- Endpoint metrics: one cold sample + repeated warm samples with p50/p95.')
  lines.push('- Page metrics: Playwright navigation sampling using in-app `page-ready` and fetch timing events.')
  lines.push('- Cold samples use isolated browser contexts; warm samples reuse context after warm-up.')
  lines.push('')
  lines.push('## Page Load (Page-Ready) Deltas')
  lines.push('')
  lines.push('| Page | Cold p50 | Cold p95 | Warm p50 | Warm p95 |')
  lines.push('| --- | --- | --- | --- | --- |')
  for (const row of pageTableRows) {
    lines.push(
      `| ${row.path} | ${fmtMs(row.coldP50Before)} -> ${fmtMs(row.coldP50After)} (${fmtDelta(row.coldP50Before, row.coldP50After)}) | ${fmtMs(row.coldP95Before)} -> ${fmtMs(row.coldP95After)} (${fmtDelta(row.coldP95Before, row.coldP95After)}) | ${fmtMs(row.warmP50Before)} -> ${fmtMs(row.warmP50After)} (${fmtDelta(row.warmP50Before, row.warmP50After)}) | ${fmtMs(row.warmP95Before)} -> ${fmtMs(row.warmP95After)} (${fmtDelta(row.warmP95Before, row.warmP95After)}) |`
    )
  }
  lines.push('')
  lines.push('### Critical Path (After)')
  lines.push('')
  for (const row of pageTableRows) {
    const critical = row.criticalAfter
      ? `\`${row.criticalAfter.name}\` (${fmtMs(row.criticalAfter.durationMs)})`
      : 'n/a'
    lines.push(`- ${row.path}: ${critical}`)
  }
  lines.push('')
  lines.push('## API Latency Deltas')
  lines.push('')
  lines.push('| Endpoint | Cold | Warm p50 | Warm p95 |')
  lines.push('| --- | --- | --- | --- |')
  for (const row of apiTableRows) {
    lines.push(
      `| ${row.pathname} | ${fmtMs(row.coldBefore)} -> ${fmtMs(row.coldAfter)} (${fmtDelta(row.coldBefore, row.coldAfter)}) | ${fmtMs(row.warmP50Before)} -> ${fmtMs(row.warmP50After)} (${fmtDelta(row.warmP50Before, row.warmP50After)}) | ${fmtMs(row.warmP95Before)} -> ${fmtMs(row.warmP95After)} (${fmtDelta(row.warmP95Before, row.warmP95After)}) |`
    )
  }
  lines.push('')
  lines.push('## Residual Risks')
  lines.push('')
  lines.push('- In-memory TTL caches are per-process and reset on restart.')
  lines.push('- OpenClaw command latency still dominates when cache misses occur.')
  lines.push('- Browser cache behavior in local loopback differs from packaged production deployments.')
  lines.push('')

  await writeFile(OUTPUT, `${lines.join('\n')}\n`, 'utf8')
  console.log(`Wrote report to ${OUTPUT}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
