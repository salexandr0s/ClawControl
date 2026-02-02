/**
 * Workspace File Utilities
 *
 * Handles file generation and management for agent workspace files.
 * Includes path safety checks and template generation.
 */

import { mockWorkspaceFiles, mockFileContents } from '@savorgos/core'
import type { Station } from '@savorgos/core'
import { isValidWorkspacePath } from './fs/path-policy'

// Re-export path validation for backward compatibility
export { isValidWorkspacePath }

/**
 * Generate a safe file ID from path
 */
export function generateFileId(path: string, name: string): string {
  const hash = Buffer.from(`${path}/${name}`).toString('base64').slice(0, 8)
  return `ws_${hash}`
}

// ============================================================================
// AGENT NAME GENERATION
// ============================================================================

/**
 * Standard agent role prefixes
 */
export const AGENT_ROLE_MAP: Record<string, { prefix: string; station: Station; description: string }> = {
  spec: { prefix: 'SPEC', station: 'spec', description: 'Specification & requirements' },
  build: { prefix: 'BUILD', station: 'build', description: 'Implementation & coding' },
  qa: { prefix: 'QA', station: 'qa', description: 'Testing & quality assurance' },
  ops: { prefix: 'OPS', station: 'ops', description: 'Operations & deployment' },
  review: { prefix: 'REVIEW', station: 'qa', description: 'Code review & approval' },
  ship: { prefix: 'SHIP', station: 'ship', description: 'Deployment & release' },
  compound: { prefix: 'COMPOUND', station: 'compound', description: 'Learning & documentation' },
  update: { prefix: 'UPDATE', station: 'update', description: 'Dependency & maintenance' },
}

/**
 * Generate an agent name from role
 * Example: role="build" -> "savorgBUILD"
 */
export function generateAgentName(role: string): string {
  const mapped = AGENT_ROLE_MAP[role.toLowerCase()]
  if (mapped) {
    return `savorg${mapped.prefix}`
  }
  // Fallback: capitalize first letter of each word
  const normalized = role.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return `savorg${normalized}`
}

/**
 * Derive session key from agent name
 */
export function generateSessionKey(agentName: string): string {
  const normalized = agentName.toLowerCase().replace(/[^a-z0-9]/g, '_')
  const timestamp = Date.now().toString(36)
  return `sess_${normalized}_${timestamp}`
}

// ============================================================================
// TEMPLATE GENERATION
// ============================================================================

export interface AgentTemplateInput {
  name: string
  role: string
  purpose: string
  capabilities: string[]
  station: Station
}

/**
 * Generate the SOUL.md content for an agent
 */
export function generateSoulContent(input: AgentTemplateInput): string {
  const capabilitiesList = input.capabilities.map(c => `- ${c}`).join('\n')

  return `# ${input.name} Soul

## Identity
You are ${input.name}, a SAVORG agent with the role of **${input.role}**.

## Purpose
${input.purpose}

## Capabilities
${capabilitiesList}

## Core Behaviors

### Safety First
- Never take destructive actions without explicit approval
- Always verify before modifying production systems
- Log all significant decisions for audit trail

### Collaboration
- Respect station boundaries and hand off work appropriately
- Communicate status changes to dependent agents
- Ask for clarification when requirements are ambiguous

### Quality
- Follow established patterns in the codebase
- Write tests for new functionality
- Document non-obvious decisions

## Constraints
- WIP Limit: 2 concurrent operations
- Must request approval for external API calls
- Cannot modify AGENTS.md without approval

## Station: ${input.station}
You operate primarily at the **${input.station}** station.
`
}

/**
 * Generate the overlay.md content for an agent
 */
export function generateOverlayContent(input: AgentTemplateInput): string {
  return `# ${input.name} Overlay

## Agent: ${input.name}
Role: ${input.role}
Station: ${input.station}

## Custom Instructions

<!-- Add agent-specific instructions here -->

## Allowed Tools
- read_file
- write_file
- execute_command (with approval for dangerous commands)
- git operations

## Restricted Actions
- Direct database writes (use API instead)
- Production deployments (requires ship gate approval)
- External API calls (requires approval)

## Notes
<!-- Add any agent-specific notes here -->
`
}

/**
 * Generate the section to add to AGENTS.md for a new agent
 */
export function generateAgentsMdSection(input: AgentTemplateInput): string {
  return `
### ${input.name}
- **Role:** ${input.role}
- **Station:** ${input.station}
- **Purpose:** ${input.purpose}
- **Capabilities:** ${input.capabilities.join(', ')}
`
}

