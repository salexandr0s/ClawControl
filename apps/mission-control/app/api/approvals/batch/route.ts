import { NextRequest, NextResponse } from 'next/server'
import { getRepos, type ApprovalDTO } from '@/lib/repo'

/**
 * POST /api/approvals/batch
 *
 * Batch update approvals (approve or reject multiple at once).
 * Excludes risky_action (danger-level) approvals from batch operations.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { ids, status, resolvedBy } = body as {
      ids: string[]
      status: 'approved' | 'rejected'
      resolvedBy?: string
    }

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        { error: 'ids array is required and must not be empty' },
        { status: 400 }
      )
    }

    if (!status || !['approved', 'rejected'].includes(status)) {
      return NextResponse.json(
        { error: 'status must be "approved" or "rejected"' },
        { status: 400 }
      )
    }

    const repos = getRepos()
    const updated: ApprovalDTO[] = []
    const failed: string[] = []

    for (const id of ids) {
      try {
        // Get approval first to check type
        const approval = await repos.approvals.getById(id)
        if (!approval) {
          failed.push(id)
          continue
        }

        // Skip risky_action (danger-level) - these require individual review
        if (approval.type === 'risky_action') {
          failed.push(id)
          continue
        }

        // Skip if already resolved
        if (approval.status !== 'pending') {
          failed.push(id)
          continue
        }

        // Update the approval
        const result = await repos.approvals.update(id, {
          status,
          resolvedBy: resolvedBy ?? 'operator',
        })
        if (result) {
          updated.push(result)
        } else {
          failed.push(id)
        }
      } catch {
        failed.push(id)
      }
    }

    return NextResponse.json({
      data: {
        updated,
        failed,
      },
    })
  } catch (error) {
    console.error('Batch approval error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to batch update approvals' },
      { status: 500 }
    )
  }
}
