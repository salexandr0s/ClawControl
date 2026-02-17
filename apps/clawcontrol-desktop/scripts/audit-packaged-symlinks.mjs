#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '../../..')
const releaseDir = resolve(repoRoot, 'apps', 'clawcontrol-desktop', 'dist', 'release')
const packagedAppPath = resolve(releaseDir, 'mac-arm64', 'ClawControl.app')

function walkSymlinks(rootPath) {
  const pending = [rootPath]
  const links = []

  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) continue

    let entries = []
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      const abs = join(current, entry.name)
      if (entry.isDirectory()) {
        pending.push(abs)
        continue
      }
      if (!entry.isSymbolicLink()) continue
      links.push(abs)
    }
  }

  return links
}

function auditAppSymlinks(appPath, label) {
  const symlinks = walkSymlinks(appPath)
  const violations = []

  for (const linkPath of symlinks) {
    const rawTarget = readlinkSync(linkPath)
    const absoluteTarget = resolve(dirname(linkPath), rawTarget)
    const isAbsolute = rawTarget.startsWith('/')
    const targetExists = existsSync(absoluteTarget)

    if (isAbsolute) {
      violations.push({
        type: 'absolute',
        path: linkPath,
        target: rawTarget,
      })
    }
    if (!targetExists) {
      violations.push({
        type: 'broken',
        path: linkPath,
        target: rawTarget,
      })
    }
  }

  const absoluteCount = violations.filter((v) => v.type === 'absolute').length
  const brokenCount = violations.filter((v) => v.type === 'broken').length
  process.stdout.write(
    `[symlink-audit] ${label}: symlinks=${symlinks.length}, absolute=${absoluteCount}, broken=${brokenCount}\n`
  )
  if (violations.length > 0) {
    for (const violation of violations) {
      process.stdout.write(
        `[symlink-audit] ${label}: ${violation.type.toUpperCase()} ${violation.path} -> ${violation.target}\n`
      )
    }
  }

  return {
    symlinkCount: symlinks.length,
    absoluteCount,
    brokenCount,
  }
}

function listReleaseArtifacts(extension) {
  return readdirSync(releaseDir)
    .filter((name) => extname(name) === extension)
    .map((name) => resolve(releaseDir, name))
    .sort()
}

function findAppBundle(rootPath) {
  const pending = [rootPath]
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) continue
    const entries = readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      const abs = join(current, entry.name)
      if (entry.isDirectory() && entry.name.endsWith('.app')) return abs
      if (entry.isDirectory()) pending.push(abs)
    }
  }
  return null
}

function extractZip(zipPath) {
  const extractRoot = mkdtempSync(join(tmpdir(), 'clawcontrol-zip-audit-'))
  const unzip = spawnSync('ditto', ['-x', '-k', zipPath, extractRoot], {
    encoding: 'utf8',
    stdio: 'pipe',
  })
  if (unzip.status !== 0) {
    throw new Error(`Failed to extract zip ${zipPath}: ${unzip.stderr || unzip.stdout}`)
  }
  return extractRoot
}

function attachDmg(dmgPath) {
  const mountPath = mkdtempSync(join(tmpdir(), 'clawcontrol-dmg-mount-'))
  const attach = spawnSync('hdiutil', ['attach', dmgPath, '-nobrowse', '-readonly', '-mountpoint', mountPath], {
    encoding: 'utf8',
    stdio: 'pipe',
  })
  if (attach.status !== 0) {
    throw new Error(`Failed to mount dmg ${dmgPath}: ${attach.stderr || attach.stdout}`)
  }
  return mountPath
}

function detachDmg(mountPath) {
  const detach = spawnSync('hdiutil', ['detach', mountPath], {
    encoding: 'utf8',
    stdio: 'pipe',
  })
  if (detach.status !== 0) {
    throw new Error(`Failed to detach dmg mount ${mountPath}: ${detach.stderr || detach.stdout}`)
  }
}

function assertNoViolations(result, label) {
  if (result.absoluteCount > 0 || result.brokenCount > 0) {
    throw new Error(`${label} symlink audit failed`)
  }
}

async function main() {
  if (!existsSync(packagedAppPath)) {
    throw new Error(`Packaged app not found: ${packagedAppPath}`)
  }

  const appResult = auditAppSymlinks(packagedAppPath, 'packaged-app')
  assertNoViolations(appResult, 'Packaged app')

  const zipFiles = listReleaseArtifacts('.zip')
  const dmgFiles = listReleaseArtifacts('.dmg')

  if (zipFiles.length === 0) {
    throw new Error(`No zip artifacts found in ${releaseDir}`)
  }
  if (dmgFiles.length === 0) {
    throw new Error(`No dmg artifacts found in ${releaseDir}`)
  }

  for (const zipPath of zipFiles) {
    const extractedRoot = extractZip(zipPath)
    try {
      const zipAppPath = findAppBundle(extractedRoot)
      if (!zipAppPath) throw new Error(`No .app bundle found in zip artifact ${zipPath}`)
      const zipResult = auditAppSymlinks(zipAppPath, `zip:${zipPath}`)
      assertNoViolations(zipResult, `Zip artifact ${zipPath}`)
    } finally {
      rmSync(extractedRoot, { recursive: true, force: true })
    }
  }

  for (const dmgPath of dmgFiles) {
    const mountPath = attachDmg(dmgPath)
    try {
      const dmgAppPath = findAppBundle(mountPath)
      if (!dmgAppPath) throw new Error(`No .app bundle found in dmg artifact ${dmgPath}`)
      const dmgResult = auditAppSymlinks(dmgAppPath, `dmg:${dmgPath}`)
      assertNoViolations(dmgResult, `Dmg artifact ${dmgPath}`)
    } finally {
      detachDmg(mountPath)
      rmSync(mountPath, { recursive: true, force: true })
    }
  }

  process.stdout.write('[symlink-audit] all artifact symlink checks passed\n')
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  })
