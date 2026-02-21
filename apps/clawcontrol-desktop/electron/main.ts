import { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage, shell } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { ensurePackagedDatabaseSchema } from './schema-bootstrap'
import { getAssetPath, isDev } from './utils'
import { buildWhatsNewPayload, type WhatsNewPayload } from './whats-new'

let mainWindow: BrowserWindow | null = null
let serverProcess: ChildProcess | null = null
let didSpawnServer = false
let startInFlight: Promise<void> | null = null

const SERVER_HOST = '127.0.0.1'
const SERVER_PORT = 3000
const SERVER_URL = `http://${SERVER_HOST}:${SERVER_PORT}`
const SERVER_PROBE_URL = `${SERVER_URL}/api/workspace?path=/`
const SERVER_CHECK_INTERVAL_MS = 500
const SERVER_START_TIMEOUT_MS = 30_000
const SERVER_STOP_TIMEOUT_MS = 10_000
const PICK_DIRECTORY_CHANNEL = 'clawcontrol:pick-directory'
const RESTART_SERVER_CHANNEL = 'clawcontrol:restart-server'
const GET_SETTINGS_CHANNEL = 'clawcontrol:get-settings'
const SAVE_SETTINGS_CHANNEL = 'clawcontrol:save-settings'
const GET_INIT_STATUS_CHANNEL = 'clawcontrol:get-init-status'
const TEST_GATEWAY_CHANNEL = 'clawcontrol:test-gateway'
const RUN_MODEL_AUTH_LOGIN_CHANNEL = 'clawcontrol:run-model-auth-login'
const CHECK_FOR_UPDATES_CHANNEL = 'clawcontrol:check-for-updates'
const OPEN_EXTERNAL_URL_CHANNEL = 'clawcontrol:open-external-url'
const GET_WHATS_NEW_CHANNEL = 'clawcontrol:get-whats-new'
const ACK_WHATS_NEW_CHANNEL = 'clawcontrol:ack-whats-new'
const GITHUB_REPOSITORY = 'salexandr0s/ClawControl'
const GITHUB_API_RELEASES_BASE = `https://api.github.com/repos/${GITHUB_REPOSITORY}/releases`
const DEFAULT_RELEASE_PAGE_URL = `https://github.com/${GITHUB_REPOSITORY}/releases`
const RELEASE_NOTES_MAX_LENGTH = 1600
// Add a custom startup logo under apps/clawcontrol-desktop/assets using one of these names.
const LOADING_LOGO_FILES = [
  'loading-logo.gif',
  'loading-logo.webp',
  'loading-logo.apng',
  'loading-logo.png',
  'icon.png',
] as const

interface ServerRestartResponse {
  ok: boolean
  message: string
}

interface RunModelAuthLoginResponse {
  ok: boolean
  message?: string
}

interface DesktopSettings {
  gatewayHttpUrl?: string
  gatewayWsUrl?: string
  gatewayToken?: string
  workspacePath?: string
  setupCompleted?: boolean
  updatedAt?: string
}

interface DesktopUpdateState {
  lastSeenVersion?: string
  updatedAt?: string
}

interface GithubReleaseResponse {
  tag_name?: string
  html_url?: string
  name?: string
  body?: string
  published_at?: string
}

interface DesktopUpdateInfo {
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  releaseUrl: string
  releaseName: string | null
  publishedAt: string | null
  notes: string | null
  error?: string
}

let pendingWhatsNew: WhatsNewPayload | null = null

interface OpenExternalUrlResponse {
  ok: boolean
  message?: string
}

function isBrokenPipeError(error: unknown): error is NodeJS.ErrnoException {
  if (!(error instanceof Error)) return false
  const maybeErrno = error as NodeJS.ErrnoException
  return maybeErrno.code === 'EPIPE' || maybeErrno.code === 'ERR_STREAM_DESTROYED'
}

function getDesktopUpdateStatePath(): string {
  return path.join(app.getPath('userData'), 'desktop-updates.json')
}

function normalizeVersionInput(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.replace(/^v/i, '')
}

function parseSemver(value: string): {
  major: number
  minor: number
  patch: number
  prerelease: string | null
} | null {
  const normalized = normalizeVersionInput(value)
  if (!normalized) return null
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/)
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  }
}

