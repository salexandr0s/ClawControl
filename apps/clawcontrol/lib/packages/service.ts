import 'server-only'

import { promises as fsp } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import yaml from 'js-yaml'
import JSZip from 'jszip'
import Ajv from 'ajv'
import {
  CLAW_PACKAGE_MANIFEST_SCHEMA,
  type ClawPackageManifest,
  type ClawPackageKind,
  type WorkflowConfig,
  type WorkflowSelectionConfig,
} from '@clawcontrol/core'
import { getRepos } from '@/lib/repo'
import { validateWorkspacePath } from '@/lib/fs/path-policy'
import {
  getTemplateById,
  getTemplateFileContent,
  getTemplateFiles,
  invalidateTemplatesCache,
} from '@/lib/templates'
import {
  getWorkflowDefinition,
  getWorkflowRegistrySnapshot,
  syncResolvedWorkflowSnapshots,
} from '@/lib/workflows/registry'
import {
  importCustomWorkflows,
  upsertWorkflowSelection,
  type WorkflowServiceError,
} from '@/lib/workflows/service'
import {
  deleteWorkspaceSelectionOverlay,
  deleteWorkspaceWorkflowConfig,
  readWorkspaceSelectionOverlay,
  writeWorkspaceSelectionOverlay,
} from '@/lib/workflows/storage'
import {
  formatAjvErrors,
  validateSelectionSchema,
  validateSelectionSemantics,
  validateWorkflowSchema,
  validateWorkflowSemantics,
} from '@/lib/workflows/validation'

const STAGED_PACKAGE_TTL_MS = 30 * 60 * 1000
const PACKAGE_HISTORY_DIR = '/workflow-packages/history'

const ajv = new Ajv({ allErrors: true })
const validateManifest = ajv.compile(CLAW_PACKAGE_MANIFEST_SCHEMA)

interface PackageTemplateArtifact {
  templateId: string
  files: Record<string, string>
}

interface PackageListingMetadata {
  slug: string
  title: string
  description: string
  author: string
  tags: string[]
  compatibilityNotes?: string
}

interface PackageTeamArtifact {
  id: string
  slug?: string
  name: string
  description?: string | null
  source?: 'builtin' | 'custom' | 'imported'
  workflowIds?: string[]
  templateIds?: string[]
  memberAgentIds?: string[]
  healthStatus?: 'healthy' | 'warning' | 'degraded' | 'unknown'
}

interface ParsedPackage {
  manifest: ClawPackageManifest
  templates: PackageTemplateArtifact[]
  workflows: WorkflowConfig[]
  teams: PackageTeamArtifact[]
  selection: WorkflowSelectionConfig | null
  installDoc: { path: string; content: string } | null
  fileCount: number
}

interface StagedPackage {
  id: string
  fileName: string
  parsed: ParsedPackage
  createdAtMs: number
  expiresAtMs: number
}

const stagedPackages = new Map<string, StagedPackage>()

export interface PackageAnalysis {
  packageId: string
  fileName: string
  manifest: ClawPackageManifest
  summary: {
    templates: number
    workflows: number
    teams: number
    hasSelection: boolean
  }
  conflicts: {
    templates: string[]
    workflows: string[]
    teams: string[]
  }
  installDoc?: { path: string; preview: string } | null
  stagedUntil: string
}

export interface PackageDeployOptions {
  applyTemplates?: boolean
  applyWorkflows?: boolean
  applyTeams?: boolean
  applySelection?: boolean
}

export interface PackageDeployResult {
  packageId: string
  deployed: {
    templates: string[]
    workflows: string[]
    teams: string[]
    selectionApplied: boolean
  }
}

export class PackageServiceError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
    public details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'PackageServiceError'
  }
}

function cleanupStagedPackages(): void {
  const now = Date.now()
  for (const [id, pkg] of stagedPackages.entries()) {
    if (pkg.expiresAtMs <= now) {
      stagedPackages.delete(id)
    }
  }
}

