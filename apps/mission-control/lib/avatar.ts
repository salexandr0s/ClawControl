/**
 * Avatar Generation
 *
 * Generates deterministic identicon-style avatars for agents.
 * Uses FNV-1a hash to create a unique 5x5 symmetric pattern.
 */

// Theme colors from the design system
const AVATAR_COLORS = [
  '#6C8CFF', // progress/blue
  '#56CCF2', // info/cyan
  '#2ECC71', // success/green
  '#F2C94C', // warning/yellow
  '#EB5757', // danger/red
] as const

const BACKGROUND_COLOR = '#101723'

/**
 * FNV-1a 32-bit hash function
 */
function fnv1a(str: string): number {
  let hash = 2166136261
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = (hash * 16777619) >>> 0
  }
  return hash
}

/**
 * Expand a seed into deterministic bytes using xorshift
 */
function expandToBytes(seed: number, length: number): number[] {
  const bytes: number[] = []
  let state = seed || 1

  for (let i = 0; i < length; i++) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    bytes.push((state >>> 0) & 0xff)
  }

  return bytes
}

/**
 * Generate an identicon SVG for an agent name
 */
export function generateIdenticonSvg(
  name: string,
  options: { size?: number; cells?: number } = {}
): string {
  const { size = 64, cells = 5 } = options

  // Hash the name
  const hash = fnv1a(name)
  const bytes = expandToBytes(hash, 32)

  // Pick a color based on the hash
  const colorIndex = hash % AVATAR_COLORS.length
  const color = AVATAR_COLORS[colorIndex]

  // Generate the pattern (5x5 grid, symmetric on Y axis)
  const cellSize = size / cells
  const halfCells = Math.ceil(cells / 2)

  const rects: string[] = []

  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < halfCells; x++) {
      const byteIndex = y * halfCells + x
      const shouldFill = (bytes[byteIndex % bytes.length] & 1) === 1

      if (shouldFill) {
        // Add cell on the left side
        rects.push(
          `<rect x="${x * cellSize}" y="${y * cellSize}" width="${cellSize}" height="${cellSize}" fill="${color}"/>`
        )

        // Mirror to the right side (if not center column)
        const mirrorX = cells - 1 - x
        if (mirrorX !== x) {
          rects.push(
            `<rect x="${mirrorX * cellSize}" y="${y * cellSize}" width="${cellSize}" height="${cellSize}" fill="${color}"/>`
          )
        }
      }
    }
  }

  // Build the SVG
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="8" fill="${BACKGROUND_COLOR}"/>
  ${rects.join('\n  ')}
</svg>`

  return svg
}

/**
 * Generate a data URL for an identicon
 */
export function generateIdenticonDataUrl(name: string, size = 64): string {
  const svg = generateIdenticonSvg(name, { size })
  const base64 = Buffer.from(svg).toString('base64')
  return `data:image/svg+xml;base64,${base64}`
}

/**
 * Get the color for a given agent name (for use in UI)
 */
export function getAgentColor(name: string): string {
  const hash = fnv1a(name)
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}
