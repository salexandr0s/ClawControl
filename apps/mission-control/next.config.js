/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@savorg/core', '@savorg/ui', '@savorg/adapters-openclaw'],
  typedRoutes: true,

  // Security: Mission Control is local-only.
  // Limit dev-origin allowances to loopback.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
}

module.exports = nextConfig
