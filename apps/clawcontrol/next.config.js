/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@clawcontrol/core', '@clawcontrol/ui', '@clawcontrol/adapters-openclaw'],
  typedRoutes: true,

  // Enables a minimal self-contained server bundle under `.next/standalone`,
  // which the Electron app can ship/run without bundling the full monorepo.
  output: 'standalone',

  // Avoid bundling native Node deps into the server build.
  // In particular, `ws` can end up with a broken bufferutil shim when bundled.
  serverExternalPackages: ['ws'],

  // Security: clawcontrol is local-only.
  // Limit dev-origin allowances to loopback.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],

  // Note: instrumentationHook is now enabled by default in Next.js 16.1+
  // No need for experimental flag - instrumentation.ts is picked up automatically

  webpack: (config, { dev }) => {
    // Prevent Next dev server from reloading when the local SQLite DB WAL/SHM files change.
    // The DB is updated frequently (telemetry, receipts), and file watching causes navigation/state resets.
    if (dev) {
      config.watchOptions = config.watchOptions || {}
      const ignored = config.watchOptions.ignored
      const ignoredList = Array.isArray(ignored) ? ignored : ignored ? [ignored] : []
      config.watchOptions.ignored = [
        ...ignoredList,
        '**/*.db',
        '**/*.db-*',
        '**/*.sqlite',
        '**/*.sqlite3',
      ]
    }
    return config
  },
}

module.exports = nextConfig