function compareVersions(a: string, b: string): number {
  const aParsed = parseSemver(a)
  const bParsed = parseSemver(b)

  if (!aParsed || !bParsed) {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  }

  if (aParsed.major !== bParsed.major) return aParsed.major - bParsed.major
  if (aParsed.minor !== bParsed.minor) return aParsed.minor - bParsed.minor
  if (aParsed.patch !== bParsed.patch) return aParsed.patch - bParsed.patch

  if (aParsed.prerelease === bParsed.prerelease) return 0
  if (aParsed.prerelease === null) return 1
  if (bParsed.prerelease === null) return -1
  return aParsed.prerelease.localeCompare(bParsed.prerelease, undefined, {
    numeric: true,
    sensitivity: 'base',
  })
}

function sanitizeReleaseNotes(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null
  const cleaned = input
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (!cleaned) return null
  if (cleaned.length <= RELEASE_NOTES_MAX_LENGTH) return cleaned
  return `${cleaned.slice(0, RELEASE_NOTES_MAX_LENGTH)}…`
}

function isTrustedGithubReleaseUrl(rawUrl: string | null | undefined): boolean {
  if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) return false

  try {
    const parsed = new URL(rawUrl)
    const host = parsed.hostname.toLowerCase()
    return parsed.protocol === 'https:' && (host === 'github.com' || host === 'www.github.com')
  } catch {
    return false
  }
}

function readDesktopUpdateState(): DesktopUpdateState {
  const statePath = getDesktopUpdateStatePath()
  if (!fs.existsSync(statePath)) return {}

  try {
    const raw = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Record<string, unknown>
    return {
      ...(typeof raw.lastSeenVersion === 'string' && raw.lastSeenVersion.trim().length > 0
        ? { lastSeenVersion: raw.lastSeenVersion.trim() }
        : {}),
      ...(typeof raw.updatedAt === 'string' && raw.updatedAt.trim().length > 0
        ? { updatedAt: raw.updatedAt.trim() }
        : {}),
    }
  } catch {
    return {}
  }
}

