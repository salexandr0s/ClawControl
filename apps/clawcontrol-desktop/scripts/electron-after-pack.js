const { spawnSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const path = require('node:path')

/**
 * Ensure macOS app bundles are sealed consistently, even in unsigned builds.
 * This prevents Gatekeeper/spctl resource-signature mismatch diagnostics.
 */
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const productFilename = context.packager.appInfo.productFilename
  const appPath = path.join(context.appOutDir, `${productFilename}.app`)
  if (!existsSync(appPath)) {
    throw new Error(`[afterPack] App bundle not found: ${appPath}`)
  }

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
