export interface WhatsNewSection {
  title: string
  items: string[]
}

export interface WhatsNewPayload {
  version: string
  title: string
  publishedAt: string | null
  highlights: string[]
  sections: WhatsNewSection[]
  releaseUrl: string
}

const BULLET_PATTERN = /^([-*•]|\d+\.)\s+/
const PREFERRED_SECTION_PATTERN = /\b(changelog|changes?|highlights?|fixes?|improvements?|enhancements?|features?)\b/i
const EXCLUDED_SECTION_PATTERN = /\b(install|installation|how to install|setup|getting started|upgrade|requirements?|prerequisites?|downloads?|quickstart)\b/i
const EXCLUDED_ITEM_PATTERN = /\b(install|installation|setup|configure|configuration|getting started|quickstart)\b/i

function normalizeLines(input: string): string[] {
  return input.replace(/\r\n/g, '\n').split('\n')
}

function cleanupBullet(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  // Strip leading bullet markers.
  const withoutMarker = trimmed.replace(BULLET_PATTERN, '')
  // Collapse whitespace.
  return withoutMarker.replace(/\s+/g, ' ').trim()
}

function isHeadingLine(line: string): boolean {
  return /^#{1,6}\s+/.test(line.trim())
}

function extractHeadingTitle(line: string): string | null {
  const match = line.trim().match(/^#{1,6}\s+(.+)$/)
  if (!match) return null
  return match[1].replace(/\s+#+\s*$/, '').trim().replace(/\s+/g, ' ')
}

function shouldExcludeTitle(title: string): boolean {
  return EXCLUDED_SECTION_PATTERN.test(title)
}

function shouldIncludeAsPreferredTitle(title: string): boolean {
  return PREFERRED_SECTION_PATTERN.test(title)
}

function shouldExcludeItem(text: string): boolean {
  return EXCLUDED_ITEM_PATTERN.test(text.toLowerCase())
}

function extractItemsFromLines(lines: string[], maxItems: number): string[] {
  const bulletItems: string[] = []
  let inCodeFence = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (/^```/.test(trimmed)) {
      inCodeFence = !inCodeFence
      continue
    }
    if (inCodeFence || !trimmed || isHeadingLine(trimmed)) continue
    if (!BULLET_PATTERN.test(trimmed)) continue

    const bullet = cleanupBullet(trimmed)
    if (!bullet || shouldExcludeItem(bullet)) continue
    bulletItems.push(bullet)
    if (bulletItems.length >= maxItems) return bulletItems
  }

  if (bulletItems.length > 0) return bulletItems

  const plainItems: string[] = []
  inCodeFence = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (/^```/.test(trimmed)) {
      inCodeFence = !inCodeFence
      continue
    }
    if (inCodeFence || !trimmed || isHeadingLine(trimmed)) continue
    if (shouldExcludeItem(trimmed)) continue
    plainItems.push(trimmed.replace(/\s+/g, ' '))
    if (plainItems.length >= maxItems) break
  }

  return plainItems
}

function parseMarkdownSections(lines: string[]): Array<{ title: string; content: string[] }> {
  const sections: Array<{ title: string; content: string[] }> = []
  let currentTitle: string | null = null
  let currentContent: string[] = []

  const flush = () => {
    if (!currentTitle) return
    sections.push({
      title: currentTitle,
      content: currentContent,
    })
  }

  for (const line of lines) {
    const headingTitle = extractHeadingTitle(line)
    if (headingTitle) {
      flush()
      currentTitle = headingTitle
      currentContent = []
      continue
    }
    if (currentTitle) currentContent.push(line)
  }

  flush()
  return sections
}

export function extractReleaseSections(
  body: string | null | undefined,
  options?: { maxSections?: number; maxItemsPerSection?: number }
): WhatsNewSection[] {
  if (typeof body !== 'string' || body.trim().length === 0) return []

  const maxSections = Math.max(1, options?.maxSections ?? 4)
  const maxItemsPerSection = Math.max(1, options?.maxItemsPerSection ?? 8)
  const lines = normalizeLines(body)
  const parsedSections = parseMarkdownSections(lines)

  const structuredSections = parsedSections
    .map((section) => ({
      title: section.title,
      items: extractItemsFromLines(section.content, maxItemsPerSection),
      preferred: shouldIncludeAsPreferredTitle(section.title),
      excluded: shouldExcludeTitle(section.title),
    }))
    .filter((section) => section.items.length > 0 && !section.excluded)

  const preferredSections = structuredSections.filter((section) => section.preferred)
  if (preferredSections.length > 0) {
    return preferredSections.slice(0, maxSections).map((section) => ({
      title: section.title,
      items: section.items,
    }))
  }

  if (structuredSections.length > 0) {
    return structuredSections.slice(0, maxSections).map((section) => ({
      title: section.title,
      items: section.items,
    }))
  }

  const fallbackItems = extractItemsFromLines(lines, maxItemsPerSection)
  if (fallbackItems.length > 0) {
    return [{ title: 'Highlights', items: fallbackItems }]
  }

  return []
}

export function extractReleaseHighlights(body: string | null | undefined, maxItems = 8): string[] {
  const sections = extractReleaseSections(body, {
    maxSections: 3,
    maxItemsPerSection: maxItems,
  })
  if (sections.length === 0) return []
  return sections.flatMap((section) => section.items).slice(0, maxItems)
}

export function buildWhatsNewPayload(input: {
  version: string
  title: string
  publishedAt: string | null
  body: string | null | undefined
  releaseUrl: string
}): WhatsNewPayload {
  const sections = extractReleaseSections(input.body)
  const highlights = sections.flatMap((section) => section.items).slice(0, 8)
  const fallbackHighlights = ['No highlights were published for this release.']
  const fallbackSections: WhatsNewSection[] = [{
    title: 'Highlights',
    items: fallbackHighlights,
  }]

  return {
    version: input.version,
    title: input.title,
    publishedAt: input.publishedAt,
    highlights: highlights.length > 0 ? highlights : fallbackHighlights,
    sections: sections.length > 0 ? sections : fallbackSections,
    releaseUrl: input.releaseUrl,
  }
}
