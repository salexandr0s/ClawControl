/**
 * Environment Configuration API
 *
 * GET - Returns current environment configuration
 * PUT - Updates environment configuration (requires restart)
 */

import { NextResponse } from 'next/server'
import { promises as fsp } from 'node:fs'
import { resolve } from 'node:path'

// Path to .env file
const ENV_PATH = resolve(process.cwd(), '.env')

interface EnvConfig {
  OPENCLAW_WORKSPACE: string | null
  DATABASE_URL: string | null
  NODE_ENV: string | null
}

// Parse .env file content
function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  const lines = content.split('\n')

  for (const line of lines) {
    // Skip comments and empty lines
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    // Parse KEY="value" or KEY=value
    const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)=(?:"([^"]*)"|'([^']*)'|(.*))?$/)
    if (match) {
      const key = match[1]
      const value = match[2] ?? match[3] ?? match[4] ?? ''
      result[key] = value
    }
  }

  return result
}

// Update .env file, preserving comments and structure
function updateEnvFile(content: string, updates: Partial<EnvConfig>): string {
  const lines = content.split('\n')
  const updatedKeys = new Set<string>()

  const result = lines.map((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return line

    const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)=/)
    if (match) {
      const key = match[1] as keyof EnvConfig
      if (key in updates) {
        updatedKeys.add(key)
        const value = updates[key]
        if (value === null || value === undefined || value === '') {
          // Comment out the line
          return `# ${key}=""`
        }
        return `${key}="${value}"`
      }
    }
    return line
  })

  // Add any keys that weren't in the file
  for (const [key, value] of Object.entries(updates)) {
    if (!updatedKeys.has(key) && value !== null && value !== undefined && value !== '') {
      result.push(`${key}="${value}"`)
    }
  }

  return result.join('\n')
}

export async function GET() {
  try {
    let content = ''
    try {
      content = await fsp.readFile(ENV_PATH, 'utf8')
    } catch {
      // .env file doesn't exist, return defaults
    }

    const parsed = parseEnvFile(content)

    const config: EnvConfig = {
      OPENCLAW_WORKSPACE: parsed.OPENCLAW_WORKSPACE || null,
      DATABASE_URL: parsed.DATABASE_URL || null,
      NODE_ENV: parsed.NODE_ENV || process.env.NODE_ENV || null,
    }

    // Also return the currently active workspace (from runtime env)
    const activeWorkspace = process.env.OPENCLAW_WORKSPACE || null

    return NextResponse.json({
      data: {
        config,
        activeWorkspace,
        envPath: ENV_PATH,
        requiresRestart: config.OPENCLAW_WORKSPACE !== activeWorkspace,
      },
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to read config' },
      { status: 500 }
    )
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json()
    const updates: Partial<EnvConfig> = {}

    // Only allow specific keys to be updated
    if ('OPENCLAW_WORKSPACE' in body) {
      updates.OPENCLAW_WORKSPACE = body.OPENCLAW_WORKSPACE
    }

    // Read existing content
    let content = ''
    try {
      content = await fsp.readFile(ENV_PATH, 'utf8')
    } catch {
      // Create new file with template
      content = `# clawcontrol Environment Configuration
# Changes require server restart to take effect

# OpenClaw workspace path - directory containing agents/, skills/, etc.
OPENCLAW_WORKSPACE=""

# Database URL
DATABASE_URL="file:../data/clawcontrol.db"
`
    }

    // Update content
    const newContent = updateEnvFile(content, updates)

    // Write back
    await fsp.writeFile(ENV_PATH, newContent, 'utf8')

    // Re-read to confirm
    const parsed = parseEnvFile(newContent)

    return NextResponse.json({
      data: {
        config: {
          OPENCLAW_WORKSPACE: parsed.OPENCLAW_WORKSPACE || null,
          DATABASE_URL: parsed.DATABASE_URL || null,
          NODE_ENV: parsed.NODE_ENV || process.env.NODE_ENV || null,
        },
        requiresRestart: true,
        message: 'Configuration updated. Restart the server for changes to take effect.',
      },
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update config' },
      { status: 500 }
    )
  }
}
