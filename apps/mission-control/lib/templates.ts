/**
 * Agent Templates Scanner & Validator
 *
 * Scans workspace/agent-templates/ for template directories,
 * validates template.json files, and provides template metadata.
 */

import Ajv from 'ajv'
import {
  AGENT_TEMPLATE_SCHEMA,
  TEMPLATE_ID_PATTERN,
  type AgentTemplate,
  type AgentTemplateConfig,
  type TemplateValidationResult,
} from '@savorg/core'
import { mockWorkspaceFiles, mockFileContents } from '@savorg/core'

// ============================================================================
// VALIDATOR
// ============================================================================

const ajv = new Ajv({ allErrors: true, strict: false })
const validateTemplateSchema = ajv.compile(AGENT_TEMPLATE_SCHEMA)

/**
 * Validate a template.json config against the schema
 */
export function validateTemplateConfig(config: unknown): TemplateValidationResult {
  const errors: TemplateValidationResult['errors'] = []
  const warnings: TemplateValidationResult['warnings'] = []

  // Schema validation
  const valid = validateTemplateSchema(config)

  if (!valid && validateTemplateSchema.errors) {
    for (const err of validateTemplateSchema.errors) {
      errors.push({
        path: err.instancePath || '(root)',
        message: err.message || 'Unknown validation error',
        code: 'SCHEMA_ERROR',
      })
    }
  }

  // Additional semantic validations
  if (valid && typeof config === 'object' && config !== null) {
    const cfg = config as AgentTemplateConfig

    // Check ID pattern
    const idRegex = new RegExp(TEMPLATE_ID_PATTERN)
    if (!idRegex.test(cfg.id)) {
      errors.push({
        path: '/id',
        message: `ID must match pattern ${TEMPLATE_ID_PATTERN}`,
        code: 'INVALID_ID_PATTERN',
      })
    }

    // Check paramsSchema if present
    if (cfg.paramsSchema && cfg.paramsSchema.required) {
      const props = cfg.paramsSchema.properties || {}
      for (const reqField of cfg.paramsSchema.required) {
        if (!(reqField in props)) {
          warnings.push({
            path: `/paramsSchema/required`,
            message: `Required field "${reqField}" not defined in properties`,
            code: 'MISSING_REQUIRED_PROP',
          })
        }
      }
    }

    // Check render targets
    if (cfg.render?.targets) {
      for (let i = 0; i < cfg.render.targets.length; i++) {
        const target = cfg.render.targets[i]
        if (!target.source || !target.destination) {
          errors.push({
            path: `/render/targets/${i}`,
            message: 'Render target must have source and destination',
            code: 'INVALID_RENDER_TARGET',
          })
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

// ============================================================================
// PATH SAFETY
// ============================================================================

const TEMPLATES_BASE_PATH = '/agent-templates'

/**
 * Validate a template path is safe
 */
export function isValidTemplatePath(path: string): boolean {
  // Must start with templates base
  if (!path.startsWith(TEMPLATES_BASE_PATH)) return false

  // No traversal
  if (path.includes('..')) return false

  // No backslashes
  if (path.includes('\\')) return false

  // No null bytes
  if (path.includes('\0')) return false

  return true
}

/**
 * Get the template directory path
 */
export function getTemplateDir(templateId: string): string {
  return `${TEMPLATES_BASE_PATH}/${templateId}`
}

// ============================================================================
// MOCK TEMPLATE DATA
// ============================================================================

// Initialize mock templates if they don't exist
function ensureMockTemplatesExist() {
  // Check if agent-templates folder exists
  const templatesFolder = mockWorkspaceFiles.find(
    (f) => f.path === '/' && f.name === 'agent-templates' && f.type === 'folder'
  )

  if (!templatesFolder) {
    // Create agent-templates folder
    mockWorkspaceFiles.push({
      id: 'ws_templates',
      name: 'agent-templates',
      type: 'folder',
      path: '/',
      modifiedAt: new Date(),
    })
  }

  // Add a sample template
  const sampleTemplateFolder = mockWorkspaceFiles.find(
    (f) => f.path === '/agent-templates' && f.name === 'savorg-build' && f.type === 'folder'
  )

  if (!sampleTemplateFolder) {
    mockWorkspaceFiles.push({
      id: 'ws_tpl_build_folder',
      name: 'savorg-build',
      type: 'folder',
      path: '/agent-templates',
      modifiedAt: new Date(),
    })

    // Add template.json
    mockWorkspaceFiles.push({
      id: 'ws_tpl_build_json',
      name: 'template.json',
      type: 'file',
      path: '/agent-templates/savorg-build',
      size: 1024,
      modifiedAt: new Date(),
    })

    mockFileContents['ws_tpl_build_json'] = JSON.stringify({
      id: 'savorg-build',
      name: 'SAVORG Build Agent',
      description: 'A build agent for implementing features and fixes',
      version: '1.0.0',
      role: 'BUILD',
      namingPattern: 'savorgBUILD',
      sessionKeyPattern: 'agent:savorg-build:main',
      paramsSchema: {
        type: 'object',
        properties: {
          projectName: {
            type: 'string',
            description: 'Name of the project this agent works on',
          },
          repoPath: {
            type: 'string',
            description: 'Path to the repository',
          },
          primaryLanguage: {
            type: 'string',
            enum: ['TypeScript', 'Python', 'Ruby', 'Go', 'Rust'],
            description: 'Primary programming language',
          },
        },
        required: ['projectName'],
      },
      render: {
        engine: 'mustache',
        targets: [
          { source: 'SOUL.md', destination: 'workspace/agents/{{agentName}}.soul.md' },
          { source: 'overlay.md', destination: 'workspace/agents/{{agentName}}.md' },
        ],
      },
      defaults: {
        primaryLanguage: 'TypeScript',
      },
      recommendations: {
        skills: [
          { name: 'git-workflow', scope: 'global', required: true },
          { name: 'code-review', scope: 'global', required: false },
        ],
        plugins: [
          { name: 'github-integration', required: false },
        ],
      },
      provisioning: {
        enabled: true,
        steps: ['create_files', 'register_agent', 'test_message'],
      },
      author: 'SAVORG',
      tags: ['build', 'implementation', 'coding'],
    }, null, 2)

    // Add SOUL.md
    mockWorkspaceFiles.push({
      id: 'ws_tpl_build_soul',
      name: 'SOUL.md',
      type: 'file',
      path: '/agent-templates/savorg-build',
      size: 512,
      modifiedAt: new Date(),
    })

    mockFileContents['ws_tpl_build_soul'] = `# {{agentName}} Soul

## Identity
You are {{agentName}}, a SAVORG build agent working on {{projectName}}.

## Purpose
Implement features, fix bugs, and maintain code quality for {{projectName}}.

## Primary Language
{{primaryLanguage}}

## Core Behaviors

### Implementation Excellence
- Write clean, maintainable code
- Follow existing patterns in the codebase
- Add appropriate tests for new functionality

### Collaboration
- Respect station boundaries
- Hand off to QA after implementation
- Ask for clarification when requirements are unclear

## Constraints
- WIP Limit: 2 concurrent operations
- Must request approval for external API calls
- Cannot modify AGENTS.md without approval
`

    // Add overlay.md
    mockWorkspaceFiles.push({
      id: 'ws_tpl_build_overlay',
      name: 'overlay.md',
      type: 'file',
      path: '/agent-templates/savorg-build',
      size: 256,
      modifiedAt: new Date(),
    })

    mockFileContents['ws_tpl_build_overlay'] = `# {{agentName}} Overlay

## Agent: {{agentName}}
Role: Build
Project: {{projectName}}
Repository: {{repoPath}}

## Custom Instructions
<!-- Add project-specific instructions here -->

## Allowed Tools
- read_file
- write_file
- execute_command (with approval for dangerous commands)
- git operations

## Notes
Created from savorg-build template v1.0.0
`

    // Add README.md
    mockWorkspaceFiles.push({
      id: 'ws_tpl_build_readme',
      name: 'README.md',
      type: 'file',
      path: '/agent-templates/savorg-build',
      size: 400,
      modifiedAt: new Date(),
    })

    mockFileContents['ws_tpl_build_readme'] = `# SAVORG Build Agent Template

This template creates a build agent optimized for implementing features and fixes.

## Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| projectName | Yes | Name of the project |
| repoPath | No | Path to the repository |
| primaryLanguage | No | Primary programming language (default: TypeScript) |

## Recommended Skills
- git-workflow (global, required)
- code-review (global, optional)

## Recommended Plugins
- github-integration (optional)

## Files Generated
- \`workspace/agents/<agentName>.soul.md\` - Agent soul
- \`workspace/agents/<agentName>.md\` - Agent overlay
`
  }

  // Add an invalid template for testing
  const invalidTemplateFolder = mockWorkspaceFiles.find(
    (f) => f.path === '/agent-templates' && f.name === 'broken-template' && f.type === 'folder'
  )

  if (!invalidTemplateFolder) {
    mockWorkspaceFiles.push({
      id: 'ws_tpl_broken_folder',
      name: 'broken-template',
      type: 'folder',
      path: '/agent-templates',
      modifiedAt: new Date(),
    })

    mockWorkspaceFiles.push({
      id: 'ws_tpl_broken_json',
      name: 'template.json',
      type: 'file',
      path: '/agent-templates/broken-template',
      size: 128,
      modifiedAt: new Date(),
    })

    // Invalid JSON - missing required fields
    mockFileContents['ws_tpl_broken_json'] = JSON.stringify({
      id: 'broken-template',
      name: 'Broken Template',
      // Missing: description, version, role
    }, null, 2)
  }
}

// ============================================================================
// SCANNER
// ============================================================================

// Cache for scanned templates
let templateCache: AgentTemplate[] | null = null
let _lastScanTime: Date | null = null

/**
 * Scan workspace/agent-templates/ for all templates
 */
export function scanTemplates(): AgentTemplate[] {
  ensureMockTemplatesExist()

  const templates: AgentTemplate[] = []

  // Find all folders under /agent-templates
  const templateFolders = mockWorkspaceFiles.filter(
    (f) => f.path === '/agent-templates' && f.type === 'folder'
  )

  for (const folder of templateFolders) {
    const templateId = folder.name
    const templatePath = `${TEMPLATES_BASE_PATH}/${templateId}`

    // Find template.json in this folder
    const templateJsonFile = mockWorkspaceFiles.find(
      (f) => f.path === templatePath && f.name === 'template.json' && f.type === 'file'
    )

    if (!templateJsonFile) {
      // No template.json - skip this folder
      continue
    }

    // Read and parse template.json
    const content = mockFileContents[templateJsonFile.id]
    let config: AgentTemplateConfig | undefined
    let validationResult: TemplateValidationResult

    try {
      const parsed = JSON.parse(content)
      validationResult = validateTemplateConfig(parsed)

      if (validationResult.valid) {
        config = parsed as AgentTemplateConfig
      }
    } catch (err) {
      validationResult = {
        valid: false,
        errors: [{
          path: '(root)',
          message: err instanceof Error ? err.message : 'Invalid JSON',
          code: 'PARSE_ERROR',
        }],
        warnings: [],
      }
    }

    // Check for optional files
    const hasReadme = mockWorkspaceFiles.some(
      (f) => f.path === templatePath && f.name === 'README.md'
    )
    const hasSoul = mockWorkspaceFiles.some(
      (f) => f.path === templatePath && f.name === 'SOUL.md'
    )
    const hasOverlay = mockWorkspaceFiles.some(
      (f) => f.path === templatePath && f.name === 'overlay.md'
    )

    templates.push({
      id: templateId,
      name: config?.name || templateId,
      description: config?.description || 'No description',
      version: config?.version || 'unknown',
      role: config?.role || 'CUSTOM',
      path: templatePath,
      isValid: validationResult.valid,
      validationErrors: validationResult.errors.map((e) => `${e.path}: ${e.message}`),
      validationWarnings: validationResult.warnings.map((w) => `${w.path}: ${w.message}`),
      validatedAt: new Date(),
      config,
      hasReadme,
      hasSoul,
      hasOverlay,
      createdAt: folder.modifiedAt,
      updatedAt: templateJsonFile.modifiedAt,
    })
  }

  // Update cache
  templateCache = templates
  _lastScanTime = new Date()

  return templates
}

/**
 * Get all templates (uses cache if available)
 */
export function getTemplates(forceRescan = false): AgentTemplate[] {
  if (!templateCache || forceRescan) {
    return scanTemplates()
  }
  return templateCache
}

/**
 * Get a single template by ID
 */
export function getTemplateById(id: string): AgentTemplate | null {
  const templates = getTemplates()
  return templates.find((t) => t.id === id) || null
}

/**
 * Get template files
 */
export function getTemplateFiles(templateId: string): Array<{
  id: string
  name: string
  path: string
}> {
  const templatePath = getTemplateDir(templateId)

  return mockWorkspaceFiles
    .filter((f) => f.path === templatePath && f.type === 'file')
    .map((f) => ({
      id: f.id,
      name: f.name,
      path: `${templatePath}/${f.name}`,
    }))
}

/**
 * Get template file content
 */
export function getTemplateFileContent(fileId: string): string | null {
  return mockFileContents[fileId] ?? null
}

/**
 * Get README content for a template
 */
export function getTemplateReadme(templateId: string): string | null {
  const templatePath = getTemplateDir(templateId)
  const readmeFile = mockWorkspaceFiles.find(
    (f) => f.path === templatePath && f.name === 'README.md'
  )

  if (!readmeFile) return null
  return mockFileContents[readmeFile.id] ?? null
}

// ============================================================================
// TEMPLATE CREATION
// ============================================================================

/**
 * Create a new template scaffold
 */
export function createTemplateScaffold(templateId: string, name: string, role: string): {
  success: boolean
  error?: string
  templatePath?: string
} {
  // Validate ID
  const idRegex = new RegExp(TEMPLATE_ID_PATTERN)
  if (!idRegex.test(templateId)) {
    return { success: false, error: `Invalid template ID: must match ${TEMPLATE_ID_PATTERN}` }
  }

  // Check if template already exists
  const existing = mockWorkspaceFiles.find(
    (f) => f.path === '/agent-templates' && f.name === templateId && f.type === 'folder'
  )
  if (existing) {
    return { success: false, error: `Template "${templateId}" already exists` }
  }

  const templatePath = `${TEMPLATES_BASE_PATH}/${templateId}`
  const now = new Date()

  // Create folder
  mockWorkspaceFiles.push({
    id: `ws_tpl_${templateId}_folder`,
    name: templateId,
    type: 'folder',
    path: '/agent-templates',
    modifiedAt: now,
  })

  // Create template.json
  const templateJsonId = `ws_tpl_${templateId}_json`
  mockWorkspaceFiles.push({
    id: templateJsonId,
    name: 'template.json',
    type: 'file',
    path: templatePath,
    size: 0,
    modifiedAt: now,
  })

  const templateConfig: AgentTemplateConfig = {
    id: templateId,
    name,
    description: `Template for ${name} agents`,
    version: '1.0.0',
    role: role as AgentTemplateConfig['role'],
    namingPattern: `savorg${role}`,
    sessionKeyPattern: `agent:${templateId}:main`,
    paramsSchema: {
      type: 'object',
      properties: {
        projectName: {
          type: 'string',
          description: 'Name of the project',
        },
      },
      required: ['projectName'],
    },
    render: {
      engine: 'mustache',
      targets: [
        { source: 'SOUL.md', destination: 'workspace/agents/{{agentName}}.soul.md' },
        { source: 'overlay.md', destination: 'workspace/agents/{{agentName}}.md' },
      ],
    },
    defaults: {},
    provisioning: {
      enabled: true,
      steps: ['create_files', 'register_agent'],
    },
  }

  mockFileContents[templateJsonId] = JSON.stringify(templateConfig, null, 2)

  // Create SOUL.md
  const soulId = `ws_tpl_${templateId}_soul`
  mockWorkspaceFiles.push({
    id: soulId,
    name: 'SOUL.md',
    type: 'file',
    path: templatePath,
    size: 0,
    modifiedAt: now,
  })

  mockFileContents[soulId] = `# {{agentName}} Soul

## Identity
You are {{agentName}}, a SAVORG ${role.toLowerCase()} agent.

## Purpose
<!-- Describe the agent's purpose -->

## Core Behaviors
<!-- Define core behaviors -->

## Constraints
- WIP Limit: 2 concurrent operations
`

  // Create overlay.md
  const overlayId = `ws_tpl_${templateId}_overlay`
  mockWorkspaceFiles.push({
    id: overlayId,
    name: 'overlay.md',
    type: 'file',
    path: templatePath,
    size: 0,
    modifiedAt: now,
  })

  mockFileContents[overlayId] = `# {{agentName}} Overlay

## Agent: {{agentName}}
Role: ${role}

## Custom Instructions
<!-- Add custom instructions -->

## Notes
Created from ${templateId} template
`

  // Invalidate cache
  templateCache = null

  return { success: true, templatePath }
}

// ============================================================================
// RENDERING
// ============================================================================

/**
 * Simple mustache-like template rendering
 */
export function renderTemplate(template: string, params: Record<string, unknown>): string {
  let result = template

  // Replace {{variable}} patterns
  for (const [key, value] of Object.entries(params)) {
    const pattern = new RegExp(`\\{\\{${key}\\}\\}`, 'g')
    result = result.replace(pattern, String(value ?? ''))
  }

  return result
}

/**
 * Preview what files would be generated from a template
 */
export function previewTemplateRender(
  templateId: string,
  params: Record<string, unknown>
): Array<{
  source: string
  destination: string
  content: string
}> {
  const template = getTemplateById(templateId)
  if (!template || !template.config) {
    return []
  }

  const results: Array<{ source: string; destination: string; content: string }> = []
  const config = template.config
  const templatePath = getTemplateDir(templateId)

  // Get render targets (or defaults)
  const targets = config.render?.targets || [
    { source: 'SOUL.md', destination: 'workspace/agents/{{agentName}}.soul.md' },
    { source: 'overlay.md', destination: 'workspace/agents/{{agentName}}.md' },
  ]

  for (const target of targets) {
    // Find source file
    const sourceFile = mockWorkspaceFiles.find(
      (f) => f.path === templatePath && f.name === target.source
    )

    if (!sourceFile) continue

    const sourceContent = mockFileContents[sourceFile.id]
    if (!sourceContent) continue

    // Render content
    const renderedContent = renderTemplate(sourceContent, params)

    // Render destination path
    const renderedDestination = renderTemplate(target.destination, params)

    results.push({
      source: target.source,
      destination: renderedDestination,
      content: renderedContent,
    })
  }

  return results
}
