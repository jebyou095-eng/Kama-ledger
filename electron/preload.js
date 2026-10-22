import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('kamaDesktopCapture', {
  listSources: () => ipcRenderer.invoke('capture:list-sources'),
  selectSource: (sourceId, sourceName) => ipcRenderer.invoke('capture:select-source', sourceId, sourceName),
  overlayShow: (on) => ipcRenderer.invoke('overlay:show', on === true),
  overlaySend: (state) => ipcRenderer.send('overlay:state', state),
  onOverlay: (callback) => {
    ipcRenderer.removeAllListeners('overlay:event');
    ipcRenderer.on('overlay:event', (_e, payload) => callback(payload));
  },
  setSharing: (sharing) => ipcRenderer.invoke('capture:set-sharing', sharing),
  gameJson: (url) => ipcRenderer.invoke('gamedata:json', url),
  gameImage: (url) => ipcRenderer.invoke('gamedata:image', url),
  setHotkey: (accelerator) => ipcRenderer.invoke('hotkey:set', accelerator),
  onHotkey: (callback) => {
    ipcRenderer.removeAllListeners('capture:hotkey');
    ipcRenderer.on('capture:hotkey', () => callback());
  },
});
