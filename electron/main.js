import { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, session } from 'electron';
import { execFile } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const appRoot = join(__dirname, '..');
let selectedCaptureSourceId = null;
let selectedInteractiveSourceId = null;
let interactionEnabled = false;
let activeShareOwner = null;
let isScreenSharing = false;
let mainWindow = null;

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

function requireSelectedWindow(sourceId) {
  if (typeof sourceId !== 'string' || !sourceId.startsWith('window:')) return false;
  const nativeHandle = sourceId.split(':')[1];
  if (!/^\d+$/.test(nativeHandle || '') || BigInt(nativeHandle) === 0n) return false;
  selectedInteractiveSourceId = sourceId;
  return true;
}

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
  interactionEnabled = false;
  selectedInteractiveSourceId = null;
  requireSelectedWindow(sourceId);
  return true;
});

ipcMain.handle('capture:set-sharing', (_event, sharing) => {
  isScreenSharing = sharing === true;
  syncHotkey();
  return isScreenSharing;
});

ipcMain.handle('interaction:set-enabled', (_event, enabled) => {
  if (enabled !== true) {
    interactionEnabled = false;
    return { enabled: false, reason: null };
  }
  if (!selectedInteractiveSourceId) {
    interactionEnabled = false;
    return { enabled: false, reason: 'Choose a specific window, not Entire screen.' };
  }
  return resolveSelectedWindow().then((result) => {
    interactionEnabled = result.ok;
    return { enabled: result.ok, reason: result.ok ? null : result.reason };
  });
});

function runPowerShell(script, values) {
  const encodedValues = values.map((value) => Buffer.from(String(value), 'utf8').toString('base64'));
  const argumentSetup = `$__kamaArgs = @('${encodedValues.join("','")}') | ForEach-Object { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($_)) }`;
  const encodedScript = Buffer.from(`${argumentSetup}\n${script}`, 'utf16le').toString('base64');
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encodedScript], { windowsHide: true }, (error) => resolve(!error));
  });
}

const windowLookup = String.raw`
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class KamaWindow {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lp);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT point);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
  public static IntPtr Find(string title) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((hWnd, lp) => {
      if (!IsWindowVisible(hWnd)) return true;
      var text = new StringBuilder(512); GetWindowText(hWnd, text, text.Capacity);
      if (String.Equals(text.ToString(), title, StringComparison.OrdinalIgnoreCase)) { found = hWnd; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}`;

async function resolveSelectedWindow() {
  const script = `${windowLookup}
$target = [IntPtr]([long]$__kamaArgs[0])
if ($target -eq [IntPtr]::Zero) { exit 2 }
$client = New-Object KamaWindow+RECT
if (-not [KamaWindow]::GetClientRect($target, [ref]$client) -or $client.Right -le 0 -or $client.Bottom -le 0) { exit 3 }`;
  const ok = await runPowerShell(script, [selectedInteractiveSourceId.split(':')[1]]);
  return { ok, reason: ok ? null : 'Could not access the selected window handle.' };
}

ipcMain.handle('interaction:click', async (_event, point) => {
  if (!interactionEnabled || !selectedInteractiveSourceId) return { ok: false, reason: 'Game input is off.' };
  const x = Number(point && point.x), y = Number(point && point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > 1 || y > 1) return { ok: false, reason: 'Click position is outside the preview.' };

  const script = `${windowLookup}
$target = [IntPtr]([long]$__kamaArgs[0])
if ($target -eq [IntPtr]::Zero) { exit 2 }
$client = New-Object KamaWindow+RECT
if (-not [KamaWindow]::GetClientRect($target, [ref]$client)) { exit 4 }
$origin = [KamaWindow+POINT]::new()
[KamaWindow]::ClientToScreen($target, [ref]$origin) | Out-Null
$px = [int]($origin.X + [double]$__kamaArgs[1] * $client.Right)
$py = [int]($origin.Y + [double]$__kamaArgs[2] * $client.Bottom)
if ($client.Right -le 0 -or $client.Bottom -le 0) { exit 3 }
[KamaWindow]::SetForegroundWindow($target) | Out-Null
[KamaWindow]::SetCursorPos($px, $py) | Out-Null
[KamaWindow]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
[KamaWindow]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)`;
  const ok = await runPowerShell(script, [selectedInteractiveSourceId.split(':')[1], x, y]);
  return { ok, reason: ok ? null : 'Windows could not deliver the click to the selected window.' };
});

ipcMain.handle('interaction:key', async (_event, key) => {
  if (!interactionEnabled || !selectedInteractiveSourceId || typeof key !== 'string') return { ok: false, reason: 'Game input is off.' };
  const virtualKeys = { Enter: 0x0d, Escape: 0x1b, Space: 0x20, Tab: 0x09, Backspace: 0x08, ArrowLeft: 0x25, ArrowUp: 0x26, ArrowRight: 0x27, ArrowDown: 0x28 };
  const virtualKey = virtualKeys[key] || (key.length === 1 && /^[a-z0-9]$/i.test(key) ? key.toUpperCase().charCodeAt(0) : null);
  if (!virtualKey) return { ok: false, reason: 'That key is not supported for forwarding.' };
  const script = `${windowLookup}
$target = [IntPtr]([long]$__kamaArgs[0])
if ($target -eq [IntPtr]::Zero) { exit 2 }
$vk = [byte]$__kamaArgs[1]
[KamaWindow]::SetForegroundWindow($target) | Out-Null
[KamaWindow]::keybd_event($vk, 0, 0, [UIntPtr]::Zero)
[KamaWindow]::keybd_event($vk, 0, 2, [UIntPtr]::Zero)`;
  const ok = await runPowerShell(script, [selectedInteractiveSourceId.split(':')[1], virtualKey]);
  return { ok, reason: ok ? null : 'Windows could not deliver the key to the selected window.' };
});

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
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

