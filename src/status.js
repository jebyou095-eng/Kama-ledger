// A small status file for the MCP connector: Kamo's last test, the last scan, errors, performance. Never contains a key.
// The desktop app saves it; Claude reads it with the kamo_status tool, so nobody has to copy or upload anything.
export function createStatus(bridge, build) {
  const data = { build, startedAt: new Date().toISOString(), errors: [] };
  let timer = null;
  const write = () => { try { if (bridge && bridge.statusWrite) bridge.statusWrite(JSON.stringify(Object.assign({ savedAt: new Date().toISOString() }, data))); } catch (e) { /* optional */ } };
  const later = () => { clearTimeout(timer); timer = setTimeout(write, 1500); };
  const clip = (v) => { try { return JSON.parse(JSON.stringify(v, (k, x) => (/key/i.test(k) ? undefined : x))); } catch (e) { return null; } };
  const api = {
    note(section, value) { data[section] = clip(value); later(); },
    error(msg) { data.errors = data.errors.concat([{ at: new Date().toISOString(), msg: String(msg).slice(0, 300) }]).slice(-20); later(); },
    data,
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('error', (e) => api.error(e.message));
    window.addEventListener('unhandledrejection', (e) => api.error('promise: ' + (e.reason && e.reason.message || e.reason)));
    // the last scan is sampled instead of hooked, so the scanner code stays untouched
    setInterval(() => {
      const s = window.klLastScan; if (!s) return;
      const sig = JSON.stringify([s.popup && s.popup.lots, s.market && s.market.length, s.tooltip && 1]);
      if (sig === api._sig) return; api._sig = sig;
      api.note('lastScan', { popup: s.popup && { lines: s.popup.lines, avg: s.popup.pop && s.popup.pop.avg, name: s.popup.pop && s.popup.pop.name, lots: s.popup.lots }, marketRows: s.market && s.market.length, market: s.market && s.market.slice(0, 12).map((r) => ({ name: r.rawName, level: r.level, price: r.price, sure: r.priceSure, reads: r.priceReads })), tooltip: s.tooltip });
    }, 4000);
  }
  write();
  return api;
}
