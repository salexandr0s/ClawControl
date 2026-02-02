/**
 * Mock data fixtures for Mission Control
 *
 * Single source of truth for all mock data used during development.
 * These fixtures match the exact shape of the database models.
 */

import type {
  WorkOrder,
  Operation,
  Agent,
  Approval,
  Activity,
} from '../types'

// ============================================================================
// HELPER: Date generation for realistic timestamps
// ============================================================================

const now = new Date()
const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000)
const minsAgo = (m: number) => new Date(now.getTime() - m * 60 * 1000)
const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000)

// ============================================================================
// WORK ORDERS
// ============================================================================

export const mockWorkOrders: WorkOrder[] = [
  {
    id: 'wo_01',
    code: 'WO-001',
    title: 'Implement user authentication flow',
    goalMd: 'Add JWT-based authentication with refresh tokens and session management.',
    state: 'active',
    priority: 'P1',
    owner: 'user',
    routingTemplate: 'default_routing',
    blockedReason: null,
    createdAt: daysAgo(3),
    updatedAt: minsAgo(2),
    shippedAt: null,
  },
  {
    id: 'wo_02',
    code: 'WO-002',
    title: 'Add dark mode to settings panel',
    goalMd: 'Implement theme switching with system preference detection.',
    state: 'review',
    priority: 'P2',
    owner: 'savorgceo',
    routingTemplate: 'default_routing',
    blockedReason: null,
    createdAt: daysAgo(5),
    updatedAt: minsAgo(15),
    shippedAt: null,
  },
  {
    id: 'wo_03',
    code: 'WO-003',
    title: 'Fix pagination bug in data table',
    goalMd: 'Page numbers reset incorrectly when filtering. Root cause: state not syncing.',
    state: 'active',
    priority: 'P0',
    owner: 'user',
    routingTemplate: 'hotfix_routing',
    blockedReason: null,
    createdAt: daysAgo(1),
    updatedAt: minsAgo(1),
    shippedAt: null,
  },
  {
    id: 'wo_04',
    code: 'WO-004',
    title: 'Database migration for new schema',
    goalMd: 'Migrate users table to support multi-tenant architecture.',
    state: 'blocked',
    priority: 'P1',
    owner: 'savorgceo',
    routingTemplate: 'migration_routing',
    blockedReason: 'Waiting for DBA approval on schema changes',
    createdAt: daysAgo(7),
    updatedAt: hoursAgo(1),
    shippedAt: null,
  },
  {
    id: 'wo_05',
    code: 'WO-005',
    title: 'Optimize API response caching',
    goalMd: 'Implement Redis caching layer for frequently accessed endpoints.',
    state: 'planned',
    priority: 'P3',
    owner: 'user',
    routingTemplate: 'default_routing',
    blockedReason: null,
    createdAt: daysAgo(2),
    updatedAt: daysAgo(2),
    shippedAt: null,
  },
  {
    id: 'wo_06',
    code: 'WO-006',
    title: 'Add email notification system',
    goalMd: 'Set up transactional email service with templates for common events.',
    state: 'shipped',
    priority: 'P2',
    owner: 'savorgceo',
    routingTemplate: 'default_routing',
    blockedReason: null,
    createdAt: daysAgo(14),
    updatedAt: daysAgo(2),
    shippedAt: daysAgo(2),
  },
  {
    id: 'wo_07',
    code: 'WO-007',
    title: 'Refactor payment processing module',
    goalMd: 'Extract payment logic into a separate service with better error handling.',
    state: 'active',
    priority: 'P1',
    owner: 'user',
    routingTemplate: 'default_routing',
    blockedReason: null,
    createdAt: daysAgo(4),
    updatedAt: minsAgo(30),
    shippedAt: null,
  },
]

// ============================================================================
// OPERATIONS
// ============================================================================

