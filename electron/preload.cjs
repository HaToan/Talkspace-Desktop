const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  getVersions: () => ipcRenderer.invoke('app:get-versions'),
  copyToClipboard: (text) => ipcRenderer.invoke('clipboard:write-text', { text }),
  startGoogleOAuth: (payload) => ipcRenderer.invoke('auth:google-oauth', payload),
  startGoogleOAuthExternal: (payload) =>
    ipcRenderer.invoke('auth:google-oauth-external', payload),
  getDesktopSource: () => ipcRenderer.invoke('media:get-desktop-source'),
  listDesktopSources: () => ipcRenderer.invoke('media:list-desktop-sources'),
  pickDesktopSource: () => ipcRenderer.invoke('media:pick-desktop-source'),
  getCurrentWindowSource: () => ipcRenderer.invoke('media:get-current-window-source'),
  openPrejoinWindow: (payload) => ipcRenderer.invoke('prejoin:open', payload),
  openConferenceWindow: (payload) => ipcRenderer.invoke('conference:open-room', payload),
  closeCurrentWindow: () => ipcRenderer.invoke('window:close-current'),
  minimizeCurrentWindow: () => ipcRenderer.invoke('window:minimize-current'),
  enterMiniMode: (payload) => ipcRenderer.invoke('window:enter-mini-mode', payload),
  exitMiniMode: () => ipcRenderer.invoke('window:exit-mini-mode'),
  expandForDrawer: () => ipcRenderer.invoke('window:expand-for-drawer'),
  collapseFromDrawer: () => ipcRenderer.invoke('window:collapse-from-drawer'),
  expandCurrentWindowHeight: () => ipcRenderer.invoke('window:expand-height-max'),
  maximizeCurrentWindow: () => ipcRenderer.invoke('window:maximize-current'),
  toggleFullscreenCurrentWindow: () => ipcRenderer.invoke('window:toggle-fullscreen'),
  isMaximizedCurrentWindow: () => ipcRenderer.invoke('window:is-maximized'),
  setCurrentWindowResizable: (resizable) =>
    ipcRenderer.invoke('window:set-resizable', { resizable: Boolean(resizable) }),
  saveRecording: (payload) => ipcRenderer.invoke('recording:save', payload),

  // Auto-updater
  checkForUpdates: () => ipcRenderer.invoke('updater:check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download-update'),
  quitAndInstall: () => ipcRenderer.invoke('updater:quit-and-install'),
  onUpdateAvailable: (cb) => {
    const fn = (_e, info) => cb(info)
    ipcRenderer.on('updater:update-available', fn)
    return () => ipcRenderer.removeListener('updater:update-available', fn)
  },
  onDownloadProgress: (cb) => {
    const fn = (_e, progress) => cb(progress)
    ipcRenderer.on('updater:download-progress', fn)
    return () => ipcRenderer.removeListener('updater:download-progress', fn)
  },
  onUpdateDownloaded: (cb) => {
    const fn = (_e, info) => cb(info)
    ipcRenderer.on('updater:update-downloaded', fn)
    return () => ipcRenderer.removeListener('updater:update-downloaded', fn)
  },
})
