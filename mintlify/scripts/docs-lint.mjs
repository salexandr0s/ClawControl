import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

function listFiles(dir, predicate) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...listFiles(abs, predicate))
      continue
    }
    if (entry.isFile() && predicate(abs)) out.push(abs)
  }
  return out
}

function extractFrontmatterTitle(source) {
  const lines = source.split('\n')
  if ((lines[0] || '').trim() !== '---') return null

  let end = -1
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      end = i
      break
    }
  }
  if (end === -1) return null

  for (const line of lines.slice(1, end)) {
    const match = line.match(/^\s*title:\s*(.+?)\s*$/)
    if (!match) continue
    let title = match[1].trim()
    if (
      (title.startsWith('"') && title.endsWith('"'))
      || (title.startsWith("'") && title.endsWith("'"))
    ) {
      title = title.slice(1, -1)
    }
    return title.trim() || null
  }

  return null
}

function stripFrontmatter(source) {
  if (!source.startsWith('---\n')) return source
  const lines = source.split('\n')
  if ((lines[0] || '').trim() !== '---') return source
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      return lines.slice(i + 1).join('\n')
    }
  }
  return source
}

function collectNavPages(docsJson) {
  const pages = []

  function walkNavEntry(entry) {
    if (typeof entry === 'string') {
      pages.push({ page: entry, title: null })
      return
    }

    if (!entry || typeof entry !== 'object') return

    if (typeof entry.page === 'string') {
      pages.push({ page: entry.page, title: typeof entry.title === 'string' ? entry.title : null })
      return
    }

    if (Array.isArray(entry.pages)) {
      for (const child of entry.pages) walkNavEntry(child)
    }
  }

  const navigation = docsJson?.navigation

  if (Array.isArray(navigation)) {
    for (const group of navigation) walkNavEntry(group)
    return pages
  }

  const groups = navigation?.groups ?? []
  for (const group of groups) {
    walkNavEntry(group)
  }

  const tabs = navigation?.tabs ?? []
  for (const tab of tabs) {
    for (const group of tab?.groups ?? []) walkNavEntry(group)
  }

  return pages
}

const root = process.cwd()
const docsJsonPath = join(root, 'docs.json')
const docsJson = JSON.parse(readFileSync(docsJsonPath, 'utf8'))

const mdxFiles = listFiles(root, (p) => p.endsWith('.mdx'))
const errors = []

const bannedSnippets = ['enforceTypedConfirm']

const bannedTitlePrefixes = [
  'Feature:',
  'API:',
  'Operations:',
  'Developers:',
  'Security:',
  'Quickstart:',
  'Remote Access:',
  'Product:',
]

for (const file of mdxFiles) {
  const source = readFileSync(file, 'utf8')

  for (const snippet of bannedSnippets) {
    if (source.includes(snippet)) {
      errors.push(`${file}: banned snippet "${snippet}"`)
    }
  }

  const frontmatterTitle = extractFrontmatterTitle(source)
  if (!frontmatterTitle) {
    errors.push(`${file}: missing frontmatter title ("---\\ntitle: ...\\n---")`)
  } else {
    for (const prefix of bannedTitlePrefixes) {
      if (frontmatterTitle.startsWith(prefix)) {
        errors.push(`${file}: frontmatter title uses banned prefix "${prefix}"`)
      }
    }
    if (frontmatterTitle.includes('+')) {
      errors.push(`${file}: frontmatter title contains "+", use words and commas instead`)
    }
    if (frontmatterTitle.includes('/')) {
      errors.push(`${file}: frontmatter title contains "/", avoid slash separators`)
    }
  }

  const body = stripFrontmatter(source)
  const firstLine = body.split('\n').find((line) => line.trim())?.trim() ?? ''
  if (firstLine.startsWith('# ')) {
    errors.push(`${file}: unexpected H1 ("# ..."). Use frontmatter title and start content at "##"`)
  }

  if (!source.includes('\n## Last updated\n')) {
    errors.push(`${file}: missing "## Last updated" section`)
  }

  if (!source.includes('\n## Related pages\n')) {
    errors.push(`${file}: missing "## Related pages" section`)
  }
}

const navPages = collectNavPages(docsJson)
for (const { page, title } of navPages) {
  const file = join(root, `${page}.mdx`)

  try {
    const st = statSync(file)
    if (!st.isFile()) errors.push(`docs.json page "${page}" does not resolve to a file: ${file}`)
  } catch {
    errors.push(`docs.json page "${page}" missing file: ${file}`)
    continue
  }

  const source = readFileSync(file, 'utf8')
  const fmTitle = extractFrontmatterTitle(source)
  if (!fmTitle) {
    errors.push(`${file}: missing frontmatter title ("---\\ntitle: ...\\n---")`)
    continue
  }

  if (title && fmTitle !== title) {
    errors.push(`${file}: docs.json title "${title}" does not match frontmatter title "${fmTitle}"`)
  }
}

if (errors.length) {
  console.error('Docs lint failed:')
  for (const err of errors) console.error(`- ${err}`)
  process.exit(1)
}

console.log(`Docs lint OK (${mdxFiles.length} MDX files checked)`)
