import { NextRequest, NextResponse } from 'next/server'
import { withRouteTiming } from '@/lib/perf/route-timing'
import {
  getUsageExploreBreakdown,
  getUsageExploreSummary,
  parseUsageExploreFiltersFromSearchParams,
} from '@/lib/openclaw/usage-explore-query'

function csvCell(value: string | number | null): string {
  const normalized = value === null ? '' : String(value)
  const escaped = normalized.replaceAll('"', '""')
  return `"${escaped}"`
}

function toCsv(input: {
  summary: Awaited<ReturnType<typeof getUsageExploreSummary>>
  breakdown: Awaited<ReturnType<typeof getUsageExploreBreakdown>>
}): string {
  const lines: string[] = []

  lines.push(`${csvCell('from')},${csvCell(input.summary.from)}`)
  lines.push(`${csvCell('to')},${csvCell(input.summary.to)}`)
  lines.push(`${csvCell('timezone')},${csvCell(input.summary.timezone)}`)
  lines.push('')

  lines.push('"daily_series"')
  lines.push([
    'dayStart',
    'inputTokens',
    'outputTokens',
    'cacheReadTokens',
    'cacheWriteTokens',
    'totalTokens',
    'totalCostMicros',
  ].map(csvCell).join(','))

  for (const point of input.summary.series) {
    lines.push([
      point.dayStart,
      point.inputTokens,
      point.outputTokens,
      point.cacheReadTokens,
      point.cacheWriteTokens,
      point.totalTokens,
      point.totalCostMicros,
    ].map(csvCell).join(','))
  }

  lines.push('')
  lines.push('"model_breakdown"')
  lines.push(['key', 'totalTokens', 'totalCostMicros', 'sessionCount'].map(csvCell).join(','))

  for (const group of input.breakdown.groups) {
    lines.push([
      group.key,
      group.totalTokens,
      group.totalCostMicros,
      group.sessionCount,
    ].map(csvCell).join(','))
  }

  return lines.join('\n')
}

const getUsageExploreExportRoute = async (request: NextRequest) => {
  const { searchParams } = new URL(request.url)
  const filters = parseUsageExploreFiltersFromSearchParams(searchParams)
  const format = (searchParams.get('format') ?? 'csv').toLowerCase()

  const [summary, breakdown] = await Promise.all([
    getUsageExploreSummary(filters),
    getUsageExploreBreakdown({
      ...filters,
      groupBy: 'model',
    }),
  ])

  if (format === 'json') {
    return NextResponse.json({
      data: {
        summary,
        breakdown,
      },
    })
  }

  if (format !== 'csv') {
    return NextResponse.json({ error: 'Invalid format' }, { status: 400 })
  }

  const csv = toCsv({ summary, breakdown })
  const stamp = new Date().toISOString().slice(0, 19).replaceAll(':', '-')

  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="usage-export-${stamp}.csv"`,
    },
  })
}

export const GET = withRouteTiming('api.openclaw.usage.explore.export.get', getUsageExploreExportRoute)
