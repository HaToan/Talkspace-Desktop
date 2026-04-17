const { app, BrowserWindow, ipcMain, shell, desktopCapturer, dialog, webContents, screen, clipboard } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { execFile } = require('child_process')

// Resolve ffmpeg binary — works in dev and in packaged (asar.unpacked) builds
const resolveFfmpegPath = () => {
  try {
    const raw = require('ffmpeg-static')
    if (!raw) return null
    // In packaged apps the binary is extracted to app.asar.unpacked
    return app.isPackaged ? raw.replace('app.asar', 'app.asar.unpacked') : raw
  } catch {
    return null
  }
}
const { autoUpdater } = require('electron-updater')

const loadDotenvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return
  const content = fs.readFileSync(filePath, 'utf8')
  const lines = content.split(/\r?\n/)

  for (const line of lines) {
    const raw = line.trim()
    if (!raw || raw.startsWith('#')) continue

    const match = raw.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (!match) continue

    const key = match[1]
    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

loadDotenvFile(path.join(process.cwd(), '.env.local'))
loadDotenvFile(path.join(process.cwd(), '.env'))

const DESKTOP_AUTH_PROTOCOL = 'talkspace-desktop'
const DESKTOP_AUTH_HOST = 'oauth-callback'
const EXTERNAL_OAUTH_TIMEOUT_MS = 3 * 60 * 1000

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL)
const allowInsecureCertFlag = process.env.ELECTRON_ALLOW_INSECURE_CERT
const allowInsecureCert =
  allowInsecureCertFlag === '1' || (isDev && allowInsecureCertFlag !== '0')
const selectSourceWindowIconPath = path.join(__dirname, 'assets', 'select-source-icon.png')
const selectSourceWindowIcon = fs.existsSync(selectSourceWindowIconPath)
  ? selectSourceWindowIconPath
  : undefined

if (allowInsecureCert) {
  app.commandLine.appendSwitch('ignore-certificate-errors')
}

const normalizeBaseUrl = (value) => {
  if (!value || typeof value !== 'string') return ''
  return value.trim().replace(/\/+$/, '')
}

const toSafeFileName = (value, fallback = 'talkspace-meeting-recording') => {
  const raw = typeof value === 'string' ? value.trim() : ''
  const sanitized = raw
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return sanitized || fallback
}

const isHttpUrl = (value) => /^https?:\/\//i.test(value)

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
}

let mainWindow = null
const conferenceWindows = new Set()
let pendingExternalOauth = null
let bufferedHandoffToken = null
const conferenceShareModeState = new Map()
const miniModeRestoreState = new Map()
const DEFAULT_CONFERENCE_MIN_SIZE = [250, 250]
const DEFAULT_SHARE_MODE_HEIGHT = 720
const APP_WINDOW_BACKGROUND = '#2b3440'

const getShareModeStateKey = (win) => String(win?.id || '')

const positionShareToolbarWindow = (toolbarWindow, ownerWindow) => {
  if (!toolbarWindow || toolbarWindow.isDestroyed() || !ownerWindow || ownerWindow.isDestroyed()) return
  const ownerBounds = ownerWindow.getBounds()
  const ownerDisplay = screen.getDisplayMatching(ownerBounds)
  const workArea = ownerDisplay.workArea
  const toolbarBounds = toolbarWindow.getBounds()
  const maxAllowedWidth = Math.max(520, workArea.width - 24)
  const targetWidth = Math.min(toolbarBounds.width, maxAllowedWidth)
  if (targetWidth !== toolbarBounds.width) {
    toolbarWindow.setSize(targetWidth, toolbarBounds.height, false)
  }
  const nextX = workArea.x + Math.floor((workArea.width - targetWidth) / 2)
  const nextY = workArea.y + 8
  toolbarWindow.setBounds(
    {
      x: nextX,
      y: nextY,
      width: targetWidth,
      height: toolbarBounds.height,
    },
    false,
  )
}

const createShareToolbarWindow = (ownerWindow) => {
  const ownerId = String(ownerWindow.id)
  const toolbarWindow = new BrowserWindow({
    width: 860,
    height: 58,
    minWidth: 420,
    minHeight: 58,
    maxWidth: 980,
    maxHeight: 58,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    autoHideMenuBar: true,
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'share-toolbar-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  toolbarWindow.setAlwaysOnTop(true, 'screen-saver', 1)
  toolbarWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  })
  toolbarWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  toolbarWindow.once('ready-to-show', () => {
    if (toolbarWindow.isDestroyed()) return
    positionShareToolbarWindow(toolbarWindow, ownerWindow)
    toolbarWindow.showInactive()
  })

  toolbarWindow.on('closed', () => {
    const key = getShareModeStateKey(ownerWindow)
    const state = conferenceShareModeState.get(key)
    if (state) {
      state.toolbarWindow = null
    }
  })

  toolbarWindow.loadFile(path.join(__dirname, 'share-toolbar.html'), {
    query: { ownerId },
  }).catch(() => undefined)

  return toolbarWindow
}

