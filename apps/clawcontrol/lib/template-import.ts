import JSZip from 'jszip'
import { posix } from 'node:path'
import type { AgentTemplateConfig, TemplateValidationResult } from '@clawcontrol/core'
import { validateTemplateConfig } from './templates'
import { validateZipEntryName, MAX_FILE_SIZE, MAX_TOTAL_SIZE, MAX_FILES } from './fs/zip-safety'

export interface ImportTemplatePayload {
  templateId: string
  name: string
  version: string
  exportedAt?: string
  files: Record<string, string>
}

export type ImportBundleSource = 'json-body' | 'json-file' | 'zip-file'
export type ImportBundleLayout = 'single' | 'bundle'
export type ImportTemplateLayout =
  | 'json-wrapper'
  | 'json-file'
  | 'zip-root'
  | 'zip-folder'
  | 'zip-bundle'

interface TemplateCandidate {
  declaredTemplateId: string
  name: string
  version: string
  exportedAt?: string
  files: Record<string, string>
  expectedId?: string
  layout: ImportTemplateLayout
  folderName?: string
}

interface ParsedTemplateCandidate {
  candidate: TemplateCandidate
  configRaw: unknown
  config: AgentTemplateConfig
  baseValidation: TemplateValidationResult
}

export interface PreparedTemplateImport {
  templateId: string
  name: string
  version: string
  exportedAt?: string
  files: Record<string, string>
  fileCount: number
  config: AgentTemplateConfig
  validation: TemplateValidationResult
  layout: ImportTemplateLayout
  folderName?: string
}

export interface PreparedTemplateImportBundle {
  source: ImportBundleSource
  layout: ImportBundleLayout
  fileName?: string
  templates: PreparedTemplateImport[]
  templateIds: string[]
  templateCount: number
}

export class TemplateImportError extends Error {
  constructor(
    message: string,
    public status = 400,
    public details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'TemplateImportError'
  }
}

interface JsonImportBody {
  template?: unknown
  templates?: unknown
  typedConfirmText?: string
}

interface FormDataImportResult {
  bundle: PreparedTemplateImportBundle
  typedConfirmText?: string
}

interface ZipFileEntry {
  path: string
  content: string
  size: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function getRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new TemplateImportError(`Invalid template data: ${fieldName} must be a string`)
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new TemplateImportError(`Invalid template data: ${fieldName} is required`)
  }

  return trimmed
}

function isIgnoredNoisePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/')

  if (normalized.startsWith('__MACOSX/')) return true

  const parts = normalized.split('/')
  const baseName = parts[parts.length - 1]
  return baseName === '.DS_Store'
}

function normalizeTemplateRelativePath(path: string): string {
  const validation = validateZipEntryName(path)
  if (!validation.valid) {
    throw new TemplateImportError(`Invalid file name: ${validation.error}`)
  }

  const normalized = posix.normalize(path.replace(/\\/g, '/').trim())
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized === '..') {
    throw new TemplateImportError(`Invalid file name: ${path}`)
  }

  const parts = normalized.split('/')
  if (parts.some((part) => part.length === 0 || part === '.' || part === '..')) {
    throw new TemplateImportError(`Invalid file name: ${path}`)
  }

  if (parts.some((part) => part.startsWith('.'))) {
    throw new TemplateImportError(`Invalid file name (hidden path segment): ${path}`)
  }

  return normalized
}

function normalizeTemplateFiles(filesInput: Record<string, unknown>): Record<string, string> {
  const normalizedFiles: Record<string, string> = {}
  let totalSize = 0

  const entries = Object.entries(filesInput)
    .filter(([fileName]) => !isIgnoredNoisePath(fileName))
    .sort(([left], [right]) => left.localeCompare(right))

  if (entries.length > MAX_FILES) {
    throw new TemplateImportError(`Too many files: ${entries.length} (max ${MAX_FILES})`)
  }

  for (const [fileName, rawContent] of entries) {
    const content = typeof rawContent === 'string'
      ? rawContent
      : rawContent === null || rawContent === undefined
        ? ''
        : String(rawContent)

    const normalizedPath = normalizeTemplateRelativePath(fileName)
    const size = Buffer.byteLength(content, 'utf8')

    if (size > MAX_FILE_SIZE) {
      throw new TemplateImportError(
        `File too large: ${normalizedPath} (${size} bytes, max ${MAX_FILE_SIZE})`
      )
    }

    totalSize += size

    if (totalSize > MAX_TOTAL_SIZE) {
      throw new TemplateImportError(
        `Import too large: ${totalSize} bytes (max ${MAX_TOTAL_SIZE})`
      )
    }

    normalizedFiles[normalizedPath] = content
  }

  if (Object.keys(normalizedFiles).length === 0) {
    throw new TemplateImportError('Import does not contain any usable files')
  }

  return normalizedFiles
}

