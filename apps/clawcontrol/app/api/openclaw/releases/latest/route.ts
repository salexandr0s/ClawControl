import { NextResponse } from 'next/server'

const OPENCLAW_RELEASES_API_URL = 'https://api.github.com/repos/openclaw/openclaw/releases/latest'
const OPENCLAW_RELEASES_URL = 'https://github.com/openclaw/openclaw/releases'
const REQUEST_TIMEOUT_MS = 8_000

type GitHubLatestReleaseResponse = {
  tag_name?: unknown
  name?: unknown
  html_url?: unknown
  published_at?: unknown
}

function asOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function normalizeVersion(tagName: string | null): string | null {
  if (!tagName) return null
  const normalized = tagName.replace(/^v/i, '').trim()
  return normalized.length > 0 ? normalized : null
}

export async function GET() {
  try {
    const response = await fetch(OPENCLAW_RELEASES_API_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'clawcontrol',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    if (!response.ok) {
      return NextResponse.json(
        { error: `OpenClaw release lookup failed (${response.status})` },
        { status: 502 }
      )
    }

    const payload = (await response.json()) as GitHubLatestReleaseResponse
    const tagName = asOptionalString(payload.tag_name)
    const version = normalizeVersion(tagName)
    const releaseName = asOptionalString(payload.name)
    const releaseUrl = asOptionalString(payload.html_url) ?? OPENCLAW_RELEASES_URL
    const publishedAt = asOptionalString(payload.published_at)

    return NextResponse.json({
      data: {
        tagName,
        version,
        name: releaseName,
        url: releaseUrl,
        publishedAt,
      },
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch latest OpenClaw release' },
      { status: 502 }
    )
  }
}
