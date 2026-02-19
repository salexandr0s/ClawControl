import 'server-only'

import { syncAgentsFromOpenClaw } from '@/lib/sync-agents'
import { syncSessionsFromOpenClaw } from '@/lib/sync-sessions'
import { isFirstRun } from '@/lib/first-run'
import { setLastSync, type SyncRunSource, type SyncRunStatus } from '@/lib/sync-state'
import { reconcileActiveGovernanceProfiles } from '@/lib/services/governance-profiles'

export async function runSyncJob(source: SyncRunSource = 'manual'): Promise<SyncRunStatus> {
  const timestamp = new Date().toISOString()
  const result: SyncRunStatus = {
    timestamp,
    source,
    agents: {
      success: false,
      count: 0,
    },
    sessions: {
      success: false,
      count: 0,
    },
  }

  let forceRefresh = false
  try {
    forceRefresh = await isFirstRun()
  } catch (err) {
    result.agents.error = err instanceof Error ? err.message : String(err)
  }

  try {
    const synced = await syncAgentsFromOpenClaw({ forceRefresh })
    let reconcileCount = 0
    let reconcileError: string | null = null

    try {
      const reconciled = await reconcileActiveGovernanceProfiles({ apply: true })
      reconcileCount = reconciled.totalMutations
      const failed = reconciled.results.find((entry) => typeof entry.error === 'string')
      if (failed?.error) {
        reconcileError = `${failed.profileId}: ${failed.error}`
      }
    } catch (err) {
      reconcileError = err instanceof Error ? err.message : String(err)
      console.error('[sync] Governance profile reconciliation failed:', reconcileError)
    }

    result.agents = {
      success: true,
      count: synced.added + synced.updated + synced.stale + reconcileCount,
      ...(reconcileError ? { error: reconcileError } : {}),
    }
  } catch (err) {
    result.agents.error = err instanceof Error ? err.message : String(err)
  }

  try {
    const synced = await syncSessionsFromOpenClaw()
    result.sessions = {
      success: true,
      count: synced.synced,
    }
  } catch (err) {
    result.sessions.error = err instanceof Error ? err.message : String(err)
  }

  setLastSync(result)

  return result
}