function writeDesktopUpdateState(next: DesktopUpdateState): void {
  const statePath = getDesktopUpdateStatePath()
  const payload = {
    ...(next.lastSeenVersion ? { lastSeenVersion: next.lastSeenVersion } : {}),
    updatedAt: new Date().toISOString(),
  }

  fs.mkdirSync(path.dirname(statePath), { recursive: true })
  fs.writeFileSync(statePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

async function fetchGitHubRelease(pathname: string): Promise<GithubReleaseResponse | null> {
  try {
    const response = await fetch(`${GITHUB_API_RELEASES_BASE}/${pathname}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'ClawControl Desktop',
      },
    })

    if (!response.ok) return null
    const json = (await response.json()) as GithubReleaseResponse
    return json
  } catch {
    return null
  }
}

async function getDesktopUpdateInfo(): Promise<DesktopUpdateInfo> {
  const currentVersion = app.getVersion()
  const latestRelease = await fetchGitHubRelease('latest')

  if (!latestRelease) {
    return {
      currentVersion,
      latestVersion: null,
      updateAvailable: false,
      releaseUrl: DEFAULT_RELEASE_PAGE_URL,
      releaseName: null,
      publishedAt: null,
      notes: null,
      error: 'Unable to fetch latest release metadata.',
    }
  }

  const latestVersion = normalizeVersionInput(latestRelease.tag_name)
  const updateAvailable = Boolean(
    latestVersion
    && compareVersions(latestVersion, currentVersion) > 0
  )

  return {
    currentVersion,
    latestVersion,
    updateAvailable,
    releaseUrl: isTrustedGithubReleaseUrl(latestRelease.html_url)
      ? (latestRelease.html_url as string)
      : DEFAULT_RELEASE_PAGE_URL,
    releaseName: typeof latestRelease.name === 'string' && latestRelease.name.trim().length > 0
      ? latestRelease.name.trim()
      : null,
    publishedAt: typeof latestRelease.published_at === 'string' ? latestRelease.published_at : null,
    notes: sanitizeReleaseNotes(latestRelease.body),
  }
}

async function maybeShowWhatsNew(): Promise<void> {
  const currentVersion = app.getVersion()
  const state = readDesktopUpdateState()
  const lastSeenVersion = normalizeVersionInput(state.lastSeenVersion)

  if (!lastSeenVersion) {
    writeDesktopUpdateState({ lastSeenVersion: currentVersion })
    return
  }

  if (compareVersions(currentVersion, lastSeenVersion) <= 0) return

  const release = await fetchGitHubRelease(`tags/v${currentVersion}`)
  const releaseTitle = typeof release?.name === 'string' && release.name.trim().length > 0
    ? release.name.trim()
    : `ClawControl v${currentVersion}`
  const releaseUrl = isTrustedGithubReleaseUrl(release?.html_url)
    ? (release?.html_url as string)
    : DEFAULT_RELEASE_PAGE_URL

  pendingWhatsNew = buildWhatsNewPayload({
    version: currentVersion,
    title: releaseTitle,
    publishedAt: typeof release?.published_at === 'string' ? release.published_at : null,
    body: release?.body,
    releaseUrl,
  })
}

function installStdIoGuards(): void {
  const onStdIoError = (error: Error) => {
    if (isBrokenPipeError(error)) return
    // Re-throw unexpected stream errors to preserve fail-fast behavior.
    process.nextTick(() => {
      throw error
    })
  }

  process.stdout?.on('error', onStdIoError)
  process.stderr?.on('error', onStdIoError)
}

function createAppMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools', visible: isDev() },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'About ClawControl',
          click: () => {
            app.showAboutPanel()
          },
        },
      ],
    },
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

function createMainWindow(): BrowserWindow {
  const preloadPath = path.join(__dirname, 'preload.js')
  const windowIcon = process.platform === 'win32'
    ? getAssetPath('icon.ico')
    : getAssetPath('icon.png')

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: windowIcon,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath,
    },
  })

  win.loadURL(SERVER_URL)

  win.once('ready-to-show', () => {
    win.show()
  })

  win.on('closed', () => {
    mainWindow = null
  })

  mainWindow = win
  return win
}

function getImageMimeType(assetPath: string): string | null {
  const extension = path.extname(assetPath).toLowerCase()
  if (extension === '.gif') return 'image/gif'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.apng') return 'image/apng'
  if (extension === '.png') return 'image/png'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.svg') return 'image/svg+xml'
  return null
}

function getFallbackLoadingLogoDataUrl(): string {
  const fallback = `
    <svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96" fill="none">
      <defs>
        <linearGradient id="g" x1="16" y1="14" x2="80" y2="84" gradientUnits="userSpaceOnUse">
          <stop stop-color="#5AA2FF" />
          <stop offset="1" stop-color="#1D4ED8" />
        </linearGradient>
      </defs>
      <rect x="8" y="8" width="80" height="80" rx="24" fill="#0B111B" stroke="#1F2937" />
      <path d="M29 29H57V39H39V57H29V29Z" fill="url(#g)" />
      <circle cx="61" cy="61" r="10" fill="url(#g)" />
    </svg>
  `
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(fallback)}`
}

function getLoadingLogoDataUrl(): string {
  for (const fileName of LOADING_LOGO_FILES) {
    const assetPath = getAssetPath(fileName)
    if (!fs.existsSync(assetPath)) continue

    if (fileName === 'icon.png') {
      const icon = nativeImage.createFromPath(assetPath)
      if (!icon.isEmpty()) {
        return icon.resize({ width: 96, height: 96, quality: 'best' }).toDataURL()
      }
      continue
    }

    const mimeType = getImageMimeType(assetPath)
    if (!mimeType) continue
    const content = fs.readFileSync(assetPath)
    return `data:${mimeType};base64,${content.toString('base64')}`
  }

  return getFallbackLoadingLogoDataUrl()
}

function createLoadingWindow(): BrowserWindow {
  const logoUrl = getLoadingLogoDataUrl()

  const win = new BrowserWindow({
    width: 420,
    height: 320,
    frame: false,
    resizable: false,
    transparent: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })

  const html = `
    <html>
      <head>
        <meta charset="utf-8" />
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';" />
        <style>
          body {
            margin: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            background: rgba(11, 15, 20, 0.98);
            color: #E4E7EB;
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            flex-direction: column;
            gap: 16px;
            user-select: none;
          }
          .logo {
            width: 96px;
            height: 96px;
            object-fit: contain;
          }
          .spinner {
            width: 40px;
            height: 40px;
            border: 3px solid #1E2530;
            border-top-color: #3B82F6;
            border-radius: 50%;
            animation: spin 1s linear infinite;
          }
          @keyframes spin { to { transform: rotate(360deg); } }
          .text { font-size: 14px; opacity: 0.75; }
        </style>
      </head>
      <body>
        <img class="logo" src="${logoUrl}" alt="ClawControl logo" />
        <div class="spinner"></div>
        <div class="text">Starting ClawControl…</div>
      </body>
    </html>
  `

  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  win.once('ready-to-show', () => win.show())
  return win
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function probeServer(): Promise<{ reachable: boolean; statusCode?: number }> {
  return new Promise((resolve) => {
    const req = http.get(SERVER_PROBE_URL, (res) => {
      res.resume()
      resolve({ reachable: true, statusCode: res.statusCode })
    })
    req.on('error', () => resolve({ reachable: false }))
    req.setTimeout(1000, () => {
      req.destroy()
      resolve({ reachable: false })
    })
  })
}

async function isClawControlServerRunning(): Promise<boolean> {
  const { reachable, statusCode } = await probeServer()
  if (!reachable) return false
  return statusCode !== 404 && statusCode !== undefined
}

async function isPortInUseByOtherService(): Promise<boolean> {
  const { reachable, statusCode } = await probeServer()
  return reachable && statusCode === 404
}

async function waitForServer(timeoutMs: number = SERVER_START_TIMEOUT_MS): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await isClawControlServerRunning()) return true
    await sleep(SERVER_CHECK_INTERVAL_MS)
  }
  return false
}

async function waitForServerStop(timeoutMs: number = SERVER_STOP_TIMEOUT_MS): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const { reachable } = await probeServer()
    if (!reachable) return true
    await sleep(SERVER_CHECK_INTERVAL_MS)
  }
  return false
}

