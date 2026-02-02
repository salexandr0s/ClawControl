/**
 * Global invariants and validation rules
 */

/**
 * Validate agent name format: savorg + ROLE (uppercase letters/digits)
 * Examples: savorgBUILD, savorgQA, savorgOPS
 */
export function isValidAgentName(name: string): boolean {
  return /^savorg[A-Z0-9]{2,16}$/.test(name)
}

/**
 * Validate Work Order code format: WO-NNNN
 */
export function isValidWorkOrderCode(code: string): boolean {
  return /^WO-\d{4}$/.test(code)
}

/**
 * Generate next Work Order code from sequence number
 */
export function formatWorkOrderCode(seq: number): string {
  return `WO-${String(seq).padStart(4, '0')}`
}

/**
 * Parse Work Order code to sequence number
 */
export function parseWorkOrderCode(code: string): number | null {
  const match = code.match(/^WO-(\d{4})$/)
  return match ? parseInt(match[1], 10) : null
}

/**
 * Validate session key format: agent:<agentName>:main
 */
export function isValidSessionKey(key: string): boolean {
  return /^agent:[a-zA-Z0-9]+:main$/.test(key)
}

/**
 * Generate session key from agent name
 */
export function generateSessionKey(agentName: string): string {
  return `agent:${agentName}:main`
}

/**
 * Maximum sizes for various fields (in bytes)
 */
export const SIZE_LIMITS = {
  STDOUT_EXCERPT: 32768, // 32KB
  STDERR_EXCERPT: 32768, // 32KB
  PARSED_JSON: 262144, // 256KB
  PAYLOAD_JSON: 65536, // 64KB
} as const

/**
 * Trim string to max length, keeping the tail
 */
export function trimToLimit(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.slice(-maxLength)
}

/**
 * Capabilities that require approval when used
 */
export const DANGEROUS_CAPABILITIES = [
  'deploy',
  'cron_edit',
  'shell',
  'network',
] as const

/**
 * Check if a capability requires approval
 */
export function requiresApproval(capability: string): boolean {
  return DANGEROUS_CAPABILITIES.includes(capability as any)
}
