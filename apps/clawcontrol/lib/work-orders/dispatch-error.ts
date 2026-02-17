export interface DispatchErrorDisplay {
  summary: string
  hint: string | null
  raw: string | null
}

const MAX_SUMMARY_CHARS = 220

function clampSummary(value: string): string {
  if (value.length <= MAX_SUMMARY_CHARS) return value
  return `${value.slice(0, MAX_SUMMARY_CHARS - 1).trimEnd()}…`
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function firstMeaningfulLine(value: string): string {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length === 0) return 'Dispatch failed.'
  return lines[0]
}

function sanitizeSummaryLine(value: string): string {
  return value
    .replace(/^error:\s*/i, '')
    .replace(/^openclaw run failed:\s*/i, '')
    .replace(/^openclaw agent --local failed:\s*/i, '')
    .replace(/^openclaw run unavailable;\s*/i, '')
    .trim()
}

export function buildDispatchErrorDisplay(error: string | null | undefined): DispatchErrorDisplay {
  const raw = (error ?? '').trim()
  if (!raw) {
    return {
      summary: 'Dispatch failed.',
      hint: null,
      raw: null,
    }
  }

  const lowered = raw.toLowerCase()
  const hasRunUnavailable = lowered.includes('openclaw run unavailable; fallback agent_local failed')
  const hasOpenAiApiKeyMissing = lowered.includes('no api key found for provider "openai"')
    || lowered.includes("no api key found for provider 'openai'")
  const hasUnknownRunCommand = lowered.includes("unknown command 'run'")
    || lowered.includes('unknown command "run"')
    || lowered.includes('did you mean cron?')

  if (hasOpenAiApiKeyMissing) {
    return {
      summary: 'Dispatch failed because OpenAI authentication is missing for the configured model.',
      hint: 'Use openai-codex/gpt-5.3-codex (OAuth) or set OPENAI_API_KEY.',
      raw,
    }
  }

  if (hasRunUnavailable) {
    return {
      summary: 'Dispatch failed because `openclaw run` is unavailable and local fallback dispatch also failed.',
      hint: hasUnknownRunCommand
        ? 'Your OpenClaw CLI does not support `run`; update the CLI or fix local fallback auth.'
        : null,
      raw,
    }
  }

  const line = sanitizeSummaryLine(firstMeaningfulLine(raw))
  const summary = clampSummary(compactWhitespace(line || 'Dispatch failed.'))

  return {
    summary,
    hint: null,
    raw,
  }
}
