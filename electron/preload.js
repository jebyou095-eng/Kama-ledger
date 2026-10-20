import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('kamaDesktopCapture', {
  listSources: () => ipcRenderer.invoke('capture:list-sources'),
  selectSource: (sourceId, sourceName) => ipcRenderer.invoke('capture:select-source', sourceId, sourceName),
  setInteractionEnabled: (enabled) => ipcRenderer.invoke('interaction:set-enabled', enabled),
  sendClick: (point) => ipcRenderer.invoke('interaction:click', point),
  sendKey: (key) => ipcRenderer.invoke('interaction:key', key),
  setSharing: (sharing) => ipcRenderer.invoke('capture:set-sharing', sharing),
  gameJson: (url) => ipcRenderer.invoke('gamedata:json', url),
  gameImage: (url) => ipcRenderer.invoke('gamedata:image', url),
  setHotkey: (accelerator) => ipcRenderer.invoke('hotkey:set', accelerator),
  onHotkey: (callback) => {
    ipcRenderer.removeAllListeners('capture:hotkey');
    ipcRenderer.on('capture:hotkey', () => callback());
  },
});
