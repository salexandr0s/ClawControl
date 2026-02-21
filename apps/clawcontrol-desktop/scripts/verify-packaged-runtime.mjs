#!/usr/bin/env node

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '../../..')
const appPath = path.join(
  repoRoot,
  'apps',
  'clawcontrol-desktop',
  'dist',
  'release',
  'mac-arm64',
  'ClawControl.app'
)
const serverDir = path.join(appPath, 'Contents', 'Resources', 'server')
const migrationsDir = path.join(serverDir, 'apps', 'clawcontrol', 'prisma', 'migrations')
const serverEntry = path.join(serverDir, 'apps', 'clawcontrol', 'server.js')
const prismaAdapterDir = path.join(serverDir, 'node_modules', '@prisma', 'adapter-better-sqlite3')
const prismaDriverAdapterUtilsDir = path.join(
  serverDir,
  'node_modules',
  '@prisma',
  'driver-adapter-utils'
)
const schemaBootstrapPath = path.join(
  repoRoot,
  'apps',
  'clawcontrol-desktop',
  'dist',
  'schema-bootstrap.js'
)

function assertExists(targetPath, label) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`${label} not found: ${targetPath}`)
  }
}

function httpRequest(port, pathname, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        host: '127.0.0.1',
        port,
        path: pathname,
        timeout: timeoutMs,
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          body += chunk
        })
        res.on('end', () => {
          resolve({ statusCode: res.statusCode ?? 0, body })
        })
      }
    )

    req.on('timeout', () => {
      req.destroy(new Error(`Request timeout for ${pathname}`))
    })

    req.on('error', reject)
  })
}

async function waitForReady(port, pathname, timeoutMs = 30_000) {
  const start = Date.now()
  let lastError = null

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await httpRequest(port, pathname, 1000)
      if ([200, 307, 308].includes(response.statusCode)) return
      lastError = new Error(`Unexpected ${pathname} status: ${response.statusCode}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  throw new Error(
    `Timed out waiting for ${pathname}: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  )
}

async function main() {
  assertExists(appPath, 'Packaged app')
  assertExists(serverDir, 'Packaged server directory')
  assertExists(migrationsDir, 'Packaged Prisma migrations')
  assertExists(serverEntry, 'Packaged server entry')
  assertExists(prismaAdapterDir, 'Packaged Prisma better-sqlite3 adapter')
  assertExists(prismaDriverAdapterUtilsDir, 'Packaged Prisma driver adapter utils')
  assertExists(schemaBootstrapPath, 'Desktop schema bootstrap module')

  const { ensurePackagedDatabaseSchema } = await import(pathToFileURL(schemaBootstrapPath).toString())

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawcontrol-desktop-smoke-'))
  const dbPath = path.join(tmpDir, 'clawcontrol.db')
  const workspaceRoot = path.join(tmpDir, 'workspace')
  fs.mkdirSync(workspaceRoot, { recursive: true })

  await ensurePackagedDatabaseSchema(serverDir, dbPath)

  const port = 33000 + Math.floor(Math.random() * 2000)
  const server = spawn(process.execPath, [serverEntry], {
    cwd: path.dirname(serverEntry),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      HOSTNAME: '127.0.0.1',
      PORT: String(port),
      OPENCLAW_WORKSPACE: workspaceRoot,
      CLAWCONTROL_WORKSPACE_ROOT: workspaceRoot,
      DATABASE_URL: `file:${dbPath}`,
    },
  })

  server.stdout.on('data', (chunk) => {
    const text = chunk.toString()
    process.stdout.write(`[smoke:server] ${text}`)
  })
  server.stderr.on('data', (chunk) => {
    const text = chunk.toString()
    process.stderr.write(`[smoke:server:err] ${text}`)
  })

  try {
    await waitForReady(port, '/')
    const dashboard = await httpRequest(port, '/dashboard', 5000)
    if (dashboard.statusCode !== 200) {
      throw new Error(`Expected /dashboard to return 200, got ${dashboard.statusCode}`)
    }
    if (dashboard.body.includes('"digest":"')) {
      throw new Error('Dashboard response contains a server digest error')
    }
  } finally {
    server.kill('SIGTERM')
  }

  console.log('Desktop packaged runtime smoke test passed')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
