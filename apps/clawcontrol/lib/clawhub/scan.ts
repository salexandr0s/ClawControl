import 'server-only'

import type { ClawHubAdapter } from './adapter'
import type { ClawHubModeration, ClawHubSkillDetailResponse, ClawHubSkillVersionResponse } from './types'

export type ScanWarningSeverity = 'info' | 'warning' | 'danger'

export interface LocalScanWarning {
  code: string
  severity: ScanWarningSeverity
  message: string
}

export interface LocalScanResult {
  blocked: boolean
  moderation: ClawHubModeration | null
  warnings: LocalScanWarning[]
  stats: {
    fileCount: number
    totalBytes: number
  }
}

const MAX_FILES_WARN = 200
const MAX_TOTAL_BYTES_WARN = 10 * 1024 * 1024

const RISKY_SUFFIXES = ['.sh', '.ps1', '.bat', '.cmd', '.exe', '.dylib', '.so'] as const

export async function scanClawHubSkillVersion(params: {
  adapter: ClawHubAdapter
  slug: string
  version: string
  skillDetail?: ClawHubSkillDetailResponse
  versionDetail?: ClawHubSkillVersionResponse
}): Promise<LocalScanResult> {
  const { adapter } = params
  const slug = params.slug.trim().toLowerCase()
  const version = params.version.trim()

  const [detail, versionResp] = await Promise.all([
    params.skillDetail ?? adapter.getSkill(slug),
    params.versionDetail ?? adapter.getSkillVersion(slug, version),
  ])

  const moderation = detail.moderation ?? null
  const warnings: LocalScanWarning[] = []

  if (moderation?.isMalwareBlocked) {
    warnings.push({
      code: 'CLAWHUB_MALWARE_BLOCKED',
      severity: 'danger',
      message: 'ClawHub has blocked this skill as malware.',
    })
  } else if (moderation?.isSuspicious) {
    warnings.push({
      code: 'CLAWHUB_SUSPICIOUS',
      severity: 'warning',
      message: 'ClawHub has marked this skill as suspicious.',
    })
  }

  const files = Array.isArray(versionResp.version.files) ? versionResp.version.files : []

  let totalBytes = 0
  for (const f of files) {
    totalBytes += typeof f.size === 'number' ? f.size : 0
  }

  if (files.length > MAX_FILES_WARN) {
    warnings.push({
      code: 'ZIP_MANY_FILES',
      severity: 'warning',
      message: `Large bundle: ${files.length} files.`,
    })
  }

  if (totalBytes > MAX_TOTAL_BYTES_WARN) {
    warnings.push({
      code: 'ZIP_LARGE_TOTAL',
      severity: 'warning',
      message: `Large bundle: ${Math.round(totalBytes / (1024 * 1024))}MB.`,
    })
  }

  const hasHooks = files.some((f) => f.path.startsWith('hooks/'))
  if (hasHooks) {
    warnings.push({
      code: 'HAS_HOOKS',
      severity: 'warning',
      message: 'Bundle contains hooks/ (may run on certain runtimes).',
    })
  }

  const hasDotGit = files.some((f) => f.path === '.git' || f.path.startsWith('.git/'))
  const hasDotSsh = files.some((f) => f.path === '.ssh' || f.path.startsWith('.ssh/'))
  const hasEnvLike = files.some((f) => f.path === '.env' || f.path.endsWith('/.env'))
  if (hasDotGit || hasDotSsh || hasEnvLike) {
    warnings.push({
      code: 'DOTFILES_PRESENT',
      severity: 'warning',
      message: 'Bundle contains sensitive dotfiles (.git/.ssh/.env).',
    })
  }

  const riskyMatches: string[] = []
  for (const f of files) {
    const lower = f.path.toLowerCase()
    for (const suffix of RISKY_SUFFIXES) {
      if (lower.endsWith(suffix)) {
        riskyMatches.push(suffix)
        break
      }
    }
  }

  if (riskyMatches.length > 0) {
    const uniq = Array.from(new Set(riskyMatches)).sort()
    warnings.push({
      code: 'RISKY_FILES_PRESENT',
      severity: 'warning',
      message: `Bundle contains executable/script files (${uniq.join(', ')}).`,
    })
  }

  // Optional package.json scripts warning
  const hasPackageJson = files.some((f) => f.path === 'package.json')
  if (hasPackageJson) {
    try {
      const pkg = await adapter.getFile(slug, version, 'package.json')
      const text = new TextDecoder('utf-8', { fatal: false }).decode(pkg.bytes)
      const parsed = JSON.parse(text) as { scripts?: Record<string, unknown> }
      const scripts = parsed?.scripts && typeof parsed.scripts === 'object' ? parsed.scripts : null

      if (scripts) {
        const scriptKeys = ['preinstall', 'install', 'postinstall', 'prepare'] as const
        const present = scriptKeys.filter((k) => typeof (scripts as Record<string, unknown>)[k] === 'string' && String((scripts as Record<string, unknown>)[k]).trim())
        if (present.length > 0) {
          warnings.push({
            code: 'PACKAGE_JSON_INSTALL_SCRIPTS',
            severity: 'danger',
            message: `package.json contains install scripts: ${present.join(', ')}.`,
          })
        }
      }
    } catch {
      warnings.push({
        code: 'PACKAGE_JSON_UNREADABLE',
        severity: 'info',
        message: 'package.json could not be inspected.',
      })
    }
  }

  return {
    blocked: Boolean(moderation?.isMalwareBlocked),
    moderation,
    warnings,
    stats: {
      fileCount: files.length,
      totalBytes,
    },
  }
}

