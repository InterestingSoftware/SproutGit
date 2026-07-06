import { initTelemetry, shutdownTelemetry, log } from './telemetry.js';
initTelemetry(); // must be first — patches Node.js before other imports

import { app, BrowserWindow, shell, nativeTheme, Menu, ipcMain } from 'electron';
import { join } from 'path';
import { tmpdir } from 'os';
import { registerGitHandlers } from './ipc/git.js';
import { registerWorkspaceHandlers } from './ipc/workspace.js';
import { registerWorkspaceInitHandlers } from './ipc/workspace-init.js';
import { registerTerminalHandlers } from './ipc/terminal.js';
import { registerSettingsHandlers } from './ipc/settings.js';
import { registerSystemHandlers } from './ipc/system.js';
import { registerGithubHandlers } from './ipc/github.js';
import { registerHookHandlers } from './ipc/hooks.js';
import { registerAgentHandlers } from './ipc/agents.js';
import { registerChatHandlers } from './ipc/chat.js';
import { registerCommitMessageGeneratorHandlers } from './ipc/commit-message-generator.js';
import { registerProjectIdeaGeneratorHandlers } from './ipc/project-idea-generator.js';
import { registerToolTestHandlers } from './ipc/tool-test.js';
import { registerWatchHandlers } from './ipc/watcher.js';
import { registerFileHandlers } from './ipc/files.js';
import { registerUpdateHandlers, startUpdateCheck } from './ipc/update.js';
import { registerIssueTrackerHandlers } from './ipc/issuetracker.js';
import { registerProviderHandlers } from './ipc/providers.js';
import { registerMcpHandlers } from './ipc/mcp.js';
import { registerGlobalErrorHandlers } from './global-error-handlers.js';
import { stopAllMcpServers } from './mcp-bridge.js';
import { openConfigDb } from '@sproutgit/database';
import { IPC } from '@sproutgit/types';

export let configDb: ReturnType<typeof openConfigDb>;

// Set the app name before the first window opens so the dock and menus show
// "SproutGit" instead of "Electron" during development.
app.setName('SproutGit');

// In e2e test mode: use a per-PID directory for the config database so parallel
// test instances don't share SQLite state.  We deliberately do NOT call
// app.setPath('userData', ...) here because that overrides the --user-data-dir
// flag injected by ChromeDriver/wdio-electron-service, which breaks DevTools
// port detection and causes the entire WebDriver session to time out.
//
// Detection: check both the env var (set by the wdio runner process) and the
// --sproutgit-e2e argv flag (passed via wdio appArgs, guaranteed to reach
// Electron even if ChromeDriver sanitises the environment).
const isE2EMode =
  process.env['SPROUTGIT_E2E'] === '1' || process.argv.includes('--sproutgit-e2e');
const e2eDataPath = isE2EMode ? join(tmpdir(), `sg-e2e-data-${process.pid}`) : null;

// In e2e mode, redirect electron-log to a predictable path so the WDIO runner
// can read and surface it on test failures. This must happen before any log call.
if (isE2EMode) {
  log.transports.file.resolvePathFn = () => join(tmpdir(), 'sg-e2e-latest.log');
  log.info('[e2e] E2E mode active. pid:', process.pid);
  log.info('[e2e] argv:', process.argv.join(' '));
}

// Allow Electron MCP tools to attach in development without requiring
// per-command launch flags. Overridable via SPROUTGIT_DEBUG_PORT so multiple
// dev instances (e.g. parallel worktrees) don't fight over the same port.
if (process.env['NODE_ENV'] === 'development') {
  app.commandLine.appendSwitch('remote-debugging-port', process.env['SPROUTGIT_DEBUG_PORT'] ?? '9222');
}

// Tracks the "primary" window for app-level concerns that need exactly one
// target: flushing paths queued from `open-file` before any window existed,
// and the startup update check. Multiple windows can be open at once (see
// `openNewWindow`) — this only ever points at one of them, falling back to
// another still-open window if it's closed.
let mainWindow: BrowserWindow | null = null;
function getMainWindow(): BrowserWindow | null { return mainWindow; }

// Registered before the window exists so startup crashes are still logged
// (and forwarded once the renderer is up, since ErrorModal subscribes on mount).
registerGlobalErrorHandlers();

