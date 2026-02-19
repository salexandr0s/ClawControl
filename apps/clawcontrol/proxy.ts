import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const CSRF_HEADER = 'x-clawcontrol-csrf'
const INTERNAL_TOKEN_HEADER = 'x-clawcontrol-internal-token'
const OPERATOR_SESSION_COOKIE = 'cc_operator_session'
const CSRF_COOKIE = 'cc_csrf'

function isInternalTokenRoute(pathname: string): boolean {
  return pathname === '/api/agents/completion' || pathname.startsWith('/api/internal/')
}

function parseHost(hostHeader: string | null): string | null {
  if (!hostHeader) return null
  // hostHeader may be "127.0.0.1:3000" or "[::1]:3000"
  const h = hostHeader.trim()
  if (h.startsWith('[')) {
    const end = h.indexOf(']')
    return end !== -1 ? h.slice(0, end + 1) : h
  }
  return h.split(':')[0]
}

export function proxy(req: NextRequest) {
  const host = parseHost(req.headers.get('host'))

  // Hard fail if accessed via anything other than loopback.
  // Even if someone reverse-proxies to it, we refuse.
  if (host && !LOOPBACK_HOSTS.has(host)) {
    return new NextResponse(
      'clawcontrol is local-only. Access must be via 127.0.0.1/localhost (or SSH port-forward).',
      { status: 403 }
    )
  }

  const pathname = req.nextUrl.pathname

  if (MUTATING_METHODS.has(req.method) && pathname.startsWith('/api/')) {
    if (pathname === '/api/auth/bootstrap') {
      return NextResponse.next()
    }

    if (isInternalTokenRoute(pathname)) {
      if (!req.headers.get(INTERNAL_TOKEN_HEADER)?.trim()) {
        return NextResponse.json(
          { error: 'Internal token is required', code: 'INTERNAL_TOKEN_REQUIRED' },
          { status: 403 }
        )
      }
      return NextResponse.next()
    }

    const sessionCookie = req.cookies.get(OPERATOR_SESSION_COOKIE)?.value ?? ''
    const csrfCookie = req.cookies.get(CSRF_COOKIE)?.value ?? ''
    const csrfHeader = req.headers.get(CSRF_HEADER)?.trim() ?? ''

    if (!sessionCookie) {
      return NextResponse.json(
        { error: 'Operator session is required', code: 'AUTH_REQUIRED' },
        { status: 401 }
      )
    }

    if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
      return NextResponse.json(
        { error: 'Invalid CSRF token', code: 'CSRF_INVALID' },
        { status: 403 }
      )
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
