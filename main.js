"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const node_child_process_1 = require("node:child_process");
const node_fs_1 = __importDefault(require("node:fs"));
const node_http_1 = __importDefault(require("node:http"));
const node_path_1 = __importDefault(require("node:path"));
const node_url_1 = require("node:url");
const utils_1 = require("./utils");
let mainWindow = null;
let serverProcess = null;
let didSpawnServer = false;
let startInFlight = null;
const SERVER_HOST = '127.0.0.1';
const SERVER_PORT = 3000;
const SERVER_URL = `http://${SERVER_HOST}:${SERVER_PORT}`;
const SERVER_PROBE_URL = `${SERVER_URL}/api/workspace?path=/`;
const SERVER_CHECK_INTERVAL_MS = 500;
const SERVER_START_TIMEOUT_MS = 30000;
function createAppMenu() {
    const template = [
        { role: 'fileMenu' },
        { role: 'editMenu' },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools', visible: (0, utils_1.isDev)() },
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
                        electron_1.app.showAboutPanel();
                    },
                },
            ],
        },
    ];
    const menu = electron_1.Menu.buildFromTemplate(template);
    electron_1.Menu.setApplicationMenu(menu);
}
function createMainWindow() {
    const preloadPath = node_path_1.default.join(__dirname, 'preload.js');
    const windowIcon = process.platform === 'win32'
        ? (0, utils_1.getAssetPath)('icon.ico')
        : (0, utils_1.getAssetPath)('icon.png');
    const win = new electron_1.BrowserWindow({
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
    });
    win.loadURL(SERVER_URL);
    win.once('ready-to-show', () => {
        win.show();
    });
    win.on('closed', () => {
        mainWindow = null;
    });
    mainWindow = win;
    return win;
}
function createLoadingWindow() {
    const iconUrl = (0, node_url_1.pathToFileURL)((0, utils_1.getAssetPath)('icon.png')).toString();
    const win = new electron_1.BrowserWindow({
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
    });
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
  `;
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    win.once('ready-to-show', () => win.show());
    return win;
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function probeServer() {
    return new Promise((resolve) => {
        const req = node_http_1.default.get(SERVER_PROBE_URL, (res) => {
            res.resume();
            resolve({ reachable: true, statusCode: res.statusCode });
        });
        req.on('error', () => resolve({ reachable: false }));
        req.setTimeout(1000, () => {
            req.destroy();
            resolve({ reachable: false });
        });
    });
}
async function isClawControlServerRunning() {
    const { reachable, statusCode } = await probeServer();
    if (!reachable)
        return false;
    return statusCode !== 404 && statusCode !== undefined;
}
async function isPortInUseByOtherService() {
    const { reachable, statusCode } = await probeServer();
    return reachable && statusCode === 404;
}
async function waitForServer(timeoutMs = SERVER_START_TIMEOUT_MS) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await isClawControlServerRunning())
            return true;
        await sleep(SERVER_CHECK_INTERVAL_MS);
    }
    return false;
}
function getDevClawControlDir() {
    const repoRoot = node_path_1.default.resolve(__dirname, '../../..');
    const dir = node_path_1.default.join(repoRoot, 'apps', 'clawcontrol');
    return dir;
}
function getPackagedServerDir() {
    return node_path_1.default.join(process.resourcesPath, 'server');
}
function spawnServer() {
    if (electron_1.app.isPackaged) {
        const serverDir = getPackagedServerDir();
        const entryCandidates = [
            node_path_1.default.join(serverDir, 'server.js'),
            node_path_1.default.join(serverDir, 'apps', 'clawcontrol', 'server.js'),
        ];
        const entry = entryCandidates.find((p) => node_fs_1.default.existsSync(p)) ?? null;
        if (!entry) {
            throw new Error('Packaged server not found (expected server bundle under resources/server)');
        }
        const cwd = node_path_1.default.dirname(entry);
        const workspaceRoot = node_path_1.default.join(electron_1.app.getPath('userData'), 'workspace');
        node_fs_1.default.mkdirSync(workspaceRoot, { recursive: true });
        const proc = (0, node_child_process_1.spawn)(process.execPath, [entry], {
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
                DATABASE_URL: `file:${node_path_1.default.join(electron_1.app.getPath('userData'), 'clawcontrol.db')}`,
            },
        });
        proc.stdout?.on('data', (data) => console.log(`[server] ${data.toString().trim()}`));
        proc.stderr?.on('data', (data) => console.error(`[server:err] ${data.toString().trim()}`));
        proc.on('exit', (code, signal) => {
            console.log(`[server] Exited (code=${code ?? 'null'} signal=${signal ?? 'null'})`);
            serverProcess = null;
            didSpawnServer = false;
        });
        return proc;
    }
    const clawcontrolDir = getDevClawControlDir();
    if (!node_fs_1.default.existsSync(node_path_1.default.join(clawcontrolDir, 'package.json'))) {
        throw new Error(`clawcontrol app not found at ${clawcontrolDir}`);
    }
    const script = (0, utils_1.isDev)() ? 'dev' : 'start';
    const proc = (0, node_child_process_1.spawn)('npm', ['--prefix', clawcontrolDir, 'run', script], {
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
    });
    proc.stdout?.on('data', (data) => console.log(`[server] ${data.toString().trim()}`));
    proc.stderr?.on('data', (data) => console.error(`[server:err] ${data.toString().trim()}`));
    proc.on('exit', (code, signal) => {
        console.log(`[server] Exited (code=${code ?? 'null'} signal=${signal ?? 'null'})`);
        serverProcess = null;
        didSpawnServer = false;
    });
    return proc;
}
function stopServer() {
    if (!didSpawnServer || !serverProcess?.pid)
        return;
    const pid = serverProcess.pid;
    console.log(`[server] Stopping (pid=${pid})…`);
    try {
        if (process.platform !== 'win32') {
            process.kill(-pid, 'SIGTERM');
        }
        else {
            serverProcess.kill('SIGTERM');
        }
    }
    catch (err) {
        console.warn('[server] Failed to send SIGTERM:', err);
    }
    const proc = serverProcess;
    serverProcess = null;
    didSpawnServer = false;
    setTimeout(() => {
        if (proc.killed)
            return;
        try {
            if (process.platform !== 'win32' && pid) {
                process.kill(-pid, 'SIGKILL');
            }
            else {
                proc.kill('SIGKILL');
            }
        }
        catch {
            // ignore
        }
    }, 5000);
}
async function startApp() {
    if (startInFlight)
        return startInFlight;
    startInFlight = (async () => {
        const alreadyRunning = await isClawControlServerRunning();
        if (alreadyRunning) {
            createMainWindow();
            return;
        }
        if (await isPortInUseByOtherService()) {
            electron_1.dialog.showErrorBox('ClawControl cannot start', `Port ${SERVER_PORT} is already in use by another service.\n\nQuit the other process or configure it to use a different port, then relaunch ClawControl.`);
            electron_1.app.quit();
            return;
        }
        const loadingWindow = createLoadingWindow();
        try {
            serverProcess = spawnServer();
            didSpawnServer = true;
        }
        catch (err) {
            loadingWindow.close();
            electron_1.dialog.showErrorBox('Failed to start server', err instanceof Error ? err.message : String(err));
            electron_1.app.quit();
            return;
        }
        const ready = await waitForServer();
        loadingWindow.close();
        if (!ready) {
            electron_1.dialog.showErrorBox('Server startup timeout', `ClawControl server did not become ready within ${Math.round(SERVER_START_TIMEOUT_MS / 1000)} seconds.`);
            stopServer();
            electron_1.app.quit();
            return;
        }
        createMainWindow();
    })().finally(() => {
        startInFlight = null;
    });
    return startInFlight;
}
const gotSingleInstanceLock = electron_1.app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
    electron_1.app.quit();
}
else {
    electron_1.app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized())
                mainWindow.restore();
            mainWindow.focus();
            return;
        }
        void startApp();
    });
}
electron_1.app.on('ready', () => {
    createAppMenu();
    void startApp();
});
electron_1.app.on('before-quit', () => {
    stopServer();
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        stopServer();
        electron_1.app.quit();
    }
});
electron_1.app.on('activate', () => {
    if (electron_1.BrowserWindow.getAllWindows().length === 0) {
        void startApp();
    }
});
process.on('SIGINT', () => {
    stopServer();
    process.exit(0);
});
process.on('SIGTERM', () => {
    stopServer();
    process.exit(0);
});
//# sourceMappingURL=main.js.map