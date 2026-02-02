/**
 * SSE Connection Limiter
 *
 * Prevents DoS attacks by limiting the number of concurrent SSE connections
 * per endpoint. Returns 429 Too Many Requests when limit is exceeded.
 */

const MAX_SSE_CLIENTS = 50

// Track connections per endpoint
const connections = new Map<string, number>()

/**
 * Check if a new connection can be accepted for an endpoint
 */
export function checkConnectionLimit(endpoint: string): boolean {
  const count = connections.get(endpoint) ?? 0
  return count < MAX_SSE_CLIENTS
}

/**
 * Increment the connection count for an endpoint
 * Call this when a new SSE connection is established
 */
export function incrementConnection(endpoint: string): void {
  const count = connections.get(endpoint) ?? 0
  connections.set(endpoint, count + 1)
}

/**
 * Decrement the connection count for an endpoint
 * Call this when an SSE connection is closed (via abort signal)
 */
export function decrementConnection(endpoint: string): void {
  const count = connections.get(endpoint) ?? 0
  connections.set(endpoint, Math.max(0, count - 1))
}

/**
 * Get the current connection count for an endpoint
 */
export function getConnectionCount(endpoint: string): number {
  return connections.get(endpoint) ?? 0
}

/**
 * Get all connection counts (for monitoring/debugging)
 */
export function getAllConnectionCounts(): Record<string, number> {
  return Object.fromEntries(connections.entries())
}

/**
 * Get the maximum allowed connections
 */
export function getMaxConnections(): number {
  return MAX_SSE_CLIENTS
}
