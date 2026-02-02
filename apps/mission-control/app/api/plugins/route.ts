import { NextRequest, NextResponse } from 'next/server'
import { mockPlugins } from '@savorg/core'
import { enforceTypedConfirm } from '@/lib/with-governor'
import { getRepos } from '@/lib/repo'
import type { Plugin, PluginSourceType } from '@savorg/core'

// Validation helpers
const ALLOWED_LOCAL_BASES = ['/usr/local/lib/savorg/plugins', '/opt/savorg/plugins']
const NPM_SPEC_PATTERN = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(@[^@]+)?$/i
const GIT_SPEC_PATTERN = /^(https?:\/\/|git@)[^\s]+$/

function validateSpec(sourceType: PluginSourceType, spec: string): { valid: boolean; error?: string } {
  if (!spec || spec.trim().length === 0) {
    return { valid: false, error: 'Spec is required' }
  }

  switch (sourceType) {
    case 'local': {
      // Check if path is within allowed bases
      const isAllowed = ALLOWED_LOCAL_BASES.some((base) => spec.startsWith(base))
      if (!isAllowed && !spec.startsWith('/')) {
        return { valid: false, error: 'Local path must be absolute' }
      }
      // Prevent directory traversal
      if (spec.includes('..')) {
        return { valid: false, error: 'Path traversal not allowed' }
      }
      return { valid: true }
    }

    case 'npm':
      if (!NPM_SPEC_PATTERN.test(spec)) {
        return { valid: false, error: 'Invalid npm package spec' }
      }
      return { valid: true }

    case 'tgz':
      if (!spec.endsWith('.tgz') && !spec.endsWith('.tar.gz')) {
        return { valid: false, error: 'Tarball must be .tgz or .tar.gz' }
      }
      if (spec.includes('..')) {
        return { valid: false, error: 'Path traversal not allowed' }
      }
      return { valid: true }

    case 'git':
      if (!GIT_SPEC_PATTERN.test(spec)) {
        return { valid: false, error: 'Invalid git URL' }
      }
      return { valid: true }

    default:
      return { valid: false, error: 'Unknown source type' }
  }
}

function extractPluginName(sourceType: PluginSourceType, spec: string): string {
  switch (sourceType) {
    case 'local':
      return spec.split('/').pop() || 'unknown'
    case 'npm': {
      // Extract package name without version
      const match = spec.match(/^(@[^@/]+\/)?([^@/]+)/)
      return match ? (match[1] || '') + match[2] : spec
    }
    case 'tgz':
      return spec.split('/').pop()?.replace(/\.(tgz|tar\.gz)$/, '') || 'unknown'
    case 'git': {
      const repoMatch = spec.match(/\/([^/]+?)(\.git)?$/)
      return repoMatch ? repoMatch[1] : 'unknown'
    }
    default:
      return 'unknown'
  }
}

/**
 * GET /api/plugins
 * List all plugins with optional filters
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const enabled = searchParams.get('enabled')

  let plugins = [...mockPlugins]

  // Filter by status
  if (status) {
    plugins = plugins.filter((p) => p.status === status)
  }

  // Filter by enabled
  if (enabled !== null) {
    const isEnabled = enabled === 'true'
    plugins = plugins.filter((p) => p.enabled === isEnabled)
  }

  // Map to DTO (exclude sensitive config data in list)
  const pluginDTOs = plugins.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    version: p.version,
    author: p.author,
    enabled: p.enabled,
    status: p.status,
    sourceType: p.sourceType,
    sourcePath: p.sourcePath,
    npmSpec: p.npmSpec,
    hasConfig: p.hasConfig,
    doctorResult: p.doctorResult,
    restartRequired: p.restartRequired,
    lastError: p.lastError,
    installedAt: p.installedAt,
    updatedAt: p.updatedAt,
  }))

  return NextResponse.json({ data: pluginDTOs })
}

/**
 * POST /api/plugins
 * Install a new plugin (danger level, requires approval)
 */
export async function POST(request: NextRequest) {
  const body = await request.json()
  const { sourceType, spec, typedConfirmText } = body

  // Validate source type
  if (!['local', 'npm', 'tgz', 'git'].includes(sourceType)) {
    return NextResponse.json(
      { error: 'Invalid source type. Must be: local, npm, tgz, or git' },
      { status: 400 }
    )
  }

  // Validate spec
  const validation = validateSpec(sourceType as PluginSourceType, spec)
  if (!validation.valid) {
    return NextResponse.json(
      { error: validation.error },
      { status: 400 }
    )
  }

  // Check for duplicate
  const pluginName = extractPluginName(sourceType as PluginSourceType, spec)
  const existingPlugin = mockPlugins.find((p) => p.name === pluginName)
  if (existingPlugin) {
    return NextResponse.json(
      { error: `Plugin "${pluginName}" is already installed` },
      { status: 409 }
    )
  }

  // Enforce Governor - plugin.install is danger level
  const result = await enforceTypedConfirm({
    actionKind: 'plugin.install',
    typedConfirmText,
  })

  if (!result.allowed) {
    return NextResponse.json(
      {
        error: result.errorType,
        policy: result.policy,
      },
      { status: result.errorType === 'TYPED_CONFIRM_REQUIRED' ? 428 : 403 }
    )
  }

  const repos = getRepos()

  // Create a receipt for the install attempt
  const receipt = await repos.receipts.create({
    workOrderId: 'system',
    kind: 'manual',
    commandName: 'plugin.install',
    commandArgs: { sourceType, spec, pluginName },
  })

  // Simulate install process
  const newPluginId = `plugin_${Date.now()}`
  const newPlugin: Plugin = {
    id: newPluginId,
    name: pluginName,
    description: `Plugin installed from ${sourceType}: ${spec}`,
    version: '1.0.0',
    author: 'user',
    enabled: false, // Start disabled until verified
    status: 'inactive',
    sourceType: sourceType as PluginSourceType,
    sourcePath: sourceType === 'local' || sourceType === 'tgz' || sourceType === 'git' ? spec : undefined,
    npmSpec: sourceType === 'npm' ? spec : undefined,
    hasConfig: false,
    restartRequired: true, // New plugins need restart
    installedAt: new Date(),
    updatedAt: new Date(),
  }

  // Add to mock plugins
  mockPlugins.push(newPlugin)

  // Finalize receipt with success
  await repos.receipts.finalize(receipt.id, {
    exitCode: 0,
    durationMs: 2000 + Math.random() * 1000, // Simulate 2-3s install
    parsedJson: {
      pluginId: newPluginId,
      pluginName,
      sourceType,
      spec,
      status: 'installed',
    },
  })

  // Log activity
  await repos.activities.create({
    type: 'plugin.installed',
    actor: 'user',
    entityType: 'plugin',
    entityId: newPluginId,
    summary: `Installed plugin: ${pluginName} from ${sourceType}`,
    payloadJson: {
      pluginName,
      sourceType,
      spec,
      receiptId: receipt.id,
    },
  })

  return NextResponse.json({
    data: {
      id: newPlugin.id,
      name: newPlugin.name,
      description: newPlugin.description,
      version: newPlugin.version,
      author: newPlugin.author,
      enabled: newPlugin.enabled,
      status: newPlugin.status,
      sourceType: newPlugin.sourceType,
      sourcePath: newPlugin.sourcePath,
      npmSpec: newPlugin.npmSpec,
      hasConfig: newPlugin.hasConfig,
      restartRequired: newPlugin.restartRequired,
      installedAt: newPlugin.installedAt,
      updatedAt: newPlugin.updatedAt,
    },
    receiptId: receipt.id,
  })
}