export const mockOperations: Operation[] = [
  // WO-001 operations
  {
    id: 'op_01',
    workOrderId: 'wo_01',
    station: 'spec',
    title: 'Define auth requirements',
    notes: null,
    status: 'done',
    assigneeAgentIds: ['agent_01'],
    dependsOnOperationIds: [],
    wipClass: 'specification',
    blockedReason: null,
    createdAt: daysAgo(3),
    updatedAt: daysAgo(2),
  },
  {
    id: 'op_02',
    workOrderId: 'wo_01',
    station: 'build',
    title: 'Implement JWT middleware',
    notes: 'Using jose library for JWT handling',
    status: 'done',
    assigneeAgentIds: ['agent_02'],
    dependsOnOperationIds: ['op_01'],
    wipClass: 'implementation',
    blockedReason: null,
    createdAt: daysAgo(2),
    updatedAt: minsAgo(45),
  },
  {
    id: 'op_03',
    workOrderId: 'wo_01',
    station: 'build',
    title: 'Create login form UI',
    notes: null,
    status: 'in_progress',
    assigneeAgentIds: ['agent_03'],
    dependsOnOperationIds: ['op_01'],
    wipClass: 'implementation',
    blockedReason: null,
    createdAt: daysAgo(2),
    updatedAt: minsAgo(5),
  },
  {
    id: 'op_04',
    workOrderId: 'wo_01',
    station: 'qa',
    title: 'Write auth integration tests',
    notes: null,
    status: 'todo',
    assigneeAgentIds: [],
    dependsOnOperationIds: ['op_02', 'op_03'],
    wipClass: 'testing',
    blockedReason: null,
    createdAt: daysAgo(2),
    updatedAt: daysAgo(2),
  },
  {
    id: 'op_05',
    workOrderId: 'wo_01',
    station: 'ship',
    title: 'Deploy to staging',
    notes: null,
    status: 'todo',
    assigneeAgentIds: [],
    dependsOnOperationIds: ['op_04'],
    wipClass: 'deployment',
    blockedReason: null,
    createdAt: daysAgo(2),
    updatedAt: daysAgo(2),
  },
  // WO-002 operations
  {
    id: 'op_06',
    workOrderId: 'wo_02',
    station: 'build',
    title: 'Add theme context provider',
    notes: null,
    status: 'done',
    assigneeAgentIds: ['agent_02'],
    dependsOnOperationIds: [],
    wipClass: 'implementation',
    blockedReason: null,
    createdAt: daysAgo(4),
    updatedAt: daysAgo(1),
  },
  {
    id: 'op_07',
    workOrderId: 'wo_02',
    station: 'build',
    title: 'Update component styles',
    notes: null,
    status: 'done',
    assigneeAgentIds: ['agent_03'],
    dependsOnOperationIds: ['op_06'],
    wipClass: 'implementation',
    blockedReason: null,
    createdAt: daysAgo(3),
    updatedAt: minsAgo(20),
  },
  {
    id: 'op_08',
    workOrderId: 'wo_02',
    station: 'qa',
    title: 'Visual regression testing',
    notes: null,
    status: 'review',
    assigneeAgentIds: ['agent_01'],
    dependsOnOperationIds: ['op_07'],
    wipClass: 'testing',
    blockedReason: null,
    createdAt: daysAgo(1),
    updatedAt: minsAgo(15),
  },
  // WO-003 operations
  {
    id: 'op_09',
    workOrderId: 'wo_03',
    station: 'build',
    title: 'Fix pagination state sync',
    notes: 'Found bug in useEffect dependency array',
    status: 'in_progress',
    assigneeAgentIds: ['agent_02'],
    dependsOnOperationIds: [],
    wipClass: 'bugfix',
    blockedReason: null,
    createdAt: daysAgo(1),
    updatedAt: minsAgo(1),
  },
  {
    id: 'op_10',
    workOrderId: 'wo_03',
    station: 'qa',
    title: 'Verify pagination fix',
    notes: null,
    status: 'todo',
    assigneeAgentIds: [],
    dependsOnOperationIds: ['op_09'],
    wipClass: 'testing',
    blockedReason: null,
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
  },
  // WO-004 operations
  {
    id: 'op_11',
    workOrderId: 'wo_04',
    station: 'spec',
    title: 'Schema design review',
    notes: null,
    status: 'done',
    assigneeAgentIds: ['agent_01'],
    dependsOnOperationIds: [],
    wipClass: 'specification',
    blockedReason: null,
    createdAt: daysAgo(7),
    updatedAt: daysAgo(5),
  },
  {
    id: 'op_12',
    workOrderId: 'wo_04',
    station: 'build',
    title: 'Write migration scripts',
    notes: 'Waiting for DBA approval before proceeding',
    status: 'blocked',
    assigneeAgentIds: ['agent_02'],
    dependsOnOperationIds: ['op_11'],
    wipClass: 'implementation',
    blockedReason: 'Waiting for DBA approval',
    createdAt: daysAgo(5),
    updatedAt: hoursAgo(1),
  },
]

// ============================================================================
// AGENTS
// ============================================================================

