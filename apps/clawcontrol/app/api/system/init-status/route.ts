import { NextResponse } from 'next/server'
import { checkOpenClawAvailable } from '@clawcontrol/adapters-openclaw'
import { ensureDatabaseInitialized, getDatabaseInitStatus } from '@/lib/db/init'
import { getOpenClawConfig, waitForGatewayAvailability } from '@/lib/openclaw-client'
import { readSettings } from '@/lib/settings/store'
import type { RemoteAccessMode } from '@/lib/settings/types'
import { validateWorkspaceStructure } from '@/lib/workspace/validate'
import { ensureWorkspaceScaffold } from '@/lib/workspace/bootstrap'

export interface InitStatus {
  ready: boolean
  requiresSetup: boolean
  setupCompleted: boolean
  access: {
    mode: RemoteAccessMode
    loopbackEnforced: true
  }
  checks: {
    database: {
      state: 'ok' | 'error'
      code: string | null
      message: string
      databasePath: string | null
    }
    openclaw: {
      state: 'ok' | 'warning'
      installed: boolean
      version?: string
      message: string
    }
    gateway: {
      state: 'ok' | 'warning' | 'error'
      reachable: boolean
      mode: 'reachable' | 'auth_required' | 'unreachable'
      attempts: number
      gatewayUrl: string
      message: string
      probe: unknown
    }
    workspace: {
      state: 'ok' | 'error'
      path: string | null
      message: string
      issues: ReturnType<typeof summarizeIssues>
      bootstrap?: {
        ensured: boolean
        createdDirectories: number
        createdFiles: number
      }
    }
  }
  timestamp: string
}

function summarizeIssues(issues: Array<{ level: 'error' | 'warning'; code: string; message: string }>) {
  return issues.map((issue) => ({
    level: issue.level,
    code: issue.code,
    message: issue.message,
  }))
}

export async function GET() {
  try {
    const [dbInitStatus, openClawCheck, settingsResult, resolvedConfig] = await Promise.all([
      ensureDatabaseInitialized(),
      checkOpenClawAvailable(),
      readSettings(),
      getOpenClawConfig(true),
    ])

    const dbStatus = getDatabaseInitStatus().initialized ? getDatabaseInitStatus() : dbInitStatus

    const workspacePath = resolvedConfig?.workspacePath ?? settingsResult.settings.workspacePath ?? null
    const workspaceBootstrap = await ensureWorkspaceScaffold(workspacePath)
    const workspaceValidation = await validateWorkspaceStructure(workspacePath)

    const gatewayUrl = resolvedConfig?.gatewayUrl ?? 'http://127.0.0.1:18789'
    const gatewayRetry = await waitForGatewayAvailability(
      {
        gatewayUrl,
        token: resolvedConfig?.token ?? null,
      },
      [0, 1000, 2000, 4000, 8000]
    )

    const setupCompleted = settingsResult.settings.setupCompleted === true
    const remoteAccessMode: RemoteAccessMode = settingsResult.settings.remoteAccessMode ?? 'local_only'

    const criticalReady = dbStatus.ok && workspaceValidation.ok
    const ready = criticalReady && setupCompleted
    const requiresSetup = !ready

    const workspaceMessage = workspaceValidation.ok
      ? 'Workspace validated'
      : workspaceValidation.issues.find((issue) => issue.level === 'error')?.message
        ?? 'Workspace validation failed'

    const gatewayState: InitStatus['checks']['gateway']['state'] = gatewayRetry.available
      ? 'ok'
      : gatewayRetry.state === 'auth_required'
        ? 'warning'
        : 'error'

    const gatewayMessage = gatewayRetry.available
      ? 'Gateway reachable'
      : gatewayRetry.state === 'auth_required'
        ? 'Gateway requires authentication token'
        : 'Gateway unreachable after startup retries'

    const response: InitStatus = {
      ready,
      requiresSetup,
      setupCompleted,
      access: {
        mode: remoteAccessMode,
        loopbackEnforced: true,
      },
      checks: {
        database: {
          state: dbStatus.ok ? 'ok' : 'error',
          code: dbStatus.code,
          message: dbStatus.message,
          databasePath: dbStatus.databasePath,
        },
        openclaw: {
          state: openClawCheck.available ? 'ok' : 'warning',
          installed: openClawCheck.available,
          ...(openClawCheck.version ? { version: openClawCheck.version } : {}),
          message: openClawCheck.available
            ? `OpenClaw CLI detected (${openClawCheck.version ?? 'unknown version'})`
            : (openClawCheck.error ?? 'OpenClaw CLI is not installed'),
        },
        gateway: {
          state: gatewayState,
          reachable: gatewayRetry.available,
          mode: gatewayRetry.state,
          attempts: gatewayRetry.attempts,
          gatewayUrl,
          message: gatewayMessage,
          probe: gatewayRetry.probe,
        },
        workspace: {
          state: workspaceValidation.ok ? 'ok' : 'error',
          path: workspaceValidation.path,
          message: workspaceMessage,
          issues: summarizeIssues(workspaceValidation.issues),
          bootstrap: {
            ensured: workspaceBootstrap.ensured,
            createdDirectories: workspaceBootstrap.createdDirectories.length,
            createdFiles: workspaceBootstrap.createdFiles.length,
          },
        },
      },
      timestamp: new Date().toISOString(),
    }

    return NextResponse.json({ data: response })
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Failed to compute initialization status',
      },
      { status: 500 }
    )
  }
}
