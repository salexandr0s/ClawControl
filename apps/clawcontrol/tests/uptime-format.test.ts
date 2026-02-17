import { describe, expect, it } from 'vitest'
import { formatUptimeSeconds } from '@/lib/utils'

describe('formatUptimeSeconds', () => {
  it('shows seconds for short uptimes', () => {
    expect(formatUptimeSeconds(45)).toBe('45s')
  })

  it('shows minutes for sub-hour uptimes', () => {
    expect(formatUptimeSeconds(209)).toBe('3m')
  })

  it('shows hours and minutes under one day', () => {
    expect(formatUptimeSeconds(4_561)).toBe('1h 16m')
  })

  it('shows days and hours for long uptimes', () => {
    expect(formatUptimeSeconds(95_000)).toBe('1d 2h')
  })
})