export const mockAgents: Agent[] = [
  {
    id: 'agent_01',
    name: 'claw-alpha',
    role: 'Specification & QA Lead',
    station: 'spec',
    status: 'active',
    sessionKey: 'sess_alpha_001',
    capabilities: { spec: true, qa: true, review: true },
    wipLimit: 3,
    lastSeenAt: minsAgo(2),
    lastHeartbeatAt: minsAgo(0.5),
    createdAt: daysAgo(30),
    updatedAt: minsAgo(2),
  },
  {
    id: 'agent_02',
    name: 'claw-beta',
    role: 'Build Specialist',
    station: 'build',
    status: 'active',
    sessionKey: 'sess_beta_001',
    capabilities: { build: true, deploy: true },
    wipLimit: 2,
    lastSeenAt: minsAgo(1),
    lastHeartbeatAt: minsAgo(0.3),
    createdAt: daysAgo(30),
    updatedAt: minsAgo(1),
  },
  {
    id: 'agent_03',
    name: 'claw-gamma',
    role: 'Frontend Specialist',
    station: 'build',
    status: 'active',
    sessionKey: 'sess_gamma_001',
    capabilities: { build: true, ui: true },
    wipLimit: 2,
    lastSeenAt: minsAgo(5),
    lastHeartbeatAt: minsAgo(1),
    createdAt: daysAgo(14),
    updatedAt: minsAgo(5),
  },
  {
    id: 'agent_04',
    name: 'claw-delta',
    role: 'Ops & Deploy',
    station: 'ops',
    status: 'idle',
    sessionKey: 'sess_delta_001',
    capabilities: { ops: true, deploy: true, monitoring: true },
    wipLimit: 2,
    lastSeenAt: hoursAgo(2),
    lastHeartbeatAt: hoursAgo(2),
    createdAt: daysAgo(7),
    updatedAt: hoursAgo(2),
  },
]

// ============================================================================
// APPROVALS
// ============================================================================

export const mockApprovals: Approval[] = [
  {
    id: 'apr_01',
    workOrderId: 'wo_01',
    operationId: 'op_02',
    type: 'ship_gate',
    questionMd: 'JWT middleware implementation complete. Ready to proceed with integration tests?',
    status: 'pending',
    resolvedBy: null,
    createdAt: minsAgo(5),
    resolvedAt: null,
  },
  {
    id: 'apr_02',
    workOrderId: 'wo_04',
    operationId: 'op_12',
    type: 'risky_action',
    questionMd: 'Migration script will modify 50,000+ rows. Run in maintenance window?',
    status: 'pending',
    resolvedBy: null,
    createdAt: hoursAgo(1),
    resolvedAt: null,
  },
  {
    id: 'apr_03',
    workOrderId: 'wo_02',
    operationId: 'op_08',
    type: 'ship_gate',
    questionMd: 'Dark mode visual regression tests passed. Approve for staging deployment?',
    status: 'pending',
    resolvedBy: null,
    createdAt: minsAgo(15),
    resolvedAt: null,
  },
]

// ============================================================================
// ACTIVITIES
// ============================================================================

export const mockActivities: Activity[] = [
  {
    id: 'act_01',
    ts: minsAgo(2),
    type: 'operation.status_changed',
    actor: 'agent:claw-alpha',
    entityType: 'operation',
    entityId: 'op_02',
    summary: 'Completed: Implement JWT middleware',
    payloadJson: { from: 'in_progress', to: 'done' },
  },
  {
    id: 'act_02',
    ts: minsAgo(5),
    type: 'agent.joined',
    actor: 'system',
    entityType: 'agent',
    entityId: 'agent_03',
    summary: 'claw-gamma joined station build',
    payloadJson: { station: 'build' },
  },
  {
    id: 'act_03',
    ts: minsAgo(15),
    type: 'work_order.state_changed',
    actor: 'agent:claw-beta',
    entityType: 'work_order',
    entityId: 'wo_02',
    summary: 'WO-002 moved to Review',
    payloadJson: { from: 'active', to: 'review' },
  },
  {
    id: 'act_04',
    ts: minsAgo(30),
    type: 'gateway.health_check',
    actor: 'system',
    entityType: 'gateway',
    entityId: 'gateway_main',
    summary: 'Gateway health check passed',
    payloadJson: { latencyMs: 12, status: 'ok' },
  },
  {
    id: 'act_05',
    ts: minsAgo(45),
    type: 'operation.started',
    actor: 'agent:claw-alpha',
    entityType: 'operation',
    entityId: 'op_03',
    summary: 'Started: Create login form UI',
    payloadJson: {},
  },
  {
    id: 'act_06',
    ts: hoursAgo(1),
    type: 'approval.created',
    actor: 'agent:claw-beta',
    entityType: 'approval',
    entityId: 'apr_02',
    summary: 'Approval requested: Run migration in maintenance window?',
    payloadJson: { type: 'risky_action' },
  },
  {
    id: 'act_07',
    ts: hoursAgo(2),
    type: 'work_order.blocked',
    actor: 'agent:claw-beta',
    entityType: 'work_order',
    entityId: 'wo_04',
    summary: 'WO-004 blocked: Waiting for DBA approval',
    payloadJson: { reason: 'Waiting for DBA approval on schema changes' },
  },
  {
    id: 'act_08',
    ts: hoursAgo(3),
    type: 'cron.executed',
    actor: 'system',
    entityType: 'cron',
    entityId: 'cron_daily_backup',
    summary: 'Daily backup completed successfully',
    payloadJson: { durationMs: 4523, exitCode: 0 },
  },
]

