import { describe, expect, it } from 'vitest'
import { buildCronCreateBody } from '@/lib/cron/create-request'

describe('cron create request builder', () => {
  it('serializes the new create form state into 2.17 API payload', () => {
    const built = buildCronCreateBody({
      name: 'nightly-summary',
      enabled: true,
      scheduleKind: 'cron',
      cronExpr: '0 * * * *',
      every: '',
      at: '',
      tz: 'UTC',
      stagger: '20s',
      exact: true,
      payloadKind: 'agentTurn',
      payloadText: 'Summarize overnight changes',
      sessionTarget: 'isolated',
      wakeMode: 'now',
      deliveryMode: 'none',
      deliveryChannel: '',
      deliveryTo: '',
      deliveryBestEffort: false,
    })

    expect(built.ok).toBe(true)
    if (!built.ok) return

    expect(built.body).toEqual({
      name: 'nightly-summary',
      enabled: true,
      schedule: {
        kind: 'cron',
        expr: '0 * * * *',
        tz: 'UTC',
        stagger: '20s',
        exact: true,
      },
      payload: {
        kind: 'agentTurn',
        text: 'Summarize overnight changes',
      },
      sessionTarget: 'isolated',
      wakeMode: 'now',
      delivery: {
        mode: 'none',
      },
    })
  })

  it('supports webhook delivery fields in serialized payload', () => {
    const built = buildCronCreateBody({
      name: 'webhook-job',
      enabled: false,
      scheduleKind: 'every',
      cronExpr: '',
      every: '30m',
      at: '',
      tz: '',
      stagger: '',
      exact: false,
      payloadKind: 'agentTurn',
      payloadText: 'Ping webhook',
      sessionTarget: 'isolated',
      wakeMode: 'next-heartbeat',
      deliveryMode: 'webhook',
      deliveryChannel: 'webhook',
      deliveryTo: 'https://hooks.example.com/openclaw',
      deliveryBestEffort: true,
    })

    expect(built.ok).toBe(true)
    if (!built.ok) return

    expect(built.body.delivery).toEqual({
      mode: 'webhook',
      channel: 'webhook',
      to: 'https://hooks.example.com/openclaw',
      bestEffort: true,
    })
  })

  it('rejects invalid form combinations', () => {
    const built = buildCronCreateBody({
      name: 'invalid',
      enabled: true,
      scheduleKind: 'cron',
      cronExpr: '',
      every: '',
      at: '',
      tz: '',
      stagger: '',
      exact: false,
      payloadKind: 'agentTurn',
      payloadText: '',
      sessionTarget: 'main',
      wakeMode: 'now',
      deliveryMode: 'announce',
      deliveryChannel: '',
      deliveryTo: '',
      deliveryBestEffort: false,
    })

    expect(built.ok).toBe(false)
    if (built.ok) return
    expect(built.error.length).toBeGreaterThan(0)
  })
})