function getDevClawControlDir(): string {
  const repoRoot = path.resolve(__dirname, '../../..')
  const dir = path.join(repoRoot, 'apps', 'clawcontrol')
  return dir
}

function getPackagedServerDir(): string {
  return path.join(process.resourcesPath, 'server')
}

function getDesktopSettingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

function getPnpmBinDirs(): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || ''
  const fromEnv = process.env.PNPM_HOME?.trim() || null
  const candidates = [
    fromEnv,
    home ? path.join(home, 'Library', 'pnpm') : null,
    home ? path.join(home, '.local', 'share', 'pnpm') : null,
    home ? path.join(home, '.pnpm') : null,
  ].filter((value): value is string => Boolean(value))

  const deduped: string[] = []
  for (const candidate of candidates) {
    if (!deduped.includes(candidate)) deduped.push(candidate)
  }

  return deduped
}

function buildServerPath(basePath: string | undefined): string {
  const separator = process.platform === 'win32' ? ';' : ':'
  const existing = (basePath ?? '').split(separator).filter((entry) => entry.length > 0)
  const extra = [
    ...getPnpmBinDirs(),
    ...(
    process.platform === 'darwin'
      ? ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']
      : ['/usr/local/bin', '/usr/bin', '/bin']
    ),
  ]

  for (const candidate of extra) {
    if (!existing.includes(candidate)) {
      existing.push(candidate)
    }
  }

  return existing.join(separator)
}

function resolveOpenClawBin(pathValue: string): string | null {
  const binaryName = process.platform === 'win32' ? 'openclaw.exe' : 'openclaw'
  const candidates = [
    process.env.OPENCLAW_BIN,
    ...getPnpmBinDirs().map((dir) => path.join(dir, binaryName)),
    ...pathValue
      .split(process.platform === 'win32' ? ';' : ':')
      .filter((segment) => segment.length > 0)
      .map((segment) => path.join(segment, binaryName)),
    '/opt/homebrew/bin/openclaw',
    '/usr/local/bin/openclaw',
  ]

  for (const candidate of candidates) {
    if (!candidate) continue
    if (fs.existsSync(candidate)) return candidate
  }

  return null
}

function resolveBinaryInPath(binaryName: string, pathValue: string): string | null {
  const separator = process.platform === 'win32' ? ';' : ':'
  const candidates = pathValue
    .split(separator)
    .filter((segment) => segment.length > 0)
    .map((segment) => path.join(segment, process.platform === 'win32' ? `${binaryName}.exe` : binaryName))

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }

  return null
}

