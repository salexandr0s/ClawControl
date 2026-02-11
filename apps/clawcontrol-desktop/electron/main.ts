import { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { ensurePackagedDatabaseSchema } from './schema-bootstrap'
import { getAssetPath, isDev } from './utils'

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

interface DesktopSettings {
  gatewayHttpUrl?: string
  gatewayWsUrl?: string
  gatewayToken?: string
  workspacePath?: string
  setupCompleted?: boolean
  updatedAt?: string
}

function isBrokenPipeError(error: unknown): error is NodeJS.ErrnoException {
  if (!(error instanceof Error)) return false
  const maybeErrno = error as NodeJS.ErrnoException
  return maybeErrno.code === 'EPIPE' || maybeErrno.code === 'ERR_STREAM_DESTROYED'
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

function buildServerPath(basePath: string | undefined): string {
  const separator = process.platform === 'win32' ? ';' : ':'
  const existing = (basePath ?? '').split(separator).filter((entry) => entry.length > 0)
  const extra =
    process.platform === 'darwin'
      ? ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']
      : ['/usr/local/bin', '/usr/bin', '/bin']

  for (const candidate of extra) {
    if (!existing.includes(candidate)) {
      existing.push(candidate)
    }
  }

  return existing.join(separator)
}

function resolveOpenClawBin(pathValue: string): string | null {
  const candidates = [
    process.env.OPENCLAW_BIN,
    ...pathValue
      .split(process.platform === 'win32' ? ';' : ':')
      .filter((segment) => segment.length > 0)
      .map((segment) => path.join(segment, process.platform === 'win32' ? 'openclaw.exe' : 'openclaw')),
    '/opt/homebrew/bin/openclaw',
    '/usr/local/bin/openclaw',
  ]

  for (const candidate of candidates) {
    if (!candidate) continue
    if (fs.existsSync(candidate)) return candidate
  }

  return null
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