function normalizeZipEntryName(name: string): string {
  return name.replace(/\\/g, '/').replace(/^\.\//, '')
}

function shouldIgnoreZipEntry(name: string): boolean {
  if (name.startsWith('__MACOSX/')) return true
  const base = name.split('/').at(-1) ?? name
  if (base === '.DS_Store') return true
  return false
}

function assertSafeArchivePath(path: string): void {
  if (!path || path.startsWith('/')) {
    throw new PackageServiceError(`Unsafe archive path: ${path}`, 'PACKAGE_VALIDATION_FAILED', 400)
  }
  if (path.includes('..')) {
    throw new PackageServiceError(`Unsafe archive path: ${path}`, 'PACKAGE_VALIDATION_FAILED', 400)
  }
}

function parseYamlObject(content: string, sourcePath: string): unknown {
  try {
    return yaml.load(content)
  } catch (error) {
    throw new PackageServiceError(
      `Failed to parse YAML in ${sourcePath}: ${error instanceof Error ? error.message : String(error)}`,
      'PACKAGE_VALIDATION_FAILED',
      400,
      { sourcePath }
    )
  }
}

function parseJsonObject(content: string, sourcePath: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(content)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Expected JSON object')
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    throw new PackageServiceError(
      `Failed to parse JSON in ${sourcePath}: ${error instanceof Error ? error.message : String(error)}`,
      'PACKAGE_VALIDATION_FAILED',
      400,
      { sourcePath }
    )
  }
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (!trimmed) continue
    out.push(trimmed)
  }
  return out
}

function parseTeamArtifact(raw: unknown, defaultId: string): PackageTeamArtifact {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new PackageServiceError('Team definition must be an object', 'PACKAGE_VALIDATION_FAILED', 400)
  }

  const record = raw as Record<string, unknown>
  const name = typeof record.name === 'string' ? record.name.trim() : ''
  if (!name) {
    throw new PackageServiceError('Team definition missing required name', 'PACKAGE_VALIDATION_FAILED', 400)
  }

  const source = typeof record.source === 'string' ? record.source : undefined
  const normalizedSource = source === 'builtin' || source === 'custom' || source === 'imported'
    ? source
    : 'imported'

  const health = typeof record.healthStatus === 'string' ? record.healthStatus : undefined
  const normalizedHealth = health === 'healthy' || health === 'warning' || health === 'degraded' || health === 'unknown'
    ? health
    : 'unknown'

  return {
    id: typeof record.id === 'string' && record.id.trim() ? record.id.trim() : defaultId,
    slug: typeof record.slug === 'string' && record.slug.trim() ? record.slug.trim() : undefined,
    name,
    description: typeof record.description === 'string' ? record.description : null,
    source: normalizedSource,
    workflowIds: asStringArray(record.workflowIds),
    templateIds: asStringArray(record.templateIds),
    memberAgentIds: asStringArray(record.memberAgentIds),
    healthStatus: normalizedHealth,
  }
}

function validateWorkflowFromPackage(raw: unknown, sourcePath: string): WorkflowConfig {
  const valid = validateWorkflowSchema(raw)
  if (!valid) {
    throw new PackageServiceError(
      `Workflow validation failed (${sourcePath}): ${formatAjvErrors(validateWorkflowSchema.errors)}`,
      'PACKAGE_VALIDATION_FAILED',
      400,
      { sourcePath }
    )
  }

  const workflow = raw as WorkflowConfig
  try {
    validateWorkflowSemantics(workflow, sourcePath)
  } catch (error) {
    throw new PackageServiceError(
      error instanceof Error ? error.message : 'Workflow semantic validation failed',
      'PACKAGE_VALIDATION_FAILED',
      400,
      { sourcePath }
    )
  }

  return workflow
}

