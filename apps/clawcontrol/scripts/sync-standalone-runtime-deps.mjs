#!/usr/bin/env node

import { builtinModules, createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const appRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(appRoot, '../..')
const standaloneNodeModules = path.join(appRoot, '.next', 'standalone', 'node_modules')
const requireFromApp = createRequire(path.join(appRoot, 'package.json'))

const ROOT_RUNTIME_PACKAGES = ['@prisma/adapter-better-sqlite3']
const visitedPackages = new Set()
const builtinModuleSet = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => moduleName.replace(/^node:/, '')),
])

function packageNameToNodeModulesPath(packageName) {
  return path.join(...packageName.split('/'))
}

function resolvePackageRoot(packageName, optional = false) {
  try {
    const resolvedEntry = requireFromApp.resolve(packageName, {
      paths: [appRoot, repoRoot],
    })
    const normalizedEntry = resolvedEntry.replace(/\\/g, '/')
    const marker = `node_modules/${packageNameToNodeModulesPath(packageName).replace(/\\/g, '/')}`
    const markerIndex = normalizedEntry.lastIndexOf(marker)
    if (markerIndex === -1) {
      throw new Error(`Unable to infer package root from resolved entry: ${resolvedEntry}`)
    }
    const packageRoot = resolvedEntry.slice(0, markerIndex + marker.length)
    const packageJsonPath = path.join(packageRoot, 'package.json')
    if (!fs.existsSync(packageJsonPath)) {
      throw new Error(`Package metadata missing: ${packageJsonPath}`)
    }
    return { packageRoot, packageJsonPath }
  } catch (error) {
    if (optional) return null
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Unable to resolve package "${packageName}" from ${appRoot}: ${detail}`)
  }
}

function copyPackageDirectory(packageName, sourceDir) {
  const destinationDir = path.join(
    standaloneNodeModules,
    packageNameToNodeModulesPath(packageName)
  )
  fs.mkdirSync(path.dirname(destinationDir), { recursive: true })
  fs.rmSync(destinationDir, { recursive: true, force: true })
  fs.cpSync(sourceDir, destinationDir, { recursive: true, dereference: true })
}

function collectDependencyNames(packageJson) {
  const dependencies = Object.keys(packageJson.dependencies ?? {})
  const optionalDependencies = Object.keys(packageJson.optionalDependencies ?? {})
  return { dependencies, optionalDependencies }
}

function isBuiltinDependency(packageName) {
  return builtinModuleSet.has(packageName) || packageName.startsWith('node:')
}

function syncPackageAndDependencies(packageName, optional = false) {
  if (isBuiltinDependency(packageName)) return
  if (visitedPackages.has(packageName)) return

  const resolvedPackage = resolvePackageRoot(packageName, optional)
  if (!resolvedPackage) {
    process.stdout.write(`[standalone-sync] Optional package not installed, skipping ${packageName}\n`)
    return
  }

  visitedPackages.add(packageName)
  copyPackageDirectory(packageName, resolvedPackage.packageRoot)
  process.stdout.write(`[standalone-sync] Synced ${packageName}\n`)

  const packageJson = JSON.parse(fs.readFileSync(resolvedPackage.packageJsonPath, 'utf8'))
  const { dependencies, optionalDependencies } = collectDependencyNames(packageJson)
  for (const dependency of dependencies) {
    syncPackageAndDependencies(dependency, false)
  }
  for (const dependency of optionalDependencies) {
    syncPackageAndDependencies(dependency, true)
  }
}

function pruneNodeModulesBinDirectories(rootDir) {
  const stack = [rootDir]
  let removedCount = 0

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || !fs.existsSync(current)) continue

    const entries = fs.readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const entryPath = path.join(current, entry.name)
      if (entry.name === '.bin' && path.basename(path.dirname(entryPath)) === 'node_modules') {
        fs.rmSync(entryPath, { recursive: true, force: true })
        removedCount += 1
        continue
      }
      stack.push(entryPath)
    }
  }

  if (removedCount > 0) {
    process.stdout.write(`[standalone-sync] Removed ${removedCount} nested node_modules/.bin directories\n`)
  }
}

function main() {
  if (!fs.existsSync(standaloneNodeModules)) {
    throw new Error(
      `Standalone node_modules directory not found: ${standaloneNodeModules}. Run next build first.`
    )
  }

  for (const packageName of ROOT_RUNTIME_PACKAGES) {
    syncPackageAndDependencies(packageName, false)
  }
  pruneNodeModulesBinDirectories(standaloneNodeModules)

  process.stdout.write(
    `[standalone-sync] Runtime package sync complete (${visitedPackages.size} packages)\n`
  )
}

try {
  main()
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[standalone-sync] ${detail}\n`)
  process.exit(1)
}
