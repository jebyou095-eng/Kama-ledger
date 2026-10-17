import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('kamaDesktopCapture', {
  listSources: () => ipcRenderer.invoke('capture:list-sources'),
  selectSource: (sourceId, sourceName) => ipcRenderer.invoke('capture:select-source', sourceId, sourceName),
  setInteractionEnabled: (enabled) => ipcRenderer.invoke('interaction:set-enabled', enabled),
  sendClick: (point) => ipcRenderer.invoke('interaction:click', point),
  sendKey: (key) => ipcRenderer.invoke('interaction:key', key),
  onGlobalSnapshot: (callback) => ipcRenderer.on('capture:global-snapshot', callback),
  setSharing: (sharing) => ipcRenderer.invoke('capture:set-sharing', sharing),
});