// ============================================================================
// SKILLS (with global vs agent scope)
// ============================================================================

import type { Skill, SkillScope, SkillValidationResult } from '../types'

export type { Skill, SkillScope }

// Helper to create validation results
const validResult = (daysOld: number = 1): SkillValidationResult => ({
  status: 'valid',
  errors: [],
  warnings: [],
  summary: 'Skill is valid and ready to use',
  validatedAt: daysAgo(daysOld),
})

const warningResult = (daysOld: number = 1): SkillValidationResult => ({
  status: 'warnings',
  errors: [],
  warnings: [
    { code: 'ENTRYPOINT_MISSING', message: 'Skill claims to have an entrypoint but no entrypoint file was found', path: 'index.ts' },
  ],
  summary: 'Skill is valid with 1 warning',
  validatedAt: daysAgo(daysOld),
})

const invalidResult = (daysOld: number = 1): SkillValidationResult => ({
  status: 'invalid',
  errors: [
    { code: 'CONFIG_INVALID_JSON', message: 'config.json is not valid JSON: Unexpected token', path: 'config.json' },
  ],
  warnings: [],
  summary: 'Skill has 1 error',
  validatedAt: daysAgo(daysOld),
})

// Global skills - available to all agents
export const mockGlobalSkills: Skill[] = [
  {
    id: 'skill_g_01',
    name: 'git-workflow',
    description: 'Git operations: commit, push, branch management',
    version: '1.2.0',
    scope: 'global',
    enabled: true,
    usageCount: 245,
    lastUsedAt: minsAgo(5),
    installedAt: daysAgo(30),
    modifiedAt: daysAgo(7),
    hasConfig: true,
    hasEntrypoint: true,
    validation: validResult(7),
  },
  {
    id: 'skill_g_02',
    name: 'code-review',
    description: 'Automated code review with style checks',
    version: '2.0.1',
    scope: 'global',
    enabled: true,
    usageCount: 89,
    lastUsedAt: minsAgo(15),
    installedAt: daysAgo(14),
    modifiedAt: daysAgo(5),
    hasConfig: true,
    hasEntrypoint: true,
    validation: validResult(5),
  },
  {
    id: 'skill_g_03',
    name: 'test-runner',
    description: 'Run and analyze test suites',
    version: '1.5.0',
    scope: 'global',
    enabled: true,
    usageCount: 156,
    lastUsedAt: hoursAgo(1),
    installedAt: daysAgo(21),
    modifiedAt: daysAgo(10),
    hasConfig: false,
    hasEntrypoint: true,
    validation: warningResult(10),
  },
  {
    id: 'skill_g_04',
    name: 'deploy-staging',
    description: 'Deploy to staging environment',
    version: '1.0.0',
    scope: 'global',
    enabled: false,
    usageCount: 12,
    lastUsedAt: daysAgo(3),
    installedAt: daysAgo(7),
    modifiedAt: daysAgo(7),
    hasConfig: true,
    hasEntrypoint: true,
    validation: invalidResult(7),
  },
]

// Agent-scoped skills - only available to specific agents
export const mockAgentSkills: Skill[] = [
  {
    id: 'skill_a_01',
    name: 'spec-template',
    description: 'Generate specification documents from requirements',
    version: '1.0.0',
    scope: 'agent',
    agentId: 'agent_01', // claw-alpha
    enabled: true,
    usageCount: 34,
    lastUsedAt: hoursAgo(2),
    installedAt: daysAgo(14),
    modifiedAt: daysAgo(3),
    hasConfig: true,
    hasEntrypoint: true,
    validation: validResult(3),
  },
  {
    id: 'skill_a_02',
    name: 'api-scaffolder',
    description: 'Scaffold REST API endpoints from OpenAPI specs',
    version: '1.1.0',
    scope: 'agent',
    agentId: 'agent_02', // claw-beta
    enabled: true,
    usageCount: 67,
    lastUsedAt: minsAgo(30),
    installedAt: daysAgo(10),
    modifiedAt: daysAgo(2),
    hasConfig: true,
    hasEntrypoint: true,
    validation: validResult(2),
  },
  {
    id: 'skill_a_03',
    name: 'ui-component-gen',
    description: 'Generate React components from designs',
    version: '0.9.0',
    scope: 'agent',
    agentId: 'agent_03', // claw-gamma
    enabled: true,
    usageCount: 45,
    lastUsedAt: hoursAgo(1),
    installedAt: daysAgo(7),
    modifiedAt: daysAgo(1),
    hasConfig: false,
    hasEntrypoint: true,
    validation: validResult(1),
  },
  {
    id: 'skill_a_04',
    name: 'deploy-monitor',
    description: 'Monitor deployments and rollback on failure',
    version: '1.0.0',
    scope: 'agent',
    agentId: 'agent_04', // claw-delta
    enabled: false,
    usageCount: 8,
    lastUsedAt: daysAgo(5),
    installedAt: daysAgo(7),
    modifiedAt: daysAgo(5),
    hasConfig: true,
    hasEntrypoint: true,
    validation: warningResult(5),
  },
]

