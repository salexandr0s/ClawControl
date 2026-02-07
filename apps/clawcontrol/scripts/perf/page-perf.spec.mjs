import { test } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const BASE_URL = process.env.PERF_BASE_URL || 'http://127.0.0.1:3000'
const PAGE_RUNS = Number(process.env.PERF_PAGE_RUNS || 9)
const OUTPUT_PATH = resolve(process.cwd(), process.env.PERF_PAGES_OUT || 'artifacts/perf/pages.json')

const pageTargets = [
  { id: 'cron', path: '/cron' },
  { id: 'dashboard', path: '/dashboard' },
  { id: 'work-orders', path: '/work-orders' },
  { id: 'agents', path: '/agents' },
  { id: 'models', path: '/models' },
  { id: 'runs', path: '/runs' },
]

test.setTimeout(20 * 60_000)

function percentile(values, p) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.ceil((p / 100) * sorted.length) - 1
  const clamped = Math.max(0, Math.min(sorted.length - 1, index))
  return Math.round(sorted[clamped] * 10) / 10
}

async function getPageMetrics(pageId, page) {
  await page.waitForTimeout(150)

  try {
    await page.waitForFunction(
      (id) => {
        const events = window.__clawcontrolPerfEvents || []
        return events.some((event) => event.kind === 'page-ready' && event.page === id)
      },
      pageId,
      { timeout: 6_000 }
    )
  } catch {
    // page-ready marker is best-effort.
  }

  const payload = await page.evaluate((id) => {
    const events = window.__clawcontrolPerfEvents || []
    const nav = performance.getEntriesByType('navigation')[0]
    const pageReady = [...events]
      .reverse()
      .find((event) => event.kind === 'page-ready' && event.page === id)

    const fetches = events
      .filter((event) => event.kind === 'fetch' && event.page === id)
      .map((event) => ({
        name: event.name,
        durationMs: event.durationMs,
        status: event.status ?? null,
        ok: event.ok ?? null,
      }))
      .sort((a, b) => b.durationMs - a.durationMs)

    return {
      domContentLoadedMs: nav ? nav.domContentLoadedEventEnd : null,
      loadEventMs: nav ? nav.loadEventEnd : null,
      pageReadyMs: pageReady?.durationMs ?? null,
      topFetches: fetches.slice(0, 6),
      totalFetchCount: fetches.length,
    }
  }, pageId)

  return {
    domContentLoadedMs:
      typeof payload.domContentLoadedMs === 'number' ? Math.round(payload.domContentLoadedMs * 10) / 10 : null,
    loadEventMs: typeof payload.loadEventMs === 'number' ? Math.round(payload.loadEventMs * 10) / 10 : null,
    pageReadyMs: typeof payload.pageReadyMs === 'number' ? Math.round(payload.pageReadyMs * 10) / 10 : null,
    topFetches: payload.topFetches,
    totalFetchCount: payload.totalFetchCount,
  }
}

async function sampleVisit(browser, target, existingContext) {
  const context = existingContext ?? (await browser.newContext())
  await context.addInitScript(() => {
    window.__clawcontrolPerfEvents = []
  })

  const page = await context.newPage()
  await page.goto(`${BASE_URL}${target.path}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })

  const metrics = await getPageMetrics(target.id, page)
  await page.close()

  if (!existingContext) {
    await context.close()
  }

  return metrics
}

test('capture perf page timings', async ({ browser }) => {
  const output = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    runs: PAGE_RUNS,
    pages: [],
  }

  for (const target of pageTargets) {
    const coldSamples = []
    const warmSamples = []

    for (let i = 0; i < PAGE_RUNS; i += 1) {
      coldSamples.push(await sampleVisit(browser, target))
    }

    const warmContext = await browser.newContext()
    try {
      const warmupPage = await warmContext.newPage()
      await warmupPage.goto(`${BASE_URL}${target.path}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      await warmupPage.close()

      for (let i = 0; i < PAGE_RUNS; i += 1) {
        warmSamples.push(await sampleVisit(browser, target, warmContext))
      }
    } finally {
      await warmContext.close()
    }

    const coldReady = coldSamples.map((sample) => sample.pageReadyMs).filter((v) => typeof v === 'number')
    const warmReady = warmSamples.map((sample) => sample.pageReadyMs).filter((v) => typeof v === 'number')
    const coldDcl = coldSamples.map((sample) => sample.domContentLoadedMs).filter((v) => typeof v === 'number')
    const warmDcl = warmSamples.map((sample) => sample.domContentLoadedMs).filter((v) => typeof v === 'number')

    output.pages.push({
      pageId: target.id,
      path: target.path,
      coldSamples,
      warmSamples,
      stats: {
        coldPageReadyP50Ms: percentile(coldReady, 50),
        coldPageReadyP95Ms: percentile(coldReady, 95),
        warmPageReadyP50Ms: percentile(warmReady, 50),
        warmPageReadyP95Ms: percentile(warmReady, 95),
        coldDclP50Ms: percentile(coldDcl, 50),
        coldDclP95Ms: percentile(coldDcl, 95),
        warmDclP50Ms: percentile(warmDcl, 50),
        warmDclP95Ms: percentile(warmDcl, 95),
      },
      criticalPath: {
        coldTopFetches: coldSamples[0]?.topFetches ?? [],
        warmTopFetches: warmSamples[0]?.topFetches ?? [],
      },
    })
  }

  await mkdir(dirname(OUTPUT_PATH), { recursive: true })
  await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
})
