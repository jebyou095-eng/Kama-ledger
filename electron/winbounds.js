// Where is the shared game window on the screen? Windows only: a small PowerShell helper (kept running) asks the system for the
// window's visible rectangle. It only reads the position; it never touches the window or sends it any input.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SCRIPT = `
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential)] public struct KRECT { public int L, T, R, B; }
[StructLayout(LayoutKind.Sequential)] public struct KPT { public int X, Y; }
public static class KW {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out KRECT r);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out KRECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref KPT p);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out KRECT r, int s);
}
'@
[void][KW]::SetProcessDPIAware()
[Console]::Out.WriteLine('ready')
while (($line = [Console]::In.ReadLine()) -ne $null) {
  $p = $line.Trim().Split(' ')
  try {
    $h = [IntPtr][int64]$p[1]
    if ([KW]::IsIconic($h)) { [Console]::Out.WriteLine($p[0] + ' min'); continue }
    $r = New-Object KRECT
    $hr = [KW]::DwmGetWindowAttribute($h, 9, [ref]$r, 16)
    if ($hr -ne 0) { [void][KW]::GetWindowRect($h, [ref]$r) }
    $c = New-Object KRECT
    [void][KW]::GetClientRect($h, [ref]$c)
    $pt = New-Object KPT
    [void][KW]::ClientToScreen($h, [ref]$pt)
    [Console]::Out.WriteLine($p[0] + ' ' + $r.L + ' ' + $r.T + ' ' + $r.R + ' ' + $r.B + ' ' + $pt.X + ' ' + $pt.Y + ' ' + ($pt.X + $c.R) + ' ' + ($pt.Y + $c.B))
  } catch { [Console]::Out.WriteLine($p[0] + ' err') }
}
`;

let proc = null, buf = '', seq = 0, ready = false;
const waiting = new Map();

function start(dir, log) {
  if (proc || process.platform !== 'win32') return;
  try {
    const file = join(dir, 'kama-winbounds.ps1');
    writeFileSync(file, SCRIPT);
    proc = spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (c) => {
      buf += c; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (line === 'ready') { ready = true; continue; }
        const p = line.split(' '), w = waiting.get(p[0]);
        if (!w) continue;
        waiting.delete(p[0]); clearTimeout(w.t);
        if (p[1] === 'min') w.done('min');
        else if (p.length >= 5 && p.slice(1).every((x) => Number.isFinite(Number(x)))) {
          const n = p.slice(1).map(Number), rect = (L, T, R, B) => (R > L && B > T ? { x: L, y: T, w: R - L, h: B - T } : null);
          const frame = rect(n[0], n[1], n[2], n[3]), client = n.length >= 8 ? rect(n[4], n[5], n[6], n[7]) : null;
          w.done(frame ? { ...frame, client } : null);   // the window with its title bar, and just its inside
        }
        else w.done(null);
      }
    });
    proc.stderr.on('data', (d) => log && log('winbounds: ' + String(d).slice(0, 300)));
    proc.on('exit', () => { proc = null; ready = false; waiting.forEach((w) => { clearTimeout(w.t); w.done(null); }); waiting.clear(); });
    proc.on('error', (e) => { log && log('winbounds: ' + e.message); proc = null; });
  } catch (e) { log && log('winbounds: ' + e.message); proc = null; }
}

export function stopBounds() { try { if (proc) proc.kill(); } catch { /* already gone */ } proc = null; }

// Resolves { x, y, w, h, client: { x, y, w, h } | null } in physical screen pixels, 'min' when the window is minimised, or null when unknown.
export function windowRect(hwnd, dir, log) {
  if (process.platform !== 'win32' || !Number.isFinite(hwnd)) return Promise.resolve(null);
  start(dir, log);
  if (!proc) return Promise.resolve(null);
  return new Promise((done) => {
    const id = 'r' + (++seq);
    const t = setTimeout(() => { waiting.delete(id); done(null); }, ready ? 2000 : 9000);   // the first call waits for PowerShell to start
    waiting.set(id, { done, t });
    try { proc.stdin.write(id + ' ' + hwnd + '\n'); } catch { waiting.delete(id); clearTimeout(t); done(null); }
  });
}
