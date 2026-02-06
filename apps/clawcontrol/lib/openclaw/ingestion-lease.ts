import 'server-only'

import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'

export interface LeaseAcquireResult {
  acquired: boolean
  ownerId: string
}

export async function acquireIngestionLease(
  name: string,
  ttlMs = 90_000,
  ownerId = randomUUID()
): Promise<LeaseAcquireResult> {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + ttlMs)

  await prisma.ingestionLease.deleteMany({
    where: {
      name,
      expiresAt: { lt: now },
    },
  })

  try {
    await prisma.ingestionLease.create({
      data: {
        name,
        ownerId,
        acquiredAt: now,
        expiresAt,
      },
    })

    return { acquired: true, ownerId }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { acquired: false, ownerId }
    }
    throw error
  }
}

export async function releaseIngestionLease(name: string, ownerId: string): Promise<void> {
  await prisma.ingestionLease.deleteMany({
    where: {
      name,
      ownerId,
    },
  })
}

export async function withIngestionLease<T>(
  name: string,
  work: () => Promise<T>,
  options?: {
    ttlMs?: number
  }
): Promise<{ lockAcquired: boolean; value?: T }> {
  const lease = await acquireIngestionLease(name, options?.ttlMs)
  if (!lease.acquired) return { lockAcquired: false }

  try {
    const value = await work()
    return { lockAcquired: true, value }
  } finally {
    await releaseIngestionLease(name, lease.ownerId)
  }
}