function parseTemplatePayload(rawTemplate: unknown, layout: ImportTemplateLayout): TemplateCandidate {
  if (!isRecord(rawTemplate)) {
    throw new TemplateImportError('Invalid template data: template must be an object')
  }

  const declaredTemplateId = getRequiredString(rawTemplate.templateId, 'templateId')
  const files = rawTemplate.files

  if (!isRecord(files)) {
    throw new TemplateImportError('Invalid template data: files must be an object')
  }

  const normalizedFiles = normalizeTemplateFiles(files)

  return {
    declaredTemplateId,
    name: getOptionalString(rawTemplate.name) ?? declaredTemplateId,
    version: getOptionalString(rawTemplate.version) ?? '1.0.0',
    exportedAt: getOptionalString(rawTemplate.exportedAt),
    files: normalizedFiles,
    expectedId: declaredTemplateId,
    layout,
  }
}

function parseJsonFilePayload(raw: unknown): TemplateCandidate {
  if (!isRecord(raw)) {
    throw new TemplateImportError('Invalid JSON import file: expected an object payload')
  }

  if ('template' in raw) {
    return parseTemplatePayload(raw.template, 'json-file')
  }

  return parseTemplatePayload(raw, 'json-file')
}

function stripFolderPrefix(filePath: string, folder: string): string {
  if (!filePath.startsWith(`${folder}/`)) {
    throw new TemplateImportError(
      `Unsupported ZIP layout: file "${filePath}" is not under top-level folder "${folder}"`
    )
  }

  const stripped = filePath.slice(folder.length + 1)
  if (!stripped) {
    throw new TemplateImportError(`Unsupported ZIP layout: invalid file path "${filePath}"`)
  }

  return stripped
}

function buildTemplateFromEntries(
  entries: ZipFileEntry[],
  options: {
    layout: ImportTemplateLayout
    folderName?: string
    expectedId?: string
  }
): TemplateCandidate {
  const fileMapInput: Record<string, unknown> = {}

  for (const entry of entries) {
    fileMapInput[entry.path] = entry.content
  }

  const files = normalizeTemplateFiles(fileMapInput)
  const declaredTemplateId = options.expectedId ?? options.folderName ?? 'zip-template'

  return {
    declaredTemplateId,
    name: options.folderName ?? declaredTemplateId,
    version: '1.0.0',
    files,
    expectedId: options.expectedId,
    layout: options.layout,
    folderName: options.folderName,
  }
}

function getTopLevelFolder(filePath: string): string | null {
  const idx = filePath.indexOf('/')
  if (idx <= 0) return null
  return filePath.slice(0, idx)
}

function detectZipCandidates(entries: ZipFileEntry[]): TemplateCandidate[] {
  const sortedEntries = [...entries].sort((left, right) => left.path.localeCompare(right.path))

  const rootTemplate = sortedEntries.find((entry) => entry.path === 'template.json')
  const rootFiles = sortedEntries.filter((entry) => !entry.path.includes('/'))

  const topLevelFolders = new Set<string>()
  for (const entry of sortedEntries) {
    const folder = getTopLevelFolder(entry.path)
    if (folder) topLevelFolders.add(folder)
  }

  const sortedFolders = [...topLevelFolders].sort((left, right) => left.localeCompare(right))
  const foldersWithTemplate = sortedFolders.filter((folder) =>
    sortedEntries.some((entry) => entry.path === `${folder}/template.json`)
  )

  if (rootTemplate) {
    if (foldersWithTemplate.length > 0) {
      throw new TemplateImportError(
        'Unsupported ZIP layout: archive mixes root template.json with folder-based templates'
      )
    }

    return [
      buildTemplateFromEntries(sortedEntries, {
        layout: 'zip-root',
      }),
    ]
  }

  if (rootFiles.length > 0) {
    const rootList = rootFiles.map((entry) => entry.path).join(', ')
    throw new TemplateImportError(
      `Unsupported ZIP layout: missing root template.json; found root files (${rootList})`
    )
  }

  if (sortedFolders.length === 0) {
    throw new TemplateImportError('Unsupported ZIP layout: archive is empty')
  }

  if (sortedFolders.length === 1) {
    const [folder] = sortedFolders
    if (!foldersWithTemplate.includes(folder)) {
      throw new TemplateImportError(`Unsupported ZIP layout: missing ${folder}/template.json`)
    }

    const folderEntries = sortedEntries.map((entry) => ({
      ...entry,
      path: stripFolderPrefix(entry.path, folder),
    }))

    return [
      buildTemplateFromEntries(folderEntries, {
        layout: 'zip-folder',
        folderName: folder,
        expectedId: folder,
      }),
    ]
  }

  const missingTemplateFolders = sortedFolders.filter((folder) => !foldersWithTemplate.includes(folder))
  if (missingTemplateFolders.length > 0) {
    throw new TemplateImportError(
      `Unsupported ZIP bundle layout: missing template.json in top-level folder(s): ${missingTemplateFolders.join(', ')}`
    )
  }

  const bundles: TemplateCandidate[] = []
  for (const folder of sortedFolders) {
    const folderEntries = sortedEntries
      .filter((entry) => entry.path.startsWith(`${folder}/`))
      .map((entry) => ({
        ...entry,
        path: stripFolderPrefix(entry.path, folder),
      }))

    bundles.push(
      buildTemplateFromEntries(folderEntries, {
        layout: 'zip-bundle',
        folderName: folder,
        expectedId: folder,
      })
    )
  }

  return bundles
}