// Combined accessor for all skills
export const mockSkills: Skill[] = [...mockGlobalSkills, ...mockAgentSkills]

// Skill file contents (for editing)
export const mockSkillContents: Record<string, { skillMd: string; config?: string }> = {
  skill_g_01: {
    skillMd: `# Git Workflow Skill

## Overview
Handles Git operations for agents including commits, branches, and PRs.

## Available Commands

### git.commit
Create a new commit with changes.

\`\`\`yaml
inputs:
  message: string (required)
  files: string[] (optional, defaults to all staged)

outputs:
  sha: string
  branch: string
\`\`\`

### git.branch
Create or switch branches.

### git.push
Push changes to remote.
`,
    config: `{
  "defaultBranch": "main",
  "autoStage": true,
  "commitPrefix": "[agent]",
  "pushOnCommit": false
}`,
  },
  skill_g_02: {
    skillMd: `# Code Review Skill

## Overview
Automated code review with style and quality checks.

## Features
- Linting enforcement
- Type checking
- Security scanning
- Performance analysis
`,
    config: `{
  "linters": ["eslint", "prettier"],
  "strictMode": true,
  "ignorePatterns": ["*.test.ts", "*.spec.ts"]
}`,
  },
}

// ============================================================================
// PLUGINS
// ============================================================================

import type {
  Plugin,
  PluginDoctorResult,
  PluginConfigSchema,
} from '../types'

// Re-export Plugin type
export type { Plugin }

// Doctor result helpers
const healthyDoctor = (daysAgo: number = 1): PluginDoctorResult => ({
  status: 'healthy',
  checks: [
    { name: 'Connection', status: 'pass', message: 'API connection successful' },
    { name: 'Authentication', status: 'pass', message: 'Credentials valid' },
    { name: 'Permissions', status: 'pass', message: 'All required permissions granted' },
  ],
  summary: 'All checks passed',
  checkedAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
})

const warningDoctor = (daysAgo: number = 1): PluginDoctorResult => ({
  status: 'warning',
  checks: [
    { name: 'Connection', status: 'pass', message: 'API connection successful' },
    { name: 'Authentication', status: 'pass', message: 'Credentials valid' },
    { name: 'Rate Limit', status: 'warn', message: 'Approaching rate limit (80% used)', details: '4000/5000 requests used this hour' },
  ],
  summary: '1 warning detected',
  checkedAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
})

const unhealthyDoctor = (daysAgo: number = 1): PluginDoctorResult => ({
  status: 'unhealthy',
  checks: [
    { name: 'Connection', status: 'pass', message: 'API connection successful' },
    { name: 'Authentication', status: 'fail', message: 'Invalid or expired token', details: 'Token expired on 2024-01-15' },
    { name: 'Permissions', status: 'fail', message: 'Missing required permissions', details: 'Missing: channels:read, chat:write' },
  ],
  summary: '2 checks failed',
  checkedAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
})

// Config schemas
const githubConfigSchema: PluginConfigSchema = {
  type: 'object',
  properties: {
    token: { type: 'string', description: 'GitHub Personal Access Token', required: true },
    org: { type: 'string', description: 'Default organization', required: false },
    autoAssign: { type: 'boolean', description: 'Auto-assign issues to agents', default: true },
  },
  required: ['token'],
}

const slackConfigSchema: PluginConfigSchema = {
  type: 'object',
  properties: {
    webhookUrl: { type: 'string', description: 'Slack Webhook URL', required: true },
    channel: { type: 'string', description: 'Default channel', required: true },
    username: { type: 'string', description: 'Bot username', default: 'SAVORG' },
    iconEmoji: { type: 'string', description: 'Bot icon emoji', default: ':robot_face:' },
  },
  required: ['webhookUrl', 'channel'],
}

