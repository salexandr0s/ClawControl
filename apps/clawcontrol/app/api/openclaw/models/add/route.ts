import { NextRequest, NextResponse } from 'next/server'
import { addModelProviderApiKeyAuth, type ModelAuthMethod } from '@/lib/openclaw/models'

type AddModelBody = {
  provider: string
  authMethod: ModelAuthMethod
  apiKey?: string
}

/**
 * POST /api/openclaw/models/add
 *
 * Adds provider authentication so models become usable in configuration.
 * Notes:
 * - API keys are accepted and written via OpenClaw's `models auth paste-token`.
 * - OAuth login currently requires an interactive TTY, so the UI can only show guidance.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json()) as Partial<AddModelBody>
  const provider = typeof body.provider === 'string' ? body.provider.trim() : ''
  const authMethod = body.authMethod

  if (!provider) {
    return NextResponse.json({ error: 'provider is required' }, { status: 400 })
  }

  if (authMethod !== 'apiKey' && authMethod !== 'oauth') {
    return NextResponse.json({ error: 'authMethod must be apiKey or oauth' }, { status: 400 })
  }

  if (authMethod === 'oauth') {
    return NextResponse.json(
      {
        error: 'OAuth login requires an interactive TTY. Run `openclaw models auth login --provider <provider>` in a terminal.',
        code: 'OAUTH_TTY_REQUIRED',
      },
      { status: 409 }
    )
  }

  const apiKey = typeof body.apiKey === 'string' ? body.apiKey : ''
  const result = await addModelProviderApiKeyAuth({ provider, apiKey })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ data: { provider } })
}

