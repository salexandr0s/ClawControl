export const ERROR_ANALYTICS_SCHEMA_WARNING =
  'Error analytics schema is out of date. Run `npm run db:migrate --workspace=clawcontrol`.'
export const ERROR_ANALYTICS_SCHEMA_CODE = 'ERROR_ANALYTICS_SCHEMA_OUTDATED'

const SCHEMA_MISMATCH_PATTERN = /no such table|no such column|P2021|P2022|SQLITE_ERROR|schema/i

const SCHEMA_MARKERS = [
  'error_signature_aggregates',
  'error_signature_daily_aggregates',
  'error_daily_aggregates',
  'error_ingestion_cursors',
  'error_signature_insights',
  'last_sample_raw_redacted',
  'errorsignatureaggregate',
  'errorsignaturedailyaggregate',
  'errordailyaggregate',
  'erroringestioncursor',
  'errorsignatureinsight',
]

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error ?? '')
}

export function isErrorAnalyticsSchemaDrift(error: unknown): boolean {
  const message = normalizeErrorMessage(error)
  if (!SCHEMA_MISMATCH_PATTERN.test(message)) return false
  const lower = message.toLowerCase()
  return SCHEMA_MARKERS.some((marker) => lower.includes(marker))
}