// Plugin configs stored separately (mutable)
export const mockPluginConfigs: Record<string, Record<string, unknown>> = {
  plugin_01: {},
  plugin_02: {
    token: 'ghp_****************************',
    org: 'savorg',
    autoAssign: true,
  },
  plugin_03: {
    webhookUrl: 'https://hooks.slack.com/services/T00/B00/XXXX',
    channel: '#alerts',
    username: 'SAVORG Bot',
    iconEmoji: ':robot_face:',
  },
}

export const mockPlugins: Plugin[] = [
  {
    id: 'plugin_01',
    name: 'context7',
    description: 'Documentation lookup and code context from Context7',
    version: '1.2.0',
    author: 'compound-engineering',
    enabled: true,
    status: 'active',
    sourceType: 'npm',
    npmSpec: '@context7/mcp-server@^1.2.0',
    hasConfig: false,
    doctorResult: healthyDoctor(1),
    restartRequired: false,
    installedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    updatedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
  },
  {
    id: 'plugin_02',
    name: 'github-integration',
    description: 'GitHub API integration for PRs, issues, and actions',
    version: '2.1.0',
    author: 'savorg',
    enabled: true,
    status: 'active',
    sourceType: 'npm',
    npmSpec: '@savorg/github-mcp@^2.1.0',
    hasConfig: true,
    configSchema: githubConfigSchema,
    configJson: mockPluginConfigs.plugin_02,
    doctorResult: warningDoctor(2),
    restartRequired: false,
    installedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    updatedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
  },
  {
    id: 'plugin_03',
    name: 'slack-notifications',
    description: 'Send notifications to Slack channels',
    version: '1.0.2',
    author: 'community',
    enabled: false,
    status: 'inactive',
    sourceType: 'npm',
    npmSpec: 'slack-mcp@^1.0.2',
    hasConfig: true,
    configSchema: slackConfigSchema,
    configJson: mockPluginConfigs.plugin_03,
    doctorResult: unhealthyDoctor(7),
    restartRequired: false,
    installedAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
    updatedAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
  },
  {
    id: 'plugin_04',
    name: 'local-fs',
    description: 'Local filesystem access for agents',
    version: '0.5.0',
    author: 'savorg',
    enabled: true,
    status: 'active',
    sourceType: 'local',
    sourcePath: '/usr/local/lib/savorg/plugins/local-fs',
    hasConfig: false,
    doctorResult: healthyDoctor(0),
    restartRequired: false,
    installedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
    updatedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
  },
  {
    id: 'plugin_05',
    name: 'database-tools',
    description: 'PostgreSQL database introspection and query tools',
    version: '1.1.0',
    author: 'compound-engineering',
    enabled: true,
    status: 'error',
    sourceType: 'git',
    sourcePath: 'https://github.com/compound-eng/db-mcp.git#v1.1.0',
    hasConfig: true,
    configJson: { connectionString: 'postgres://localhost:5432/savorg' },
    doctorResult: undefined, // Never checked
    restartRequired: true,
    lastError: 'Connection refused: database not running',
    installedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
    updatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
  },
]

// ============================================================================
// CRON JOBS
// ============================================================================

export interface CronJob {
  id: string
  name: string
  schedule: string
  description: string
  enabled: boolean
  lastRunAt: Date | null
  nextRunAt: Date | null
  lastStatus: 'success' | 'failed' | 'running' | null
  runCount: number
}

export const mockCronJobs: CronJob[] = [
  {
    id: 'cron_01',
    name: 'daily-backup',
    schedule: '0 2 * * *',
    description: 'Daily database backup to S3',
    enabled: true,
    lastRunAt: hoursAgo(3),
    nextRunAt: hoursAgo(-21), // 21 hours from now
    lastStatus: 'success',
    runCount: 45,
  },
  {
    id: 'cron_02',
    name: 'health-check',
    schedule: '*/5 * * * *',
    description: 'Gateway health monitoring',
    enabled: true,
    lastRunAt: minsAgo(2),
    nextRunAt: minsAgo(-3), // 3 minutes from now
    lastStatus: 'success',
    runCount: 1250,
  },
  {
    id: 'cron_03',
    name: 'cleanup-temp',
    schedule: '0 0 * * 0',
    description: 'Weekly cleanup of temporary files',
    enabled: true,
    lastRunAt: daysAgo(4),
    nextRunAt: daysAgo(-3), // 3 days from now
    lastStatus: 'success',
    runCount: 12,
  },
  {
    id: 'cron_04',
    name: 'sync-external',
    schedule: '0 */6 * * *',
    description: 'Sync with external APIs',
    enabled: false,
    lastRunAt: daysAgo(7),
    nextRunAt: null,
    lastStatus: 'failed',
    runCount: 8,
  },
]

