import { describe, expect, it } from 'vitest'
import { extractEnvVarsFromText, extractRuntimeRequirements } from '@/lib/clawhub/runtime-requirements'

describe('runtime requirements extraction', () => {
  it('extracts bins from inline metadata frontmatter JSON', () => {
    const skillMd = `---
name: gog
metadata: {"clawdbot":{"requires":{"bins":["gog"]}}}
---

Set \`GOG_ACCOUNT\` to avoid repeating --account.
`

    const result = extractRuntimeRequirements({
      files: [{ path: 'SKILL.md' }],
      skillMd,
    })

    expect(result.bins).toEqual(['gog'])
    expect(result.envVars).toEqual(['GOG_ACCOUNT'])
    expect(result.primaryEnv).toBe('GOG_ACCOUNT')
  })

  it('respects metadata env vars and primary env', () => {
    const skillMd = `---
metadata: {"clawdbot":{"requires":{"bins":["node"],"env":["TAVILY_API_KEY"]},"primaryEnv":"TAVILY_API_KEY"}}
---
`

    const result = extractRuntimeRequirements({
      files: [{ path: 'SKILL.md' }],
      skillMd,
    })

    expect(result.bins).toEqual(['node'])
    expect(result.envVars).toEqual(['TAVILY_API_KEY'])
    expect(result.primaryEnv).toBe('TAVILY_API_KEY')
  })

  it('keeps file-based bin inference as fallback', () => {
    const result = extractRuntimeRequirements({
      files: [{ path: 'package.json' }, { path: 'scripts/setup.sh' }],
      skillMd: '# Skill',
    })

    expect(result.bins).toEqual(['bash', 'node'])
    expect(result.envVars).toEqual([])
    expect(result.primaryEnv).toBeNull()
  })
})

describe('extractEnvVarsFromText', () => {
  it('filters uppercase tokens that are not likely env vars', () => {
    const text = `
Use --input USER_ENTERED and --insert INSERT_ROWS.
Set \`GOG_ACCOUNT\` for defaults.
`
    expect(extractEnvVarsFromText(text)).toEqual(['GOG_ACCOUNT'])
  })
})
