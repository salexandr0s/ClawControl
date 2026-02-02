import { NextResponse } from 'next/server'
import { mockPlaybooks } from '@savorgos/core'

/**
 * GET /api/playbooks
 * List all playbooks
 */
export async function GET() {
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
