/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@savorgos/core', '@savorgos/ui', '@savorgos/adapters-openclaw'],
  typedRoutes: true,
}

module.exports = nextConfig
