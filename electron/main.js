import { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, net, screen, session } from 'electron';
import { appendFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const appRoot = join(__dirname, '..');
let selectedCaptureSourceId = null;
let activeShareOwner = null;
let isScreenSharing = false;
let mainWindow = null;
let overlayWindow = null;
let sharedSourceId = null;

// A small log next to the app data, so a window that does not appear can be diagnosed.
// Windows: %APPDATA%\Kama Ledger\kama-ledger.log
function logLine(message) {
  try { appendFileSync(join(app.getPath('userData'), 'kama-ledger.log'), `${new Date().toISOString()} ${message}\n`); } catch (error) { /* logging must never break the app */ }
}
process.on('uncaughtException', (error) => { logLine(`uncaughtException: ${error && error.stack || error}`); });
process.on('unhandledRejection', (error) => { logLine(`unhandledRejection: ${error && error.stack || error}`); });

// Only one copy runs. Starting it again brings the existing window forward instead of
// leaving a second invisible process in the background.
const gotInstanceLock = app.requestSingleInstanceLock();
if (!gotInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) { createWindow(); return; }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}
let desiredHotkey = null;
let registeredHotkey = null;

// Capture hotkey: only tells the Kama Ledger window to take a screenshot of the
// shared window. It never sends anything to the game. It is registered with the
// system only while a screen or window is being shared, so the key is not taken
// away from other programs the rest of the time.
const HOTKEY_PATTERN = /^((CommandOrControl|Alt|Shift)\+)*([A-Z0-9]|F([1-9]|1\d|2[0-4])|Space|Up|Down|Left|Right|Tab|Enter|Backspace|Insert|Delete|Home|End|PageUp|PageDown)$/;
function validHotkey(accelerator) {
  if (typeof accelerator !== 'string' || !HOTKEY_PATTERN.test(accelerator)) return false;
  return /^(CommandOrControl|Alt|Shift)\+/.test(accelerator) || /^F\d/.test(accelerator);
}

function fireHotkey() {
  const target = activeShareOwner || mainWindow;
  if (target && !target.isDestroyed()) target.webContents.send('capture:hotkey');
}

function syncHotkey() {
  if (registeredHotkey) {
    globalShortcut.unregister(registeredHotkey);
    registeredHotkey = null;
  }
  if (!desiredHotkey || !isScreenSharing) return;
  try {
    if (globalShortcut.register(desiredHotkey, fireHotkey)) registeredHotkey = desiredHotkey;
  } catch (error) { /* an invalid accelerator was already rejected in hotkey:set */ }
}

// Game data comes from one fixed host only; the renderer cannot ask the app to fetch anything else.
const DATA_HOST = 'api.dofusdu.de';
const dataUrlOk = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && x.hostname === DATA_HOST; } catch (e) { return false; } };
const FAKE = process.env.KAMA_FAKE_GAMEDATA ? JSON.parse(process.env.KAMA_FAKE_GAMEDATA) : null; // used by automated tests only
ipcMain.handle('gamedata:json', async (_e, url) => {
  if (!dataUrlOk(url)) return { ok: false, error: 'blocked url' };
  if (FAKE) return /meta\/version/.test(url) ? { ok: true, json: { version: 'test' } } : (/items\/equipment/.test(url) ? { ok: true, json: /page\[number\]=1(&|$)/.test(url) ? (/fields\[item\]=recipe/.test(url) ? FAKE : { items: FAKE.items.map((x) => { const y = { ...x }; delete y.recipe; return y; }) }) : { items: [] } } : { ok: false, status: 404 });
  try { const r = await net.fetch(url, { redirect: 'error' }); if (!r.ok) return { ok: false, status: r.status }; return { ok: true, json: await r.json() }; }
  catch (e) { return { ok: false, error: String(e && e.message || e) }; }
});
ipcMain.handle('gamedata:image', async (_e, url) => {
  if (!dataUrlOk(url)) return { ok: false, error: 'blocked url' };
  if (FAKE) return { ok: true, dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' };
  try { const r = await net.fetch(url, { redirect: 'error' }); if (!r.ok) return { ok: false, status: r.status }; const b = Buffer.from(await r.arrayBuffer()); return { ok: true, dataUrl: 'data:image/png;base64,' + b.toString('base64') }; }
  catch (e) { return { ok: false, error: String(e && e.message || e) }; }
});

ipcMain.handle('hotkey:set', (_event, accelerator) => {
  if (!validHotkey(accelerator)) return { ok: false, reason: 'Use a function key (F1-F24) or a combination with Ctrl, Alt or Shift.' };
  if (accelerator !== registeredHotkey) {
    try {
      // Check the key is free right now, then release it again.
      if (!globalShortcut.register(accelerator, fireHotkey)) return { ok: false, reason: 'Another program already uses that key combination.' };
      globalShortcut.unregister(accelerator);
    } catch (error) {
      return { ok: false, reason: 'That key combination is not valid.' };
    }
  }
  desiredHotkey = accelerator;
  syncHotkey();
  return { ok: true, accelerator };
});

ipcMain.handle('capture:list-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 360, height: 220 },
    fetchWindowIcons: true,
  });

  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    thumbnail: source.thumbnail.toDataURL(),
    type: source.id.startsWith('screen:') ? 'screen' : 'window',
  }));
});