async function readZipEntries(file: File): Promise<ZipFileEntry[]> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer())

  const entries: ZipFileEntry[] = []
  let totalSize = 0

  const fileEntries = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .sort((left, right) => left.name.localeCompare(right.name))

  for (const entry of fileEntries) {
    const unsafeOriginalName = (entry as unknown as { unsafeOriginalName?: string }).unsafeOriginalName
    const rawName = unsafeOriginalName ?? entry.name

    if (isIgnoredNoisePath(rawName) || isIgnoredNoisePath(entry.name)) {
      continue
    }

    const rawValidation = validateZipEntryName(rawName)
    if (!rawValidation.valid) {
      throw new TemplateImportError(`Invalid ZIP entry name: ${rawValidation.error}`)
    }

    const safeValidation = validateZipEntryName(entry.name)
    if (!safeValidation.valid) {
      throw new TemplateImportError(`Invalid ZIP entry name: ${safeValidation.error}`)
    }

    const normalizedPath = normalizeTemplateRelativePath(entry.name)
    const bytes = await entry.async('uint8array')
    const size = bytes.byteLength

    if (size > MAX_FILE_SIZE) {
      throw new TemplateImportError(
        `File too large: ${normalizedPath} (${size} bytes, max ${MAX_FILE_SIZE})`
      )
    }

    totalSize += size
    if (totalSize > MAX_TOTAL_SIZE) {
      throw new TemplateImportError(
        `Import too large: ${totalSize} bytes (max ${MAX_TOTAL_SIZE})`
      )
    }

    entries.push({
      path: normalizedPath,
      content: Buffer.from(bytes).toString('utf8'),
      size,
    })
  }

  if (entries.length === 0) {
    throw new TemplateImportError('ZIP archive is empty or contains only ignored files')
  }

  if (entries.length > MAX_FILES) {
    throw new TemplateImportError(`Too many files: ${entries.length} (max ${MAX_FILES})`)
  }

  return entries
}

function getRequiredSources(config: AgentTemplateConfig): string[] {
  if (config.render?.targets) {
    const unique = new Set<string>()
    for (const target of config.render.targets) {
      if (!target.source) continue
      unique.add(target.source)
    }
    return [...unique]
  }

  return ['SOUL.md', 'overlay.md']
}

function parseCandidateConfig(candidate: TemplateCandidate): ParsedTemplateCandidate {
  const templateJson = candidate.files['template.json']
  if (!templateJson) {
    const label = candidate.folderName
      ? `${candidate.folderName}/template.json`
      : 'template.json'

    throw new TemplateImportError(`Invalid template: missing ${label}`)
  }

  let templateConfigRaw: unknown
  try {
    templateConfigRaw = JSON.parse(templateJson)
  } catch {
    throw new TemplateImportError('Invalid template.json: failed to parse JSON')
  }

  const validation = validateTemplateConfig(templateConfigRaw)

  if (!validation.valid) {
    const templateHint = candidate.expectedId ?? candidate.declaredTemplateId
    throw new TemplateImportError(
      `Template validation failed for "${templateHint}"`,
      400,
      {
        templateId: templateHint,
        validationErrors: validation.errors,
        validationWarnings: validation.warnings,
      }
    )
  }

  return {
    candidate,
    configRaw: templateConfigRaw,
    config: templateConfigRaw as AgentTemplateConfig,
    baseValidation: validation,
  }
}

