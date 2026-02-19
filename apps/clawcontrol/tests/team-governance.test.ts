import { describe, expect, it } from 'vitest'
import {
  assertValidTeamGovernance,
  createDefaultTeamGovernance,
  TeamGovernanceValidationError,
} from '@/lib/services/team-governance'

describe('team governance service', () => {
  it('creates team-scoped defaults for new teams', () => {
    const config = createDefaultTeamGovernance('team_scoped')
    expect(config.agentIdentityMode).toBe('team_scoped')
    expect(config.orchestratorTemplateId).toBe('manager')
    expect(config.ops.templateId).toBe('ops')
  })

  it('falls back to legacy defaults when governance is unset for existing teams', () => {
    const config = assertValidTeamGovernance(undefined, { whenUnset: 'legacy' })
    expect(config.agentIdentityMode).toBe('legacy_global')
  })

  it('throws when governance object omits required orchestratorTemplateId', () => {
    expect(() => assertValidTeamGovernance({
      agentIdentityMode: 'team_scoped',
      ops: { templateId: 'ops' },
    })).toThrow(TeamGovernanceValidationError)
  })
})

