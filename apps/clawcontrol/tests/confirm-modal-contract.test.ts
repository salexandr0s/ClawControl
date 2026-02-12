import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const workspaceRoot = resolve(process.cwd(), '..', '..')

const checkedFiles = [
  'apps/clawcontrol/app',
  'apps/clawcontrol/components',
  'apps/clawcontrol/lib',
  'packages/ui/src',
]

function collectSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir)
  const files: string[] = []

  for (const entry of entries) {
    const path = resolve(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      files.push(...collectSourceFiles(path))
      continue
    }
    if (/\.(ts|tsx|js|jsx)$/.test(entry)) {
      files.push(path)
    }
  }

  return files
}

describe('confirm modal contract', () => {
  it('disallows browser-native confirm/alert/prompt dialogs in app code', () => {
    const sourceFiles = checkedFiles.flatMap((relativePath) =>
      collectSourceFiles(resolve(workspaceRoot, relativePath))
    )

    const bannedPatterns = [
      /\bwindow\.confirm\s*\(/,
      /\bwindow\.alert\s*\(/,
      /\bwindow\.prompt\s*\(/,
      /\bglobalThis\.confirm\s*\(/,
      /\bglobalThis\.alert\s*\(/,
      /\bglobalThis\.prompt\s*\(/,
    ]

    for (const filePath of sourceFiles) {
      const content = readFileSync(filePath, 'utf8')
      for (const pattern of bannedPatterns) {
        expect(content, `${filePath} matches banned pattern ${pattern}`).not.toMatch(pattern)
      }
    }
  })
})
