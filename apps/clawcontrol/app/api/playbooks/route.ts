import { NextResponse } from 'next/server'
import { listPlaybooks } from '@/lib/fs/playbooks-fs'

/**
 * GET /api/playbooks
 * List all playbooks
 */
export async function GET() {
  try {
    const playbooks = await listPlaybooks()
    return NextResponse.json({ data: playbooks })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to list playbooks'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
