import 'server-only'

import { getOrLoadWithCache } from '@/lib/perf/async-cache'
import type { ClawHubAdapter, SearchSkillsInput } from './adapter'
import type {
  ClawHubFilePayload,
  ClawHubSearchResponse,
  ClawHubSkillDetailResponse,
  ClawHubSkillVersionResponse,
  ClawHubSkillsListResponse,
  ClawHubVersionsListResponse,
  ClawHubVersionFileEntry,
} from './types'

const CLAWHUB_API_BASE = 'https://clawhub.ai/api/v1'

const TTL_LIST_MS = 30_000
const TTL_SKILL_MS = 5 * 60_000
const TTL_VERSIONS_MS = 5 * 60_000
const TTL_VERSION_DETAIL_MS = 10 * 60_000
const TTL_FILE_MS = 5 * 60_000

const MAX_FILE_BYTES = 256 * 1024
const MAX_ZIP_BYTES = 20 * 1024 * 1024

function toQuery(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    sp.set(key, String(value))
  }
  const q = sp.toString()
  return q ? `?${q}` : ''
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`[clawhub] ${res.status} ${res.statusText}${text ? `: ${text.slice(0, 400)}` : ''}`)
  }

  return res.json() as Promise<T>
}

async function readBytesWithLimit(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = res.headers.get('content-length')
  if (declared) {
    const len = Number(declared)
    if (Number.isFinite(len) && len > maxBytes) {
      throw new Error(`[clawhub] response too large: ${len} bytes > ${maxBytes}`)
    }
  }

  const buf = await res.arrayBuffer()
  if (buf.byteLength > maxBytes) {
    throw new Error(`[clawhub] response too large: ${buf.byteLength} bytes > ${maxBytes}`)
  }
  return new Uint8Array(buf)
}

function normalizeSlug(slug: string): string {
  return slug.trim().toLowerCase()
}

