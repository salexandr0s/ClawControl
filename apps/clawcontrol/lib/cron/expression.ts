/**
 * Normalize cron expressions to a 5-field form used by ClawControl helpers.
 *
 * OpenClaw jobs may carry either:
 * - 5 fields: minute hour day month weekday
 * - 6 fields: second minute hour day month weekday
 */
export function normalizeCronExpressionToFiveFields(
  expr: string | undefined
): string | null {
  if (!expr || !expr.trim()) return null
  const parts = expr.trim().replace(/\s+/g, ' ').split(' ')
  if (parts.length === 5) return parts.join(' ')
  if (parts.length === 6) return parts.slice(1).join(' ')
  return null
}
