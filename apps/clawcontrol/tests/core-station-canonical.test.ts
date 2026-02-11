import { describe, expect, it } from 'vitest'
import { CANONICAL_STATION_IDS, isCanonicalStationId, normalizeStationId } from '@clawcontrol/core'

describe('canonical station helpers', () => {
  it('exposes the v1 canonical station set', () => {
    expect(CANONICAL_STATION_IDS).toEqual([
      'strategic',
      'orchestration',
      'spec',
      'build',
      'qa',
      'security',
      'ops',
      'ship',
      'compound',
      'update',
    ])
  })

  it('normalizes and validates station ids', () => {
    expect(normalizeStationId(' OPS ')).toBe('ops')
    expect(isCanonicalStationId('OPS')).toBe(true)
    expect(isCanonicalStationId('random')).toBe(false)
  })
})