// ============================================================================
// GATEWAY STATUS
// ============================================================================

export interface GatewayStatus {
  status: 'ok' | 'degraded' | 'down'
  lastCheckAt: Date
  latencyMs: number
  version: string
  uptime: number // seconds
  connections: {
    openClaw: 'connected' | 'disconnected' | 'error'
    database: 'connected' | 'disconnected' | 'error'
    redis: 'connected' | 'disconnected' | 'error'
  }
}

export const mockGatewayStatus: GatewayStatus = {
  status: 'ok',
  lastCheckAt: minsAgo(0.5),
  latencyMs: 12,
  version: '0.1.0',
  uptime: 86400 * 3 + 3600 * 5, // 3 days 5 hours
  connections: {
    openClaw: 'connected',
    database: 'connected',
    redis: 'disconnected',
  },
}

// ============================================================================
// WORKSPACE FILES (stub)
// ============================================================================

export interface WorkspaceFile {
  id: string
  name: string
  type: 'file' | 'folder'
  path: string
  size?: number
  modifiedAt: Date
}

export const mockWorkspaceFiles: WorkspaceFile[] = [
  { id: 'ws_01', name: 'AGENTS.md', type: 'file', path: '/', size: 2048, modifiedAt: daysAgo(1) },
  { id: 'ws_02', name: 'overlays', type: 'folder', path: '/', modifiedAt: daysAgo(2) },
  { id: 'ws_03', name: 'skills', type: 'folder', path: '/', modifiedAt: daysAgo(5) },
  { id: 'ws_04', name: 'playbooks', type: 'folder', path: '/', modifiedAt: daysAgo(3) },
  { id: 'ws_05', name: 'BUILD_PLAN.md', type: 'file', path: '/', size: 15360, modifiedAt: daysAgo(1) },
  { id: 'ws_06', name: 'routing.yaml', type: 'file', path: '/overlays', size: 512, modifiedAt: daysAgo(2) },
  { id: 'ws_07', name: 'git-workflow.md', type: 'file', path: '/skills', size: 1024, modifiedAt: daysAgo(5) },
]

// Mock file contents for workspace
export const mockFileContents: Record<string, string> = {
  ws_01: `# AGENTS.md - Global Agent Configuration

## Overview
This document defines the global behavior and constraints for all SAVORG agents.

## Core Principles
1. **Safety First** - Never take destructive actions without approval
2. **Transparency** - Log all significant decisions
3. **Collaboration** - Work with other agents effectively

## Agent Roles

### Specification Agent (claw-alpha)
- Reviews work order requirements
- Creates operation breakdowns
- Validates acceptance criteria

### Build Agent (claw-beta)
- Implements features and fixes
- Writes tests
- Manages code changes

### QA Agent (claw-gamma)
- Runs test suites
- Performs visual regression checks
- Validates acceptance criteria

## Constraints
- Maximum 3 operations per work order
- All code changes require review
- External API calls require approval
`,

  ws_05: `# BUILD_PLAN.md - Development Roadmap

## Phase 1: Foundation ✅
- Set up monorepo structure
- Configure TypeScript and ESLint
- Create shared UI components

## Phase 2: Core Features ✅
- Work order management
- Operation tracking
- Agent lifecycle

## Phase 3: Integration 🚧
- Gateway integration
- Real-time updates
- Activity logging

## Phase 4: Polish
- Error handling
- Performance optimization
- Documentation

## Phase 5: Launch
- Security audit
- Load testing
- Production deployment
`,

  ws_06: `# Default Routing Template
# Defines how work orders flow through stations

stations:
  - name: spec
    required: true
    agents:
      - claw-alpha
    max_concurrent: 2

  - name: build
    required: true
    agents:
      - claw-beta
      - claw-gamma
    max_concurrent: 3

  - name: qa
    required: true
    agents:
      - claw-alpha
    max_concurrent: 2

  - name: ship
    required: true
    agents:
      - claw-delta
    max_concurrent: 1
    requires_approval: true

transitions:
  - from: spec
    to: build
    auto: true

  - from: build
    to: qa
    auto: true

  - from: qa
    to: ship
    requires: all_tests_pass

  - from: ship
    to: done
    requires: approval
`,

  ws_07: `# Git Workflow Skill

## Overview
Handles Git operations for agents including commits, branches, and PRs.

## Available Commands

### git.commit
Create a new commit with changes.

\`\`\`yaml
inputs:
  message: string (required)
  files: string[] (optional, defaults to all staged)

outputs:
  sha: string
  branch: string
\`\`\`

### git.branch
Create or switch branches.

\`\`\`yaml
inputs:
  name: string (required)
  base: string (optional, defaults to main)

outputs:
  created: boolean
  previous: string
\`\`\`

### git.push
Push changes to remote.

\`\`\`yaml
inputs:
  branch: string (required)
  force: boolean (optional, default false)

outputs:
  success: boolean
  url: string
\`\`\`
`,
}