// ============================================================================
// FILE OPERATIONS (Mock Implementation)
// ============================================================================

/**
 * Result of a workspace file write
 */
export interface WriteResult {
  success: boolean
  fileId?: string
  error?: string
}

/**
 * Write a file to the workspace (mock implementation)
 * In production, this would write to the actual filesystem
 */
export function writeWorkspaceFile(
  path: string,
  name: string,
  content: string
): WriteResult {
  // Validate path
  if (!isValidWorkspacePath(path)) {
    return { success: false, error: 'Invalid workspace path' }
  }

  // Generate ID
  const fileId = generateFileId(path, name)

  // Check if file exists
  const existing = mockWorkspaceFiles.find(
    f => f.path === path && f.name === name
  )

  if (existing) {
    // Update existing file
    existing.modifiedAt = new Date()
    existing.size = content.length
    mockFileContents[existing.id] = content
    return { success: true, fileId: existing.id }
  }

  // Create new file
  const newFile = {
    id: fileId,
    name,
    type: 'file' as const,
    path,
    size: content.length,
    modifiedAt: new Date(),
  }

  mockWorkspaceFiles.push(newFile)
  mockFileContents[fileId] = content

  return { success: true, fileId }
}

/**
 * Create a folder in the workspace (mock implementation)
 */
export function createWorkspaceFolder(
  path: string,
  name: string
): WriteResult {
  // Validate path
  if (!isValidWorkspacePath(path)) {
    return { success: false, error: 'Invalid workspace path' }
  }

  // Check if folder exists
  const existing = mockWorkspaceFiles.find(
    f => f.path === path && f.name === name && f.type === 'folder'
  )

  if (existing) {
    return { success: true, fileId: existing.id }
  }

  // Generate ID
  const fileId = generateFileId(path, name)

  // Create folder
  const newFolder = {
    id: fileId,
    name,
    type: 'folder' as const,
    path,
    modifiedAt: new Date(),
  }

  mockWorkspaceFiles.push(newFolder)

  return { success: true, fileId }
}

/**
 * Read a workspace file content
 */
export function readWorkspaceFile(fileId: string): string | null {
  return mockFileContents[fileId] ?? null
}

/**
 * Append content to a workspace file
 */
export function appendToWorkspaceFile(
  fileId: string,
  content: string
): WriteResult {
  const existing = mockFileContents[fileId]
  if (existing === undefined) {
    return { success: false, error: 'File not found' }
  }

  mockFileContents[fileId] = existing + content

  // Update modification time
  const file = mockWorkspaceFiles.find(f => f.id === fileId)
  if (file) {
    file.modifiedAt = new Date()
    file.size = mockFileContents[fileId].length
  }

  return { success: true, fileId }
}

// ============================================================================
// AGENT FILE CREATION
// ============================================================================

export interface CreateAgentFilesInput {
  name: string
  role: string
  purpose: string
  capabilities: string[]
  station: Station
}

export interface CreateAgentFilesResult {
  success: boolean
  files: {
    soul?: string
    overlay?: string
    agentsMd?: boolean
  }
  error?: string
}

/**
 * Create all workspace files for a new agent
 */
export function createAgentFiles(input: CreateAgentFilesInput): CreateAgentFilesResult {
  const templateInput: AgentTemplateInput = {
    name: input.name,
    role: input.role,
    purpose: input.purpose,
    capabilities: input.capabilities,
    station: input.station,
  }

  // Ensure /agents folder exists
  createWorkspaceFolder('/', 'agents')

  // Create soul file: /agents/<name>.soul.md
  const soulContent = generateSoulContent(templateInput)
  const soulResult = writeWorkspaceFile(
    '/agents',
    `${input.name}.soul.md`,
    soulContent
  )

  if (!soulResult.success) {
    return { success: false, files: {}, error: `Failed to create soul file: ${soulResult.error}` }
  }

  // Create overlay file: /agents/<name>.md
  const overlayContent = generateOverlayContent(templateInput)
  const overlayResult = writeWorkspaceFile(
    '/agents',
    `${input.name}.md`,
    overlayContent
  )

  if (!overlayResult.success) {
    return {
      success: false,
      files: { soul: soulResult.fileId },
      error: `Failed to create overlay file: ${overlayResult.error}`,
    }
  }

  // Append to AGENTS.md (id: ws_01)
  const agentSection = generateAgentsMdSection(templateInput)
  const appendResult = appendToWorkspaceFile('ws_01', agentSection)

  return {
    success: true,
    files: {
      soul: soulResult.fileId,
      overlay: overlayResult.fileId,
      agentsMd: appendResult.success,
    },
  }
}