// ── macOS application menu ────────────────────────────────────────────────────
// Without an explicit menu, Cmd+C / Cmd+V / Cmd+Z etc. don't work on macOS.

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+N',
          click: () => { openNewWindow(); },
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        ...(process.env['NODE_ENV'] === 'development'
          ? [{ role: 'toggleDevTools' as const }]
          : []),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
        { role: 'window' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 960,
    height: 620,
    minWidth: 800,
    minHeight: 500,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    // Centre the traffic-light buttons vertically in our 38 px titlebar.
    ...(process.platform === 'darwin' && { trafficLightPosition: { x: 16, y: 12 } }),
    frame: process.platform !== 'darwin',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e2e' : '#f5f5f5',
    // Override the default Electron icon on Windows/Linux with the SproutGit logo.
    // On macOS the dock icon is set separately via app.dock.setIcon() after ready.
    ...(process.platform !== 'darwin' && { icon: join(__dirname, '../../build/icon.png') }),
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Electron renderer processes don't inherit the main process's argv —
      // additionalArguments is the documented way to forward a flag onto the
      // renderer/preload process.argv (used by app/src/preload/index.ts to
      // expose api.isE2E without a round-trip IPC call).
      ...(isE2EMode && { additionalArguments: ['--sproutgit-e2e'] }),
    },
  });

  win.once('ready-to-show', () => {
    if (isE2EMode) {
      // showInactive() renders the window without activating/focusing the app,
      // opacity 0 keeps it invisible on-screen, and ignoring mouse events stops
      // it from hijacking clicks meant for whatever's actually on screen.
      // CDP screenshots still work because they capture the renderer's backing
      // store, not screen pixels. (macOS clamps off-screen x/y back on-screen,
      // so position tricks don't work — this is the reliable alternative.)
      win.setOpacity(0);
      win.setIgnoreMouseEvents(true);
      win.showInactive();
    } else {
      win.show();
    }
  });

  // Notify the renderer when the window maximize state changes so the
  // WindowControls component can update its icon.
  win.on('maximize', () => win.webContents.send('event:windowMaximized'));
  win.on('unmaximize', () => win.webContents.send('event:windowUnmaximized'));

  // Electron fires these on native full-screen (green button / Cmd+Ctrl+F).
  // The renderer adjusts --sg-titlebar-inset via the window-fullscreen class.
  win.on('enter-full-screen', () => win.webContents.send('event:windowEnterFullscreen'));
  win.on('leave-full-screen', () => win.webContents.send('event:windowLeaveFullscreen'));

  // Open external links in the system browser, not in the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Forward renderer console output to electron-log (captured on disk).
  const levels = ['verbose', 'info', 'warn', 'error'] as const;
  win.webContents.on('console-message', (_e, level, message) => {
    log[levels[level] ?? 'info']('[renderer]', message);
  });

  if (process.env['NODE_ENV'] === 'development' && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // Keep `mainWindow` pointing at a live window for the app-level concerns
  // that need exactly one (see the comment above its declaration).
  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = BrowserWindow.getAllWindows().find(w => w !== win) ?? null;
    }
  });

  return win;
}

/** Opens an additional app window (File → New Window / Cmd+N), landing on the home screen so the user can open a different workspace alongside whatever's already open. */
function openNewWindow(): void {
  const win = createWindow();
  mainWindow = win;
}

// Renderer-triggered equivalent of File → New Window — lets the "New Window"
// button/shortcut work on Windows/Linux too, where there's no application menu.
ipcMain.handle(IPC.SYSTEM_NEW_WINDOW, () => { openNewWindow(); });

// Queue paths received via open-file before the window is ready.
const pendingOpenPaths: string[] = [];

// macOS: opened via Dock "Open Recent" or by the OS passing a file/folder.
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (mainWindow?.webContents) {
    mainWindow.webContents.send(IPC.EVENT_OPEN_WORKSPACE, filePath);
  } else {
    pendingOpenPaths.push(filePath);
  }
});