const enterConferenceShareMode = (conferenceWindow, options = {}) => {
  if (!conferenceWindow || conferenceWindow.isDestroyed()) {
    return { success: false, error: 'Conference window not found.' }
  }

  if (conferenceWindow.isMinimized()) {
    conferenceWindow.restore()
  }

  const key = getShareModeStateKey(conferenceWindow)
  let state = conferenceShareModeState.get(key)
  if (!state) {
    state = {
      originalBounds: conferenceWindow.getBounds(),
      originalMinSize: conferenceWindow.getMinimumSize(),
      wasMaximized: conferenceWindow.isMaximized(),
      wasFullScreen: conferenceWindow.isFullScreen(),
      wasAlwaysOnTop: conferenceWindow.isAlwaysOnTop(),
      toolbarWindow: null,
    }
    conferenceShareModeState.set(key, state)
  }

  if (conferenceWindow.isFullScreen()) {
    conferenceWindow.setFullScreen(false)
  }
  if (conferenceWindow.isMaximized()) {
    conferenceWindow.unmaximize()
  }

  const currentBounds = conferenceWindow.getBounds()
  const currentDisplay = screen.getDisplayMatching(currentBounds)
  const workArea = currentDisplay.workArea
  const targetWidth = Math.max(340, Math.min(430, Math.floor(workArea.width * 0.25)))
  const targetHeight = Math.max(
    DEFAULT_CONFERENCE_MIN_SIZE[1],
    Math.min(Math.max(DEFAULT_SHARE_MODE_HEIGHT, currentBounds.height), workArea.height - 92),
  )
  const targetX = workArea.x + workArea.width - targetWidth - 10
  const targetY = workArea.y + 8

  conferenceWindow.setMinimumSize(280, 300)
  conferenceWindow.setBounds(
    {
      x: targetX,
      y: targetY,
      width: targetWidth,
      height: targetHeight,
    },
    true,
  )
  conferenceWindow.setAlwaysOnTop(true, 'floating')
  conferenceWindow.show()
  if (!options?.silentResize) {
    conferenceWindow.focus()
  }

  if (state.toolbarWindow && !state.toolbarWindow.isDestroyed()) {
    state.toolbarWindow.close()
    state.toolbarWindow = null
  }

  return { success: true }
}

const exitConferenceShareMode = (conferenceWindow) => {
  if (!conferenceWindow) return { success: true }
  const key = getShareModeStateKey(conferenceWindow)
  const state = conferenceShareModeState.get(key)
  if (!state) {
    return { success: true }
  }

  if (state.toolbarWindow && !state.toolbarWindow.isDestroyed()) {
    state.toolbarWindow.close()
  }

  if (conferenceWindow.isDestroyed()) {
    conferenceShareModeState.delete(key)
    return { success: true }
  }

  const minSize = Array.isArray(state.originalMinSize)
    ? state.originalMinSize
    : DEFAULT_CONFERENCE_MIN_SIZE
  conferenceWindow.setMinimumSize(
    Number.isFinite(minSize[0]) ? minSize[0] : DEFAULT_CONFERENCE_MIN_SIZE[0],
    Number.isFinite(minSize[1]) ? minSize[1] : DEFAULT_CONFERENCE_MIN_SIZE[1],
  )
  conferenceWindow.setAlwaysOnTop(Boolean(state.wasAlwaysOnTop))

  if (state.wasFullScreen) {
    conferenceWindow.setFullScreen(true)
  } else if (state.wasMaximized) {
    conferenceWindow.maximize()
  } else if (state.originalBounds) {
    conferenceWindow.setBounds(state.originalBounds, true)
  }

  conferenceShareModeState.delete(key)
  return { success: true }
}

const resolvePendingExternalOauth = (result) => {
  if (!pendingExternalOauth) return
  clearTimeout(pendingExternalOauth.timeout)
  const resolver = pendingExternalOauth.resolve
  pendingExternalOauth = null
  resolver(result)
}

const extractHandoffTokenFromDeepLink = (rawUrl) => {
  if (!rawUrl || typeof rawUrl !== 'string') return null
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== `${DESKTOP_AUTH_PROTOCOL}:`) return null
    if (parsed.hostname !== DESKTOP_AUTH_HOST) return null
    const token = parsed.searchParams.get('token')
    return token && token.trim() ? token.trim() : null
  } catch {
    return null
  }
}

const handleDesktopDeepLink = (rawUrl) => {
  const token = extractHandoffTokenFromDeepLink(rawUrl)
  if (!token) return false

  if (pendingExternalOauth) {
    resolvePendingExternalOauth({
      success: true,
      handoffToken: token,
    })
  } else {
    bufferedHandoffToken = token
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
    mainWindow.focus()
  }
  return true
}

const registerDesktopProtocolClient = () => {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(
      DESKTOP_AUTH_PROTOCOL,
      process.execPath,
      [path.resolve(process.argv[1])],
    )
    return
  }
  app.setAsDefaultProtocolClient(DESKTOP_AUTH_PROTOCOL)
}

const createGoogleAuthStartUrl = (apiBaseUrl, mode = 'popup') => {
  const safeBaseUrl = normalizeBaseUrl(apiBaseUrl)
  if (!isHttpUrl(safeBaseUrl)) return null

  if (mode === 'external') {
    const params = new URLSearchParams({
      redirect: '/talkspaces',
      for_pub: '1',
      handoff: 'desktop',
      desktop_app: `${DESKTOP_AUTH_PROTOCOL}://${DESKTOP_AUTH_HOST}`,
    })
    return `${safeBaseUrl}/api/v1/auth/google?${params.toString()}`
  }

  return `${safeBaseUrl}/api/v1/auth/google?redirect=${encodeURIComponent('/talkspaces')}&for_pub=1`
}

const getDefaultDesktopSource = async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: {
      width: 0,
      height: 0,
    },
    fetchWindowIcons: false,
  })

  if (!sources.length) return null
  return sources.find((source) => source.id.startsWith('screen:')) || sources[0]
}

const listDesktopSources = async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: {
      width: 960,
      height: 540,
    },
    fetchWindowIcons: false,
  })

  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    kind: source.id.startsWith('screen:') ? 'screen' : 'window',
    thumbnailDataUrl: source.thumbnail?.isEmpty() ? '' : source.thumbnail.toDataURL(),
  }))
}

const getDesktopSourceById = async (sourceId) => {
  if (!sourceId) return null
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: {
      width: 0,
      height: 0,
    },
    fetchWindowIcons: false,
  })
  return sources.find((source) => source.id === sourceId) || null
}