ipcMain.handle('capture:select-source', (_event, sourceId, sourceName) => {
  if (typeof sourceId !== 'string') return false;
  selectedCaptureSourceId = sourceId;
  sharedSourceId = sourceId;
  return true;
});

ipcMain.handle('capture:set-sharing', (_event, sharing) => {
  isScreenSharing = sharing === true;
  syncHotkey();
  return isScreenSharing;
});


// ---- Kamo overlay: a see-through window above the screen that only shows Kamo's bubble and a pointer.
// It never takes keyboard focus and sends no input to any other program, the game included.
async function overlayDisplay() {
  try {
    if (sharedSourceId && sharedSourceId.startsWith('screen:')) {
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
      const src = sources.find((x) => x.id === sharedSourceId);
      const d = src && screen.getAllDisplays().find((x) => String(x.id) === String(src.display_id));
      if (d) return d;
    }
  } catch { /* fall back to the main display */ }
  return screen.getPrimaryDisplay();
}
async function showOverlay(on) {
  if (!on) { if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide(); return false; }
  const d = await overlayDisplay();
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    overlayWindow = new BrowserWindow({
      x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
      transparent: true, frame: false, resizable: false, movable: false, focusable: false, skipTaskbar: true, hasShadow: false, show: false, alwaysOnTop: true,
      webPreferences: { preload: join(__dirname, 'overlay-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
    });
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
    overlayWindow.setMenuBarVisibility(false);
    overlayWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    overlayWindow.webContents.on('will-navigate', (e) => e.preventDefault());
    await overlayWindow.loadFile(join(appRoot, 'dist', 'overlay.html'));
  } else {
    overlayWindow.setBounds(d.bounds);
  }
  overlayWindow.showInactive();
  return true;
}
ipcMain.handle('overlay:show', (_e, on) => showOverlay(on === true));
ipcMain.on('overlay:state', (_e, state) => { if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.webContents.send('overlay:state', state); });
ipcMain.on('overlay:event', (_e, payload) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('overlay:event', payload); });
ipcMain.on('overlay:interactive', (_e, on) => { if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.setIgnoreMouseEvents(on !== true, { forward: true }); });

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 960,
    minWidth: 1000,
    minHeight: 700,
    title: 'Kama Ledger',
    backgroundColor: '#14161c',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // The built app is used unless a dev server address is given on purpose
  // (KAMA_DEV_URL=http://localhost:5173), so `npm run start` never waits for a server that is not running.
  const builtPage = join(appRoot, 'dist', 'index.html');
  const devUrl = app.isPackaged ? null : process.env.KAMA_DEV_URL;
  if (devUrl) mainWindow.loadURL(devUrl);
  else mainWindow.loadFile(builtPage);

  mainWindow.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    logLine(`did-fail-load ${code} ${description} ${url}`);
    if (!isMainFrame) return;
    const reason = existsSync(builtPage) ? description : `${description}. The built app (dist/index.html) is missing: run "npm run build" first.`;
    const page = `<body style="font:16px system-ui;padding:32px;background:#14161c;color:#e8eaf0"><h2>Kama Ledger could not load its page</h2><p>${String(reason).replace(/[<>&]/g, '')}</p><p>Details are in kama-ledger.log in the app data folder.</p></body>`;
    mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page));
  });
  mainWindow.webContents.on('preload-error', (_event, path, error) => logLine(`preload-error ${path}: ${error && error.stack || error}`));
  mainWindow.webContents.on('render-process-gone', (_event, details) => logLine(`render-process-gone ${JSON.stringify(details)}`));

  // The app never needs to open other pages: refuse every navigation and new window.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('file:') && !url.startsWith('data:text/html') && !(devUrl && url.startsWith(devUrl))) event.preventDefault(); });

  mainWindow.webContents.on('did-finish-load', () => { activeShareOwner = mainWindow; });
  mainWindow.on('closed', () => { if (activeShareOwner === mainWindow) activeShareOwner = null; });
}

app.whenReady().then(() => {
  if (!gotInstanceLock) return;
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    const requestedId = selectedCaptureSourceId;
    selectedCaptureSourceId = null;
    isScreenSharing = Boolean(requestedId);
    if (!requestedId) {
      callback({});
      return;
    }

    desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } })
      .then((sources) => {
        const source = sources.find((item) => item.id === requestedId);
        if (!source) isScreenSharing = false;
        callback(source ? { video: source } : {});
      })
      .catch(() => { isScreenSharing = false; callback({}); });
  });

  app.on('web-contents-created', (_event, contents) => {
    contents.on('render-process-gone', () => { if (contents === activeShareOwner?.webContents) { isScreenSharing = false; syncHotkey(); } });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('will-quit', () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.destroy();
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

