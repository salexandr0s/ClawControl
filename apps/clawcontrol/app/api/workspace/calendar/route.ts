import { NextRequest, NextResponse } from 'next/server'
import { getWorkspaceCalendar } from '@/lib/workspace/calendar-index'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const now = new Date()
  const defaultMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`

  const month = searchParams.get('month') || defaultMonth
  const root = searchParams.get('root')
  const folder = searchParams.get('folder')

  try {
    const data = await getWorkspaceCalendar({ month, root, folder })
    return NextResponse.json({ data })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to build calendar' },
      { status: 400 }
    )
  }
}