app.whenReady().then(() => {
  if (isE2EMode) log.info('[e2e] whenReady fired');

  const userDataPath = e2eDataPath ?? app.getPath('userData');
  const dbPath = join(userDataPath, 'config.db');
  if (isE2EMode) log.info('[e2e] opening config db at', dbPath);
  configDb = openConfigDb(dbPath);
  if (isE2EMode) log.info('[e2e] config db opened');

  // app.dock is only available after ready. In dev, Electron runs as its own
  // binary so we override the icon; in production it's embedded in the bundle
  // by electron-builder, and build/icon.png isn't packaged into app.asar, so
  // calling setIcon there would throw (and abort the rest of this callback,
  // including createWindow()).
  if (process.platform === 'darwin' && app.dock && !app.isPackaged) {
    // Use PNG — nativeImage.createFromPath can silently return empty for .icns.
    // Passing the path string directly is the most reliable approach.
    app.dock.setIcon(join(__dirname, '../../build/icon.png'));
  }

  // macOS: set the application menu so Cmd+C/V/Z/X work in text inputs.
  // Windows/Linux: suppress the menu bar entirely (native bar is hidden, and
  // Ctrl+C/V/Z are handled by the OS without a menu).
  // Skip in E2E mode — on Linux, GTK menu init can hang with no real desktop.
  if (process.platform === 'darwin' && !isE2EMode) {
    buildMenu();
  } else {
    Menu.setApplicationMenu(null);
  }
  if (isE2EMode) log.info('[e2e] skipped buildMenu, registering handlers');

  registerGitHandlers(configDb);
  if (isE2EMode) log.info('[e2e] git handlers ok');
  registerWorkspaceHandlers(configDb);
  if (isE2EMode) log.info('[e2e] workspace handlers ok');
  registerWorkspaceInitHandlers();
  if (isE2EMode) log.info('[e2e] workspace-init handlers ok');
  registerTerminalHandlers();
  if (isE2EMode) log.info('[e2e] terminal handlers ok');
  registerSettingsHandlers(configDb);
  if (isE2EMode) log.info('[e2e] settings handlers ok');
  registerSystemHandlers();
  if (isE2EMode) log.info('[e2e] system handlers ok');
  registerGithubHandlers(userDataPath);
  if (isE2EMode) log.info('[e2e] github handlers ok');
  registerHookHandlers(configDb);
  if (isE2EMode) log.info('[e2e] hook handlers ok');
  registerAgentHandlers(configDb, userDataPath);
  if (isE2EMode) log.info('[e2e] agent handlers ok');
  registerChatHandlers(configDb, userDataPath);
  if (isE2EMode) log.info('[e2e] chat handlers ok');
  registerCommitMessageGeneratorHandlers();
  if (isE2EMode) log.info('[e2e] commit message generator handlers ok');
  registerProjectIdeaGeneratorHandlers(configDb);
  if (isE2EMode) log.info('[e2e] project idea generator handlers ok');
  registerToolTestHandlers();
  if (isE2EMode) log.info('[e2e] tool test handlers ok');
  registerWatchHandlers();
  if (isE2EMode) log.info('[e2e] watch handlers ok');
  registerFileHandlers();
  if (isE2EMode) log.info('[e2e] file handlers ok');
  registerIssueTrackerHandlers();
  registerProviderHandlers(userDataPath);
  registerMcpHandlers(configDb);
  if (isE2EMode) log.info('[e2e] issue tracker / provider / mcp handlers ok');
  // Skip update handler registration in E2E mode. On Linux CI, electron-updater
  // initialises AppImageUpdater which accesses D-Bus / libsecret and hangs for
  // ~20 s when no real session bus is available. Auto-update is irrelevant in tests.
  if (!isE2EMode) {
    registerUpdateHandlers();
  }
  if (isE2EMode) log.info('[e2e] handlers registered');

  mainWindow = createWindow();
  if (isE2EMode) log.info('[e2e] window created');

  mainWindow.once('ready-to-show', () => {
    // Skip update check in E2E mode — on Linux, autoUpdater.checkForUpdates()
    // initialises AppImageUpdater which accesses D-Bus and hangs in CI.
    if (!isE2EMode) {
      startUpdateCheck();
    }
    // Flush any paths that arrived before the window was ready.
    for (const p of pendingOpenPaths) {
      mainWindow?.webContents.send(IPC.EVENT_OPEN_WORKSPACE, p);
    }
    pendingOpenPaths.length = 0;
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Always quit in e2e test mode so the test runner can clean up properly.
  if (process.platform !== 'darwin' || isE2EMode) app.quit();
});

app.on('before-quit', () => {
  void stopAllMcpServers();
  void shutdownTelemetry();
});
