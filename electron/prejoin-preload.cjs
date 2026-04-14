const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('prejoinAPI', {
  ready: (requestId) => ipcRenderer.send('prejoin:ready', { requestId }),
  confirm: (requestId, settings) => ipcRenderer.send('prejoin:confirm', { requestId, settings }),
  cancel: (requestId) => ipcRenderer.send('prejoin:cancel', { requestId }),
  onInit: (handler) => {
    const listener = (_event, payload) => handler(payload)
    ipcRenderer.on('prejoin:init', listener)
    return () => ipcRenderer.removeListener('prejoin:init', listener)
  },
})