export function createHttpClawHubAdapter(): ClawHubAdapter {
  return {
    async searchSkills(input: SearchSkillsInput) {
      const limit = Math.max(1, Math.min(50, input.limit ?? 24))
      const cursor = input.cursor ?? null
      const sort = input.sort ?? 'downloads'
      const query = (input.query ?? '').trim()

      if (query) {
        const highlightedOnly = input.highlightedOnly ?? false
        const key = `clawhub:search:${query}:${limit}:${highlightedOnly ? '1' : '0'}`
        const loaded = await getOrLoadWithCache(key, TTL_LIST_MS, async () => {
          return fetchJson<ClawHubSearchResponse>(
            `${CLAWBHUB_SEARCH_URL}${toQuery({ q: query, limit, highlightedOnly })}`
          )
        })
        return { source: 'search' as const, data: loaded.value }
      }

      const key = `clawhub:list:${sort}:${limit}:${cursor ?? ''}`
      const loaded = await getOrLoadWithCache(key, TTL_LIST_MS, async () => {
        return fetchJson<ClawHubSkillsListResponse>(
          `${CLAWBHUB_SKILLS_URL}${toQuery({ sort, limit, cursor })}`
        )
      })
      return { source: 'skills' as const, data: loaded.value }
    },

    async getSkill(slug: string): Promise<ClawHubSkillDetailResponse> {
      const normalized = normalizeSlug(slug)
      const key = `clawhub:skill:${normalized}`
      const loaded = await getOrLoadWithCache(key, TTL_SKILL_MS, async () => {
        return fetchJson<ClawHubSkillDetailResponse>(`${CLAWBHUB_SKILLS_URL}/${encodeURIComponent(normalized)}`)
      })
      return loaded.value
    },

    async listVersions(slug: string, input?: { limit?: number; cursor?: string | null }): Promise<ClawHubVersionsListResponse> {
      const normalized = normalizeSlug(slug)
      const limit = Math.max(1, Math.min(50, input?.limit ?? 25))
      const cursor = input?.cursor ?? null
      const key = `clawhub:versions:${normalized}:${limit}:${cursor ?? ''}`
      const loaded = await getOrLoadWithCache(key, TTL_VERSIONS_MS, async () => {
        return fetchJson<ClawHubVersionsListResponse>(
          `${CLAWBHUB_SKILLS_URL}/${encodeURIComponent(normalized)}/versions${toQuery({ limit, cursor })}`
        )
      })
      return loaded.value
    },

    async getSkillVersion(slug: string, version: string): Promise<ClawHubSkillVersionResponse> {
      const normalized = normalizeSlug(slug)
      const v = version.trim()
      const key = `clawhub:version:${normalized}@${v}`
      const loaded = await getOrLoadWithCache(key, TTL_VERSION_DETAIL_MS, async () => {
        return fetchJson<ClawHubSkillVersionResponse>(
          `${CLAWBHUB_SKILLS_URL}/${encodeURIComponent(normalized)}/versions/${encodeURIComponent(v)}`
        )
      })
      return loaded.value
    },

    async listFiles(slug: string, version: string): Promise<ClawHubVersionFileEntry[]> {
      const data = await this.getSkillVersion(slug, version)
      return Array.isArray(data.version.files) ? data.version.files : []
    },

    async getFile(slug: string, version: string, path: string): Promise<ClawHubFilePayload> {
      const normalized = normalizeSlug(slug)
      const v = version.trim()
      const p = path.trim()
      const key = `clawhub:file:${normalized}@${v}:${p}`

      const loaded = await getOrLoadWithCache(key, TTL_FILE_MS, async () => {
        const url = `${CLAWBHUB_SKILLS_URL}/${encodeURIComponent(normalized)}/file${toQuery({ path: p, version: v })}`
        const res = await fetch(url, { headers: { Accept: '*/*' } })
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          throw new Error(`[clawhub] ${res.status} ${res.statusText}${text ? `: ${text.slice(0, 200)}` : ''}`)
        }

        const bytes = await readBytesWithLimit(res, MAX_FILE_BYTES)
        return {
          bytes,
          contentType: res.headers.get('content-type'),
          sha256: res.headers.get('x-content-sha256'),
          size: res.headers.get('x-content-size'),
          etag: res.headers.get('etag'),
        } satisfies {
          bytes: Uint8Array
          contentType: string | null
          sha256: string | null
          size: string | null
          etag: string | null
        }
      })

      const payload = loaded.value as unknown as {
        bytes: Uint8Array
        contentType: string | null
        sha256: string | null
        size: string | null
        etag: string | null
      }

      return {
        bytes: payload.bytes,
        contentType: payload.contentType,
        sha256: payload.sha256,
        size: payload.size ? Number(payload.size) : null,
        etag: payload.etag,
      }
    },

    async downloadZip(slug: string, version: string): Promise<{ bytes: Uint8Array; contentType: string; fileName: string | null }> {
      const normalized = normalizeSlug(slug)
      const v = version.trim()
      const primaryUrl = `${CLAWBHUB_DOWNLOAD_URL}${toQuery({ slug: normalized, version: v })}`

      const res = await fetch(primaryUrl, { headers: { Accept: 'application/zip,application/octet-stream' } })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`[clawhub] download failed: ${res.status} ${res.statusText}${text ? `: ${text.slice(0, 200)}` : ''}`)
      }

      const bytes = await readBytesWithLimit(res, MAX_ZIP_BYTES)
      const contentType = res.headers.get('content-type') || 'application/zip'
      const disposition = res.headers.get('content-disposition')
      const fileName = disposition ? parseContentDispositionFilename(disposition) : null

      return { bytes, contentType, fileName }
    },
  }
}

const CLAWBHUB_SKILLS_URL = `${CLAWHUB_API_BASE}/skills`
const CLAWBHUB_SEARCH_URL = `${CLAWHUB_API_BASE}/search`
const CLAWBHUB_DOWNLOAD_URL = `${CLAWHUB_API_BASE}/download`

function parseContentDispositionFilename(headerValue: string): string | null {
  // Very small parser, enough for: attachment; filename="gog-1.0.0.zip"
  const match = headerValue.match(/filename\*=UTF-8''([^;]+)|filename="([^"]+)"|filename=([^;]+)/i)
  const raw = (match?.[1] || match?.[2] || match?.[3] || '').trim()
  if (!raw) return null
  try {
    return decodeURIComponent(raw.replace(/^"|"$/g, ''))
  } catch {
    return raw.replace(/^"|"$/g, '')
  }
}