const attachRendererWindowHandlers = (win) => {
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const windowSession = win.webContents.session
  windowSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'media' || permission === 'display-capture') {
      callback(true)
      return
    }
    callback(false)
  })

  windowSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      try {
        let source = null
        const frame = request?.frame
        if (frame && typeof webContents.fromFrame === 'function') {
          const requesterWebContents = webContents.fromFrame(frame.processId, frame.routingId)
          const requesterWindow = requesterWebContents
            ? BrowserWindow.fromWebContents(requesterWebContents)
            : null
          const requesterSourceId =
            requesterWindow && typeof requesterWindow.getMediaSourceId === 'function'
              ? requesterWindow.getMediaSourceId()
              : ''
          if (requesterSourceId) {
            source = await getDesktopSourceById(requesterSourceId)
          }
        }

        if (!source) {
          source = await getDefaultDesktopSource()
        }
        if (!source) {
          callback({})
          return
        }
        callback({
          video: source,
          audio: false,
        })
      } catch (_error) {
        callback({})
      }
    },
    { useSystemPicker: false },
  )
}

const loadRendererEntry = (win, query = {}) => {
  if (isDev) {
    const baseUrl = process.env.VITE_DEV_SERVER_URL
    const devUrl = new URL(baseUrl)
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue
      devUrl.searchParams.set(key, String(value))
    }
    return win.loadURL(devUrl.toString())
  }

  return win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query })
}

