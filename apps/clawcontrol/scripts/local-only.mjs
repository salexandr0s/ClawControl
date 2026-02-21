#!/usr/bin/env node

// Local-only guard for clawcontrol.
// Refuses to start if HOST/HOSTNAME is set to a non-loopback value.

const allowed = new Set(['127.0.0.1', 'localhost', '::1'])

function fail(msg) {
  console.error(`\n[FATAL] ${msg}`)
  console.error('[FATAL] clawcontrol is local-only. Refusing to start.')
  process.exit(1)
}

const hostEnv = process.env.HOST || process.env.HOSTNAME
if (hostEnv && !allowed.has(hostEnv)) {
  fail(`HOST/HOSTNAME is set to "${hostEnv}" (must be loopback: 127.0.0.1/localhost/::1).`)
}

// Explicitly force loopback for Next.js
process.env.HOSTNAME = '127.0.0.1'
process.env.HOST = '127.0.0.1'

// Local default: if DATABASE_URL is unset, use the bundled SQLite path.
if (!process.env.DATABASE_URL || process.env.DATABASE_URL.trim().length === 0) {
  process.env.DATABASE_URL = 'file:./data/clawcontrol.db'
}

// Pass-through: `node scripts/local-only.mjs <cmd> <args...>`
const [cmd, ...args] = process.argv.slice(2)
if (!cmd) fail('No command provided. Usage: node scripts/local-only.mjs next dev ...')

const { spawn } = await import('node:child_process')
const child = spawn(cmd, args, { stdio: 'inherit', env: process.env })

let childExited = false

function forwardSignal(signal) {
  if (childExited) return
  try {
    child.kill(signal)
  } catch {
    // ignore
  }
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    forwardSignal(signal)
  })
}

child.on('exit', (code, signal) => {
  childExited = true
  if (signal) process.exit(1)
  process.exit(code ?? 1)
})
