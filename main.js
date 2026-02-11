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
const schema_bootstrap_1 = require("./schema-bootstrap");
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
const SERVER_STOP_TIMEOUT_MS = 10000;
const PICK_DIRECTORY_CHANNEL = 'clawcontrol:pick-directory';
const RESTART_SERVER_CHANNEL = 'clawcontrol:restart-server';
const GET_SETTINGS_CHANNEL = 'clawcontrol:get-settings';
const SAVE_SETTINGS_CHANNEL = 'clawcontrol:save-settings';
const GET_INIT_STATUS_CHANNEL = 'clawcontrol:get-init-status';
const TEST_GATEWAY_CHANNEL = 'clawcontrol:test-gateway';
// Add a custom startup logo under apps/clawcontrol-desktop/assets using one of these names.
const LOADING_LOGO_FILES = [
    'loading-logo.gif',
    'loading-logo.webp',
    'loading-logo.apng',
    'loading-logo.png',
    'icon.png',
];
function isBrokenPipeError(error) {
    if (!(error instanceof Error))
        return false;
    const maybeErrno = error;
    return maybeErrno.code === 'EPIPE' || maybeErrno.code === 'ERR_STREAM_DESTROYED';
}
function installStdIoGuards() {
    const onStdIoError = (error) => {
        if (isBrokenPipeError(error))
            return;
        // Re-throw unexpected stream errors to preserve fail-fast behavior.
        process.nextTick(() => {
            throw error;
        });
    };
    process.stdout?.on('error', onStdIoError);
    process.stderr?.on('error', onStdIoError);
}
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
function getImageMimeType(assetPath) {
    const extension = node_path_1.default.extname(assetPath).toLowerCase();
    if (extension === '.gif')
        return 'image/gif';
    if (extension === '.webp')
        return 'image/webp';
    if (extension === '.apng')
        return 'image/apng';
    if (extension === '.png')
        return 'image/png';
    if (extension === '.jpg' || extension === '.jpeg')
        return 'image/jpeg';
    if (extension === '.svg')
        return 'image/svg+xml';
    return null;
}
function getFallbackLoadingLogoDataUrl() {
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
  `;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(fallback)}`;
}
function getLoadingLogoDataUrl() {
    for (const fileName of LOADING_LOGO_FILES) {
        const assetPath = (0, utils_1.getAssetPath)(fileName);
        if (!node_fs_1.default.existsSync(assetPath))
            continue;
        if (fileName === 'icon.png') {
            const icon = electron_1.nativeImage.createFromPath(assetPath);
            if (!icon.isEmpty()) {
                return icon.resize({ width: 96, height: 96, quality: 'best' }).toDataURL();
            }
            continue;
        }
        const mimeType = getImageMimeType(assetPath);
        if (!mimeType)
            continue;
        const content = node_fs_1.default.readFileSync(assetPath);
        return `data:${mimeType};base64,${content.toString('base64')}`;
    }
    return getFallbackLoadingLogoDataUrl();
}
function createLoadingWindow() {
    const logoUrl = getLoadingLogoDataUrl();
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
async function waitForServerStop(timeoutMs = SERVER_STOP_TIMEOUT_MS) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const { reachable } = await probeServer();
        if (!reachable)
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
function getDesktopSettingsPath() {
    return node_path_1.default.join(electron_1.app.getPath('userData'), 'settings.json');
}
function buildServerPath(basePath) {
    const separator = process.platform === 'win32' ? ';' : ':';
    const existing = (basePath ?? '').split(separator).filter((entry) => entry.length > 0);
    const extra = process.platform === 'darwin'
        ? ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']
        : ['/usr/local/bin', '/usr/bin', '/bin'];
    for (const candidate of extra) {
        if (!existing.includes(candidate)) {
            existing.push(candidate);
        }
    }
    return existing.join(separator);
}
function resolveOpenClawBin(pathValue) {
    const candidates = [
        process.env.OPENCLAW_BIN,
        ...pathValue
            .split(process.platform === 'win32' ? ';' : ':')
            .filter((segment) => segment.length > 0)
            .map((segment) => node_path_1.default.join(segment, process.platform === 'win32' ? 'openclaw.exe' : 'openclaw')),
        '/opt/homebrew/bin/openclaw',
        '/usr/local/bin/openclaw',
    ];
    for (const candidate of candidates) {
        if (!candidate)
            continue;
        if (node_fs_1.default.existsSync(candidate))
            return candidate;
    }
    return null;
}
function normalizeSettingsString(value) {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function readDesktopSettings() {
    const settingsPath = getDesktopSettingsPath();
    if (!node_fs_1.default.existsSync(settingsPath))
        return {};
    try {
        const raw = JSON.parse(node_fs_1.default.readFileSync(settingsPath, 'utf8'));
        return {
            ...(normalizeSettingsString(raw.gatewayHttpUrl) ? { gatewayHttpUrl: normalizeSettingsString(raw.gatewayHttpUrl) ?? undefined } : {}),
            ...(normalizeSettingsString(raw.gatewayWsUrl) ? { gatewayWsUrl: normalizeSettingsString(raw.gatewayWsUrl) ?? undefined } : {}),
            ...(normalizeSettingsString(raw.gatewayToken) ? { gatewayToken: normalizeSettingsString(raw.gatewayToken) ?? undefined } : {}),
            ...(normalizeSettingsString(raw.workspacePath) ? { workspacePath: normalizeSettingsString(raw.workspacePath) ?? undefined } : {}),
            ...(typeof raw.setupCompleted === 'boolean' ? { setupCompleted: raw.setupCompleted } : {}),
            ...(normalizeSettingsString(raw.updatedAt) ? { updatedAt: normalizeSettingsString(raw.updatedAt) ?? undefined } : {}),
        };
    }
    catch {
        return {};
    }
}
async function callServerJson(pathname, init) {
    const url = `${SERVER_URL}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
    const response = await fetch(url, {
        ...init,
        headers: {
            Accept: 'application/json',
            ...(init?.headers ? init.headers : {}),
        },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        const error = payload && typeof payload === 'object' && 'error' in payload
            ? String(payload.error)
            : `HTTP ${response.status}`;
        throw new Error(error);
    }
    return payload;
}
async function spawnServer() {
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
        const userDataDir = electron_1.app.getPath('userData');
        const settingsPath = getDesktopSettingsPath();
        const settings = readDesktopSettings();
        const workspaceRoot = settings.workspacePath || node_path_1.default.join(userDataDir, 'workspace');
        const databasePath = node_path_1.default.join(userDataDir, 'clawcontrol.db');
        const migrationsDir = node_path_1.default.join(serverDir, 'apps', 'clawcontrol', 'prisma', 'migrations');
        const serverPath = buildServerPath(process.env.PATH);
        const openClawBin = resolveOpenClawBin(serverPath);
        node_fs_1.default.mkdirSync(workspaceRoot, { recursive: true });
        await (0, schema_bootstrap_1.ensurePackagedDatabaseSchema)(serverDir, databasePath);
        const env = {
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
        };
        if (openClawBin) {
            env.OPENCLAW_BIN = openClawBin;
        }
        if (settings.gatewayHttpUrl) {
            env.OPENCLAW_GATEWAY_HTTP_URL = settings.gatewayHttpUrl;
        }
        if (settings.gatewayWsUrl) {
            env.OPENCLAW_GATEWAY_WS_URL = settings.gatewayWsUrl;
        }
        if (settings.gatewayToken) {
            env.OPENCLAW_GATEWAY_TOKEN = settings.gatewayToken;
        }
        const proc = (0, node_child_process_1.spawn)(process.execPath, [entry], {
            cwd,
            detached: process.platform !== 'win32',
            stdio: ['ignore', 'pipe', 'pipe'],
            env,
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
    const userDataDir = electron_1.app.getPath('userData');
    const settingsPath = getDesktopSettingsPath();
    const settings = readDesktopSettings();
    const workspaceRoot = settings.workspacePath || node_path_1.default.join(userDataDir, 'workspace');
    const serverPath = buildServerPath(process.env.PATH);
    const openClawBin = resolveOpenClawBin(serverPath);
    node_fs_1.default.mkdirSync(workspaceRoot, { recursive: true });
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
async function restartManagedServer() {
    if (startInFlight) {
        await startInFlight;
    }
    if (!didSpawnServer || !serverProcess?.pid) {
        return {
            ok: false,
            message: 'Saved configuration, but this server is externally managed. Restart it manually to apply workspace changes.',
        };
    }
    stopServer();
    const stopped = await waitForServerStop();
    if (!stopped) {
        return {
            ok: false,
            message: 'Saved configuration, but timed out while stopping the server. Restart manually.',
        };
    }
    if (await isPortInUseByOtherService()) {
        return {
            ok: false,
            message: `Saved configuration, but port ${SERVER_PORT} is now occupied by another service.`,
        };
    }
    try {
        serverProcess = await spawnServer();
        didSpawnServer = true;
    }
    catch (err) {
        return {
            ok: false,
            message: err instanceof Error
                ? `Saved configuration, but failed to restart server: ${err.message}`
                : 'Saved configuration, but failed to restart server.',
        };
    }
    const ready = await waitForServer();
    if (!ready) {
        stopServer();
        return {
            ok: false,
            message: `Saved configuration, but server did not become ready within ${Math.round(SERVER_START_TIMEOUT_MS / 1000)} seconds.`,
        };
    }
    return {
        ok: true,
        message: 'Configuration saved and server restarted.',
    };
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
            serverProcess = await spawnServer();
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
installStdIoGuards();
electron_1.ipcMain.handle(PICK_DIRECTORY_CHANNEL, async (_event, payload) => {
    const options = {
        title: 'Select OpenClaw Workspace',
        properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
        defaultPath: payload?.defaultPath,
        buttonLabel: 'Select',
    };
    const result = mainWindow
        ? await electron_1.dialog.showOpenDialog(mainWindow, options)
        : await electron_1.dialog.showOpenDialog(options);
    return {
        canceled: result.canceled,
        path: result.canceled ? null : (result.filePaths[0] ?? null),
    };
});
electron_1.ipcMain.handle(RESTART_SERVER_CHANNEL, async () => {
    try {
        return await restartManagedServer();
    }
    catch (err) {
        return {
            ok: false,
            message: err instanceof Error
                ? `Saved configuration, but restart failed: ${err.message}`
                : 'Saved configuration, but restart failed.',
        };
    }
});
electron_1.ipcMain.handle(GET_SETTINGS_CHANNEL, async () => {
    try {
        return await callServerJson('/api/config/settings');
    }
    catch (err) {
        return {
            error: err instanceof Error ? err.message : 'Failed to load settings',
        };
    }
});
electron_1.ipcMain.handle(SAVE_SETTINGS_CHANNEL, async (_event, payload) => {
    try {
        return await callServerJson('/api/config/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload ?? {}),
        });
    }
    catch (err) {
        return {
            error: err instanceof Error ? err.message : 'Failed to save settings',
        };
    }
});
electron_1.ipcMain.handle(GET_INIT_STATUS_CHANNEL, async () => {
    try {
        return await callServerJson('/api/system/init-status');
    }
    catch (err) {
        return {
            error: err instanceof Error ? err.message : 'Failed to load init status',
        };
    }
});
electron_1.ipcMain.handle(TEST_GATEWAY_CHANNEL, async (_event, payload) => {
    try {
        return await callServerJson('/api/openclaw/gateway/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload ?? {}),
        });
    }
    catch (err) {
        return {
            error: err instanceof Error ? err.message : 'Failed to test gateway',
        };
    }
});
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