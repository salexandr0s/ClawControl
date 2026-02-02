/**
 * Seed script for Mission Control database
 *
 * Populates the database with realistic development data.
 * Run with: npm run db:seed
 */

import { PrismaClient } from '@prisma/client'
import {
  initializeFts,
  rebuildAllIndexes,
} from '../lib/db/fts'

const prisma = new PrismaClient()

// ============================================================================
// HELPER: Date generation for realistic timestamps
// ============================================================================

const now = new Date()
const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000)
const minsAgo = (m: number) => new Date(now.getTime() - m * 60 * 1000)
const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000)

async function main() {
  console.log('Seeding database...')

  // Clear existing data (in reverse order of dependencies)
  await prisma.message.deleteMany()
  await prisma.artifact.deleteMany()
  await prisma.receipt.deleteMany()
  await prisma.approval.deleteMany()
  await prisma.operation.deleteMany()
  await prisma.workOrder.deleteMany()
  await prisma.agent.deleteMany()
  await prisma.activity.deleteMany()
  await prisma.document.deleteMany()
  await prisma.cronJob.deleteMany()
  await prisma.skill.deleteMany()
  await prisma.plugin.deleteMany()
  await prisma.setting.deleteMany()

  console.log('Cleared existing data')

  // ============================================================================
  // WORK ORDERS
  // ============================================================================

  const workOrders = await Promise.all([
    prisma.workOrder.create({
      data: {
        id: 'wo_01',
        code: 'WO-001',
        title: 'Implement user authentication flow',
        goalMd: 'Add JWT-based authentication with refresh tokens and session management.',
        state: 'active',
        priority: 'P1',
        owner: 'user',
        routingTemplate: 'default_routing',
        createdAt: daysAgo(3),
        updatedAt: minsAgo(2),
      },
    }),
    prisma.workOrder.create({
      data: {
        id: 'wo_02',
        code: 'WO-002',
        title: 'Add dark mode to settings panel',
        goalMd: 'Implement theme switching with system preference detection.',
        state: 'review',
        priority: 'P2',
        owner: 'savorgceo',
        routingTemplate: 'default_routing',
        createdAt: daysAgo(5),
        updatedAt: minsAgo(15),
      },
    }),
    prisma.workOrder.create({
      data: {
        id: 'wo_03',
        code: 'WO-003',
        title: 'Fix pagination bug in data table',
        goalMd: 'Page numbers reset incorrectly when filtering. Root cause: state not syncing.',
        state: 'active',
        priority: 'P0',
        owner: 'user',
        routingTemplate: 'hotfix_routing',
        createdAt: daysAgo(1),
        updatedAt: minsAgo(1),
      },
    }),
    prisma.workOrder.create({
      data: {
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
      },
    }),
    prisma.workOrder.create({
      data: {
        id: 'wo_05',
        code: 'WO-005',
        title: 'Optimize API response caching',
        goalMd: 'Implement Redis caching layer for frequently accessed endpoints.',
        state: 'planned',
        priority: 'P3',
        owner: 'user',
        routingTemplate: 'default_routing',
        createdAt: daysAgo(2),
        updatedAt: daysAgo(2),
      },
    }),
    prisma.workOrder.create({
      data: {
        id: 'wo_06',
        code: 'WO-006',
        title: 'Add email notification system',
        goalMd: 'Set up transactional email service with templates for common events.',
        state: 'shipped',
        priority: 'P2',
        owner: 'savorgceo',
        routingTemplate: 'default_routing',
        createdAt: daysAgo(14),
        updatedAt: daysAgo(2),
        shippedAt: daysAgo(2),
      },
    }),
    prisma.workOrder.create({
      data: {
        id: 'wo_07',
        code: 'WO-007',
        title: 'Refactor payment processing module',
        goalMd: 'Extract payment logic into a separate service with better error handling.',
        state: 'active',
        priority: 'P1',
        owner: 'user',
        routingTemplate: 'default_routing',
        createdAt: daysAgo(4),
        updatedAt: minsAgo(30),
      },
    }),
  ])

  console.log(`Created ${workOrders.length} work orders`)

  // ============================================================================
  // OPERATIONS
  // ============================================================================

  const operations = await Promise.all([
    // WO-001 operations
    prisma.operation.create({
      data: {
        id: 'op_01',
        workOrderId: 'wo_01',
        station: 'spec',
        title: 'Define auth requirements',
        status: 'done',
        assigneeAgentIds: JSON.stringify(['agent_01']),
        dependsOnOperationIds: JSON.stringify([]),
        wipClass: 'specification',
        createdAt: daysAgo(3),
        updatedAt: daysAgo(2),
      },
    }),
    prisma.operation.create({
      data: {
        id: 'op_02',
        workOrderId: 'wo_01',
        station: 'build',
        title: 'Implement JWT middleware',
        status: 'done',
        assigneeAgentIds: JSON.stringify(['agent_02']),
        dependsOnOperationIds: JSON.stringify(['op_01']),
        wipClass: 'implementation',
        createdAt: daysAgo(2),
        updatedAt: minsAgo(45),
      },
    }),
    prisma.operation.create({
      data: {
        id: 'op_03',
        workOrderId: 'wo_01',
        station: 'build',
        title: 'Create login form UI',
        status: 'in_progress',
        assigneeAgentIds: JSON.stringify(['agent_03']),
        dependsOnOperationIds: JSON.stringify(['op_01']),
        wipClass: 'implementation',
        createdAt: daysAgo(2),
        updatedAt: minsAgo(5),
      },
    }),
    prisma.operation.create({
      data: {
        id: 'op_04',
        workOrderId: 'wo_01',
        station: 'qa',
        title: 'Write auth integration tests',
        status: 'todo',
        assigneeAgentIds: JSON.stringify([]),
        dependsOnOperationIds: JSON.stringify(['op_02', 'op_03']),
        wipClass: 'testing',
        createdAt: daysAgo(2),
        updatedAt: daysAgo(2),
      },
    }),
    prisma.operation.create({
      data: {
        id: 'op_05',
        workOrderId: 'wo_01',
        station: 'ship',
        title: 'Deploy to staging',
        status: 'todo',
        assigneeAgentIds: JSON.stringify([]),
        dependsOnOperationIds: JSON.stringify(['op_04']),
        wipClass: 'deployment',
        createdAt: daysAgo(2),
        updatedAt: daysAgo(2),
      },
    }),
    // WO-002 operations
    prisma.operation.create({
      data: {
        id: 'op_06',
        workOrderId: 'wo_02',
        station: 'build',
        title: 'Add theme context provider',
        status: 'done',
        assigneeAgentIds: JSON.stringify(['agent_02']),
        dependsOnOperationIds: JSON.stringify([]),
        wipClass: 'implementation',
        createdAt: daysAgo(4),
        updatedAt: daysAgo(1),
      },
    }),
    prisma.operation.create({
      data: {
        id: 'op_07',
        workOrderId: 'wo_02',
        station: 'build',
        title: 'Update component styles',
        status: 'done',
        assigneeAgentIds: JSON.stringify(['agent_03']),
        dependsOnOperationIds: JSON.stringify(['op_06']),
        wipClass: 'implementation',
        createdAt: daysAgo(3),
        updatedAt: minsAgo(20),
      },
    }),
    prisma.operation.create({
      data: {
        id: 'op_08',
        workOrderId: 'wo_02',
        station: 'qa',
        title: 'Visual regression testing',
        status: 'review',
        assigneeAgentIds: JSON.stringify(['agent_01']),
        dependsOnOperationIds: JSON.stringify(['op_07']),
        wipClass: 'testing',
        createdAt: daysAgo(1),
        updatedAt: minsAgo(15),
      },
    }),
    // WO-003 operations
    prisma.operation.create({
      data: {
        id: 'op_09',
        workOrderId: 'wo_03',
        station: 'build',
        title: 'Fix pagination state sync',
        status: 'in_progress',
        assigneeAgentIds: JSON.stringify(['agent_02']),
        dependsOnOperationIds: JSON.stringify([]),
        wipClass: 'bugfix',
        createdAt: daysAgo(1),
        updatedAt: minsAgo(1),
      },
    }),
    prisma.operation.create({
      data: {
        id: 'op_10',
        workOrderId: 'wo_03',
        station: 'qa',
        title: 'Verify pagination fix',
        status: 'todo',
        assigneeAgentIds: JSON.stringify([]),
        dependsOnOperationIds: JSON.stringify(['op_09']),
        wipClass: 'testing',
        createdAt: daysAgo(1),
        updatedAt: daysAgo(1),
      },
    }),
    // WO-004 operations
    prisma.operation.create({
      data: {
        id: 'op_11',
        workOrderId: 'wo_04',
        station: 'spec',
        title: 'Schema design review',
        status: 'done',
        assigneeAgentIds: JSON.stringify(['agent_01']),
        dependsOnOperationIds: JSON.stringify([]),
        wipClass: 'specification',
        createdAt: daysAgo(7),
        updatedAt: daysAgo(5),
      },
    }),
    prisma.operation.create({
      data: {
        id: 'op_12',
        workOrderId: 'wo_04',
        station: 'build',
        title: 'Write migration scripts',
        status: 'blocked',
        assigneeAgentIds: JSON.stringify(['agent_02']),
        dependsOnOperationIds: JSON.stringify(['op_11']),
        wipClass: 'implementation',
        blockedReason: 'Waiting for DBA approval',
        createdAt: daysAgo(5),
        updatedAt: hoursAgo(1),
      },
    }),
  ])

  console.log(`Created ${operations.length} operations`)

  // ============================================================================
  // AGENTS
  // ============================================================================

  const agents = await Promise.all([
    prisma.agent.create({
      data: {
        id: 'agent_01',
        name: 'claw-alpha',
        role: 'Specification & QA Lead',
        station: 'spec',
        status: 'active',
        sessionKey: 'sess_alpha_001',
        capabilities: JSON.stringify({ spec: true, qa: true, review: true }),
        wipLimit: 3,
        lastSeenAt: minsAgo(2),
        lastHeartbeatAt: minsAgo(0.5),
        createdAt: daysAgo(30),
        updatedAt: minsAgo(2),
      },
    }),
    prisma.agent.create({
      data: {
        id: 'agent_02',
        name: 'claw-beta',
        role: 'Build Specialist',
        station: 'build',
        status: 'active',
        sessionKey: 'sess_beta_001',
        capabilities: JSON.stringify({ build: true, deploy: true }),
        wipLimit: 2,
        lastSeenAt: minsAgo(1),
        lastHeartbeatAt: minsAgo(0.3),
        createdAt: daysAgo(30),
        updatedAt: minsAgo(1),
      },
    }),
    prisma.agent.create({
      data: {
        id: 'agent_03',
        name: 'claw-gamma',
        role: 'Frontend Specialist',
        station: 'build',
        status: 'active',
        sessionKey: 'sess_gamma_001',
        capabilities: JSON.stringify({ build: true, ui: true }),
        wipLimit: 2,
        lastSeenAt: minsAgo(5),
        lastHeartbeatAt: minsAgo(1),
        createdAt: daysAgo(14),
        updatedAt: minsAgo(5),
      },
    }),
    prisma.agent.create({
      data: {
        id: 'agent_04',
        name: 'claw-delta',
        role: 'Ops & Deploy',
        station: 'ops',
        status: 'idle',
        sessionKey: 'sess_delta_001',
        capabilities: JSON.stringify({ ops: true, deploy: true, monitoring: true }),
        wipLimit: 2,
        lastSeenAt: hoursAgo(2),
        lastHeartbeatAt: hoursAgo(2),
        createdAt: daysAgo(7),
        updatedAt: hoursAgo(2),
      },
    }),
  ])

  console.log(`Created ${agents.length} agents`)

  // ============================================================================
  // APPROVALS
  // ============================================================================

  const approvals = await Promise.all([
    prisma.approval.create({
      data: {
        id: 'apr_01',
        workOrderId: 'wo_01',
        operationId: 'op_02',
        type: 'ship_gate',
        questionMd: 'JWT middleware implementation complete. Ready to proceed with integration tests?',
        status: 'pending',
        createdAt: minsAgo(5),
      },
    }),
    prisma.approval.create({
      data: {
        id: 'apr_02',
        workOrderId: 'wo_04',
        operationId: 'op_12',
        type: 'risky_action',
        questionMd: 'Migration script will modify 50,000+ rows. Run in maintenance window?',
        status: 'pending',
        createdAt: hoursAgo(1),
      },
    }),
    prisma.approval.create({
      data: {
        id: 'apr_03',
        workOrderId: 'wo_02',
        operationId: 'op_08',
        type: 'ship_gate',
        questionMd: 'Dark mode visual regression tests passed. Approve for staging deployment?',
        status: 'pending',
        createdAt: minsAgo(15),
      },
    }),
  ])

  console.log(`Created ${approvals.length} approvals`)

  // ============================================================================
  // ACTIVITIES
  // ============================================================================

  const activities = await Promise.all([
    prisma.activity.create({
      data: {
        id: 'act_01',
        ts: minsAgo(2),
        type: 'operation.status_changed',
        actor: 'agent:claw-alpha',
        entityType: 'operation',
        entityId: 'op_02',
        summary: 'Completed: Implement JWT middleware',
        payloadJson: JSON.stringify({ from: 'in_progress', to: 'done' }),
      },
    }),
    prisma.activity.create({
      data: {
        id: 'act_02',
        ts: minsAgo(5),
        type: 'agent.joined',
        actor: 'system',
        entityType: 'agent',
        entityId: 'agent_03',
        summary: 'claw-gamma joined station build',
        payloadJson: JSON.stringify({ station: 'build' }),
      },
    }),
    prisma.activity.create({
      data: {
        id: 'act_03',
        ts: minsAgo(15),
        type: 'work_order.state_changed',
        actor: 'agent:claw-beta',
        entityType: 'work_order',
        entityId: 'wo_02',
        summary: 'WO-002 moved to Review',
        payloadJson: JSON.stringify({ from: 'active', to: 'review' }),
      },
    }),
    prisma.activity.create({
      data: {
        id: 'act_04',
        ts: minsAgo(30),
        type: 'gateway.health_check',
        actor: 'system',
        entityType: 'gateway',
        entityId: 'gateway_main',
        summary: 'Gateway health check passed',
        payloadJson: JSON.stringify({ latencyMs: 12, status: 'ok' }),
      },
    }),
    prisma.activity.create({
      data: {
        id: 'act_05',
        ts: minsAgo(45),
        type: 'operation.started',
        actor: 'agent:claw-alpha',
        entityType: 'operation',
        entityId: 'op_03',
        summary: 'Started: Create login form UI',
        payloadJson: JSON.stringify({}),
      },
    }),
    prisma.activity.create({
      data: {
        id: 'act_06',
        ts: hoursAgo(1),
        type: 'approval.created',
        actor: 'agent:claw-beta',
        entityType: 'approval',
        entityId: 'apr_02',
        summary: 'Approval requested: Run migration in maintenance window?',
        payloadJson: JSON.stringify({ type: 'risky_action' }),
      },
    }),
    prisma.activity.create({
      data: {
        id: 'act_07',
        ts: hoursAgo(2),
        type: 'work_order.blocked',
        actor: 'agent:claw-beta',
        entityType: 'work_order',
        entityId: 'wo_04',
        summary: 'WO-004 blocked: Waiting for DBA approval',
        payloadJson: JSON.stringify({ reason: 'Waiting for DBA approval on schema changes' }),
      },
    }),
    prisma.activity.create({
      data: {
        id: 'act_08',
        ts: hoursAgo(3),
        type: 'cron.executed',
        actor: 'system',
        entityType: 'cron',
        entityId: 'cron_daily_backup',
        summary: 'Daily backup completed successfully',
        payloadJson: JSON.stringify({ durationMs: 4523, exitCode: 0 }),
      },
    }),
  ])

  console.log(`Created ${activities.length} activities`)

  // ============================================================================
  // CRON JOBS
  // ============================================================================

  const cronJobs = await Promise.all([
    prisma.cronJob.create({
      data: {
        id: 'cron_01',
        name: 'daily-backup',
        schedule: '0 2 * * *',
        description: 'Daily database backup to S3',
        enabled: true,
        lastRunAt: hoursAgo(3),
        nextRunAt: hoursAgo(-21),
        lastStatus: 'success',
        runCount: 45,
      },
    }),
    prisma.cronJob.create({
      data: {
        id: 'cron_02',
        name: 'health-check',
        schedule: '*/5 * * * *',
        description: 'Gateway health monitoring',
        enabled: true,
        lastRunAt: minsAgo(2),
        nextRunAt: minsAgo(-3),
        lastStatus: 'success',
        runCount: 1250,
      },
    }),
    prisma.cronJob.create({
      data: {
        id: 'cron_03',
        name: 'cleanup-temp',
        schedule: '0 0 * * 0',
        description: 'Weekly cleanup of temporary files',
        enabled: true,
        lastRunAt: daysAgo(4),
        nextRunAt: daysAgo(-3),
        lastStatus: 'success',
        runCount: 12,
      },
    }),
    prisma.cronJob.create({
      data: {
        id: 'cron_04',
        name: 'sync-external',
        schedule: '0 */6 * * *',
        description: 'Sync with external APIs',
        enabled: false,
        lastRunAt: daysAgo(7),
        lastStatus: 'failed',
        runCount: 8,
      },
    }),
  ])

  console.log(`Created ${cronJobs.length} cron jobs`)

  // ============================================================================
  // SKILLS
  // ============================================================================

  const skills = await Promise.all([
    prisma.skill.create({
      data: {
        id: 'skill_01',
        name: 'git-workflow',
        description: 'Git operations: commit, push, branch management',
        version: '1.2.0',
        enabled: true,
        usageCount: 245,
        lastUsedAt: minsAgo(5),
        installedAt: daysAgo(30),
      },
    }),
    prisma.skill.create({
      data: {
        id: 'skill_02',
        name: 'code-review',
        description: 'Automated code review with style checks',
        version: '2.0.1',
        enabled: true,
        usageCount: 89,
        lastUsedAt: minsAgo(15),
        installedAt: daysAgo(14),
      },
    }),
    prisma.skill.create({
      data: {
        id: 'skill_03',
        name: 'test-runner',
        description: 'Run and analyze test suites',
        version: '1.5.0',
        enabled: true,
        usageCount: 156,
        lastUsedAt: hoursAgo(1),
        installedAt: daysAgo(21),
      },
    }),
    prisma.skill.create({
      data: {
        id: 'skill_04',
        name: 'deploy-staging',
        description: 'Deploy to staging environment',
        version: '1.0.0',
        enabled: false,
        usageCount: 12,
        lastUsedAt: daysAgo(3),
        installedAt: daysAgo(7),
      },
    }),
  ])

  console.log(`Created ${skills.length} skills`)

  // ============================================================================
  // PLUGINS
  // ============================================================================

  const plugins = await Promise.all([
    prisma.plugin.create({
      data: {
        id: 'plugin_01',
        name: 'context7',
        description: 'Documentation lookup and code context',
        version: '1.0.0',
        author: 'compound-engineering',
        enabled: true,
        installedAt: daysAgo(30),
      },
    }),
    prisma.plugin.create({
      data: {
        id: 'plugin_02',
        name: 'github-integration',
        description: 'GitHub API integration for PRs, issues, and actions',
        version: '2.1.0',
        author: 'savorg',
        enabled: true,
        installedAt: daysAgo(30),
      },
    }),
    prisma.plugin.create({
      data: {
        id: 'plugin_03',
        name: 'slack-notifications',
        description: 'Send notifications to Slack channels',
        version: '1.0.2',
        author: 'community',
        enabled: false,
        installedAt: daysAgo(14),
      },
    }),
  ])

  console.log(`Created ${plugins.length} plugins`)

  // ============================================================================
  // SETTINGS
  // ============================================================================

  const settings = await Promise.all([
    prisma.setting.upsert({
      where: { key: 'layout_mode' },
      update: { value: 'auto' },
      create: { key: 'layout_mode', value: 'auto' },
    }),
    prisma.setting.upsert({
      where: { key: 'gateway_url' },
      update: { value: 'http://localhost:8080' },
      create: { key: 'gateway_url', value: 'http://localhost:8080' },
    }),
    prisma.setting.upsert({
      where: { key: 'theme' },
      update: { value: 'dark' },
      create: { key: 'theme', value: 'dark' },
    }),
  ])

  console.log(`Created ${settings.length} settings`)

  // ============================================================================
  // FTS5 INDEXING
  // ============================================================================

  console.log('Initializing FTS5 indexes...')

  // Initialize FTS tables
  await initializeFts()

  // Rebuild all indexes from freshly seeded data
  await rebuildAllIndexes()

  console.log('FTS5 indexes created')

  console.log('Seed completed successfully!')
}

main()
  .catch((e) => {
    console.error('Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
