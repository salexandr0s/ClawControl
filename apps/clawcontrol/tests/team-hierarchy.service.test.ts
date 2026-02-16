import { describe, expect, it } from 'vitest'
import {
  assertValidTeamHierarchy,
  buildTeamHierarchyFromTemplateDefaults,
  TeamHierarchyValidationError,
  validateTeamHierarchy,
} from '@/lib/services/team-hierarchy'

describe('team-hierarchy service', () => {
  it('normalizes valid hierarchy with sorted/deduped links', () => {
    const result = validateTeamHierarchy(
      {
        version: 1,
        members: {
          manager: {
            reportsTo: null,
            delegatesTo: ['build', 'build', 'research'],
            receivesFrom: ['build'],
            canMessage: ['research', 'build', 'build'],
            capabilities: { canDelegate: true, canSendMessages: true },
          },
          build: {
            reportsTo: 'manager',
            delegatesTo: [],
            receivesFrom: ['manager'],
            canMessage: ['manager'],
            capabilities: { canDelegate: false },
          },
          research: {
            reportsTo: 'manager',
            delegatesTo: [],
            receivesFrom: ['manager'],
            canMessage: ['manager'],
            capabilities: {},
          },
        },
      },
      ['manager', 'build', 'research']
    )

    expect(result.ok).toBe(true)
    expect(result.normalized.members.manager.delegatesTo).toEqual(['build', 'research'])
    expect(result.normalized.members.manager.canMessage).toEqual(['build', 'research'])
  })

  it('rejects reportsTo cycles', () => {
    const result = validateTeamHierarchy(
      {
        version: 1,
        members: {
          a: { reportsTo: 'b', delegatesTo: [], receivesFrom: [], canMessage: [], capabilities: {} },
          b: { reportsTo: 'a', delegatesTo: [], receivesFrom: [], canMessage: [], capabilities: {} },
        },
      },
      ['a', 'b']
    )

    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.code === 'REPORTS_TO_CYCLE')).toBe(true)
  })

  it('enforces canSendMessages/canDelegate conflicts', () => {
    expect(() => assertValidTeamHierarchy(
      {
        version: 1,
        members: {
          manager: {
            reportsTo: null,
            delegatesTo: ['build'],
            receivesFrom: [],
            canMessage: ['build'],
            capabilities: { canDelegate: false, canSendMessages: false },
          },
          build: {
            reportsTo: 'manager',
            delegatesTo: [],
            receivesFrom: [],
            canMessage: [],
            capabilities: {},
          },
        },
      },
      ['manager', 'build']
    )).toThrow(TeamHierarchyValidationError)
  })

  it('builds hierarchy from template defaults', () => {
    const templatesById = new Map([
      ['manager', {
        id: 'manager',
        config: {
          teamDefaults: {
            reportsTo: null,
            delegatesTo: ['build'],
            receivesFrom: ['build'],
            canMessage: ['build'],
            capabilities: {
              canDelegate: true,
              canSendMessages: true,
            },
          },
        },
      } as any],
      ['build', {
        id: 'build',
        config: {
          teamDefaults: {
            reportsTo: 'manager',
            delegatesTo: [],
            receivesFrom: ['manager'],
            canMessage: ['manager'],
            capabilities: {
              canDelegate: false,
            },
          },
        },
      } as any],
    ])

    const hierarchy = buildTeamHierarchyFromTemplateDefaults(['manager', 'build'], templatesById)
    expect(hierarchy.version).toBe(1)
    expect(hierarchy.members.manager.delegatesTo).toEqual(['build'])
    expect(hierarchy.members.build.reportsTo).toBe('manager')
  })
})