function validateSelectionFromPackage(raw: unknown, sourcePath: string): WorkflowSelectionConfig {
  const valid = validateSelectionSchema(raw)
  if (!valid) {
    throw new PackageServiceError(
      `Selection validation failed (${sourcePath}): ${formatAjvErrors(validateSelectionSchema.errors)}`,
      'PACKAGE_VALIDATION_FAILED',
      400,
      { sourcePath }
    )
  }

  return raw as WorkflowSelectionConfig
}

function findPackageRootPrefix(entries: string[]): string {
  const directManifest = entries.find((entry) => entry === 'clawcontrol-package.yaml' || entry === 'clawcontrol-package.yml')
  if (directManifest) return ''

  const nested = entries
    .filter((entry) => entry.endsWith('/clawcontrol-package.yaml') || entry.endsWith('/clawcontrol-package.yml'))
    .sort((left, right) => left.length - right.length)

  if (nested.length === 0) {
    throw new PackageServiceError(
      'Missing required root manifest: clawcontrol-package.yaml',
      'PACKAGE_VALIDATION_FAILED',
      400
    )
  }

  const candidate = nested[0]
  const slash = candidate.lastIndexOf('/')
  return slash > -1 ? candidate.slice(0, slash + 1) : ''
}

function stripPrefix(path: string, prefix: string): string {
  if (!prefix) return path
  if (!path.startsWith(prefix)) return path
  return path.slice(prefix.length)
}

