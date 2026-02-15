import 'server-only'

import type {
  ClawHubFilePayload,
  ClawHubListSort,
  ClawHubSearchResponse,
  ClawHubSkillDetailResponse,
  ClawHubSkillVersionResponse,
  ClawHubSkillsListResponse,
  ClawHubVersionsListResponse,
  ClawHubVersionFileEntry,
} from './types'

export interface SearchSkillsInput {
  query?: string
  sort?: ClawHubListSort
  limit?: number
  cursor?: string | null
  highlightedOnly?: boolean
}

export interface ClawHubAdapter {
  /**
   * Search skills. If `query` is provided, uses ClawHub's search endpoint.
   * Otherwise returns the curated list endpoint.
   */
  searchSkills(input: SearchSkillsInput): Promise<
    | { source: 'skills'; data: ClawHubSkillsListResponse }
    | { source: 'search'; data: ClawHubSearchResponse }
  >

  getSkill(slug: string): Promise<ClawHubSkillDetailResponse>

  listVersions(slug: string, input?: { limit?: number; cursor?: string | null }): Promise<ClawHubVersionsListResponse>

  getSkillVersion(slug: string, version: string): Promise<ClawHubSkillVersionResponse>

  listFiles(slug: string, version: string): Promise<ClawHubVersionFileEntry[]>

  getFile(slug: string, version: string, path: string): Promise<ClawHubFilePayload>

  /**
   * Fetch a version zip. This is not cached and may be rate-limited upstream.
   * Returns raw bytes and important headers for proxying.
   */
  downloadZip(slug: string, version: string): Promise<{ bytes: Uint8Array; contentType: string; fileName: string | null }>
}