const openConferenceWindow = async (parentWindow, payload = {}) => {
  const roomId = String(payload?.roomId || '').trim()
  if (!roomId) {
    return {
      success: false,
      error: 'Room id is required.',
    }
  }

  const roomTitle = String(payload?.roomTitle || 'TalkSpace')
  const conferenceWindowTitle = 'User\'s Meeting Zoom'
  const query = {
    launchMode: 'conference',
    roomId,
    audience: payload?.joinAsAudience ? '1' : '0',
    prejoin: payload?.prejoinSettings ? JSON.stringify(payload.prejoinSettings) : '',
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 836,
    minWidth: DEFAULT_CONFERENCE_MIN_SIZE[0],
    minHeight: DEFAULT_CONFERENCE_MIN_SIZE[1],
    resizable: true,
    maximizable: true,
    fullscreenable: true,
    autoHideMenuBar: true,
    backgroundColor: APP_WINDOW_BACKGROUND,
    title: conferenceWindowTitle,
    show: false,
    frame: false,
    parent: undefined,
    modal: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  attachRendererWindowHandlers(win)

  const revealWindow = () => {
    if (win.isDestroyed()) return
    win.center()
    if (!win.isVisible()) {
      win.show()
    }
    win.focus()
  }

  win.once('ready-to-show', revealWindow)
  setTimeout(revealWindow, 700)

  try {
    await loadRendererEntry(win, query)
  } catch (error) {
    if (!win.isDestroyed()) {
      win.close()
    }
    return {
      success: false,
      error: error?.message || 'Failed to load conference window.',
    }
  }

  conferenceWindows.add(win)
  win.on('closed', () => {
    exitConferenceShareMode(win)
    conferenceWindows.delete(win)
  })

  return { success: true }
}

const openPrejoinWindow = async (parentWindow, payload = {}) => {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const PREJOIN_WIDTH = 660
  const PREJOIN_HEIGHT = 520

  return await new Promise((resolve) => {
    const windowTitle = String(payload?.roomTitle || 'TalkSpace')
    const prejoinWindow = new BrowserWindow({
      width: PREJOIN_WIDTH,
      height: PREJOIN_HEIGHT,
      minWidth: PREJOIN_WIDTH,
      minHeight: PREJOIN_HEIGHT,
      maxWidth: PREJOIN_WIDTH,
      maxHeight: PREJOIN_HEIGHT,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      useContentSize: true,
      show: false,
      title: windowTitle,
      icon: selectSourceWindowIcon,
      parent: parentWindow || undefined,
      modal: Boolean(parentWindow),
      autoHideMenuBar: true,
      backgroundColor: APP_WINDOW_BACKGROUND,
      webPreferences: {
        preload: path.join(__dirname, 'prejoin-preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    let settled = false

    prejoinWindow.once('ready-to-show', () => {
      if (prejoinWindow.isDestroyed()) return
      prejoinWindow.setContentSize(PREJOIN_WIDTH, PREJOIN_HEIGHT)
      prejoinWindow.setSize(PREJOIN_WIDTH, PREJOIN_HEIGHT)
      prejoinWindow.center()
      prejoinWindow.show()
    })

    prejoinWindow.on('page-title-updated', (event) => {
      event.preventDefault()
      prejoinWindow.setTitle(windowTitle)
    })

    const cleanup = () => {
      ipcMain.removeListener('prejoin:ready', onReady)
      ipcMain.removeListener('prejoin:confirm', onConfirm)
      ipcMain.removeListener('prejoin:cancel', onCancel)
    }

    const finish = (result) => {
      if (settled) return
      settled = true
      cleanup()
      if (!prejoinWindow.isDestroyed()) {
        prejoinWindow.close()
      }
      resolve(result)
    }

    const onReady = (_event, data) => {
      if (!data || data.requestId !== requestId) return
      if (!prejoinWindow.isDestroyed()) {
        prejoinWindow.webContents.send('prejoin:init', {
          requestId,
          roomTitle: String(payload?.roomTitle || 'TalkSpace'),
          userInfo: payload?.userInfo || null,
          roomInfo: payload?.roomInfo || null,
          canManageAudience: Boolean(payload?.canManageAudience),
          allowedJoinRoles: Array.isArray(payload?.allowedJoinRoles)
            ? payload.allowedJoinRoles
            : undefined,
          joinAsAudience: Boolean(payload?.joinAsAudience),
          initialSettings: payload?.initialSettings || {},
        })
      }
    }

    const onConfirm = (_event, data) => {
      if (!data || data.requestId !== requestId) return
      finish({
        confirmed: true,
        settings: data.settings || {},
      })
    }

    const onCancel = (_event, data) => {
      if (!data || data.requestId !== requestId) return
      finish({ confirmed: false })
    }

    ipcMain.on('prejoin:ready', onReady)
    ipcMain.on('prejoin:confirm', onConfirm)
    ipcMain.on('prejoin:cancel', onCancel)

    prejoinWindow.on('closed', () => {
      finish({ confirmed: false })
    })

    prejoinWindow.loadFile(path.join(__dirname, 'prejoin.html'), {
      query: { requestId },
    }).catch(() => {
      finish({ confirmed: false })
    })
  })
}

const focusSourceWindow = (sourceId, conferenceWindow = null) => {
  if (!sourceId) return

  // Determine work area from the conference window's display, or fall back to primary
  let wa = screen.getPrimaryDisplay().workArea
  let confX = null

  // Determine work area from the conference window's display
  if (conferenceWindow && !conferenceWindow.isDestroyed()) {
    const confDisplay = screen.getDisplayMatching(conferenceWindow.getBounds())
    wa = confDisplay.workArea
  }

  // Compute where enterMiniMode will place the conference window (right edge, 250px wide)
  // so we can position the selected window to avoid overlapping it.
  const miniWidth = 250
  const miniMargin = 16
  confX = wa.x + wa.width - miniWidth - miniMargin

  // Max width the selected window can use without overlapping the conference window
  const gap = 12
  const maxAllowedWidth = confX !== null ? confX - wa.x - gap : wa.width
  const targetX = wa.x
  const targetY = wa.y

  // Try to focus one of our own Electron windows first
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    try {
      const winSourceId =
        typeof win.getMediaSourceId === 'function' ? win.getMediaSourceId() : ''
      if (winSourceId && winSourceId === sourceId) {
        if (win.isMinimized()) win.restore()
        if (win.isMaximized()) win.unmaximize()
        if (win.isFullScreen()) win.setFullScreen(false)
        const cur = win.getBounds()
        // Keep original size; only constrain width if it would overlap the conference window
        win.setBounds({ x: targetX, y: targetY, width: Math.min(cur.width, maxAllowedWidth), height: cur.height }, true)
        win.focus()
        return
      }
    } catch {
      // skip
    }
  }

  // On Windows, extract the HWND from the source ID (format: window:<hwnd_decimal>:0),
  // restore + move to left edge keeping original size (SWP_NOSIZE), then bring to front.
  if (process.platform === 'win32' && sourceId.startsWith('window:')) {
    const match = sourceId.match(/^window:(\d+):/)
    if (match) {
      const hwndValue = match[1]
      const script = [
        `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class WF { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n); [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr i, int x, int y, int cx, int cy, uint f); }'`,
        `[WF]::ShowWindow([IntPtr]${hwndValue}, 9)`,
        // SWP_NOSIZE (0x0001) | SWP_SHOWWINDOW (0x0040) — move only, keep current size
        `[WF]::SetWindowPos([IntPtr]${hwndValue}, [IntPtr]0, ${targetX}, ${targetY}, 0, 0, 0x0041)`,
        `[WF]::SetForegroundWindow([IntPtr]${hwndValue})`,
      ].join('; ')
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script],
        { timeout: 5000 },
        () => {},
      )
    }
  }
}

const openDesktopSourcePickerWindow = async (parentWindow) => {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  return await new Promise((resolve) => {
    const pickerWindow = new BrowserWindow({
      width: 980,
      height: 700,
      minWidth: 780,
      minHeight: 560,
      title: 'Select source to share',
      icon: selectSourceWindowIcon,
      ...(process.platform === 'win32'
        ? {
            titleBarStyle: 'hidden',
            titleBarOverlay: {
              color: '#25272b',
              symbolColor: '#ffffff',
              height: 34,
            },
          }
        : {}),
      parent: parentWindow || undefined,
      modal: Boolean(parentWindow),
      autoHideMenuBar: true,
      backgroundColor: APP_WINDOW_BACKGROUND,
      webPreferences: {
        preload: path.join(__dirname, 'screen-picker-preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    pickerWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

    let settled = false

    const cleanup = () => {
      ipcMain.removeListener('screen-picker:ready', onReady)
      ipcMain.removeListener('screen-picker:select', onSelect)
      ipcMain.removeListener('screen-picker:cancel', onCancel)
    }

    const finish = (result) => {
      if (settled) return
      settled = true
      cleanup()
      if (!pickerWindow.isDestroyed()) {
        pickerWindow.close()
      }
      resolve(result)
    }

    const sendSources = async () => {
      try {
        const sources = await listDesktopSources()
        if (!pickerWindow.isDestroyed()) {
          pickerWindow.webContents.send('screen-picker:sources', { requestId, sources })
        }
      } catch (_error) {
        if (!pickerWindow.isDestroyed()) {
          pickerWindow.webContents.send('screen-picker:sources', { requestId, sources: [] })
        }
      }
    }

    const onReady = (_event, payload) => {
      if (!payload || payload.requestId !== requestId) return
      void sendSources()
    }

    const onSelect = async (_event, payload) => {
      if (!payload || payload.requestId !== requestId) return
      const selectedId = String(payload.sourceId || '')
      if (!selectedId) {
        finish(null)
        return
      }

      const latestSources = await listDesktopSources()
      const selected = latestSources.find((source) => source.id === selectedId) || null
      finish(selected)

      // After the picker closes, bring the selected window to the front
      // and reposition both the selected window (left) and conference window (top-right)
      if (selectedId.startsWith('window:')) {
        setTimeout(() => focusSourceWindow(selectedId, parentWindow), 250)
      }
    }

    const onCancel = (_event, payload) => {
      if (!payload || payload.requestId !== requestId) return
      finish(null)
    }

    ipcMain.on('screen-picker:ready', onReady)
    ipcMain.on('screen-picker:select', onSelect)
    ipcMain.on('screen-picker:cancel', onCancel)

    pickerWindow.on('closed', () => {
      finish(null)
    })

    pickerWindow.loadFile(path.join(__dirname, 'screen-picker.html'), {
      query: { requestId },
    }).catch(() => {
      finish(null)
    })
  })
}

const setupAutoUpdater = (win) => {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    if (!win.isDestroyed()) win.webContents.send('updater:update-available', info)
  })
  autoUpdater.on('download-progress', (progress) => {
    if (!win.isDestroyed()) win.webContents.send('updater:download-progress', progress)
  })
  autoUpdater.on('update-downloaded', (info) => {
    if (!win.isDestroyed()) win.webContents.send('updater:update-downloaded', info)
  })
  autoUpdater.on('update-not-available', () => {
    if (!win.isDestroyed()) win.webContents.send('updater:update-not-available')
  })
  autoUpdater.on('error', (err) => {
    if (!win.isDestroyed()) win.webContents.send('updater:error', err?.message || 'Update error')
  })
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 720,
    minHeight: 480,
    resizable: true,
    autoHideMenuBar: true,
    backgroundColor: APP_WINDOW_BACKGROUND,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  attachRendererWindowHandlers(win)

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null
    }
  })

  void loadRendererEntry(win).catch(() => undefined)

  mainWindow = win
}

const runGoogleOauthFlow = (parentWindow, apiBaseUrl) =>
  new Promise((resolve) => {
    const authUrl = createGoogleAuthStartUrl(apiBaseUrl, 'popup')
    if (!authUrl) {
      resolve({
        success: false,
        error:
          'Google OAuth requires VITE_API_BASE_URL (or VITE_API_PROXY_TARGET) as an absolute http(s) URL.',
      })
      return
    }

    const authWindow = new BrowserWindow({
      width: 520,
      height: 760,
      minWidth: 480,
      minHeight: 640,
      parent: parentWindow || undefined,
      modal: Boolean(parentWindow),
      autoHideMenuBar: true,
      backgroundColor: APP_WINDOW_BACKGROUND,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    authWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url)
      return { action: 'deny' }
    })

    let done = false
    let callbackSeen = false

    const finish = (result) => {
      if (done) return
      done = true
      if (!authWindow.isDestroyed()) {
        authWindow.close()
      }
      resolve(result)
    }

    const checkUrl = (url) => {
      if (!url || typeof url !== 'string') return
      if (url.includes('/api/v1/auth/google/callback')) {
        callbackSeen = true
        setTimeout(() => {
          finish({ success: true })
        }, 1200)
      }
    }

    authWindow.webContents.on('will-redirect', (_event, url) => checkUrl(url))
    authWindow.webContents.on('did-navigate', (_event, url) => checkUrl(url))
    authWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      finish({
        success: false,
        error: `Google OAuth window failed to load (${errorCode}): ${errorDescription}`,
      })
    })

    authWindow.on('closed', () => {
      if (done) return
      finish(
        callbackSeen
          ? { success: true }
          : { success: false, cancelled: true, error: 'Google OAuth cancelled.' },
      )
    })

    authWindow.loadURL(authUrl).catch((error) => {
      finish({
        success: false,
        error: error?.message || 'Unable to open Google OAuth window.',
      })
    })
  })

