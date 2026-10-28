import { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, net, screen, session, safeStorage } from 'electron';
import { appendFileSync, existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stopBounds, windowRect } from './winbounds.js';

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

// A copy of the price list for the MCP connector (mcp/kama-mcp.mjs), which reads it from the same folder as the log.
ipcMain.handle('mcp:snapshot', (_e, json) => {
  try {
    const file = join(app.getPath('userData'), 'kama-snapshot.json'), tmp = file + '.tmp';
    writeFileSync(tmp, String(json)); renameSync(tmp, file);
    return true;
  } catch (error) { logLine(`snapshot: ${error && error.message}`); return false; }
});
// Kamo's status for the connector (kama_status tool): test result, last scan, errors. Never holds a key.
ipcMain.handle('status:write', (_e, json) => {
  try { const f = join(app.getPath('userData'), 'kama-status.json'), t = f + '.tmp'; writeFileSync(t, String(json).slice(0, 400000)); renameSync(t, f); return true; }
  catch (error) { logLine(`status: ${error && error.message}`); return false; }
});
// "Ask a friend": Kamo's unanswered questions go to a file Claude can read through the connector; the answers come back in another.
ipcMain.handle('friend:write', (_e, json) => {
  try { const f = join(app.getPath('userData'), 'kama-questions.json'), t = f + '.tmp'; writeFileSync(t, String(json)); renameSync(t, f); return true; }
  catch (error) { logLine(`friend write: ${error && error.message}`); return false; }
});
ipcMain.handle('friend:read', () => {
  try { const f = join(app.getPath('userData'), 'kama-answers.json'); return existsSync(f) ? readFileSync(f, 'utf8') : ''; } catch { return ''; }
});
// Kamo's free-cloud tier: the page sends a provider id, the player's own key and a tiny prompt; only these fixed hosts can be reached,
// so the key can never be sent anywhere else. The key is never logged.
const BRAIN_URLS = {
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  sambanova: 'https://api.sambanova.ai/v1/chat/completions',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
};
// API keys are kept encrypted with the operating system (Windows DPAPI) in userData/brain-keys.json; the page only ever holds the placeholder.
const KEY_HELD = 'stored-securely';
const keyFile = () => join(app.getPath('userData'), 'brain-keys.json');
function readKeys() { try { return existsSync(keyFile()) ? JSON.parse(readFileSync(keyFile(), 'utf8')) : {}; } catch { return {}; } }
function storedKey(provider) {
  try { const b = readKeys()[provider]; return b && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(b, 'base64')) : ''; } catch { return ''; }
}
ipcMain.handle('brain:key-set', (_e, provider, key) => {
  try {
    if (!BRAIN_URLS[provider] || typeof key !== 'string' || key.length > 400) return { ok: false };
    const all = readKeys();
    if (!key.trim()) delete all[provider];
    else { if (!safeStorage.isEncryptionAvailable()) return { ok: false, reason: 'no secure storage here' }; all[provider] = safeStorage.encryptString(key.trim()).toString('base64'); }
    const f = keyFile(), t = f + '.tmp'; writeFileSync(t, JSON.stringify(all)); renameSync(t, f);
    return { ok: true, held: !!all[provider] };
  } catch (error) { logLine('brain:key-set: ' + (error && error.message)); return { ok: false }; }
});
ipcMain.handle('brain:chat', async (_e, req) => {
  const url = req && BRAIN_URLS[req.provider];
  let key = req && typeof req.key === 'string' ? req.key.trim() : '';
  if (key === KEY_HELD) { key = storedKey(req.provider); if (!key) return { ok: false, status: 401 }; }   // not held any more (new Windows profile?): ask for the key again
  const model = req && typeof req.model === 'string' ? req.model.trim() : '';
  const msgs = req && Array.isArray(req.messages) ? req.messages : [];
  if (!url || key.length < 8 || key.length > 400 || !/^[\w.:\/-]{1,90}$/.test(model) || !msgs.length || msgs.length > 3) return { ok: false, error: 'bad request' };
  const messages = msgs.map((m) => ({ role: m && m.role === 'system' ? 'system' : 'user', content: String(m && m.content || '').slice(0, 2500) }));
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await net.fetch(url, { method: 'POST', redirect: 'error', signal: ctl.signal, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify({ model, messages, max_tokens: 400, temperature: 0.4 }) });
    if (!r.ok) { let detail = ''; try { const j0 = await r.json(); detail = String((j0 && j0.error && (j0.error.message || j0.error)) || '').replace(/gsk_\w+/g, '***').slice(0, 140); } catch (e) { /* no body */ } return { ok: false, status: r.status, retryAfter: Number(r.headers.get('retry-after')) || 0, detail }; }
    const j = await r.json(), text = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    return text ? { ok: true, text: String(text) } : { ok: false, error: 'empty answer' };
  } catch (error) { logLine(`brain:chat ${req.provider}: ${error && error.name === 'AbortError' ? 'timeout' : 'network error'}`); return { ok: false, error: error && error.name === 'AbortError' ? 'timeout' : 'network error' }; }
  finally { clearTimeout(timer); }
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
// The shared window's rectangle on the screen, in the units Electron uses for windows (null when unknown).
// The picture that is shared is either the whole window (with its title bar) or only its inside: whichever has the same shape as the picture (pw x ph) is used.
async function sharedWindowRect(pw, ph) {
  if (process.platform !== 'win32' || !sharedSourceId || !sharedSourceId.startsWith('window:')) return null;
  const r = await windowRect(Number(sharedSourceId.split(':')[1]), app.getPath('userData'), logLine);
  if (!r || r === 'min') return null;
  let pick = { x: r.x, y: r.y, w: r.w, h: r.h };
  if (r.client && pw > 0 && ph > 0) {
    const err = (b) => Math.abs((b.w / b.h) / (pw / ph) - 1);
    if (err(r.client) < err(pick)) pick = r.client;
  }
  const box = { x: pick.x, y: pick.y, width: pick.w, height: pick.h };
  try { return screen.screenToDipRect ? screen.screenToDipRect(null, box) : box; } catch { return box; }
}
let overlayDisplayId = null;
async function overlayDisplay() {
  try {
    if (sharedSourceId && sharedSourceId.startsWith('screen:')) {
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
      const src = sources.find((x) => x.id === sharedSourceId);
      const d = src && screen.getAllDisplays().find((x) => String(x.id) === String(src.display_id));
      if (d) return d;
    } else if (sharedSourceId && sharedSourceId.startsWith('window:')) {
      const r = await sharedWindowRect();
      if (r) return screen.getDisplayMatching(r);
    }
  } catch { /* fall back to the main display */ }
  return screen.getPrimaryDisplay();
}
// Where the shared picture sits on the overlay, as fractions of the overlay: the whole thing for a shared screen, the window's place for a shared window.
ipcMain.handle('capture:frame-rect', async (_e, pw, ph) => {
  try {
    // Fractions are taken against where the overlay window REALLY is (Windows can shrink it to the work area, for example),
    // so a mark lands on the right pixel of the game whatever size the overlay ended up with.
    const ob = overlayWindow && !overlayWindow.isDestroyed() ? overlayWindow.getBounds() : null;
    if (sharedSourceId && sharedSourceId.startsWith('screen:')) {
      const d = await overlayDisplay(), b = d.bounds;
      if (ob && ob.width > 0 && ob.height > 0) { if (Math.abs(ob.height - b.height) > 1 || Math.abs(ob.width - b.width) > 1) logLine('overlay bounds differ from the screen: ' + JSON.stringify(ob) + ' vs ' + JSON.stringify(b)); return { fx: (b.x - ob.x) / ob.width, fy: (b.y - ob.y) / ob.height, fw: b.width / ob.width, fh: b.height / ob.height, kind: 'screen' }; }
      return { fx: 0, fy: 0, fw: 1, fh: 1, kind: 'screen' };
    }
    const r = await sharedWindowRect(Number(pw), Number(ph));
    if (!r) return null;
    const d = screen.getDisplayMatching(r), b = d.bounds;
    if (overlayWindow && !overlayWindow.isDestroyed() && overlayDisplayId !== d.id) { overlayWindow.setBounds(b); overlayDisplayId = d.id; }
    const o = overlayWindow && !overlayWindow.isDestroyed() ? overlayWindow.getBounds() : b;
    return { fx: (r.x - o.x) / o.width, fy: (r.y - o.y) / o.height, fw: r.width / o.width, fh: r.height / o.height, kind: 'window' };
  } catch (e) { logLine('frame-rect: ' + (e && e.message)); return null; }
});
async function showOverlay(on) {
  if (!on) { if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide(); registerAskKey(false); return false; }
  const d = await overlayDisplay();
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    overlayWindow = new BrowserWindow({
      x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
      transparent: true, frame: false, resizable: false, movable: false, focusable: false, skipTaskbar: true, hasShadow: false, show: false, alwaysOnTop: true,
      webPreferences: { preload: join(__dirname, 'overlay-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
    });
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    try { overlayWindow.setContentProtection(true); } catch (e) { logLine('content protection: ' + (e && e.message)); }   // keep Kamo, boxes and rings OUT of the screen capture, or the scan reads them
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
    overlayWindow.setMenuBarVisibility(false);
    overlayWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    overlayWindow.webContents.on('will-navigate', (e) => e.preventDefault());
    await overlayWindow.loadFile(join(appRoot, 'dist', 'overlay.html'));
  } else {
    overlayWindow.setBounds(d.bounds);
  }
  overlayDisplayId = d.id;
  overlayWindow.showInactive();
  overlayWindow.setBounds(d.bounds);   // once more after it is shown: Windows may have fitted it to the work area first
  registerAskKey(true);
  return true;
}
// Ctrl+Alt+K opens a small text box over the game to talk to Kamo. It takes the keyboard while it is open and gives it back when closed.
const ASK_KEY = 'CommandOrControl+Alt+K';
let askKeyOn = false;
function openAsk() {
  if (!overlayWindow || overlayWindow.isDestroyed() || !overlayWindow.isVisible()) return;
  overlayWindow.setFocusable(true); overlayWindow.setIgnoreMouseEvents(false); overlayWindow.focus();
  overlayWindow.webContents.send('overlay:ask-open');
}
function closeAsk() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.setIgnoreMouseEvents(true, { forward: true }); overlayWindow.setFocusable(false); overlayWindow.blur();
}
function registerAskKey(on) {
  try {
    if (on && !askKeyOn) askKeyOn = globalShortcut.register(ASK_KEY, openAsk);
    else if (!on && askKeyOn) { globalShortcut.unregister(ASK_KEY); askKeyOn = false; }
  } catch (e) { logLine('ask key: ' + (e && e.message)); }
}
ipcMain.on('overlay:ask-close', closeAsk);
// The live voice engine (optional, ~90 MB): voice-engine/kokoro.int8.onnx next to the app, or in the app's data folder.
ipcMain.handle('voice:model', () => {
  try {
    for (const dir of [join(app.getAppPath(), 'voice-engine'), join(app.getAppPath(), 'dist', 'voice-engine'), join(app.getPath('userData'), 'voice-engine'), join(app.getAppPath(), '..', 'voice-engine')]) {
      const f = join(dir, 'kokoro.int8.onnx');
      let b = null;
      if (existsSync(f)) b = readFileSync(f);
      else {   // the engine can come in parts (kokoro.int8.onnx.part1, .part2, ...): they are joined here
        const parts = existsSync(dir) ? readdirSync(dir).filter((n) => /^kokoro\.int8\.onnx\.part\d+$/.test(n)).sort((x, y) => Number(x.split('part')[1]) - Number(y.split('part')[1])) : [];
        if (parts.length) b = Buffer.concat(parts.map((n) => readFileSync(join(dir, n))));
      }
      if (b) return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    }
  } catch (error) { logLine('voice engine: ' + error.message); }
  return null;
});
ipcMain.handle('voice:wasm', () => {
  try {
    for (const f of [join(app.getAppPath(), 'node_modules', 'onnxruntime-web', 'dist', 'ort-wasm-simd-threaded.wasm'), join(app.getAppPath(), 'dist', 'ort', 'ort-wasm-simd-threaded.wasm')]) {
      if (existsSync(f)) { const b = readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }
    }
  } catch (error) { logLine('voice engine wasm: ' + error.message); }
  return null;
});
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
  stopBounds();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

