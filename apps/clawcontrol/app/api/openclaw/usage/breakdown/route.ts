import { NextRequest, NextResponse } from 'next/server'
import { getUsageBreakdown } from '@/lib/openclaw/usage-query'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const groupBy = searchParams.get('groupBy') || 'model'

  if (groupBy !== 'model' && groupBy !== 'agent') {
    return NextResponse.json({ error: 'Invalid groupBy' }, { status: 400 })
  }

  const result = await getUsageBreakdown({
    groupBy,
    from: searchParams.get('from'),
    to: searchParams.get('to'),
  })

  return NextResponse.json({ data: result })
}
