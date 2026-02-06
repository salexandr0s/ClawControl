import { NextRequest, NextResponse } from 'next/server'
import { mutateFavorites, readWorkspaceFavorites } from '@/lib/workspace/favorites-store'

export async function GET() {
  const data = await readWorkspaceFavorites()
  return NextResponse.json({ data })
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const action = (body?.action || '').toString() as 'add' | 'remove' | 'toggle'
  const path = (body?.path || '').toString()

  if (!action || !['add', 'remove', 'toggle'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  if (!path) {
    return NextResponse.json({ error: 'Missing path' }, { status: 400 })
  }

  try {
    const data = await mutateFavorites(action, path)
    return NextResponse.json({ data })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update favorites' },
      { status: 400 }
    )
  }
}
