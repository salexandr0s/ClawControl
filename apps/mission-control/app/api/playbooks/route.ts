import { NextResponse } from 'next/server'
import { useMockData } from '@/lib/repo'
import { mockPlaybooks } from '@savorg/core'
import { listPlaybooks } from '@/lib/fs/playbooks-fs'

/**
 * GET /api/playbooks
 * List all playbooks
 */
export async function GET() {
  if (useMockData()) {
    return NextResponse.json({
      data: mockPlaybooks.map(({ id, name, description, severity, modifiedAt }) => ({
        id,
        name,
        description,
        severity,
        modifiedAt,
      })),
    })
  }

  try {
    const playbooks = await listPlaybooks()
    return NextResponse.json({ data: playbooks })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to list playbooks'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
