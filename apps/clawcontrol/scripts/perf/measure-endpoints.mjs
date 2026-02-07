#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'

const BASE_URL = process.env.PERF_BASE_URL || 'http://127.0.0.1:3000'
const OUTPUT_PATH = resolve(process.cwd(), process.env.PERF_ENDPOINTS_OUT || 'artifacts/perf/endpoints.json')
const WARM_RUNS = Number(process.env.PERF_ENDPOINT_WARM_RUNS || 15)

const endpoints = [
  '/api/openclaw/cron/jobs',
  '/api/openclaw/cron/health?days=7',
  '/api/agents',
  '/api/models',
  '/api/openclaw/usage/summary?range=daily',
  '/api/openclaw/usage/breakdown?groupBy=model',
  '/api/openclaw/usage/breakdown?groupBy=agent',
  '/api/work-orders',
  '/api/operations',
]

function percentile(values, p) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))]
}

async function runSample(pathname) {
  const startedAt = performance.now()
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
  await response.text()
  const durationMs = performance.now() - startedAt

  const rawLatency = response.headers.get('x-clawcontrol-latency-ms')
  const route = response.headers.get('x-clawcontrol-route')

  return {
    pathname,
    status: response.status,
    ok: response.ok,
    durationMs: Math.round(durationMs * 10) / 10,
    serverLatencyMs: rawLatency ? Number(rawLatency) : null,
    route,
  }
}

async function main() {
  const startedAtIso = new Date().toISOString()
  const results = []

  for (const pathname of endpoints) {
    const cold = await runSample(pathname)
    const warm = []

    for (let i = 0; i < WARM_RUNS; i += 1) {
      warm.push(await runSample(pathname))
    }

    const warmDurations = warm.map((sample) => sample.durationMs)
    const warmServerDurations = warm
      .map((sample) => sample.serverLatencyMs)
      .filter((value) => typeof value === 'number')

    results.push({
      pathname,
      cold,
      warm,
      warmStats: {
        count: warm.length,
        p50Ms: percentile(warmDurations, 50),
        p95Ms: percentile(warmDurations, 95),
        serverP50Ms: percentile(warmServerDurations, 50),
        serverP95Ms: percentile(warmServerDurations, 95),
      },
    })
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    startedAt: startedAtIso,
    baseUrl: BASE_URL,
    warmRuns: WARM_RUNS,
    results,
  }

  await mkdir(dirname(OUTPUT_PATH), { recursive: true })
  await writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

  console.log(`Saved endpoint perf measurements to ${OUTPUT_PATH}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
