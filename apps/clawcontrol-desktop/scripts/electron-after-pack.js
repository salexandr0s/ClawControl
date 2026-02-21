const { spawnSync } = require('node:child_process')
const { existsSync, writeFileSync, unlinkSync } = require('node:fs')
const path = require('node:path')

/**
 * Ensure macOS app bundles are sealed consistently, even in unsigned builds.
 * This prevents Gatekeeper/spctl resource-signature mismatch diagnostics.
 */
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const productFilename = context.packager.appInfo.productFilename
  const appPath = path.join(context.appOutDir, `${productFilename}.app`)
  const serverDir = path.join(appPath, 'Contents', 'Resources', 'server')
  const betterSqliteDir = path.join(serverDir, 'node_modules', 'better-sqlite3')
  const appExecutable = path.join(appPath, 'Contents', 'MacOS', productFilename)

  if (!existsSync(appPath)) {
    throw new Error(`[afterPack] App bundle not found: ${appPath}`)
  }
  if (!existsSync(serverDir)) {
    throw new Error(`[afterPack] Packaged server bundle not found: ${serverDir}`)
  }
  if (!existsSync(betterSqliteDir)) {
    throw new Error(`[afterPack] better-sqlite3 not found in packaged server: ${betterSqliteDir}`)
  }
  if (!existsSync(appExecutable)) {
    throw new Error(`[afterPack] App executable not found: ${appExecutable}`)
  }

  const packageJsonPath = path.join(__dirname, '..', 'package.json')
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const desktopPackage = require(packageJsonPath)
  const electronVersionRaw = String(desktopPackage?.devDependencies?.electron ?? '').trim()
  const electronVersion = electronVersionRaw.replace(/^[~^]/, '')
  if (!electronVersion) {
    throw new Error('[afterPack] Unable to determine Electron version from package.json')
  }

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const rebuild = spawnSync(npmCommand, ['rebuild', 'better-sqlite3'], {
    cwd: serverDir,
    encoding: 'utf8',
    stdio: 'pipe',
    env: {
      ...process.env,
      npm_config_runtime: 'electron',
      npm_config_target: electronVersion,
      npm_config_disturl: 'https://electronjs.org/headers',
      npm_config_build_from_source: 'false',
      npm_config_update_binary: 'true',
    },
  })

  if (rebuild.status !== 0) {
    const details = [rebuild.stdout, rebuild.stderr].filter(Boolean).join('\n').trim()
    throw new Error(`[afterPack] Failed to rebuild better-sqlite3 for Electron ${electronVersion}: ${details}`)
  }

  const probeScriptPath = path.join(serverDir, '.better-sqlite3-electron-probe.cjs')
  const betterSqliteEntry = path.join(serverDir, 'node_modules', 'better-sqlite3')
  writeFileSync(
    probeScriptPath,
    [
      "const BetterSqlite3 = require(process.argv[2])",
      "const db = new BetterSqlite3(':memory:')",
      "db.prepare('SELECT 1 AS ok').get()",
      'db.close()',
      "process.stdout.write(`[afterPack] better-sqlite3 loaded with NODE_MODULE_VERSION=${process.versions.modules}\\n`)",
    ].join('\n'),
    'utf8'
  )

  const probe = spawnSync(appExecutable, [probeScriptPath, betterSqliteEntry], {
    cwd: serverDir,
    encoding: 'utf8',
    stdio: 'pipe',
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
    },
  })
  try {
    if (probe.status !== 0) {
      const details = [probe.stdout, probe.stderr].filter(Boolean).join('\n').trim()
      throw new Error(`[afterPack] Electron ABI probe failed: ${details}`)
    }
  } finally {
    try {
      unlinkSync(probeScriptPath)
    } catch {
      // ignore cleanup failures
    }
  }
  if (probe.stdout) process.stdout.write(probe.stdout)

  const sign = spawnSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
    encoding: 'utf8',
    stdio: 'pipe',
  })

  if (sign.status !== 0) {
    const details = [sign.stdout, sign.stderr].filter(Boolean).join('\n').trim()
    throw new Error(`[afterPack] Failed to ad-hoc sign app: ${details}`)
  }

  process.stdout.write(`[afterPack] Ad-hoc signed ${appPath}\n`)
}
