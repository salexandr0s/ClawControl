/**
 * Agent Template JSON Schema
 *
 * Defines the structure for template.json files in workspace/agent-templates/
 */

export const TEMPLATE_ID_PATTERN = '^[a-z0-9][a-z0-9-_]{1,48}$'

export const AGENT_TEMPLATE_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: ['id', 'name', 'description', 'version', 'role'],
  properties: {
    id: {
      type: 'string',
      pattern: TEMPLATE_ID_PATTERN,
      description: 'Unique template identifier (must match folder name)',
    },
    name: {
      type: 'string',
      minLength: 1,
      maxLength: 100,
      description: 'Human-readable template name',
    },
    description: {
      type: 'string',
      minLength: 1,
      maxLength: 500,
      description: 'Template description',
    },
    version: {
      type: 'string',
      minLength: 1,
      maxLength: 20,
      description: 'Template version (semver-ish)',
    },
    role: {
      type: 'string',
      enum: ['CEO', 'BUILD', 'OPS', 'REVIEW', 'SPEC', 'QA', 'SHIP', 'COMPOUND', 'UPDATE', 'CUSTOM'],
      description: 'Agent role type',
    },
    namingPattern: {
      type: 'string',
      default: 'savorg{{ROLE}}',
      description: 'Pattern for generating agent name (supports {{ROLE}}, {{CUSTOM_NAME}})',
    },
    sessionKeyPattern: {
      type: 'string',
      default: 'agent:{{templateId}}:main',
      description: 'Pattern for generating session key',
    },
    paramsSchema: {
      type: 'object',
      description: 'JSON Schema for user-fillable parameters',
      properties: {
        type: { const: 'object' },
        properties: { type: 'object' },
        required: {
          type: 'array',
          items: { type: 'string' },
        },
      },
    },
    render: {
      type: 'object',
      properties: {
        engine: {
          type: 'string',
          enum: ['mustache'],
          default: 'mustache',
        },
        targets: {
          type: 'array',
          items: {
            type: 'object',
            required: ['source', 'destination'],
            properties: {
              source: {
                type: 'string',
                description: 'Source file path relative to template directory',
              },
              destination: {
                type: 'string',
                description: 'Destination path (supports {{variables}})',
              },
            },
          },
        },
      },
    },
    defaults: {
      type: 'object',
      description: 'Default parameter values',
      additionalProperties: true,
    },
    recommendations: {
      type: 'object',
      properties: {
        skills: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string' },
              scope: {
                type: 'string',
                enum: ['global', 'agent'],
              },
              required: { type: 'boolean' },
            },
          },
        },
        plugins: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string' },
              required: { type: 'boolean' },
            },
          },
        },
      },
    },
    provisioning: {
      type: 'object',
      properties: {
        enabled: {
          type: 'boolean',
          default: true,
        },
        steps: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['create_files', 'register_agent', 'schedule_heartbeat', 'test_message'],
          },
        },
      },
    },
    author: {
      type: 'string',
      description: 'Template author',
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description: 'Tags for categorization',
    },
  },
  additionalProperties: false,
} as const

/**
 * TypeScript type for a validated template.json
 */
export interface AgentTemplateConfig {
  id: string
  name: string
  description: string
  version: string
  role: 'CEO' | 'BUILD' | 'OPS' | 'REVIEW' | 'SPEC' | 'QA' | 'SHIP' | 'COMPOUND' | 'UPDATE' | 'CUSTOM'
  namingPattern?: string
  sessionKeyPattern?: string
  paramsSchema?: {
    type: 'object'
    properties?: Record<string, {
      type: string
      description?: string
      default?: unknown
      enum?: unknown[]
      minLength?: number
      maxLength?: number
    }>
    required?: string[]
  }
  render?: {
    engine: 'mustache'
    targets?: Array<{
      source: string
      destination: string
    }>
  }
  defaults?: Record<string, unknown>
  recommendations?: {
    skills?: Array<{
      name: string
      scope?: 'global' | 'agent'
      required?: boolean
    }>
    plugins?: Array<{
      name: string
      required?: boolean
    }>
  }
  provisioning?: {
    enabled?: boolean
    steps?: Array<'create_files' | 'register_agent' | 'schedule_heartbeat' | 'test_message'>
  }
  author?: string
  tags?: string[]
}

/**
 * Template validation result
 */
export interface TemplateValidationResult {
  valid: boolean
  errors: Array<{
    path: string
    message: string
    code: string
  }>
  warnings: Array<{
    path: string
    message: string
    code: string
  }>
}

/**
 * Agent template with metadata
 */
export interface AgentTemplate {
  id: string
  name: string
  description: string
  version: string
  role: string
  path: string
  isValid: boolean
  validationErrors: string[]
  validationWarnings: string[]
  validatedAt: Date
  config?: AgentTemplateConfig
  hasReadme: boolean
  hasSoul: boolean
  hasOverlay: boolean
  createdAt: Date
  updatedAt: Date
}