function escapeForAppleScript(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function quoteForPosixShell(input: string): string {
  if (/^[a-zA-Z0-9_./:-]+$/.test(input)) return input
  return `'${input.replace(/'/g, `'\\''`)}'`
}

function parseProviderId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const providerId = value.trim()
  if (!providerId) return null
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(providerId)) return null
  return providerId
}

function launchDetached(command: string, args: string[]): RunModelAuthLoginResponse {
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.unref()
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Failed to launch terminal command.',
    }
  }
}

function runModelAuthLoginInTerminal(providerId: string): RunModelAuthLoginResponse {
  const pathValue = buildServerPath(process.env.PATH)
  const openClawBin = resolveOpenClawBin(pathValue)

  if (!openClawBin) {
    return {
      ok: false,
      message: 'OpenClaw CLI was not found on PATH.',
    }
  }

  if (process.platform === 'win32') {
    const command = `"${openClawBin}" models auth login --provider ${providerId}`
    const result = launchDetached('cmd.exe', ['/c', 'start', '', 'cmd', '/k', command])
    return result.ok
      ? { ok: true, message: 'Opened terminal for OAuth login.' }
      : result
  }

  const posixCommand = `${quoteForPosixShell(openClawBin)} models auth login --provider ${providerId}`

  if (process.platform === 'darwin') {
    const script = [
      'tell application "Terminal"',
      'activate',
      `do script "${escapeForAppleScript(posixCommand)}"`,
      'end tell',
    ].join('\n')

    const result = launchDetached('osascript', ['-e', script])
    return result.ok
      ? { ok: true, message: 'Opened Terminal for OAuth login.' }
      : result
  }

  const linuxTerminalCandidates: Array<{ bin: string; args: string[] }> = [
    { bin: 'x-terminal-emulator', args: ['-e', 'bash', '-lc', `${posixCommand}; exec bash`] },
    { bin: 'gnome-terminal', args: ['--', 'bash', '-lc', `${posixCommand}; exec bash`] },
    { bin: 'konsole', args: ['-e', 'bash', '-lc', `${posixCommand}; exec bash`] },
    { bin: 'xfce4-terminal', args: ['-e', `bash -lc "${posixCommand}; exec bash"`] },
    { bin: 'xterm', args: ['-e', 'bash', '-lc', `${posixCommand}; exec bash`] },
  ]

  for (const candidate of linuxTerminalCandidates) {
    const binaryPath = resolveBinaryInPath(candidate.bin, pathValue)
    if (!binaryPath) continue
    const result = launchDetached(binaryPath, candidate.args)
    if (result.ok) {
      return { ok: true, message: 'Opened terminal for OAuth login.' }
    }
  }

  return {
    ok: false,
    message: 'No supported terminal app was found to run the OAuth command.',
  }
}

function normalizeSettingsString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function readDesktopSettings(): DesktopSettings {
  const settingsPath = getDesktopSettingsPath()
  if (!fs.existsSync(settingsPath)) return {}

  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Record<string, unknown>
    return {
      ...(normalizeSettingsString(raw.gatewayHttpUrl) ? { gatewayHttpUrl: normalizeSettingsString(raw.gatewayHttpUrl) ?? undefined } : {}),
      ...(normalizeSettingsString(raw.gatewayWsUrl) ? { gatewayWsUrl: normalizeSettingsString(raw.gatewayWsUrl) ?? undefined } : {}),
      ...(normalizeSettingsString(raw.gatewayToken) ? { gatewayToken: normalizeSettingsString(raw.gatewayToken) ?? undefined } : {}),
      ...(normalizeSettingsString(raw.workspacePath) ? { workspacePath: normalizeSettingsString(raw.workspacePath) ?? undefined } : {}),
      ...(typeof raw.setupCompleted === 'boolean' ? { setupCompleted: raw.setupCompleted } : {}),
      ...(normalizeSettingsString(raw.updatedAt) ? { updatedAt: normalizeSettingsString(raw.updatedAt) ?? undefined } : {}),
    }
  } catch {
    return {}
  }
}

async function callServerJson(pathname: string, init?: RequestInit): Promise<unknown> {
  const url = `${SERVER_URL}${pathname.startsWith('/') ? pathname : `/${pathname}`}`
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.headers ? init.headers : {}),
    },
  })

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    const error = payload && typeof payload === 'object' && 'error' in payload
      ? String((payload as { error?: unknown }).error)
      : `HTTP ${response.status}`
    throw new Error(error)
  }

  return payload
}

async function spawnServer(): Promise<ChildProcess> {
  if (app.isPackaged) {
    const serverDir = getPackagedServerDir()
    const entryCandidates = [
      path.join(serverDir, 'server.js'),
      path.join(serverDir, 'apps', 'clawcontrol', 'server.js'),
    ]

    const entry = entryCandidates.find((p) => fs.existsSync(p)) ?? null

    if (!entry) {
      throw new Error('Packaged server not found (expected server bundle under resources/server)')
    }

    const cwd = path.dirname(entry)
    const userDataDir = app.getPath('userData')
    const settingsPath = getDesktopSettingsPath()
    const settings = readDesktopSettings()
    const workspaceRoot = settings.workspacePath || path.join(userDataDir, 'workspace')
    const databasePath = path.join(userDataDir, 'clawcontrol.db')
    const migrationsDir = path.join(serverDir, 'apps', 'clawcontrol', 'prisma', 'migrations')
    const serverPath = buildServerPath(process.env.PATH)
    const openClawBin = resolveOpenClawBin(serverPath)

    fs.mkdirSync(workspaceRoot, { recursive: true })
    await ensurePackagedDatabaseSchema(serverDir, databasePath)

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      HOST: SERVER_HOST,
      HOSTNAME: SERVER_HOST,
      PORT: String(SERVER_PORT),
      OPENCLAW_WORKSPACE: workspaceRoot,
      CLAWCONTROL_WORKSPACE_ROOT: workspaceRoot,
      CLAWCONTROL_USER_DATA_DIR: userDataDir,
      CLAWCONTROL_SETTINGS_PATH: settingsPath,
      CLAWCONTROL_MIGRATIONS_DIR: migrationsDir,
      DATABASE_URL: `file:${databasePath}`,
      PATH: serverPath,
    }

    if (openClawBin) {
      env.OPENCLAW_BIN = openClawBin
    }

    if (settings.gatewayHttpUrl) {
      env.OPENCLAW_GATEWAY_HTTP_URL = settings.gatewayHttpUrl
    }
    if (settings.gatewayWsUrl) {
      env.OPENCLAW_GATEWAY_WS_URL = settings.gatewayWsUrl
    }
    if (settings.gatewayToken) {
      env.OPENCLAW_GATEWAY_TOKEN = settings.gatewayToken
    }

    const proc = spawn(process.execPath, [entry], {
      cwd,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    })

    proc.stdout?.on('data', (data) => console.log(`[server] ${data.toString().trim()}`))
    proc.stderr?.on('data', (data) => console.error(`[server:err] ${data.toString().trim()}`))

    proc.on('exit', (code, signal) => {
      console.log(`[server] Exited (code=${code ?? 'null'} signal=${signal ?? 'null'})`)
      serverProcess = null
      didSpawnServer = false
    })

    return proc
  }

  const clawcontrolDir = getDevClawControlDir()
  if (!fs.existsSync(path.join(clawcontrolDir, 'package.json'))) {
    throw new Error(`clawcontrol app not found at ${clawcontrolDir}`)
  }

  const script = isDev() ? 'dev' : 'start'
  const userDataDir = app.getPath('userData')
  const settingsPath = getDesktopSettingsPath()
  const settings = readDesktopSettings()
  const workspaceRoot = settings.workspacePath || path.join(userDataDir, 'workspace')
  const serverPath = buildServerPath(process.env.PATH)
  const openClawBin = resolveOpenClawBin(serverPath)

  fs.mkdirSync(workspaceRoot, { recursive: true })

  const proc = spawn('npm', ['--prefix', clawcontrolDir, 'run', script], {
    cwd: clawcontrolDir,
    shell: process.platform === 'win32',
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      HOST: SERVER_HOST,
      HOSTNAME: SERVER_HOST,
      PORT: String(SERVER_PORT),
      OPENCLAW_WORKSPACE: workspaceRoot,
      CLAWCONTROL_WORKSPACE_ROOT: workspaceRoot,
      CLAWCONTROL_USER_DATA_DIR: userDataDir,
      CLAWCONTROL_SETTINGS_PATH: settingsPath,
      PATH: serverPath,
      ...(openClawBin ? { OPENCLAW_BIN: openClawBin } : {}),
      ...(settings.gatewayHttpUrl ? { OPENCLAW_GATEWAY_HTTP_URL: settings.gatewayHttpUrl } : {}),
      ...(settings.gatewayWsUrl ? { OPENCLAW_GATEWAY_WS_URL: settings.gatewayWsUrl } : {}),
      ...(settings.gatewayToken ? { OPENCLAW_GATEWAY_TOKEN: settings.gatewayToken } : {}),
    },
  })

  proc.stdout?.on('data', (data) => console.log(`[server] ${data.toString().trim()}`))
  proc.stderr?.on('data', (data) => console.error(`[server:err] ${data.toString().trim()}`))

  proc.on('exit', (code, signal) => {
    console.log(`[server] Exited (code=${code ?? 'null'} signal=${signal ?? 'null'})`)
    serverProcess = null
    didSpawnServer = false
  })

  return proc
}

function stopServer(): void {
  if (!didSpawnServer || !serverProcess?.pid) return

  const pid = serverProcess.pid
  console.log(`[server] Stopping (pid=${pid})…`)

  try {
    if (process.platform !== 'win32') {
      process.kill(-pid, 'SIGTERM')
    } else {
      serverProcess.kill('SIGTERM')
    }
  } catch (err) {
    console.warn('[server] Failed to send SIGTERM:', err)
  }

  const proc = serverProcess
  serverProcess = null
  didSpawnServer = false

  setTimeout(() => {
    if (proc.killed) return
    try {
      if (process.platform !== 'win32' && pid) {
        process.kill(-pid, 'SIGKILL')
      } else {
        proc.kill('SIGKILL')
      }
    } catch {
      // ignore
    }
  }, 5000)
}

async function restartManagedServer(): Promise<ServerRestartResponse> {
  if (startInFlight) {
    await startInFlight
  }

  if (!didSpawnServer || !serverProcess?.pid) {
    return {
      ok: false,
      message: 'Saved configuration, but this server is externally managed. Restart it manually to apply workspace changes.',
    }
  }

  stopServer()

  const stopped = await waitForServerStop()
  if (!stopped) {
    return {
      ok: false,
      message: 'Saved configuration, but timed out while stopping the server. Restart manually.',
    }
  }

  if (await isPortInUseByOtherService()) {
    return {
      ok: false,
      message: `Saved configuration, but port ${SERVER_PORT} is now occupied by another service.`,
    }
  }

  try {
    serverProcess = await spawnServer()
    didSpawnServer = true
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error
        ? `Saved configuration, but failed to restart server: ${err.message}`
        : 'Saved configuration, but failed to restart server.',
    }
  }

  const ready = await waitForServer()
  if (!ready) {
    stopServer()
    return {
      ok: false,
      message: `Saved configuration, but server did not become ready within ${Math.round(SERVER_START_TIMEOUT_MS / 1000)} seconds.`,
    }
  }

  return {
    ok: true,
    message: 'Configuration saved and server restarted.',
  }
}

async function startApp(): Promise<void> {
  if (startInFlight) return startInFlight

  startInFlight = (async () => {
    const alreadyRunning = await isClawControlServerRunning()
    if (alreadyRunning) {
      createMainWindow()
      void maybeShowWhatsNew()
      return
    }

    if (await isPortInUseByOtherService()) {
      dialog.showErrorBox(
        'ClawControl cannot start',
        `Port ${SERVER_PORT} is already in use by another service.\n\nQuit the other process or configure it to use a different port, then relaunch ClawControl.`
      )
      app.quit()
      return
    }

    const loadingWindow = createLoadingWindow()

    try {
      serverProcess = await spawnServer()
      didSpawnServer = true
    } catch (err) {
      loadingWindow.close()
      dialog.showErrorBox(
        'Failed to start server',
        err instanceof Error ? err.message : String(err)
      )
      app.quit()
      return
    }

    const ready = await waitForServer()
    loadingWindow.close()

    if (!ready) {
      dialog.showErrorBox(
        'Server startup timeout',
        `ClawControl server did not become ready within ${Math.round(SERVER_START_TIMEOUT_MS / 1000)} seconds.`
      )
      stopServer()
      app.quit()
      return
    }

    createMainWindow()
    void maybeShowWhatsNew()
  })().finally(() => {
    startInFlight = null
  })

  return startInFlight
}

installStdIoGuards()

ipcMain.handle(PICK_DIRECTORY_CHANNEL, async (_event, payload?: { defaultPath?: string }) => {
  const options: Electron.OpenDialogOptions = {
    title: 'Select OpenClaw Workspace',
    properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
    defaultPath: payload?.defaultPath,
    buttonLabel: 'Select',
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)

  return {
    canceled: result.canceled,
    path: result.canceled ? null : (result.filePaths[0] ?? null),
  }
})

ipcMain.handle(RESTART_SERVER_CHANNEL, async (): Promise<ServerRestartResponse> => {
  try {
    return await restartManagedServer()
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error
        ? `Saved configuration, but restart failed: ${err.message}`
        : 'Saved configuration, but restart failed.',
    }
  }
})

ipcMain.handle(GET_SETTINGS_CHANNEL, async () => {
  try {
    return await callServerJson('/api/config/settings')
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'Failed to load settings',
    }
  }
})

ipcMain.handle(SAVE_SETTINGS_CHANNEL, async (_event, payload: unknown) => {
  try {
    return await callServerJson('/api/config/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
    })
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'Failed to save settings',
    }
  }
})

ipcMain.handle(GET_INIT_STATUS_CHANNEL, async () => {
  try {
    return await callServerJson('/api/system/init-status')
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'Failed to load init status',
    }
  }
})

ipcMain.handle(TEST_GATEWAY_CHANNEL, async (_event, payload: unknown) => {
  try {
    return await callServerJson('/api/openclaw/gateway/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
    })
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'Failed to test gateway',
    }
  }
})

ipcMain.handle(
  RUN_MODEL_AUTH_LOGIN_CHANNEL,
  async (_event, payload: { providerId?: unknown }): Promise<RunModelAuthLoginResponse> => {
    const providerId = parseProviderId(payload?.providerId)
    if (!providerId) {
      return {
        ok: false,
        message: 'Invalid provider id.',
      }
    }

    return runModelAuthLoginInTerminal(providerId)
  }
)

ipcMain.handle(CHECK_FOR_UPDATES_CHANNEL, async (): Promise<DesktopUpdateInfo> => {
  return getDesktopUpdateInfo()
})

ipcMain.handle(GET_WHATS_NEW_CHANNEL, async (): Promise<WhatsNewPayload | null> => {
  return pendingWhatsNew
})

ipcMain.handle(ACK_WHATS_NEW_CHANNEL, async (_event, payload: { version?: unknown }): Promise<{ ok: boolean }> => {
  const currentVersion = app.getVersion()
  const requested = typeof payload?.version === 'string' ? normalizeVersionInput(payload.version) : null
  const next = requested ?? currentVersion

  // Never regress the last-seen marker.
  const state = readDesktopUpdateState()
  const lastSeen = normalizeVersionInput(state.lastSeenVersion)
  if (lastSeen && compareVersions(next, lastSeen) <= 0) {
    pendingWhatsNew = null
    return { ok: true }
  }

  writeDesktopUpdateState({ lastSeenVersion: next })
  pendingWhatsNew = null
  return { ok: true }
})

ipcMain.handle(
  OPEN_EXTERNAL_URL_CHANNEL,
  async (_event, payload: { url?: unknown }): Promise<OpenExternalUrlResponse> => {
    const url = typeof payload?.url === 'string' ? payload.url.trim() : ''
    if (!isTrustedGithubReleaseUrl(url)) {
      return {
        ok: false,
        message: 'Only trusted GitHub release URLs can be opened.',
      }
    }

    try {
      await shell.openExternal(url)
      return { ok: true }
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : 'Failed to open external URL.',
      }
    }
  }
)

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
      return
    }
    void startApp()
  })
}

app.on('ready', () => {
  createAppMenu()
  void startApp()
})

app.on('before-quit', () => {
  stopServer()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopServer()
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void startApp()
  }
})

process.on('SIGINT', () => {
  stopServer()
  process.exit(0)
})

process.on('SIGTERM', () => {
  stopServer()
  process.exit(0)
})
