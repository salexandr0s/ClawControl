import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

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

export function middleware(req: NextRequest) {
  const host = parseHost(req.headers.get('host'))

  // Hard fail if accessed via anything other than loopback.
  // Even if someone reverse-proxies to it, we refuse.
  if (host && !LOOPBACK_HOSTS.has(host)) {
    return new NextResponse(
      'Mission Control is local-only. Access must be via 127.0.0.1/localhost (or SSH port-forward).',
      { status: 403 }
    )
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
