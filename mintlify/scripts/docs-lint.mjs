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

function extractH1Title(source) {
  const lines = source.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('# ')) return trimmed.slice(2).trim()
    return null
  }
  return null
}

function collectNavPages(docsJson) {
  const pages = []
  const tabs = docsJson?.navigation?.tabs ?? []
  for (const tab of tabs) {
    for (const group of tab?.groups ?? []) {
      for (const item of group?.pages ?? []) {
        if (typeof item === 'string') {
          pages.push({ page: item, title: null })
          continue
        }
        if (item && typeof item === 'object' && typeof item.page === 'string') {
          pages.push({ page: item.page, title: typeof item.title === 'string' ? item.title : null })
        }
      }
    }
  }
  return pages
}

const root = process.cwd()
const docsJsonPath = join(root, 'docs.json')
const docsJson = JSON.parse(readFileSync(docsJsonPath, 'utf8'))

const mdxFiles = listFiles(root, (p) => p.endsWith('.mdx'))
const errors = []

const bannedSnippets = [
  'enforceTypedConfirm',
  '# Feature:',
  '# API:',
  '# Operations:',
  '# Developers:',
  '# Security:',
  '# Quickstart:',
  '# Remote Access:',
  '# Product:',
]

for (const file of mdxFiles) {
  const source = readFileSync(file, 'utf8')

  for (const snippet of bannedSnippets) {
    if (source.includes(snippet)) {
      errors.push(`${file}: banned snippet "${snippet}"`)
    }
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

  if (!title) {
    errors.push(`docs.json page "${page}" is missing an explicit title`)
    continue
  }

  const source = readFileSync(file, 'utf8')
  const h1 = extractH1Title(source)
  if (!h1) {
    errors.push(`${file}: missing H1 title ("# ...")`)
    continue
  }

  if (h1 !== title) {
    errors.push(`${file}: docs.json title "${title}" does not match H1 "${h1}"`)
  }
}

if (errors.length) {
  console.error('Docs lint failed:')
  for (const err of errors) console.error(`- ${err}`)
  process.exit(1)
}

console.log(`Docs lint OK (${mdxFiles.length} MDX files checked)`)
