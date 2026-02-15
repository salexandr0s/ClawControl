export type ClawHubListSort = 'downloads' | 'stars' | 'updated'

export interface ClawHubOwner {
  handle: string
  userId: string
  displayName: string
  image: string | null
}

export interface ClawHubModeration {
  isSuspicious: boolean
  isMalwareBlocked: boolean
}

export interface ClawHubStats {
  comments: number
  downloads: number
  installsAllTime: number
  installsCurrent: number
  stars: number
  versions: number
}

export interface ClawHubSkillSummary {
  slug: string
  displayName: string
  summary: string
  tags: { latest: string } | null
  stats: ClawHubStats
  createdAt: number
  updatedAt: number
}

export interface ClawHubSkillListItem extends ClawHubSkillSummary {
  latestVersion?: {
    version: string
    createdAt: number
    changelog: string
  }
}

export interface ClawHubSkillsListResponse {
  items: ClawHubSkillListItem[]
  nextCursor: string | null
}

export interface ClawHubSearchResultItem {
  score: number
  slug: string
  displayName: string
  summary: string
  version: string
  updatedAt: number
}

export interface ClawHubSearchResponse {
  results: ClawHubSearchResultItem[]
}

export interface ClawHubSkillDetailResponse {
  skill: ClawHubSkillSummary
  latestVersion: {
    version: string
    createdAt: number
    changelog: string
  } | null
  owner: ClawHubOwner | null
  moderation: ClawHubModeration | null
}

export interface ClawHubVersionsListItem {
  version: string
  createdAt: number
  changelog: string
  changelogSource: string | null
}

export interface ClawHubVersionsListResponse {
  items: ClawHubVersionsListItem[]
  nextCursor: string | null
}

export interface ClawHubVersionFileEntry {
  path: string
  size: number
  sha256: string
  contentType: string | null
}

export interface ClawHubSkillVersionResponse {
  skill: {
    slug: string
    displayName: string
  }
  version: {
    version: string
    createdAt: number
    changelog: string
    changelogSource: string | null
    files: ClawHubVersionFileEntry[]
  }
}

export interface ClawHubFilePayload {
  bytes: Uint8Array
  contentType: string | null
  sha256: string | null
  size: number | null
  etag: string | null
}

