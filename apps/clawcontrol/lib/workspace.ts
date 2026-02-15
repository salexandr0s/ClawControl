/**
 * Workspace File Utilities
 *
 * Handles file generation and management for agent workspace files.
 * Includes path safety checks and template generation.
 */

import type { StationId } from '@clawcontrol/core'
import { encodeWorkspaceId, writeWorkspaceFileById, ensureWorkspaceRootExists } from './fs/workspace-fs'
import { slugifyDisplayName } from './agent-identity'

// ============================================================================
// AGENT NAME GENERATION
// ============================================================================

/**
 * Standard role suffixes for auto-generated names.
 */
export const AGENT_ROLE_MAP: Record<string, { prefix: string; station: StationId; description: string }> = {
  ceo: { prefix: 'CEO', station: 'strategic', description: 'Strategic interface & executive direction' },
  manager: { prefix: 'MANAGER', station: 'orchestration', description: 'Workflow orchestration & coordination' },
  spec: { prefix: 'SPEC', station: 'spec', description: 'Specification & requirements' },
  build: { prefix: 'BUILD', station: 'build', description: 'Implementation & coding' },
  qa: { prefix: 'QA', station: 'qa', description: 'Testing & quality assurance' },
  ops: { prefix: 'OPS', station: 'ops', description: 'Operations & deployment' },
  review: { prefix: 'REVIEW', station: 'qa', description: 'Code review & approval' },
  ship: { prefix: 'SHIP', station: 'ship', description: 'Deployment & release' },
  compound: { prefix: 'COMPOUND', station: 'compound', description: 'Learning & documentation' },
  update: { prefix: 'UPDATE', station: 'update', description: 'Dependency & maintenance' },
  custom: { prefix: 'CUSTOM', station: 'build', description: 'Custom specialized worker' },
}

/**
 * Generate an agent name from role
 * Example: role="build" -> "agent-build"
 */
export function generateAgentName(role: string): string {
  const mapped = AGENT_ROLE_MAP[role.toLowerCase()]
  const base = mapped?.prefix ?? role
  const normalized = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const suffix = normalized || 'worker'

  return `agent-${suffix}`
}

/**
 * Generate a local session key for workspace-created agents.
 * This key is internal to clawcontrol and not tied to OpenClaw's `agent:<id>:<id>` convention.
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
  displayName: string
  slug: string
  role: string
  purpose: string
  capabilities: string[]
  station: StationId
}

/**
 * Generate the SOUL.md content for an agent
 */
export function generateSoulContent(input: AgentTemplateInput): string {
  const capabilitiesList = input.capabilities.map(c => `- ${c}`).join('\n')

  return `# ${input.displayName} Soul

## Identity
You are ${input.displayName}, a clawcontrol agent with the role of **${input.role}**.

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
  return `# ${input.displayName} Overlay

## Agent: ${input.displayName}
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
 * Generate a HEARTBEAT.md template for an agent.
 */
export function generateHeartbeatContent(input: AgentTemplateInput): string {
  return `# HEARTBEAT.md — ${input.displayName}

## Checks
- Blockers for current operations.
- Failing tests or broken builds.
- Missing approvals required to proceed.

## Report vs Silence
- Report only if something is blocked or failing.
- Otherwise reply \`HEARTBEAT_OK\`.
`
}

/**
 * Generate a MEMORY.md template for an agent.
 */
export function generateMemoryContent(input: AgentTemplateInput): string {
  return `# MEMORY.md — ${input.displayName}

## What I Should Remember
- Project-specific norms and pitfalls.
- Workflow governance rules (workflow-only; PlanReview gates; security veto finality).
- Role-specific output discipline.
`
}

/**
 * Generate the section to add to AGENTS.md for a new agent
 */
export function generateAgentsMdSection(input: AgentTemplateInput): string {
  return `
### ${input.displayName}
- **Slug:** ${input.slug}
- **Role:** ${input.role}
- **Station:** ${input.station}
- **Purpose:** ${input.purpose}
- **Capabilities:** ${input.capabilities.join(', ')}
`
}

// ============================================================================
// AGENT FILE CREATION
// ============================================================================

export interface CreateAgentFilesInput {
  name?: string // legacy alias for displayName
  displayName?: string
  slug?: string
  role: string
  purpose: string
  capabilities: string[]
  station: StationId
}

export interface CreateAgentFilesResult {
  success: boolean
  files: {
    soul?: string
    heartbeat?: string
    memory?: string
    overlay?: string
  }
  error?: string
}

/**
 * Create all workspace files for a new agent
 */
export async function createAgentFiles(input: CreateAgentFilesInput): Promise<CreateAgentFilesResult> {
  const displayName = (input.displayName ?? input.name ?? '').trim() || 'Unnamed Agent'
  const slug = slugifyDisplayName(input.slug ?? displayName)

  const templateInput: AgentTemplateInput = {
    displayName,
    slug,
    role: input.role,
    purpose: input.purpose,
    capabilities: input.capabilities,
    station: input.station,
  }

  await ensureWorkspaceRootExists()

  const soulContent = generateSoulContent(templateInput)
  const soulId = encodeWorkspaceId(`/agents/${slug}/SOUL.md`)

  try {
    await writeWorkspaceFileById(soulId, soulContent)
  } catch (err) {
    return {
      success: false,
      files: {},
      error: `Failed to write soul file: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const heartbeatContent = generateHeartbeatContent(templateInput)
  const heartbeatId = encodeWorkspaceId(`/agents/${slug}/HEARTBEAT.md`)

  try {
    await writeWorkspaceFileById(heartbeatId, heartbeatContent)
  } catch (err) {
    return {
      success: false,
      files: { soul: soulId },
      error: `Failed to write heartbeat file: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const memoryContent = generateMemoryContent(templateInput)
  const memoryId = encodeWorkspaceId(`/agents/${slug}/MEMORY.md`)

  try {
    await writeWorkspaceFileById(memoryId, memoryContent)
  } catch (err) {
    return {
      success: false,
      files: { soul: soulId, heartbeat: heartbeatId },
      error: `Failed to write memory file: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const overlayContent = generateOverlayContent(templateInput)
  const overlayId = encodeWorkspaceId(`/agents/${slug}.md`)

  try {
    await writeWorkspaceFileById(overlayId, overlayContent)
  } catch (err) {
    return {
      success: false,
      files: { soul: soulId, heartbeat: heartbeatId, memory: memoryId },
      error: `Failed to write overlay file: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  return {
    success: true,
    files: {
      soul: soulId,
      heartbeat: heartbeatId,
      memory: memoryId,
      overlay: overlayId,
    },
  }
}
