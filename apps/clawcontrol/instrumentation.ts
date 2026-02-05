/**
 * Next.js Instrumentation Hook
 *
 * Runs once at process startup (before any routes are handled).
 * Used to initialize critical DB settings like WAL mode.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only run on Node.js runtime (not Edge)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { enableWalMode } = await import('./lib/db')
    await enableWalMode()
    console.log('[boot] WAL mode enabled')

    try {
      const { syncAgentsFromOpenClaw } = await import('./lib/sync-agents')
      const result = await syncAgentsFromOpenClaw()
      if (result.added || result.updated) {
        console.log(`[boot] Synced agents from OpenClaw: ${result.added} added, ${result.updated} updated`)
      }
    } catch (err) {
      console.warn('[boot] OpenClaw agent sync skipped:', err instanceof Error ? err.message : String(err))
    }
  }
}
