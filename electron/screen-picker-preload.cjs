const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('screenPickerAPI', {
  ready: (requestId) => ipcRenderer.send('screen-picker:ready', { requestId }),
  select: (requestId, sourceId) => ipcRenderer.send('screen-picker:select', { requestId, sourceId }),
  cancel: (requestId) => ipcRenderer.send('screen-picker:cancel', { requestId }),
  onSources: (handler) => {
    const listener = (_event, payload) => handler(payload)
    ipcRenderer.on('screen-picker:sources', listener)
    return () => ipcRenderer.removeListener('screen-picker:sources', listener)
  },
})
