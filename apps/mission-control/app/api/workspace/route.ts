import { NextRequest, NextResponse } from 'next/server'
import { useMockData } from '@/lib/repo'
import { mockWorkspaceFiles } from '@savorg/core'
import { listWorkspace } from '@/lib/fs/workspace-fs'

/**
 * GET /api/workspace?path=/agents
 * List workspace directory entries.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const path = searchParams.get('path') || '/'

  try {
    if (useMockData()) {
      const data = mockWorkspaceFiles
        .filter((f) => f.path === path)
        .map((f) => ({
          id: f.id,
          name: f.name,
          type: f.type,
          path: f.path,
          size: f.size,
          modifiedAt: f.modifiedAt,
        }))

      return NextResponse.json({ data })
    }

    const data = await listWorkspace(path)
    return NextResponse.json({ data })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to list workspace'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
