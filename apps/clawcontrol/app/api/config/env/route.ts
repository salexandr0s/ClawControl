/**
 * Legacy Environment Configuration API
 *
 * Backward-compatible wrapper around settings.json persistence.
 * New clients should use /api/config/settings.
 */

import { NextResponse } from 'next/server'
import { getOpenClawConfig } from '@/lib/openclaw-client'
import { readSettings, writeSettings } from '@/lib/settings/store'
import { invalidateWorkspaceRootCache } from '@/lib/fs/path-policy'
import { invalidateTemplatesCache } from '@/lib/templates'
import { ensureWorkspaceScaffold } from '@/lib/workspace/bootstrap'

interface EnvConfig {
  OPENCLAW_WORKSPACE: string | null
  DATABASE_URL: string | null
  NODE_ENV: string | null
}

function applyRuntimeWorkspacePath(workspacePath: string | null): void {
  if (workspacePath) {
    process.env.OPENCLAW_WORKSPACE = workspacePath
    process.env.CLAWCONTROL_WORKSPACE_ROOT = workspacePath
  } else {
    delete process.env.OPENCLAW_WORKSPACE
    delete process.env.CLAWCONTROL_WORKSPACE_ROOT
  }
  invalidateWorkspaceRootCache()
  invalidateTemplatesCache()
}

export async function GET() {
  try {
    const [settingsResult, resolved] = await Promise.all([
      readSettings(),
      getOpenClawConfig(true),
    ])

    const workspace =
      settingsResult.settings.workspacePath
      ?? resolved?.workspacePath
      ?? null

    const config: EnvConfig = {
      OPENCLAW_WORKSPACE: workspace,
      DATABASE_URL: process.env.DATABASE_URL ?? null,
      NODE_ENV: process.env.NODE_ENV ?? null,
    }

    return NextResponse.json({
      data: {
        config,
        activeWorkspace: resolved?.workspacePath ?? workspace,
        envPath: settingsResult.path,
        requiresRestart: false,
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
    const body = (await request.json().catch(() => null)) as {
      OPENCLAW_WORKSPACE?: unknown
    } | null

    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      )
    }

    if ('OPENCLAW_WORKSPACE' in body) {
      const workspace = typeof body.OPENCLAW_WORKSPACE === 'string'
        ? body.OPENCLAW_WORKSPACE.trim()
        : null

      const saved = await writeSettings({
        workspacePath: (workspace || null) as unknown as string | undefined,
      })
      applyRuntimeWorkspacePath(saved.settings.workspacePath ?? null)
      await ensureWorkspaceScaffold(saved.settings.workspacePath ?? null)
    }

    const [settingsResult, resolved] = await Promise.all([
      readSettings(),
      getOpenClawConfig(true),
    ])

    const config: EnvConfig = {
      OPENCLAW_WORKSPACE: settingsResult.settings.workspacePath ?? null,
      DATABASE_URL: process.env.DATABASE_URL ?? null,
      NODE_ENV: process.env.NODE_ENV ?? null,
    }

    return NextResponse.json({
      data: {
        config,
        activeWorkspace: resolved?.workspacePath ?? settingsResult.settings.workspacePath ?? null,
        envPath: settingsResult.path,
        requiresRestart: false,
        message: 'Configuration updated and applied.',
      },
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update config' },
      { status: 500 }
    )
  }
}