const runGoogleExternalOauthFlow = async (apiBaseUrl) => {
  const authUrl = createGoogleAuthStartUrl(apiBaseUrl, 'external')
  if (!authUrl) {
    return {
      success: false,
      error:
        'Google OAuth requires VITE_API_BASE_URL (or VITE_API_PROXY_TARGET) as an absolute http(s) URL.',
    }
  }

  if (bufferedHandoffToken) {
    const token = bufferedHandoffToken
    bufferedHandoffToken = null
    return {
      success: true,
      handoffToken: token,
    }
  }

  if (pendingExternalOauth) {
    resolvePendingExternalOauth({
      success: false,
      cancelled: true,
      error: 'Previous Google OAuth flow was replaced by a new request.',
    })
  }

  try {
    await shell.openExternal(authUrl)
  } catch (error) {
    return {
      success: false,
      error: error?.message || 'Unable to open system browser.',
    }
  }

  return await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolvePendingExternalOauth({
        success: false,
        cancelled: true,
        error: 'Timed out waiting for Google OAuth handoff.',
      })
    }, EXTERNAL_OAUTH_TIMEOUT_MS)

    pendingExternalOauth = {
      resolve,
      timeout,
    }
  })
}

if (gotSingleInstanceLock) {
  app.on('second-instance', (_event, commandLine) => {
    const deepLinkArg = commandLine.find(
      (arg) => typeof arg === 'string' && arg.startsWith(`${DESKTOP_AUTH_PROTOCOL}://`),
    )
    if (deepLinkArg) {
      handleDesktopDeepLink(deepLinkArg)
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }
      mainWindow.focus()
    }
  })
}

app.on('open-url', (event, url) => {
  event.preventDefault()
  handleDesktopDeepLink(url)
})

