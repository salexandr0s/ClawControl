import { app, BrowserWindow, Menu, dialog } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
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

function createLoadingWindow(): BrowserWindow {
  const iconUrl = pathToFileURL(getAssetPath('icon.png')).toString()

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
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file: data:; style-src 'unsafe-inline';" />
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
        <img src="${iconUrl}" width="64" height="64" />
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

function getDevClawControlDir(): string {
  const repoRoot = path.resolve(__dirname, '../../..')
  const dir = path.join(repoRoot, 'apps', 'clawcontrol')
  return dir
}

function getPackagedServerDir(): string {
  return path.join(process.resourcesPath, 'server')
}

function spawnServer(): ChildProcess {
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
    const workspaceRoot = path.join(app.getPath('userData'), 'workspace')
    fs.mkdirSync(workspaceRoot, { recursive: true })

    const proc = spawn(process.execPath, [entry], {
      cwd,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        NODE_ENV: 'production',
        HOST: SERVER_HOST,
        HOSTNAME: SERVER_HOST,
        PORT: String(SERVER_PORT),
        OPENCLAW_WORKSPACE: workspaceRoot,
        CLAWCONTROL_WORKSPACE_ROOT: workspaceRoot,
        DATABASE_URL: `file:${path.join(app.getPath('userData'), 'clawcontrol.db')}`,
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

  const clawcontrolDir = getDevClawControlDir()
  if (!fs.existsSync(path.join(clawcontrolDir, 'package.json'))) {
    throw new Error(`clawcontrol app not found at ${clawcontrolDir}`)
  }

  const script = isDev() ? 'dev' : 'start'

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
      serverProcess = spawnServer()
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
