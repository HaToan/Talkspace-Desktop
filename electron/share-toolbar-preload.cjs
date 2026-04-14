const { contextBridge, ipcRenderer } = require('electron')

const ownerId = new URLSearchParams(window.location.search).get('ownerId') || ''

contextBridge.exposeInMainWorld('shareToolbarAPI', {
  stopShare: () => ipcRenderer.send('share-toolbar:stop-share', { ownerId }),
  focusMeeting: () => ipcRenderer.send('share-toolbar:focus-owner', { ownerId }),
  exitShareMode: () => ipcRenderer.send('share-toolbar:exit-share-mode', { ownerId }),
  sendAction: (action) => ipcRenderer.send('share-toolbar:action', { ownerId, action }),
})
