import { NextRequest, NextResponse } from 'next/server'
import { touchRecent } from '@/lib/workspace/favorites-store'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const path = (body?.path || '').toString()

  if (!path) {
    return NextResponse.json({ error: 'Missing path' }, { status: 400 })
  }

  try {
    const data = await touchRecent(path)
    return NextResponse.json({ data })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update recents' },
      { status: 400 }
    )
  }
}
