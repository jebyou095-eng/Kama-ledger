import { contextBridge, ipcRenderer } from 'electron';

// The overlay page can only show what Kamo says, report a click on one of Kamo's own buttons, and switch itself between
// "see-through to the mouse" and "clickable" while the pointer is over Kamo. It has no access to the game or the files.
contextBridge.exposeInMainWorld('kamaOverlay', {
  onState: (callback) => { ipcRenderer.removeAllListeners('overlay:state'); ipcRenderer.on('overlay:state', (_e, state) => callback(state)); },
  act: (i) => ipcRenderer.send('overlay:event', { type: 'act', i: Number.isInteger(i) ? i : -1 }),
  hide: () => ipcRenderer.send('overlay:event', { type: 'hide' }),
  interactive: (on) => ipcRenderer.send('overlay:interactive', on === true),
});
