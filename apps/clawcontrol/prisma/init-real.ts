/**
 * Minimal database bootstrap for real (non-demo) installs.
 *
 * This script must NOT create demo/mock records. It should only:
 * - enable SQLite WAL mode
 * - ensure FTS tables exist
 * - ensure reserved/system work orders exist (FK safety)
 */

import { enableWalMode, ensureReservedWorkOrders, prisma } from '../lib/db'
import { initializeFts } from '../lib/db/fts'

async function main() {
  await enableWalMode()
  await initializeFts()
  await ensureReservedWorkOrders()
  console.log('✓ Database bootstrap complete')
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
