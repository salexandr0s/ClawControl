export interface CronCreateFormValues {
  name: string
  enabled: boolean
  scheduleKind: 'cron' | 'every' | 'at'
  cronExpr: string
  every: string
  at: string
  tz: string
  stagger: string
  exact: boolean
  payloadKind: 'agentTurn' | 'systemEvent'
  payloadText: string
  sessionTarget: 'isolated' | 'main'
  wakeMode: 'now' | 'next-heartbeat'
  deliveryMode: 'none' | 'announce' | 'webhook'
  deliveryChannel: string
  deliveryTo: string
  deliveryBestEffort: boolean
}

export interface CronCreateApiBody {
  name: string
  enabled: boolean
  schedule: {
    kind: 'cron' | 'every' | 'at'
    expr?: string
    every?: string
    at?: string
    tz?: string
    stagger?: string
    exact?: boolean
  }
  payload: {
    kind: 'agentTurn' | 'systemEvent'
    text: string
  }
  sessionTarget: 'isolated' | 'main'
  wakeMode: 'now' | 'next-heartbeat'
  delivery: {
    mode: 'none' | 'announce' | 'webhook'
    channel?: string
    to?: string
    bestEffort?: boolean
  }
}

export function buildCronCreateBody(
  values: CronCreateFormValues
): { ok: true; body: CronCreateApiBody } | { ok: false; error: string } {
  const name = values.name.trim()
  if (!name) return { ok: false, error: 'Name is required' }

  const payloadText = values.payloadText.trim()
  if (!payloadText) return { ok: false, error: 'Payload text is required' }

  if (values.sessionTarget === 'main' && values.payloadKind !== 'systemEvent') {
    return { ok: false, error: 'Main session jobs must use systemEvent payload' }
  }

  if (values.sessionTarget === 'isolated' && values.payloadKind !== 'agentTurn') {
    return { ok: false, error: 'Isolated session jobs must use agentTurn payload' }
  }

  if (values.sessionTarget !== 'isolated' && values.deliveryMode !== 'none') {
    return { ok: false, error: 'Delivery mode announce/webhook requires isolated session' }
  }

  const schedule: CronCreateApiBody['schedule'] = {
    kind: values.scheduleKind,
  }

  if (values.scheduleKind === 'cron') {
    const expr = values.cronExpr.trim()
    if (!expr) return { ok: false, error: 'Cron expression is required' }
    schedule.expr = expr
    if (values.tz.trim()) schedule.tz = values.tz.trim()
    if (values.stagger.trim()) schedule.stagger = values.stagger.trim()
    if (values.exact) schedule.exact = true
  } else if (values.scheduleKind === 'every') {
    const every = values.every.trim()
    if (!every) return { ok: false, error: 'Every interval is required' }
    schedule.every = every
  } else {
    const at = values.at.trim()
    if (!at) return { ok: false, error: 'At value is required' }
    schedule.at = at
  }

  const delivery: CronCreateApiBody['delivery'] = {
    mode: values.deliveryMode,
  }
  if (values.deliveryChannel.trim()) delivery.channel = values.deliveryChannel.trim()
  if (values.deliveryTo.trim()) delivery.to = values.deliveryTo.trim()
  if (values.deliveryBestEffort) delivery.bestEffort = true

  return {
    ok: true,
    body: {
      name,
      enabled: values.enabled,
      schedule,
      payload: {
        kind: values.payloadKind,
        text: payloadText,
      },
      sessionTarget: values.sessionTarget,
      wakeMode: values.wakeMode,
      delivery,
    },
  }
}
