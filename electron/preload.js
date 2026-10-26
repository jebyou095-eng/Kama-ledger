import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('kamaDesktopCapture', {
  listSources: () => ipcRenderer.invoke('capture:list-sources'),
  selectSource: (sourceId, sourceName) => ipcRenderer.invoke('capture:select-source', sourceId, sourceName),
  voiceWasm: () => ipcRenderer.invoke('voice:wasm'),
  voiceModel: () => ipcRenderer.invoke('voice:model'),
  overlayShow: (on) => ipcRenderer.invoke('overlay:show', on === true),
  overlaySend: (state) => ipcRenderer.send('overlay:state', state),
  onOverlay: (callback) => {
    ipcRenderer.removeAllListeners('overlay:event');
    ipcRenderer.on('overlay:event', (_e, payload) => callback(payload));
  },
  setSharing: (sharing) => ipcRenderer.invoke('capture:set-sharing', sharing),
  frameRect: (w, h) => ipcRenderer.invoke('capture:frame-rect', w, h),
  gameJson: (url) => ipcRenderer.invoke('gamedata:json', url),
  gameImage: (url) => ipcRenderer.invoke('gamedata:image', url),
  friendWrite: (json) => ipcRenderer.invoke('friend:write', json),
  friendRead: () => ipcRenderer.invoke('friend:read'),
  saveSnapshot: (json) => ipcRenderer.invoke('mcp:snapshot', json),
  setHotkey: (accelerator) => ipcRenderer.invoke('hotkey:set', accelerator),
  onHotkey: (callback) => {
    ipcRenderer.removeAllListeners('capture:hotkey');
    ipcRenderer.on('capture:hotkey', () => callback());
  },
});