app.whenReady().then(() => {
  if (allowInsecureCert) {
    app.on('certificate-error', (event, _webContents, _url, _error, _certificate, callback) => {
      event.preventDefault()
      callback(true)
    })
  }

  registerDesktopProtocolClient()
  createMainWindow()

  if (!isDev && mainWindow) {
    setTimeout(() => {
      setupAutoUpdater(mainWindow)
      autoUpdater.checkForUpdates().catch(() => {})
    }, 5000)
  }

  const startupDeepLink = process.argv.find(
    (arg) => typeof arg === 'string' && arg.startsWith(`${DESKTOP_AUTH_PROTOCOL}://`),
  )
  if (startupDeepLink) {
    handleDesktopDeepLink(startupDeepLink)
  }

  ipcMain.handle('app:get-versions', () => ({
    app: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
  }))

  ipcMain.handle('updater:check-for-updates', async () => {
    if (isDev) return { success: true, skipped: true }
    try {
      await autoUpdater.checkForUpdates()
      return { success: true }
    } catch (e) {
      return { success: false, error: e?.message }
    }
  })

  ipcMain.handle('updater:download-update', async () => {
    if (isDev) return { success: true, skipped: true }
    try {
      await autoUpdater.downloadUpdate()
      return { success: true }
    } catch (e) {
      return { success: false, error: e?.message }
    }
  })

  ipcMain.handle('updater:quit-and-install', () => {
    autoUpdater.quitAndInstall(false, true)
  })

  ipcMain.handle('clipboard:write-text', async (_event, payload) => {
    try {
      const text = typeof payload?.text === 'string' ? payload.text : ''
      clipboard.writeText(text)
      return { success: true }
    } catch (error) {
      return { success: false, error: error?.message || 'Could not copy text.' }
    }
  })

  ipcMain.handle('auth:google-oauth', async (_event, payload) => {
    const activeWindow = BrowserWindow.getFocusedWindow() || mainWindow
    const apiBaseUrl = normalizeBaseUrl(payload?.apiBaseUrl || '')
    return runGoogleOauthFlow(activeWindow, apiBaseUrl)
  })

  ipcMain.handle('auth:google-oauth-external', async (_event, payload) => {
    const apiBaseUrl = normalizeBaseUrl(payload?.apiBaseUrl || '')
    return runGoogleExternalOauthFlow(apiBaseUrl)
  })

  ipcMain.handle('media:get-desktop-source', async () => {
    const source = await getDefaultDesktopSource()
    if (!source) return null
    return {
      id: source.id,
      name: source.name,
    }
  })

  ipcMain.handle('media:list-desktop-sources', async () => {
    return listDesktopSources()
  })

  ipcMain.handle('media:pick-desktop-source', async () => {
    const activeWindow = BrowserWindow.getFocusedWindow() || mainWindow
    const selected = await openDesktopSourcePickerWindow(activeWindow)
    if (!selected) return null
    return {
      id: selected.id,
      name: selected.name,
      kind: selected.kind,
      thumbnailDataUrl: selected.thumbnailDataUrl,
    }
  })

  ipcMain.handle('media:get-current-window-source', async (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    if (!senderWindow || senderWindow.isDestroyed()) return null

    try {
      const sourceId =
        typeof senderWindow.getMediaSourceId === 'function'
          ? senderWindow.getMediaSourceId()
          : ''
      if (sourceId) {
        return {
          id: sourceId,
          name: senderWindow.getTitle() || 'Current Window',
          kind: 'window',
        }
      }

      const windowTitle = senderWindow.getTitle() || ''
      if (windowTitle) {
        const sources = await desktopCapturer.getSources({
          types: ['window'],
          thumbnailSize: {
            width: 0,
            height: 0,
          },
          fetchWindowIcons: false,
        })
        const matched = sources.find((source) => source.name === windowTitle)
        if (matched) {
          return {
            id: matched.id,
            name: matched.name || windowTitle,
            kind: 'window',
          }
        }
      }
    } catch {
      // fallback to null below
    }

    return null
  })

  // Resize an external window (by desktopCapturer sourceId) to target dimensions
  ipcMain.handle('media:resize-source-window', async (_e, { sourceId, width, height }) => {
    if (process.platform !== 'win32') return { success: false, error: 'Windows only' }

    const parts = String(sourceId || '').split(':')
    if (parts[0] !== 'window') return { success: false, error: 'Not a window source' }
    const hwnd = parseInt(parts[1], 10)
    if (!hwnd || isNaN(hwnd)) return { success: false, error: 'Invalid HWND' }

    const w = Math.round(Number(width))
    const h = Math.round(Number(height))

    const { execFile } = require('child_process')
    const os = require('os')
    const fs = require('fs')
    const pathMod = require('path')

    const script = [
      'Add-Type -TypeDefinition @"',
      'using System;',
      'using System.Runtime.InteropServices;',
      'public class WinResizeUtil {',
      '  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int n);',
      '  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr ins, int x, int y, int cx, int cy, uint f);',
      '}',
      '"@',
      `[WinResizeUtil]::ShowWindow([IntPtr]${hwnd}, 9)`,
      `[WinResizeUtil]::SetWindowPos([IntPtr]${hwnd}, [IntPtr]::Zero, 0, 0, ${w}, ${h}, 22)`,
    ].join('\r\n')

    const tmpFile = pathMod.join(os.tmpdir(), `ts_resize_${hwnd}.ps1`)
    fs.writeFileSync(tmpFile, script, 'utf8')

    return new Promise((resolve) => {
      execFile(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', tmpFile],
        { timeout: 8000 },
        (err) => {
          try { fs.unlinkSync(tmpFile) } catch {}
          if (err) resolve({ success: false, error: err.message })
          else resolve({ success: true })
        },
      )
    })
  })

  // Returns a primary screen source ID for loopback audio capture (no dialog)
  ipcMain.handle('media:get-screen-source-for-audio', async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1, height: 1 },
        fetchWindowIcons: false,
      })
      return sources[0] ? { id: sources[0].id } : null
    } catch {
      return null
    }
  })

  ipcMain.handle('prejoin:open', async (_event, payload) => {
    const activeWindow = BrowserWindow.getFocusedWindow() || mainWindow
    return await openPrejoinWindow(activeWindow, payload)
  })

  ipcMain.handle('conference:open-room', async (_event, payload) => {
    const activeWindow = BrowserWindow.getFocusedWindow() || mainWindow
    return await openConferenceWindow(activeWindow, payload)
  })

  ipcMain.handle('window:close-current', (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    if (senderWindow && !senderWindow.isDestroyed()) {
      senderWindow.close()
      return { success: true }
    }
    return { success: false, error: 'Window not found.' }
  })

  ipcMain.handle('window:set-resizable', (event, payload) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    if (!senderWindow || senderWindow.isDestroyed()) {
      return { success: false, error: 'Window not found.' }
    }
    const resizable = Boolean(payload?.resizable)
    senderWindow.setResizable(resizable)
    return { success: true }
  })

  ipcMain.handle('window:minimize-current', (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    if (senderWindow && !senderWindow.isDestroyed()) {
      senderWindow.minimize()
      return { success: true }
    }
    return { success: false, error: 'Window not found.' }
  })

  ipcMain.handle('window:enter-mini-mode', (event, payload) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    if (!senderWindow || senderWindow.isDestroyed()) return { success: false }

    const alreadyMini = miniModeRestoreState.has(senderWindow.id)
    if (!alreadyMini) {
      const normalBounds =
        senderWindow.isMaximized() || senderWindow.isFullScreen()
          ? senderWindow.getNormalBounds()
          : senderWindow.getBounds()
      miniModeRestoreState.set(senderWindow.id, {
        bounds: normalBounds,
        minSize: senderWindow.getMinimumSize(),
        maxSize: senderWindow.getMaximumSize(),
        isResizable: senderWindow.isResizable(),
        wasAlwaysOnTop: senderWindow.isAlwaysOnTop(),
        wasMaximized: senderWindow.isMaximized(),
        wasFullScreen: senderWindow.isFullScreen(),
      })
    }

    if (senderWindow.isFullScreen()) {
      senderWindow.setFullScreen(false)
    }
    if (senderWindow.isMaximized()) {
      senderWindow.unmaximize()
    }

    const miniWidth = 250
    const miniMinHeight = 620

    const display = screen.getDisplayMatching(senderWindow.getBounds())
    const workArea = display.workArea
    const boundedMiniWidth = Math.min(miniWidth, workArea.width - 24)
    const maxMiniHeight = Math.max(200, workArea.height - 24)
    const boundedMiniMinHeight = Math.min(miniMinHeight, maxMiniHeight)
    const currentHeight = senderWindow.getBounds().height
    const boundedMiniHeight = Math.max(
      boundedMiniMinHeight,
      Math.min(currentHeight, maxMiniHeight),
    )

    let x = workArea.x + workArea.width - miniWidth - 16
    let y = workArea.y + 8

    if (mainWindow && !mainWindow.isDestroyed()) {
      const mainBounds = mainWindow.getBounds()
      const rightX = mainBounds.x + mainBounds.width + 8
      if (rightX + boundedMiniWidth <= workArea.x + workArea.width) {
        x = rightX
      }
      y = workArea.y + 8
    }

    x = Math.max(workArea.x + 8, Math.min(x, workArea.x + workArea.width - boundedMiniWidth - 8))
    y = Math.max(workArea.y + 8, Math.min(y, workArea.y + workArea.height - boundedMiniHeight - 8))

    senderWindow.setAlwaysOnTop(true, 'floating')
    senderWindow.setResizable(true)
    senderWindow.setMinimumSize(boundedMiniWidth, boundedMiniMinHeight)
    senderWindow.setMaximumSize(boundedMiniWidth, maxMiniHeight)
    senderWindow.setBounds({ x, y, width: boundedMiniWidth, height: boundedMiniHeight }, true)

    return { success: true, alreadyMini }
  })

  // Expand window width so the drawer (chat/settings) can render at full size.
  // Saves the current mini-mode bounds so we can restore them later.
  const miniDrawerExpandState = new Map()

  ipcMain.handle('window:expand-for-drawer', (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    if (!senderWindow || senderWindow.isDestroyed()) return { success: false }

    const currentBounds = senderWindow.getBounds()
    // Target: 400px keeps the compact layout while letting the 360px drawer render in full.
    const display = screen.getDisplayMatching(currentBounds)
    const workArea = display.workArea
    const targetWidth = Math.min(400, workArea.width - 16)

    if (currentBounds.width >= targetWidth) return { success: true, expanded: false }

    miniDrawerExpandState.set(senderWindow.id, {
      bounds: currentBounds,
      maxSize: senderWindow.getMaximumSize(),
      minSize: senderWindow.getMinimumSize(),
    })

    // Remove max-size lock that mini mode sets, then expand leftward keeping right edge fixed.
    senderWindow.setMaximumSize(0, 0)
    const rightEdge = currentBounds.x + currentBounds.width
    const newX = Math.max(workArea.x + 8, rightEdge - targetWidth)
    senderWindow.setBounds({ x: newX, y: currentBounds.y, width: targetWidth, height: currentBounds.height }, true)

    return { success: true, expanded: true }
  })

  // Restore window to its pre-expansion mini-mode bounds.
  ipcMain.handle('window:collapse-from-drawer', (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    if (!senderWindow || senderWindow.isDestroyed()) return { success: false }

    const savedState = miniDrawerExpandState.get(senderWindow.id)
    if (!savedState) return { success: false }

    miniDrawerExpandState.delete(senderWindow.id)

    const { bounds, maxSize, minSize } = savedState
    if (maxSize[0] > 0 || maxSize[1] > 0) {
      senderWindow.setMaximumSize(maxSize[0], maxSize[1])
    }
    senderWindow.setMinimumSize(minSize[0], minSize[1])
    senderWindow.setBounds(bounds, true)

    return { success: true }
  })

  ipcMain.handle('window:expand-height-max', (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    if (!senderWindow || senderWindow.isDestroyed()) return { success: false, error: 'Window not found.' }

    if (senderWindow.isFullScreen()) {
      return { success: true, skipped: 'fullscreen' }
    }
    if (senderWindow.isMinimized()) {
      senderWindow.restore()
    }

    if (senderWindow.isMaximized()) {
      return { success: true, skipped: 'maximized' }
    }

    const currentBounds = senderWindow.getBounds()
    const display = screen.getDisplayMatching(currentBounds)
    const workArea = display.workArea
    const verticalPadding = 8
    const horizontalPadding = 8
    const maxAllowedWidth = Math.max(240, workArea.width - horizontalPadding * 2)
    const targetWidth = Math.min(currentBounds.width, maxAllowedWidth)
    const targetHeight = Math.max(200, workArea.height - verticalPadding * 2)
    const maxX = workArea.x + workArea.width - targetWidth - horizontalPadding
    const targetX = Math.max(workArea.x + horizontalPadding, Math.min(currentBounds.x, maxX))
    const targetY = workArea.y + verticalPadding

    senderWindow.setBounds(
      {
        x: targetX,
        y: targetY,
        width: targetWidth,
        height: targetHeight,
      },
      true,
    )
    return { success: true }
  })

  ipcMain.handle('window:exit-mini-mode', (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    if (!senderWindow || senderWindow.isDestroyed()) return { success: false }

    miniDrawerExpandState.delete(senderWindow.id)

    const savedState = miniModeRestoreState.get(senderWindow.id)
    miniModeRestoreState.delete(senderWindow.id)

    if (savedState) {
      const { bounds, minSize, maxSize, isResizable, wasAlwaysOnTop, wasMaximized, wasFullScreen } = savedState
      senderWindow.setAlwaysOnTop(Boolean(wasAlwaysOnTop))
      senderWindow.setResizable(Boolean(isResizable))
      senderWindow.setMinimumSize(
        Number.isFinite(minSize?.[0]) ? minSize[0] : DEFAULT_CONFERENCE_MIN_SIZE[0],
        Number.isFinite(minSize?.[1]) ? minSize[1] : DEFAULT_CONFERENCE_MIN_SIZE[1],
      )
      senderWindow.setMaximumSize(
        Number.isFinite(maxSize?.[0]) ? maxSize[0] : 0,
        Number.isFinite(maxSize?.[1]) ? maxSize[1] : 0,
      )

      if (wasFullScreen) {
        senderWindow.setFullScreen(true)
      } else if (wasMaximized) {
        senderWindow.setBounds(bounds, true)
        senderWindow.maximize()
      } else if (bounds) {
        senderWindow.setBounds(bounds, true)
      }

      return { success: true, restored: true }
    }

    return { success: true, restored: false }
  })

  ipcMain.handle('window:maximize-current', (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    if (senderWindow && !senderWindow.isDestroyed()) {
      if (senderWindow.isMaximized()) {
        senderWindow.unmaximize()
      } else {
        senderWindow.maximize()
      }
      return { success: true, isMaximized: senderWindow.isMaximized() }
    }
    return { success: false, error: 'Window not found.' }
  })

  ipcMain.handle('window:toggle-fullscreen', (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    if (senderWindow && !senderWindow.isDestroyed()) {
      senderWindow.setFullScreen(!senderWindow.isFullScreen())
      return { success: true, isFullScreen: senderWindow.isFullScreen() }
    }
    return { success: false, error: 'Window not found.' }
  })

  ipcMain.handle('window:is-maximized', (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    if (senderWindow && !senderWindow.isDestroyed()) {
      return { isMaximized: senderWindow.isMaximized(), isFullScreen: senderWindow.isFullScreen() }
    }
    return { isMaximized: false, isFullScreen: false }
  })

  // ── Recording: stream chunks directly to chosen folder on disk ───────────
  // sessionId → { ws: WriteStream, webmPath: string }
  const activeRecordingStreams = new Map()
  let preferredRecordingFolder = null

  ipcMain.handle('recording:get-folder', () => preferredRecordingFolder)

  ipcMain.handle('recording:choose-folder', async (event) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender) || undefined
    const result = await dialog.showOpenDialog(senderWin, {
      title: 'Choose recording save folder',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: preferredRecordingFolder || app.getPath('videos'),
    })
    if (result.canceled || !result.filePaths.length) return { success: false, cancelled: true }
    preferredRecordingFolder = result.filePaths[0]
    return { success: true, folder: preferredRecordingFolder }
  })

  ipcMain.handle('recording:open-stream', (_event, { sessionId, folder, roomSlug, filename }) => {
    try {
      const dir = path.join(folder, roomSlug)
      fs.mkdirSync(dir, { recursive: true })
      const webmPath = path.join(dir, filename)
      const ws = fs.createWriteStream(webmPath)
      ws.on('error', () => activeRecordingStreams.delete(sessionId))
      activeRecordingStreams.set(sessionId, { ws, webmPath })
      return { success: true, webmPath }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('recording:write-chunk', async (_event, { sessionId, bytes }) => {
    const rec = activeRecordingStreams.get(sessionId)
    if (!rec) return { success: false, error: 'No active stream.' }
    try {
      await new Promise((resolve, reject) =>
        rec.ws.write(Buffer.from(bytes), (err) => (err ? reject(err) : resolve()))
      )
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('recording:close-stream', async (_event, { sessionId }) => {
    const rec = activeRecordingStreams.get(sessionId)
    if (!rec) return { success: false, error: 'No active stream.' }
    activeRecordingStreams.delete(sessionId)
    await new Promise((resolve) => rec.ws.end(resolve))
    return { success: true, webmPath: rec.webmPath }
  })

  ipcMain.handle('recording:convert-background', (event, { webmPath, isH264 }) => {
    const ffmpegBin = resolveFfmpegPath()
    if (!ffmpegBin || !fs.existsSync(ffmpegBin)) {
      return { success: false, error: 'FFmpeg not available.' }
    }
    const mp4Path = webmPath.replace(/\.webm$/i, '.mp4')
    const senderWcId = event.sender.id

    // H.264 input → just remux container (seconds). VP8/VP9 → re-encode (minutes).
    const videoArgs = isH264
      ? ['-c:v', 'copy']
      : ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23']

    // Fire-and-forget: convert in background, notify renderer when done
    setImmediate(() => {
      const proc = execFile(
        ffmpegBin,
        ['-i', webmPath,
         '-map', '0:v:0', '-map', '0:a:0?',
         ...videoArgs, '-movflags', '+faststart',
         '-c:a', 'aac', '-b:a', '128k',
         '-y', mp4Path],
        { maxBuffer: 50 * 1024 * 1024 },
        (err, _stdout, stderr) => {
          const wc = webContents.fromId(senderWcId)
          if (err) {
            wc?.send('recording:convert-done', { success: false, error: stderr || err.message, webmPath })
          } else {
            fs.unlink(webmPath, () => {}) // delete source WebM after successful convert
            wc?.send('recording:convert-done', { success: true, mp4Path })
            if (wc && !wc.isDestroyed()) shell.showItemInFolder(mp4Path)
          }
        },
      )
      const timer = setTimeout(() => {
        proc.kill()
        const wc = webContents.fromId(senderWcId)
        wc?.send('recording:convert-done', { success: false, error: 'FFmpeg timed out.', webmPath })
      }, 10 * 60 * 1000)
      proc.on('close', () => clearTimeout(timer))
    })

    return { success: true }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
