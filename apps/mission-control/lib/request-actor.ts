/**
 * Request Actor Extraction
 *
 * Extract actor information from request headers for attribution.
 * Used until a full auth system is implemented.
 */

import type { NextRequest } from 'next/server'

export interface ActorInfo {
  /** Formatted actor string matching existing patterns (e.g., 'user', 'system', 'agent:claw-alpha') */
  actor: string
  actorType: 'user' | 'system' | 'agent'
  actorId?: string
}

/**
 * Extract actor from request headers.
 *
 * Headers:
 * - x-savorg-actor-id: The actor identifier (e.g., 'claw-alpha', 'admin')
 * - x-savorg-actor-type: The actor type ('user' | 'system' | 'agent')
 *
 * Formats the actor string according to existing patterns:
 * - type='user' -> 'user'
 * - type='system' -> 'system'
 * - type='agent' -> 'agent:<actorId>'
 *
 * Falls back to 'system' if no headers provided.
 */
export function getRequestActor(request: NextRequest): ActorInfo {
  const actorId = request.headers.get('x-savorg-actor-id')
  const actorType = request.headers.get('x-savorg-actor-type') as 'user' | 'system' | 'agent' | null

  // Default to system for automated/API calls without headers
  if (!actorType && !actorId) {
    return { actor: 'system', actorType: 'system' }
  }

  // If only actorId is provided, assume it's a user
  if (!actorType && actorId) {
    return { actor: 'user', actorType: 'user', actorId }
  }

  // Format actor string based on type
  switch (actorType) {
    case 'agent':
      return {
        actor: actorId ? `agent:${actorId}` : 'agent:unknown',
        actorType: 'agent',
        actorId: actorId ?? undefined,
      }
    case 'system':
      return { actor: 'system', actorType: 'system' }
    case 'user':
    default:
      return { actor: 'user', actorType: 'user', actorId: actorId ?? undefined }
  }
}