// ============================================================================
// PLAYBOOKS (with editable content)
// ============================================================================

export interface PlaybookData {
  id: string
  name: string
  description: string
  severity: 'info' | 'warn' | 'critical'
  content: string
  modifiedAt: Date
}

export const mockPlaybooks: PlaybookData[] = [
  {
    id: 'pb_01',
    name: 'daily-backup',
    description: 'Backup database and artifacts to remote storage',
    severity: 'info',
    modifiedAt: daysAgo(2),
    content: `# Daily Backup Playbook
name: daily-backup
description: Backup database and artifacts to remote storage
severity: info

steps:
  - name: create-snapshot
    command: pg_dump
    args:
      database: savorg_prod
      format: custom
      output: /backups/snapshot.dump
    timeout: 300000

  - name: upload-to-s3
    command: aws_s3_sync
    args:
      source: /backups/
      bucket: savorg-backups
      prefix: "{{date}}"
    timeout: 600000
    requires_approval: false

  - name: cleanup-old-backups
    command: cleanup
    args:
      path: /backups/
      keep_days: 7
    timeout: 60000

on_failure:
  notify:
    - channel: ops-alerts
      message: Daily backup failed

schedule:
  cron: "0 2 * * *"
  timezone: UTC
`,
  },
  {
    id: 'pb_02',
    name: 'emergency-stop',
    description: 'Halt all agents and pause active work orders',
    severity: 'critical',
    modifiedAt: daysAgo(5),
    content: `# Emergency Stop Playbook
name: emergency-stop
description: Halt all agents and pause active work orders
severity: critical
requires_approval: true

steps:
  - name: pause-agents
    command: agent_control
    args:
      action: pause_all
      reason: "Emergency stop initiated"
    timeout: 30000

  - name: block-work-orders
    command: work_order_control
    args:
      action: block_active
      reason: "Emergency stop - manual review required"
    timeout: 30000

  - name: notify-team
    command: notify
    args:
      channels:
        - ops-critical
        - engineering
      message: "EMERGENCY STOP executed. All agents paused."
    timeout: 10000

on_success:
  log_level: critical
  audit_trail: true

on_failure:
  escalate: true
  notify:
    - channel: on-call
      message: "CRITICAL: Emergency stop failed!"
`,
  },
  {
    id: 'pb_03',
    name: 'gc-cleanup',
    description: 'Garbage collection for orphaned resources',
    severity: 'warn',
    modifiedAt: daysAgo(3),
    content: `# GC Cleanup Playbook
name: gc-cleanup
description: Garbage collection for orphaned resources
severity: warn

steps:
  - name: identify-orphans
    command: resource_scan
    args:
      types:
        - stale_sessions
        - orphan_artifacts
        - expired_tokens
      older_than: 7d
    timeout: 120000
    output: orphan_list

  - name: dry-run-cleanup
    command: cleanup_preview
    args:
      resources: "{{orphan_list}}"
    timeout: 60000
    output: cleanup_plan

  - name: execute-cleanup
    command: cleanup
    args:
      plan: "{{cleanup_plan}}"
      dry_run: false
    timeout: 300000
    requires_approval: true

  - name: report
    command: report_generate
    args:
      type: cleanup_summary
      output: /reports/gc-{{date}}.json

on_success:
  notify:
    - channel: ops-info
      message: "GC cleanup completed"

schedule:
  cron: "0 0 * * 0"
  timezone: UTC
`,
  },
]

// ============================================================================
// COMPUTED STATS
// ============================================================================

export interface DashboardStats {
  activeWorkOrders: number
  blockedWorkOrders: number
  pendingApprovals: number
  activeAgents: number
  totalAgents: number
  completedToday: number
}

export function computeDashboardStats(): DashboardStats {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  return {
    activeWorkOrders: mockWorkOrders.filter((w) => w.state === 'active').length,
    blockedWorkOrders: mockWorkOrders.filter((w) => w.state === 'blocked').length,
    pendingApprovals: mockApprovals.filter((a) => a.status === 'pending').length,
    activeAgents: mockAgents.filter((a) => a.status === 'active').length,
    totalAgents: mockAgents.length,
    completedToday: mockWorkOrders.filter(
      (w) => w.shippedAt && w.shippedAt >= today
    ).length,
  }
}