function validateParsedCandidate(parsed: ParsedTemplateCandidate): PreparedTemplateImport {
  const { candidate, configRaw, config, baseValidation } = parsed

  let validation = baseValidation
  if (candidate.expectedId) {
    const expectedValidation = validateTemplateConfig(configRaw, { expectedId: candidate.expectedId })
    if (!expectedValidation.valid) {
      const templateHint = candidate.expectedId ?? candidate.declaredTemplateId
      throw new TemplateImportError(
        `Template validation failed for "${templateHint}"`,
        400,
        {
          templateId: templateHint,
          validationErrors: expectedValidation.errors,
          validationWarnings: expectedValidation.warnings,
        }
      )
    }
    validation = expectedValidation
  }

  const requiredSources = getRequiredSources(config)
  const missingSources = requiredSources.filter((source) => !candidate.files[source])

  if (missingSources.length > 0) {
    throw new TemplateImportError(
      `Template "${config.id}" is missing required source file(s): ${missingSources.join(', ')}`
    )
  }

  return {
    templateId: config.id,
    name: config.name || candidate.name,
    version: config.version || candidate.version,
    exportedAt: candidate.exportedAt,
    files: candidate.files,
    fileCount: Object.keys(candidate.files).length,
    config,
    validation,
    layout: candidate.layout,
    folderName: candidate.folderName,
  }
}

function finalizeBundle(
  source: ImportBundleSource,
  candidates: TemplateCandidate[],
  fileName?: string
): PreparedTemplateImportBundle {
  if (candidates.length === 0) {
    throw new TemplateImportError('Import bundle does not contain any templates')
  }

  const parsedCandidates = candidates.map((candidate) => parseCandidateConfig(candidate))
  const templateIds = parsedCandidates.map((parsed) => parsed.config.id)

  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const id of templateIds) {
    if (seen.has(id)) duplicates.add(id)
    seen.add(id)
  }

  if (duplicates.size > 0) {
    throw new TemplateImportError(
      `Duplicate template ID(s) in bundle: ${[...duplicates].join(', ')}`
    )
  }

  const templates = parsedCandidates.map((parsed) => validateParsedCandidate(parsed))

  return {
    source,
    layout: templates.length > 1 ? 'bundle' : 'single',
    fileName,
    templates,
    templateIds,
    templateCount: templates.length,
  }
}

export function prepareTemplateImportBundleFromJsonBody(body: unknown): {
  bundle: PreparedTemplateImportBundle
  typedConfirmText?: string
} {
  if (!isRecord(body)) {
    throw new TemplateImportError('Invalid JSON body')
  }

  const input = body as JsonImportBody
  const typedConfirmText = getOptionalString(input.typedConfirmText)

  if ('template' in input && input.template !== undefined) {
    const candidate = parseTemplatePayload(input.template, 'json-wrapper')

    return {
      bundle: finalizeBundle('json-body', [candidate]),
      typedConfirmText,
    }
  }

  if ('templates' in input && Array.isArray(input.templates)) {
    if (input.templates.length === 0) {
      throw new TemplateImportError('Invalid template data: templates bundle is empty')
    }

    const candidates = input.templates.map((template, index) => {
      try {
        return parseTemplatePayload(template, 'json-wrapper')
      } catch (err) {
        if (err instanceof TemplateImportError) {
          throw new TemplateImportError(
            `Invalid template bundle entry at index ${index}: ${err.message}`,
            err.status,
            err.details
          )
        }
        throw err
      }
    })

    return {
      bundle: finalizeBundle('json-body', candidates),
      typedConfirmText,
    }
  }

  throw new TemplateImportError('Invalid template data: missing template payload')
}

export async function prepareTemplateImportBundleFromFormData(formData: FormData): Promise<FormDataImportResult> {
  const fileEntry = formData.get('file')
  const typedConfirmEntry = formData.get('typedConfirmText')

  const typedConfirmText = typeof typedConfirmEntry === 'string'
    ? getOptionalString(typedConfirmEntry)
    : undefined

  if (!(fileEntry instanceof File)) {
    throw new TemplateImportError('Import file is required')
  }

  const lowerName = fileEntry.name.toLowerCase()

  if (lowerName.endsWith('.zip')) {
    const entries = await readZipEntries(fileEntry)
    const candidates = detectZipCandidates(entries)

    return {
      bundle: finalizeBundle('zip-file', candidates, fileEntry.name),
      typedConfirmText,
    }
  }

  if (lowerName.endsWith('.json')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(await fileEntry.text())
    } catch {
      throw new TemplateImportError('Invalid JSON import file: failed to parse JSON')
    }

    const candidate = parseJsonFilePayload(parsed)

    return {
      bundle: finalizeBundle('json-file', [candidate], fileEntry.name),
      typedConfirmText,
    }
  }

  throw new TemplateImportError('Unsupported file type. Upload .zip, .json, or .template.json')
}
