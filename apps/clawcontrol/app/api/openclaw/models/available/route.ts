import { NextResponse } from 'next/server'
import { getAvailableModelProviders } from '@/lib/openclaw/models'

/**
 * GET /api/openclaw/models/available
 *
 * Returns a list of supported model providers and their auth options.
 */
export async function GET() {
  try {
    const providers = await getAvailableModelProviders()
    return NextResponse.json({ data: { providers } })
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Failed to load providers',
        data: { providers: [] },
      },
      { status: 500 }
    )
  }
}

