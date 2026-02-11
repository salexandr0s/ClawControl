export const STATION_MUTATIONS_DISABLED_ERROR = 'STATION_MUTATIONS_DISABLED'
export const STATION_MUTATIONS_DISABLED_MESSAGE =
  'Station mutations are locked for v1 defaults. Canonical stations are read-only.'

/**
 * Station create/update/delete is locked by default in v1.
 * Set CLAWCONTROL_ENABLE_STATION_MUTATIONS=1 to enable mutations temporarily.
 */
export function areStationMutationsEnabled(): boolean {
  return (
    process.env.CLAWCONTROL_ENABLE_STATION_MUTATIONS === '1'
    || process.env.NEXT_PUBLIC_ENABLE_STATION_MUTATIONS === '1'
  )
}
