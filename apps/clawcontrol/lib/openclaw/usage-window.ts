export const USAGE_RANGE_ROUND_MS = 60_000

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

export function resolveUsageWindowIso(days: number, nowMs: number = Date.now()): { fromIso: string; toIso: string } {
  const roundedNowMs = Math.floor(nowMs / USAGE_RANGE_ROUND_MS) * USAGE_RANGE_ROUND_MS
  const to = new Date(roundedNowMs)

  const toDay = startOfUtcDay(to)
  const safeDays = Math.max(1, Math.floor(days))
  const from = new Date(toDay)
  from.setUTCDate(toDay.getUTCDate() - (safeDays - 1))

  return {
    fromIso: from.toISOString(),
    toIso: to.toISOString(),
  }
}

export function getUtcInclusiveDayCount(fromIso: string, toIso: string): number {
  const from = startOfUtcDay(new Date(fromIso))
  const to = startOfUtcDay(new Date(toIso))
  const diffMs = to.getTime() - from.getTime()

  if (!Number.isFinite(diffMs)) return 1

  const dayCount = Math.floor(diffMs / 86_400_000) + 1
  return dayCount > 0 ? dayCount : 1
}

export function computeUsageAvgPerDay(input: {
  totalTokens: string
  totalCostMicros: string
  dayCount: number
}): {
  avgTokens: string
  avgCostMicros: string
} | null {
  const safeDayCount = BigInt(Math.max(1, input.dayCount))

  try {
    const totalTokens = BigInt(input.totalTokens)
    const totalCostMicros = BigInt(input.totalCostMicros)

    return {
      avgTokens: (totalTokens / safeDayCount).toString(),
      avgCostMicros: (totalCostMicros / safeDayCount).toString(),
    }
  } catch {
    return null
  }
}
