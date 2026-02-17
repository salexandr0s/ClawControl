import { cpSync, existsSync, lstatSync, mkdirSync, readlinkSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..', '..', '..')

const rootPostcssDir = resolve(repoRoot, 'node_modules', 'postcss')
const nextNodeModulesDir = resolve(repoRoot, 'node_modules', 'next', 'node_modules')
const nextPostcssPath = resolve(nextNodeModulesDir, 'postcss')
const nextPostcssEntrypoint = resolve(nextPostcssPath, 'lib', 'postcss.js')

function log(message) {
  process.stdout.write(`[ensure-next-postcss] ${message}\n`)
}

if (!existsSync(rootPostcssDir)) {
  log('Skipping: root postcss package not found.')
  process.exit(0)
}

mkdirSync(nextNodeModulesDir, { recursive: true })

function replaceWithCopiedPackage(reason) {
  log(`${reason}. Copying package to ${nextPostcssPath}`)
  rmSync(nextPostcssPath, { recursive: true, force: true })
  cpSync(rootPostcssDir, nextPostcssPath, {
    recursive: true,
    force: true,
    dereference: true,
  })
}

if (existsSync(nextPostcssPath)) {
  try {
    const stat = lstatSync(nextPostcssPath)
    if (stat.isSymbolicLink()) {
      const currentTarget = readlinkSync(nextPostcssPath)
      replaceWithCopiedPackage(`Replacing symlink (${currentTarget})`)
      process.exit(0)
    }

    if (!existsSync(nextPostcssEntrypoint)) {
      replaceWithCopiedPackage('Replacing stale postcss directory missing lib/postcss.js')
    }
    process.exit(0)
  } catch {
    replaceWithCopiedPackage('Replacing unreadable postcss path')
    process.exit(0)
  }
}

replaceWithCopiedPackage('postcss package missing under next/node_modules')