async function parsePackageBuffer(buffer: Buffer): Promise<ParsedPackage> {
  const zip = await JSZip.loadAsync(buffer)

  const allFileEntries = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .map((entry) => normalizeZipEntryName(entry.name))
    .filter((entry) => !shouldIgnoreZipEntry(entry))

  for (const entryName of allFileEntries) {
    assertSafeArchivePath(entryName)
  }

  if (allFileEntries.length === 0) {
    throw new PackageServiceError('Package archive is empty', 'PACKAGE_VALIDATION_FAILED', 400)
  }

  const rootPrefix = findPackageRootPrefix(allFileEntries)

  const fileEntries = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .map((entry) => ({
      zipEntry: entry,
      normalized: stripPrefix(normalizeZipEntryName(entry.name), rootPrefix),
    }))
    .filter((entry) => entry.normalized.length > 0)
    .filter((entry) => !shouldIgnoreZipEntry(entry.normalized))

  const manifestEntry = fileEntries.find((entry) => {
    return entry.normalized === 'clawcontrol-package.yaml' || entry.normalized === 'clawcontrol-package.yml'
  })

  if (!manifestEntry) {
    throw new PackageServiceError(
      'Missing required root manifest: clawcontrol-package.yaml',
      'PACKAGE_VALIDATION_FAILED',
      400
    )
  }

  const manifestRaw = await manifestEntry.zipEntry.async('string')
  const parsedManifest = parseYamlObject(manifestRaw, manifestEntry.normalized)
  const manifestValid = validateManifest(parsedManifest)
  if (!manifestValid) {
    throw new PackageServiceError(
      `Invalid package manifest: ${formatAjvErrors(validateManifest.errors)}`,
      'PACKAGE_VALIDATION_FAILED',
      400
    )
  }

  const manifest = parsedManifest as ClawPackageManifest

  const templatesById = new Map<string, PackageTemplateArtifact>()
  const workflows: WorkflowConfig[] = []
  const teams: PackageTeamArtifact[] = []
  let selection: WorkflowSelectionConfig | null = null
  let installDoc: { path: string; content: string } | null = null

  for (const entry of fileEntries) {
    const path = entry.normalized
    if (path === 'clawcontrol-package.yaml' || path === 'clawcontrol-package.yml') {
      continue
    }

    if (path === 'POST_INSTALL.md') {
      const raw = await entry.zipEntry.async('string')
      installDoc = {
        path,
        content: raw,
      }
      continue
    }

    if (path.startsWith('agent-templates/')) {
      const parts = path.split('/')
      if (parts.length < 3) {
        throw new PackageServiceError(`Invalid template path in package: ${path}`, 'PACKAGE_VALIDATION_FAILED', 400)
      }

      const templateId = parts[1]
      const fileName = parts.slice(2).join('/')
      if (!fileName) continue

      const artifact = templatesById.get(templateId) ?? { templateId, files: {} }
      artifact.files[fileName] = await entry.zipEntry.async('string')
      templatesById.set(templateId, artifact)
      continue
    }

    if (path.startsWith('workflows/') && path.match(/\.ya?ml$/i)) {
      const raw = await entry.zipEntry.async('string')
      const parsed = parseYamlObject(raw, path)
      workflows.push(validateWorkflowFromPackage(parsed, path))
      continue
    }

    if (path.startsWith('teams/') && path.match(/\.ya?ml$/i)) {
      const raw = await entry.zipEntry.async('string')
      const parsed = parseYamlObject(raw, path)
      const teamId = path.split('/').at(-1)?.replace(/\.ya?ml$/i, '') || `team_${teams.length + 1}`
      teams.push(parseTeamArtifact(parsed, teamId))
      continue
    }

    if ((path === 'selection/workflow-selection.yaml' || path === 'selection/workflow-selection.yml')) {
      const raw = await entry.zipEntry.async('string')
      const parsed = parseYamlObject(raw, path)
      selection = validateSelectionFromPackage(parsed, path)
      continue
    }
  }

  const templates = [...templatesById.values()]

  for (const template of templates) {
    const templateJson = template.files['template.json']
    if (!templateJson) {
      throw new PackageServiceError(
        `Template ${template.templateId} is missing template.json`,
        'PACKAGE_VALIDATION_FAILED',
        400,
        { templateId: template.templateId }
      )
    }

    const parsedJson = parseJsonObject(templateJson, `agent-templates/${template.templateId}/template.json`)
    const declaredId = typeof parsedJson.id === 'string' ? parsedJson.id.trim() : ''
    if (!declaredId) {
      throw new PackageServiceError(
        `Template ${template.templateId} template.json missing id`,
        'PACKAGE_VALIDATION_FAILED',
        400,
        { templateId: template.templateId }
      )
    }

    if (declaredId !== template.templateId) {
      throw new PackageServiceError(
        `Template folder/id mismatch (${template.templateId} vs ${declaredId})`,
        'PACKAGE_VALIDATION_FAILED',
        400,
        { templateId: template.templateId, declaredId }
      )
    }
  }

  return {
    manifest,
    templates,
    workflows,
    teams,
    selection,
    installDoc,
    fileCount: fileEntries.length,
  }
}

