import { NextResponse } from 'next/server'
import { buildAgentHierarchyApiPayload } from '@/lib/services/agent-hierarchy-api'

/**
 * GET /api/agents/hierarchy
 *
 * Returns normalized hierarchy nodes/edges with source metadata and warnings.
 */
export async function GET() {
  try {
    const payload = await buildAgentHierarchyApiPayload()
    return NextResponse.json(payload)
  } catch (error) {
    console.error('[api/agents/hierarchy] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to build agents hierarchy' },
      { status: 500 }
    )
  }
}
