export function safeStack(err: unknown, maxLines = 6): string | null {
  if (!(err instanceof Error)) return null
  if (!err.stack) return null
  return err.stack.split('\n').slice(0, maxLines).join('\n')
}

export function stderrTail(text: string | undefined, maxChars = 800): string | null {
  if (!text) return null
  const t = text.trim()
  if (!t) return null
  return t.length <= maxChars ? t : t.slice(-maxChars)
}

export function detectPrismaHmrMismatchHint(err: unknown): string | null {
  const msg = err instanceof Error ? (err.stack || err.message) : String(err)

  // Common dev hot-reload mismatches:
  // - prisma.<model> is undefined
  // - Client is out-of-date with generated types
  if (
    msg.includes("Cannot read properties of undefined (reading 'agentSession')") ||
    msg.includes("Cannot read properties of undefined (reading 'upsert')") ||
    msg.includes('Prisma Client did not initialize') ||
    msg.includes('Unknown argument')
  ) {
    return 'Prisma client mismatch during HMR — restart dev server'
  }

  return null
}

export function parseExplicitLinkage(input: {
  sessionKey?: string
  flags?: string[]
  metadata?: { operationId?: string; workOrderId?: string }
}): { operationId?: string; workOrderId?: string } {
  // Highest precedence: explicit metadata
  const opMeta = input.metadata?.operationId
  const woMeta = input.metadata?.workOrderId

  // Next: flags e.g. ["op:<id>","wo:<id>"]
  const flagOp = input.flags?.find((f) => f.startsWith('op:'))?.slice(3)
  const flagWo = input.flags?.find((f) => f.startsWith('wo:'))?.slice(3)

  // Last: sessionKey tokens e.g. "... op:<id> ..." or "... wo:<id> ..."
  const key = input.sessionKey ?? ''
  const opMatch = key.match(/\bop:([a-z0-9_-]{10,})\b/i)
  const woMatch = key.match(/\bwo:([a-z0-9_-]{10,})\b/i)

  const operationId = opMeta || flagOp || opMatch?.[1]
  const workOrderId = woMeta || flagWo || woMatch?.[1]

  return {
    ...(operationId ? { operationId } : {}),
    ...(workOrderId ? { workOrderId } : {}),
  }
}
