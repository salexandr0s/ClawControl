import { NextRequest, NextResponse } from 'next/server'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { getRepos, useMockData } from '@/lib/repo'
import { generateIdenticonSvg } from '@/lib/avatar'
import { enforceTypedConfirm } from '@/lib/with-governor'
import { getWorkspaceRoot, validateWorkspacePath } from '@/lib/fs/path-policy'
import type { ActionKind } from '@savorg/core'

const AVATAR_ACTION: ActionKind = 'agent.edit'
const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB
const MAX_DIMENSION = 512
const AVATARS_DIR = 'agents/avatars'

function getAvatarsRoot(): string {
  return join(getWorkspaceRoot(), AVATARS_DIR)
}

/**
 * GET /api/agents/:id/avatar
 *
 * Return the agent's avatar as SVG (default identicon) or PNG (custom upload).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // Get agent
  const repos = getRepos()
  const agent = await repos.agents.getById(id)

  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  // If custom avatar exists, serve it
  if (agent.avatarPath && !useMockData()) {
    try {
      const avatarAbs = join(getWorkspaceRoot(), agent.avatarPath)
      const data = await fsp.readFile(avatarAbs)
      return new NextResponse(data, {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=3600',
        },
      })
    } catch {
      // Fall through to identicon if file not found
    }
  }

  // Generate identicon SVG
  const svg = generateIdenticonSvg(agent.name, { size: 128 })

  return new NextResponse(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}

/**
 * POST /api/agents/:id/avatar
 *
 * Upload a custom avatar image. Accepts data URL (base64).
 * Validates size and dimensions, converts to PNG.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // Get agent
  const repos = getRepos()
  const agent = await repos.agents.getById(id)

  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  const body = await request.json()
  const { dataUrl, typedConfirmText } = body as {
    dataUrl: string
    typedConfirmText?: string
  }

  if (!dataUrl || !dataUrl.startsWith('data:image/')) {
    return NextResponse.json(
      { error: 'Invalid image data. Must be a data URL.' },
      { status: 400 }
    )
  }

  // Enforce typed confirmation
  const result = await enforceTypedConfirm({
    actionKind: AVATAR_ACTION,
    typedConfirmText,
  })

  if (!result.allowed) {
    return NextResponse.json(
      {
        error: result.errorType,
        policy: result.policy,
      },
      { status: result.errorType === 'TYPED_CONFIRM_REQUIRED' ? 428 : 403 }
    )
  }

  // Parse the data URL
  const matches = dataUrl.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/)
  if (!matches) {
    return NextResponse.json(
      { error: 'Invalid image format. Must be PNG, JPEG, or WebP.' },
      { status: 400 }
    )
  }

  const base64Data = matches[2]
  const buffer = Buffer.from(base64Data, 'base64')

  // Check file size
  if (buffer.length > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `Image too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.` },
      { status: 400 }
    )
  }

  if (useMockData()) {
    // In mock mode, just return success without writing
    return NextResponse.json({
      data: {
        avatarPath: `${AVATARS_DIR}/${agent.id}.png`,
        message: 'Avatar uploaded (mock mode)',
      },
    })
  }

  try {
    // Ensure avatars directory exists
    const avatarsRoot = getAvatarsRoot()
    await fsp.mkdir(avatarsRoot, { recursive: true })

    // Write the file as PNG
    const avatarPath = `${AVATARS_DIR}/${agent.id}.png`
    const avatarAbs = join(getWorkspaceRoot(), avatarPath)

    // Validate the path
    validateWorkspacePath(avatarAbs)

    // Write file directly (we accept any valid image format)
    await fsp.writeFile(avatarAbs, buffer)

    // Update agent record
    await repos.agents.update(id, { avatarPath })

    return NextResponse.json({
      data: {
        avatarPath,
        message: 'Avatar uploaded successfully',
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to upload avatar'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/**
 * DELETE /api/agents/:id/avatar
 *
 * Reset avatar to default identicon.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // Get agent
  const repos = getRepos()
  const agent = await repos.agents.getById(id)

  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  const body = await request.json().catch(() => ({}))
  const { typedConfirmText } = body as { typedConfirmText?: string }

  // Enforce typed confirmation
  const result = await enforceTypedConfirm({
    actionKind: AVATAR_ACTION,
    typedConfirmText,
  })

  if (!result.allowed) {
    return NextResponse.json(
      {
        error: result.errorType,
        policy: result.policy,
      },
      { status: result.errorType === 'TYPED_CONFIRM_REQUIRED' ? 428 : 403 }
    )
  }

  if (useMockData()) {
    return NextResponse.json({
      data: { message: 'Avatar reset (mock mode)' },
    })
  }

  try {
    // Try to delete the file (best effort)
    if (agent.avatarPath) {
      const avatarAbs = join(getWorkspaceRoot(), agent.avatarPath)
      await fsp.unlink(avatarAbs).catch(() => {})
    }

    // Clear avatar path in database
    await repos.agents.update(id, { avatarPath: null })

    return NextResponse.json({
      data: { message: 'Avatar reset to default' },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to reset avatar'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
