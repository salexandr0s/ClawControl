import { NextRequest, NextResponse } from 'next/server'
import { search, type SearchScope } from '@/lib/data'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const query = searchParams.get('q') || ''
  const scope = searchParams.get('scope') as SearchScope | undefined
  const limitStr = searchParams.get('limit')
  const limit = limitStr ? parseInt(limitStr, 10) : 20

  if (!query.trim()) {
    return NextResponse.json({ results: [] })
  }

  try {
    const results = await search(query, {
      scope: scope || 'all',
      limit,
    })

    return NextResponse.json({ results })
  } catch (error) {
    console.error('[api/search] Error:', error)
    return NextResponse.json(
      { error: 'Search failed', results: [] },
      { status: 500 }
    )
  }
}
