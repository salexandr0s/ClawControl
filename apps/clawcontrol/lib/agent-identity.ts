export type OwnerType = 'user' | 'agent' | 'system'
export type ActorType = 'user' | 'agent' | 'system'
export type AgentNameSource = 'system' | 'openclaw' | 'user'

export interface AgentWipHint {
  id?: string
  name?: string
  role?: string
  station?: string
}

export interface OwnerRefInput {
  owner?: string | null
  ownerType?: string | null
  ownerAgentId?: string | null
}

export interface NormalizedOwnerRef {
  owner: string
  ownerType: OwnerType
  ownerAgentId: string | null
}

export interface ActorRefInput {
  actor?: string | null
  actorType?: string | null
  actorAgentId?: string | null
}

export interface NormalizedActorRef {
  actor: string
  actorType: ActorType
  actorAgentId: string | null
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase()
}

function normalizeTrimmed(value: string | null | undefined): string {
  return (value ?? '').trim()
}

function parseAgentToken(value: string | null | undefined): string | null {
  const raw = normalizeTrimmed(value)
  if (!raw) return null
  if (raw.toLowerCase().startsWith('agent:')) {
    const token = raw.slice('agent:'.length).trim()
    return token || null
  }
  return raw
}

export function extractAgentIdFromSessionKey(sessionKey: string): string | null {
  const parts = sessionKey.split(':')
  if (parts[0] !== 'agent' || !parts[1]) return null
  return parts[1]
}

export function buildOpenClawSessionKey(agentId: string): string {
  const id = agentId.trim()
  return `agent:${id}:${id}`
}

export function slugifyDisplayName(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')

  return slug || 'agent'
}

export function buildUniqueSlug(baseSlug: string, existingSlugs: Iterable<string>): string {
  const used = new Set(Array.from(existingSlugs).map((v) => normalizeToken(v)))
  const normalizedBase = slugifyDisplayName(baseSlug)

  if (!used.has(normalizedBase)) return normalizedBase

  let index = 2
  while (index < 100000) {
    const candidate = `${normalizedBase}-${index}`
    if (!used.has(candidate)) return candidate
    index += 1
  }

  return `${normalizedBase}-${Date.now()}`
}

export function inferDefaultAgentWipLimit(agent: AgentWipHint): number {
  const text = normalizeToken(
    `${agent.id ?? ''} ${agent.name ?? ''} ${agent.role ?? ''} ${agent.station ?? ''}`
  )

  if (
    text.includes('build') ||
    text.includes('code') ||
    text.includes('implement') ||
    text.includes('dev') ||
    text.includes('engineer')
  ) {
    return 3
  }

  return 2
}

export function normalizeOwnerRef(input: OwnerRefInput): NormalizedOwnerRef {
  const owner = normalizeTrimmed(input.owner)
  const explicitType = normalizeToken(input.ownerType ?? '')
  const explicitAgentId = parseAgentToken(input.ownerAgentId)

  if (explicitType === 'system') {
    return { owner: 'system', ownerType: 'system', ownerAgentId: null }
  }

  if (explicitType === 'agent') {
    if (explicitAgentId) {
      return {
        owner: `agent:${explicitAgentId}`,
        ownerType: 'agent',
        ownerAgentId: explicitAgentId,
      }
    }
    const parsedOwnerAgentId = parseAgentToken(owner)
    if (parsedOwnerAgentId && normalizeToken(parsedOwnerAgentId) !== 'user') {
      return {
        owner: `agent:${parsedOwnerAgentId}`,
        ownerType: 'agent',
        ownerAgentId: parsedOwnerAgentId,
      }
    }
  }

  const parsedOwnerAgentId = parseAgentToken(owner)
  if (parsedOwnerAgentId && normalizeToken(parsedOwnerAgentId) !== 'user' && normalizeToken(parsedOwnerAgentId) !== 'system') {
    return {
      owner: `agent:${parsedOwnerAgentId}`,
      ownerType: 'agent',
      ownerAgentId: parsedOwnerAgentId,
    }
  }

  if (normalizeToken(owner) === 'system') {
    return { owner: 'system', ownerType: 'system', ownerAgentId: null }
  }

  return { owner: 'user', ownerType: 'user', ownerAgentId: null }
}

export function normalizeActorRef(input: ActorRefInput): NormalizedActorRef {
  const actor = normalizeTrimmed(input.actor)
  const explicitType = normalizeToken(input.actorType ?? '')
  const explicitAgentId = parseAgentToken(input.actorAgentId)

  if (explicitType === 'system') {
    return { actor: 'system', actorType: 'system', actorAgentId: null }
  }

  if (explicitType === 'agent') {
    if (explicitAgentId) {
      return {
        actor: `agent:${explicitAgentId}`,
        actorType: 'agent',
        actorAgentId: explicitAgentId,
      }
    }
    const parsed = parseAgentToken(actor)
    if (parsed && normalizeToken(parsed) !== 'unknown') {
      return {
        actor: `agent:${parsed}`,
        actorType: 'agent',
        actorAgentId: parsed,
      }
    }
    return { actor: 'agent:unknown', actorType: 'agent', actorAgentId: null }
  }

  const parsedActor = parseAgentToken(actor)
  if (parsedActor && actor.toLowerCase().startsWith('agent:')) {
    return {
      actor: `agent:${parsedActor}`,
      actorType: 'agent',
      actorAgentId: parsedActor,
    }
  }

  if (normalizeToken(actor) === 'system' || normalizeToken(actor).startsWith('system:') || normalizeToken(actor).startsWith('operator:')) {
    return { actor: 'system', actorType: 'system', actorAgentId: null }
  }

  return { actor: 'user', actorType: 'user', actorAgentId: null }
}

export function ownerToActor(
  owner: string | null | undefined,
  ownerType?: OwnerType | null,
  ownerAgentId?: string | null
): string {
  return normalizeActorRef({
    actor: owner ?? null,
    actorType: ownerType ?? null,
    actorAgentId: ownerAgentId ?? null,
  }).actor
}

export function formatOwnerLabel(
  owner: string,
  ownerType?: OwnerType | string | null,
  ownerLabel?: string | null
): string {
  const preferred = normalizeTrimmed(ownerLabel)
  if (preferred) return preferred

  if (normalizeToken(ownerType ?? '') === 'user' || normalizeToken(owner) === 'user' || !normalizeToken(owner)) {
    return 'User'
  }

  if (normalizeToken(ownerType ?? '') === 'system' || normalizeToken(owner) === 'system') {
    return 'System'
  }

  if (owner.toLowerCase().startsWith('agent:')) {
    return owner.slice('agent:'.length) || 'Agent'
  }

  return owner
}

export function ownerTextTone(owner: string, ownerType?: OwnerType | string | null): 'user' | 'agent' {
  const explicit = normalizeToken(ownerType ?? '')
  if (explicit === 'agent') return 'agent'
  if (explicit === 'system' || explicit === 'user') return 'user'

  const normalized = normalizeToken(owner)
  return !normalized || normalized === 'user' || normalized === 'system' ? 'user' : 'agent'
}
