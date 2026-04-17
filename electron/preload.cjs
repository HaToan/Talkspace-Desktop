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
  getScreenSourceForAudio: () => ipcRenderer.invoke('media:get-screen-source-for-audio'),
  resizeSourceWindow: (payload) => ipcRenderer.invoke('media:resize-source-window', payload),
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
  getRecordingFolder: () => ipcRenderer.invoke('recording:get-folder'),
  isRecordingFolderValid: (payload) => ipcRenderer.invoke('recording:is-folder-valid', payload),
  chooseRecordingFolder: () => ipcRenderer.invoke('recording:choose-folder'),
  openRecordingStream: (payload) => ipcRenderer.invoke('recording:open-stream', payload),
  writeRecordingChunk: (payload) => ipcRenderer.invoke('recording:write-chunk', payload),
  closeRecordingStream: (payload) => ipcRenderer.invoke('recording:close-stream', payload),
  convertBackground: (payload) => ipcRenderer.invoke('recording:convert-background', payload),
  onConvertDone: (cb) => {
    const fn = (_e, result) => cb(result)
    ipcRenderer.on('recording:convert-done', fn)
    return () => ipcRenderer.removeListener('recording:convert-done', fn)
  },
  listRecordingFiles: () => ipcRenderer.invoke('recording:list-files'),
  listRecordingUploadHistory: () => ipcRenderer.invoke('recording:list-upload-history'),
  markRecordingUploadHistorySync: (payload) => ipcRenderer.invoke('recording:mark-upload-history-sync', payload),
  listCurrentUploads: () => ipcRenderer.invoke('recording:list-current-uploads'),
  autoUploadStatus: () => ipcRenderer.invoke('recording:auto-upload-status'),
  setAutoUploadEnabled: (payload) => ipcRenderer.invoke('recording:auto-upload-set-enabled', payload),
  deleteRecordingFile: (payload) => ipcRenderer.invoke('recording:delete-file', payload),
  revealRecordingFile: (payload) => ipcRenderer.invoke('recording:reveal-file', payload),
  saveYoutubeClientId: (payload) => ipcRenderer.invoke('recording:youtube-save-client-id', payload),
  youtubeStatus: () => ipcRenderer.invoke('recording:youtube-status'),
  youtubeAuth: () => ipcRenderer.invoke('recording:youtube-auth'),
  youtubeRevoke: () => ipcRenderer.invoke('recording:youtube-revoke'),
  youtubeUpload: (payload) => ipcRenderer.invoke('recording:youtube-upload', payload),
  youtubeUploadCancel: (payload) => ipcRenderer.invoke('recording:youtube-upload-cancel', payload),
  onYoutubeProgress: (cb) => {
    const fn = (_e, data) => cb(data)
    ipcRenderer.on('recording:youtube-progress', fn)
    return () => ipcRenderer.removeListener('recording:youtube-progress', fn)
  },
  onYoutubeUploaded: (cb) => {
    const fn = (_e, data) => cb(data)
    ipcRenderer.on('recording:youtube-uploaded', fn)
    return () => ipcRenderer.removeListener('recording:youtube-uploaded', fn)
  },
  onRecordingUploadsState: (cb) => {
    const fn = (_e, data) => cb(data)
    ipcRenderer.on('recording:uploads-state', fn)
    return () => ipcRenderer.removeListener('recording:uploads-state', fn)
  },

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
