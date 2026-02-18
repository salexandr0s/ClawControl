export interface RuntimeRequirements {
  bins: string[]
  envVars: string[]
  primaryEnv: string | null
}

interface ParsedRuntimeMetadata {
  bins: string[]
  envVars: string[]
  primaryEnv: string | null
}

const LIKELY_ENV_SUFFIXES = [
  '_API_KEY',
  '_TOKEN',
  '_SECRET',
  '_KEY',
  '_ACCOUNT',
  '_PASSWORD',
  '_URL',
  '_HOST',
  '_PORT',
  '_MODEL',
  '_ENDPOINT',
  '_ORG',
  '_PROJECT',
] as const

function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right))
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean)
}

function extractFrontmatter(content: string): string | null {
  if (!content.startsWith('---')) return null
  const match = content.match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/)
  return match?.[1] ?? null
}

function parseInlineMetadataJson(frontmatter: string): Record<string, unknown> | null {
  const line = frontmatter.split('\n').find((entry) => /^\s*metadata:\s*/i.test(entry))
  if (!line) return null

  const rawValue = line.replace(/^\s*metadata:\s*/i, '').trim()
  if (!rawValue) return null

  const parseCandidate = (candidate: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(candidate) as unknown
      return asRecord(parsed)
    } catch {
      return null
    }
  }

  const direct = parseCandidate(rawValue)
  if (direct) return direct

  if (
    (rawValue.startsWith('"') && rawValue.endsWith('"'))
    || (rawValue.startsWith("'") && rawValue.endsWith("'"))
  ) {
    const unquoted = rawValue.slice(1, -1)
    const unquotedParsed = parseCandidate(unquoted)
    if (unquotedParsed) return unquotedParsed

    const normalized = unquoted.replace(/\\"/g, '"')
    const normalizedParsed = parseCandidate(normalized)
    if (normalizedParsed) return normalizedParsed
  }

  return null
}

function parseRuntimeMetadataFromSkillMd(skillMd: string): ParsedRuntimeMetadata {
  const frontmatter = extractFrontmatter(skillMd)
  if (!frontmatter) return { bins: [], envVars: [], primaryEnv: null }

  const metadata = parseInlineMetadataJson(frontmatter)
  if (!metadata) return { bins: [], envVars: [], primaryEnv: null }

  const clawdbot = asRecord(metadata.clawdbot)
  const requires = asRecord(clawdbot?.requires)

  const installBins = Array.isArray(clawdbot?.install)
    ? clawdbot.install.flatMap((entry) => toStringArray(asRecord(entry)?.bins))
    : []

  const bins = uniqueSorted([
    ...toStringArray(requires?.bins),
    ...installBins,
  ])

  const envVars = uniqueSorted([
    ...toStringArray(requires?.env),
    ...toStringArray(requires?.envVars),
  ])

  const primaryEnvRaw = clawdbot?.primaryEnv
  const primaryEnv = typeof primaryEnvRaw === 'string' ? primaryEnvRaw.trim() || null : null

  return { bins, envVars, primaryEnv }
}

function isLikelyEnvVar(name: string): boolean {
  if (!name.includes('_')) return false
  if (LIKELY_ENV_SUFFIXES.some((suffix) => name.endsWith(suffix))) return true
  return /^(OPENAI|ANTHROPIC|GOOGLE|AWS|AZURE|GCP|CLAW|OPENCLAW|MOLTBOT|CLAWDBOT)_/.test(name)
}

export function extractEnvVarsFromText(text: string): string[] {
  if (!text) return []

  const candidates = new Set<string>()
  const patterns = [
    /\$([A-Z][A-Z0-9_]{2,80})\b/g,
    /\bexport\s+([A-Z][A-Z0-9_]{2,80})\s*=/g,
    /\b([A-Z][A-Z0-9_]{2,80})\s*=/g,
    /`([A-Z][A-Z0-9_]{2,80})`/g,
  ]

  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
      candidates.add(match[1])
    }
  }

  return uniqueSorted(Array.from(candidates).filter((name) => isLikelyEnvVar(name)))
}

export function inferBinsFromFiles(files: Array<{ path: string }>): string[] {
  const lowerPaths = files.map((file) => file.path.toLowerCase())
  const bins: string[] = []

  const needsNode = lowerPaths.some((path) =>
    path === 'package.json' || path.endsWith('.mjs') || path.endsWith('.js') || path.endsWith('.ts')
  )
  const needsPython = lowerPaths.some((path) =>
    path === 'pyproject.toml' || path === 'requirements.txt' || path.endsWith('.py')
  )
  const needsBash = lowerPaths.some((path) => path.endsWith('.sh'))

  if (needsNode) bins.push('node')
  if (needsPython) bins.push('python')
  if (needsBash) bins.push('bash')

  return bins
}

export function extractRuntimeRequirements(input: {
  files: Array<{ path: string }>
  skillMd: string
}): RuntimeRequirements {
  const fromMetadata = parseRuntimeMetadataFromSkillMd(input.skillMd)
  const fromFiles = inferBinsFromFiles(input.files)
  const fromText = extractEnvVarsFromText(input.skillMd)

  const envVars = uniqueSorted([
    ...fromMetadata.envVars,
    ...fromText,
    fromMetadata.primaryEnv,
  ])

  return {
    bins: uniqueSorted([...fromFiles, ...fromMetadata.bins]),
    envVars,
    primaryEnv: fromMetadata.primaryEnv ?? envVars[0] ?? null,
  }
}
