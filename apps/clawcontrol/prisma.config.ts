import { defineConfig } from 'prisma/config'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const DEFAULT_DATABASE_URL = 'file:./data/clawcontrol.db'
const LEGACY_DATABASE_URL_PREFIX = 'file:../data/clawcontrol.db'

function legacyUrlToPreferredUrl(value: string): string {
  const suffix = value.slice(LEGACY_DATABASE_URL_PREFIX.length)
  const currentPath = resolve(process.cwd(), './data/clawcontrol.db')
  const legacyPath = resolve(process.cwd(), '../data/clawcontrol.db')

  if (!existsSync(currentPath) && existsSync(legacyPath)) {
    return `${LEGACY_DATABASE_URL_PREFIX}${suffix}`
  }

  return `${DEFAULT_DATABASE_URL}${suffix}`
}

function normalizeDatabaseUrl(databaseUrl: string | undefined): string {
  const value = (databaseUrl || DEFAULT_DATABASE_URL).trim()
  if (!value) return DEFAULT_DATABASE_URL

  if (value === LEGACY_DATABASE_URL_PREFIX || value.startsWith(`${LEGACY_DATABASE_URL_PREFIX}?`)) {
    return legacyUrlToPreferredUrl(value)
  }

  return value
}

const databaseUrl = normalizeDatabaseUrl(process.env.DATABASE_URL)

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: databaseUrl,
  },
})
