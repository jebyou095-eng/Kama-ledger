import { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, session } from 'electron';
import { execFile } from 'node:child_process';
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
  const mainWindow = new BrowserWindow({
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

  if (app.isPackaged) {
    mainWindow.loadFile(join(appRoot, 'dist', 'index.html'));
  } else {
    mainWindow.loadURL('http://localhost:5173');
  }

  mainWindow.webContents.on('did-finish-load', () => { activeShareOwner = mainWindow; });
  mainWindow.on('closed', () => { if (activeShareOwner === mainWindow) activeShareOwner = null; });
}

app.whenReady().then(() => {
  const shortcutRegistered = globalShortcut.register('CommandOrControl+Shift+S', () => {
    if (isScreenSharing) activeShareOwner?.webContents.send('capture:global-snapshot');
  });

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
    contents.on('render-process-gone', () => { if (contents === activeShareOwner?.webContents) isScreenSharing = false; });
  });

  app.on('before-quit', () => {
    if (shortcutRegistered) globalShortcut.unregister('CommandOrControl+Shift+S');
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => globalShortcut.unregisterAll());