async function ensurePathExists(path: string): Promise<boolean> {
  const result = validateWorkspacePath(path)
  if (!result.valid || !result.resolvedPath) {
    throw new PackageServiceError(result.error || `Invalid workspace path: ${path}`, 'PACKAGE_VALIDATION_FAILED', 400)
  }

  try {
    await fsp.access(result.resolvedPath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function detectConflicts(parsed: ParsedPackage): Promise<PackageAnalysis['conflicts']> {
  const [workflowSnapshot, repos] = await Promise.all([
    getWorkflowRegistrySnapshot({ forceReload: true }),
    Promise.resolve(getRepos()),
  ])

  const existingWorkflowIds = new Set(workflowSnapshot.definitions.map((item) => item.id))
  const existingWorkflows = parsed.workflows
    .map((workflow) => workflow.id)
    .filter((id) => existingWorkflowIds.has(id))

  const existingTemplates: string[] = []
  for (const template of parsed.templates) {
    const exists = await ensurePathExists(`/agent-templates/${template.templateId}`)
    if (exists) existingTemplates.push(template.templateId)
  }

  const existingTeams: string[] = []
  for (const team of parsed.teams) {
    if (!team.slug) continue
    const found = await repos.agentTeams.getBySlug(team.slug)
    if (found) existingTeams.push(team.slug)
  }

  return {
    templates: existingTemplates,
    workflows: existingWorkflows,
    teams: existingTeams,
  }
}

async function writeHistoryRecord(event: {
  type: 'import_analyzed' | 'import_deployed' | 'exported'
  payload: Record<string, unknown>
}): Promise<void> {
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}_${randomUUID()}`
  const workspacePath = `${PACKAGE_HISTORY_DIR}/${id}.json`
  const result = validateWorkspacePath(workspacePath)
  if (!result.valid || !result.resolvedPath) return

  await fsp.mkdir(dirname(result.resolvedPath), { recursive: true })
  await fsp.writeFile(
    result.resolvedPath,
    `${JSON.stringify({
      ts: new Date().toISOString(),
      type: event.type,
      payload: event.payload,
    }, null, 2)}\n`,
    'utf8'
  )
}

function defaultDeployOptions(kind: ClawPackageKind): Required<PackageDeployOptions> {
  switch (kind) {
    case 'agent_template':
      return { applyTemplates: true, applyWorkflows: false, applyTeams: false, applySelection: false }
    case 'workflow':
      return { applyTemplates: false, applyWorkflows: true, applyTeams: false, applySelection: true }
    case 'agent_team':
      return { applyTemplates: false, applyWorkflows: false, applyTeams: true, applySelection: false }
    case 'team_with_workflows':
      return { applyTemplates: true, applyWorkflows: true, applyTeams: true, applySelection: true }
  }
}

function mergeDeployOptions(kind: ClawPackageKind, input?: PackageDeployOptions): Required<PackageDeployOptions> {
  const defaults = defaultDeployOptions(kind)
  return {
    applyTemplates: input?.applyTemplates ?? defaults.applyTemplates,
    applyWorkflows: input?.applyWorkflows ?? defaults.applyWorkflows,
    applyTeams: input?.applyTeams ?? defaults.applyTeams,
    applySelection: input?.applySelection ?? defaults.applySelection,
  }
}

function toListingSlug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/_/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')

  const candidate = normalized.slice(0, 80).replace(/-+$/g, '')
  if (candidate.length >= 3) return candidate
  return `pkg-${randomUUID().slice(0, 8)}`
}

function listingTagsForKind(kind: ClawPackageKind): string[] {
  switch (kind) {
    case 'agent_template':
      return ['agent-template']
    case 'agent_team':
      return ['agent-team']
    case 'workflow':
      return ['workflow']
    case 'team_with_workflows':
      return ['agent-team', 'workflow-bundle']
  }
}

function buildMarketplaceListing(manifest: ClawPackageManifest): PackageListingMetadata {
  return {
    slug: toListingSlug(manifest.id),
    title: manifest.name,
    description: manifest.description || `${manifest.name} package`,
    author: manifest.createdBy || 'clawcontrol',
    tags: listingTagsForKind(manifest.kind),
    compatibilityNotes: 'Generated by ClawControl package export. Compatible with ClawControl package import and Market_ClawControl clawpack validation.',
  }
}

export async function analyzePackageImport(file: File): Promise<PackageAnalysis> {
  cleanupStagedPackages()

  if (!file.name.toLowerCase().endsWith('.zip')) {
    throw new PackageServiceError('Package file must be a .zip archive', 'PACKAGE_VALIDATION_FAILED', 400)
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const parsed = await parsePackageBuffer(buffer)
  const conflicts = await detectConflicts(parsed)

  const packageId = randomUUID()
  const createdAtMs = Date.now()
  const stagedUntilMs = createdAtMs + STAGED_PACKAGE_TTL_MS

  stagedPackages.set(packageId, {
    id: packageId,
    fileName: file.name,
    parsed,
    createdAtMs,
    expiresAtMs: stagedUntilMs,
  })

  await writeHistoryRecord({
    type: 'import_analyzed',
    payload: {
      packageId,
      fileName: file.name,
      manifest: parsed.manifest,
      summary: {
        templates: parsed.templates.length,
        workflows: parsed.workflows.length,
        teams: parsed.teams.length,
        hasSelection: Boolean(parsed.selection),
      },
      conflicts,
    },
  })

  return {
    packageId,
    fileName: file.name,
    manifest: parsed.manifest,
    summary: {
      templates: parsed.templates.length,
      workflows: parsed.workflows.length,
      teams: parsed.teams.length,
      hasSelection: Boolean(parsed.selection),
    },
    conflicts,
    installDoc: parsed.installDoc
      ? {
          path: parsed.installDoc.path,
          preview: parsed.installDoc.content.slice(0, 4000),
        }
      : null,
    stagedUntil: new Date(stagedUntilMs).toISOString(),
  }
}

async function deployTemplates(templates: PackageTemplateArtifact[]): Promise<{ deployed: string[]; createdDirs: string[] }> {
  const deployed: string[] = []
  const createdDirs: string[] = []

  for (const template of templates) {
    const templatePath = `/agent-templates/${template.templateId}`
    if (await ensurePathExists(templatePath)) {
      throw new PackageServiceError(
        `Template already exists: ${template.templateId}`,
        'PACKAGE_DEPLOY_FAILED',
        409,
        { templateId: template.templateId }
      )
    }

    const dirResult = validateWorkspacePath(templatePath)
    if (!dirResult.valid || !dirResult.resolvedPath) {
      throw new PackageServiceError(dirResult.error || `Invalid template path: ${templatePath}`, 'PACKAGE_DEPLOY_FAILED', 400)
    }

    await fsp.mkdir(dirResult.resolvedPath, { recursive: false })
    createdDirs.push(dirResult.resolvedPath)

    const fileNames = Object.keys(template.files).sort((left, right) => left.localeCompare(right))
    for (const fileName of fileNames) {
      const segments = fileName.split('/')
      if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
        throw new PackageServiceError(
          `Invalid template file path: ${fileName}`,
          'PACKAGE_DEPLOY_FAILED',
          400,
          { templateId: template.templateId }
        )
      }

      const workspacePath = `${templatePath}/${fileName}`
      const fileResult = validateWorkspacePath(workspacePath)
      if (!fileResult.valid || !fileResult.resolvedPath) {
        throw new PackageServiceError(fileResult.error || `Invalid file path: ${workspacePath}`, 'PACKAGE_DEPLOY_FAILED', 400)
      }

      await fsp.mkdir(dirname(fileResult.resolvedPath), { recursive: true })
      await fsp.writeFile(fileResult.resolvedPath, template.files[fileName], 'utf8')
    }

    deployed.push(template.templateId)
  }

  invalidateTemplatesCache()
  return { deployed, createdDirs }
}

async function rollbackTemplateDirs(paths: string[]): Promise<void> {
  for (const path of [...paths].reverse()) {
    try {
      await fsp.rm(path, { recursive: true, force: true })
    } catch {
      // Best-effort rollback.
    }
  }
  invalidateTemplatesCache()
}

export async function deployStagedPackage(input: {
  packageId: string
  options?: PackageDeployOptions
}): Promise<PackageDeployResult> {
  cleanupStagedPackages()

  const staged = stagedPackages.get(input.packageId)
  if (!staged) {
    throw new PackageServiceError('Staged package not found or expired', 'PACKAGE_DEPLOY_FAILED', 404)
  }

  const parsed = staged.parsed
  const deployOptions = mergeDeployOptions(parsed.manifest.kind, input.options)
  const repos = getRepos()

  const deployedTemplates: string[] = []
  const createdTemplateDirs: string[] = []
  const deployedWorkflows: string[] = []
  const deployedTeams: string[] = []
  let selectionApplied = false
  let previousSelection: WorkflowSelectionConfig | null = null

  try {
    if (deployOptions.applyTemplates && parsed.templates.length > 0) {
      const templateResult = await deployTemplates(parsed.templates)
      deployedTemplates.push(...templateResult.deployed)
      createdTemplateDirs.push(...templateResult.createdDirs)
    }

    if (deployOptions.applyWorkflows && parsed.workflows.length > 0) {
      const workflowResult = await importCustomWorkflows(parsed.workflows)
      deployedWorkflows.push(...workflowResult.imported.map((item) => item.id))
    }

    if (deployOptions.applyTeams && parsed.teams.length > 0) {
      for (const team of parsed.teams) {
        if (team.slug) {
          const existing = await repos.agentTeams.getBySlug(team.slug)
          if (existing) {
            throw new PackageServiceError(
              `Team slug already exists: ${team.slug}`,
              'TEAM_DEPLOY_FAILED',
              409,
              { slug: team.slug }
            )
          }
        }

        const created = await repos.agentTeams.create({
          name: team.name,
          slug: team.slug,
          description: team.description,
          source: team.source ?? 'imported',
          workflowIds: team.workflowIds,
          templateIds: team.templateIds,
          memberAgentIds: team.memberAgentIds,
          healthStatus: team.healthStatus,
        })
        deployedTeams.push(created.id)
      }
    }

    if (deployOptions.applySelection && parsed.selection) {
      const overlay = await readWorkspaceSelectionOverlay()
      previousSelection = overlay?.selection ?? null

      const workflowSnapshot = await getWorkflowRegistrySnapshot({ forceReload: true })
      const knownWorkflowIds = new Set(workflowSnapshot.definitions.map((item) => item.id))
      for (const id of deployedWorkflows) {
        knownWorkflowIds.add(id)
      }

      validateSelectionSemantics(parsed.selection, knownWorkflowIds)
      await upsertWorkflowSelection(parsed.selection)
      selectionApplied = true
    }

    await syncResolvedWorkflowSnapshots({ forceReload: true })

    stagedPackages.delete(input.packageId)

    await writeHistoryRecord({
      type: 'import_deployed',
      payload: {
        packageId: input.packageId,
        manifest: parsed.manifest,
        deployed: {
          templates: deployedTemplates,
          workflows: deployedWorkflows,
          teams: deployedTeams,
          selectionApplied,
        },
      },
    })

    return {
      packageId: input.packageId,
      deployed: {
        templates: deployedTemplates,
        workflows: deployedWorkflows,
        teams: deployedTeams,
        selectionApplied,
      },
    }
  } catch (error) {
    await rollbackTemplateDirs(createdTemplateDirs)

    for (const workflowId of deployedWorkflows) {
      try {
        await deleteWorkspaceWorkflowConfig(workflowId)
      } catch {
        // best-effort rollback
      }
    }

    if (deployedWorkflows.length > 0) {
      await syncResolvedWorkflowSnapshots({ forceReload: true }).catch(() => {
        // best-effort rollback
      })
    }

    for (const teamId of deployedTeams) {
      try {
        await repos.agentTeams.delete(teamId)
      } catch {
        // best-effort rollback
      }
    }

    if (selectionApplied) {
      try {
        if (previousSelection) {
          await writeWorkspaceSelectionOverlay(previousSelection)
        } else {
          await deleteWorkspaceSelectionOverlay()
        }
        await syncResolvedWorkflowSnapshots({ forceReload: true })
      } catch {
        // best-effort rollback
      }
    }

    if (error instanceof PackageServiceError) {
      throw error
    }

    const workflowError = error as WorkflowServiceError
    if (workflowError && workflowError.name === 'WorkflowServiceError') {
      throw new PackageServiceError(
        workflowError.message,
        workflowError.code,
        workflowError.status,
        workflowError.details
      )
    }

    throw new PackageServiceError(
      error instanceof Error ? error.message : 'Package deployment failed',
      'PACKAGE_DEPLOY_FAILED',
      500
    )
  }
}

export async function buildPackageExport(input: {
  kind: ClawPackageKind
  id: string
}): Promise<{ fileName: string; content: Buffer; manifest: ClawPackageManifest }> {
  const zip = new JSZip()
  const kind = input.kind
  const repos = getRepos()

  const manifest: ClawPackageManifest = {
    id: input.id,
    name: input.id,
    version: '1.0.0',
    kind,
    createdAt: new Date().toISOString(),
    createdBy: 'clawcontrol',
  }

  if (kind === 'workflow') {
    const workflow = await getWorkflowDefinition(input.id, { forceReload: true })
    if (!workflow) {
      throw new PackageServiceError('Workflow not found', 'PACKAGE_DEPLOY_FAILED', 404, { id: input.id })
    }

    manifest.name = workflow.id
    manifest.description = workflow.workflow.description

    zip.file(`workflows/${workflow.id}.yaml`, yaml.dump(workflow.workflow, {
      indent: 2,
      lineWidth: 100,
      noRefs: true,
      sortKeys: false,
    }))
  }

  if (kind === 'agent_template') {
    const template = await getTemplateById(input.id)
    if (!template) {
      throw new PackageServiceError('Template not found', 'PACKAGE_DEPLOY_FAILED', 404, { id: input.id })
    }

    manifest.name = template.name
    manifest.description = template.description

    const files = await getTemplateFiles(template.id)
    for (const file of files) {
      const content = await getTemplateFileContent(template.id, file.id)
      if (content === null) continue
      zip.file(`agent-templates/${template.id}/${file.name}`, content)
    }
  }

  if (kind === 'agent_team' || kind === 'team_with_workflows') {
    const team = await repos.agentTeams.getById(input.id)
    if (!team) {
      throw new PackageServiceError('Team not found', 'PACKAGE_DEPLOY_FAILED', 404, { id: input.id })
    }

    manifest.name = team.name
    manifest.description = team.description || undefined

    zip.file(`teams/${team.slug || team.id}.yaml`, yaml.dump({
      id: team.id,
      slug: team.slug,
      name: team.name,
      description: team.description,
      source: team.source,
      workflowIds: team.workflowIds,
      templateIds: team.templateIds,
      memberAgentIds: team.members.map((member) => member.id),
      healthStatus: team.healthStatus,
    }, {
      indent: 2,
      lineWidth: 100,
      noRefs: true,
      sortKeys: false,
    }))

    if (kind === 'team_with_workflows') {
      for (const workflowId of team.workflowIds) {
        const workflow = await getWorkflowDefinition(workflowId, { forceReload: true })
        if (!workflow) continue

        zip.file(`workflows/${workflow.id}.yaml`, yaml.dump(workflow.workflow, {
          indent: 2,
          lineWidth: 100,
          noRefs: true,
          sortKeys: false,
        }))
      }

      for (const templateId of team.templateIds) {
        const template = await getTemplateById(templateId)
        if (!template) continue
        const files = await getTemplateFiles(template.id)
        for (const file of files) {
          const content = await getTemplateFileContent(template.id, file.id)
          if (content === null) continue
          zip.file(`agent-templates/${template.id}/${file.name}`, content)
        }
      }
    }
  }

  const listingMetadata = buildMarketplaceListing(manifest)
  zip.file('marketplace/listing.yaml', yaml.dump(listingMetadata, {
    indent: 2,
    lineWidth: 100,
    noRefs: true,
    sortKeys: false,
  }))

  zip.file('clawcontrol-package.yaml', yaml.dump(manifest, {
    indent: 2,
    lineWidth: 100,
    noRefs: true,
    sortKeys: false,
  }))

  const content = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })

  await writeHistoryRecord({
    type: 'exported',
    payload: {
      id: input.id,
      kind,
      manifest,
      sizeBytes: content.byteLength,
    },
  })

  return {
    fileName: `${manifest.id}.clawpack.zip`,
    content,
    manifest,
  }
}
