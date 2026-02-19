import { describe, expect, it } from 'vitest'
import { AGENT_ROLE_MAP, generateOverlayContent, generateSoulContent } from '@/lib/workspace'

describe('workspace agent contract generation', () => {
  it('includes security role mapping in AGENT_ROLE_MAP', () => {
    expect(AGENT_ROLE_MAP.security).toBeDefined()
    expect(AGENT_ROLE_MAP.security.station).toBe('security')
  })

  it('normalizes wf-security role/station and includes security governance block', () => {
    const content = generateSoulContent({
      displayName: 'wf-security',
      slug: 'wf-security',
      role: 'qa',
      purpose: 'security checks',
      capabilities: ['security'],
      station: 'qa',
    })

    expect(content).toContain('role of **security**')
    expect(content).toContain('## Station: security')
    expect(content).toContain('### Security Governance')
  })

  it('includes ops relay governance in overlay generation', () => {
    const content = generateOverlayContent({
      displayName: 'wf-ops',
      slug: 'wf-ops',
      role: 'ops',
      purpose: 'ops checks',
      capabilities: ['ops'],
      station: 'ops',
    })

    expect(content).toContain('NO_REPLY')
    expect(content).toContain('NO_ACTION')
    expect(content).toContain('wf-ops -> main -> user')
  })
})
