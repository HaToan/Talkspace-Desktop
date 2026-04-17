/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_API_PROXY_TARGET?: string
  readonly VITE_LIVEKIT_URL?: string
  readonly VITE_SUPPORT_FORM_URL?: string
  readonly NEXT_PUBLIC_BASE_URL?: string
  readonly NEXT_PUBLIC_DOMAIN?: string
  readonly NEXT_PUBLIC_DOMAIN_AUTH?: string
  readonly NEXT_PUBLIC_LIVEKIT_URL?: string
  readonly NEXT_PUBLIC_SUPPORT_FORM_URL?: string
}

declare global {
  interface Window {
    electronAPI?: {
      getVersions: () => Promise<{
        app?: string
        electron: string
        chrome: string
        node: string
        platform: string
      }>
      copyToClipboard: (text: string) => Promise<{
        success: boolean
        error?: string
      }>
      checkForUpdates?: () => Promise<{ success: boolean; skipped?: boolean; error?: string }>
      downloadUpdate?: () => Promise<{ success: boolean; skipped?: boolean; error?: string }>
      quitAndInstall?: () => Promise<void>
      onUpdateAvailable?: (cb: (info: { version: string }) => void) => () => void
      onDownloadProgress?: (cb: (progress: { percent: number }) => void) => () => void
      onUpdateDownloaded?: (cb: (info: { version: string }) => void) => () => void
      startGoogleOAuth: (payload: {
        apiBaseUrl: string
      }) => Promise<{
        success: boolean
        cancelled?: boolean
        error?: string
      }>
      startGoogleOAuthExternal: (payload: {
        apiBaseUrl: string
      }) => Promise<{
        success: boolean
        cancelled?: boolean
        handoffToken?: string
        error?: string
      }>
      getDesktopSource: () => Promise<
        | {
            id: string
            name: string
          }
        | null
      >
      listDesktopSources: () => Promise<
        Array<{
          id: string
          name: string
          kind: 'screen' | 'window'
          thumbnailDataUrl: string
        }>
      >
      pickDesktopSource: () => Promise<
        | {
            id: string
            name: string
            kind: 'screen' | 'window'
            thumbnailDataUrl: string
          }
        | null
      >
      getScreenSourceForAudio: () => Promise<{ id: string } | null>
      resizeSourceWindow: (payload: { sourceId: string; width: number; height: number }) => Promise<{ success: boolean; error?: string }>
      getCurrentWindowSource: () => Promise<
        | {
            id: string
            name: string
            kind: 'window'
          }
        | null
      >
      openPrejoinWindow: (payload: {
        roomTitle: string
        joinAsAudience: boolean
        canManageAudience?: boolean
        userInfo?: {
          name?: string
          username?: string
          avatar?: string
        }
        allowedJoinRoles?: Array<'member' | 'listener' | 'host' | 'co_host'>
        roomInfo?: {
          title?: string
          category?: string
          status?: 'open' | 'scheduled' | 'closed' | string
          hostName?: string
          description?: string
          participantCount?: number
          maxParticipants?: number
          isPrivate?: boolean
          audienceEnabled?: boolean
          scheduleLabel?: string
          roomName?: string
        }
        initialSettings?: {
          micEnabled?: boolean
          camEnabled?: boolean
          backgroundMode?: 'none' | 'blur' | 'nature' | 'office'
          microphoneDeviceId?: string
          speakerDeviceId?: string
          cameraDeviceId?: string
          joinRole?: 'member' | 'listener' | 'host' | 'co_host'
          audienceEnabled?: boolean
        }
      }) => Promise<{
        confirmed: boolean
        settings?: {
          micEnabled: boolean
          camEnabled: boolean
          backgroundMode: 'none' | 'blur' | 'nature' | 'office'
          microphoneDeviceId?: string
          speakerDeviceId?: string
          cameraDeviceId?: string
          joinRole?: 'member' | 'listener' | 'host' | 'co_host'
          audienceEnabled?: boolean
        }
      }>
      openConferenceWindow: (payload: {
        roomId: string
        roomTitle: string
        joinAsAudience: boolean
        prejoinSettings?: {
          micEnabled: boolean
          camEnabled: boolean
          backgroundMode: 'none' | 'blur' | 'nature' | 'office'
          microphoneDeviceId?: string
          speakerDeviceId?: string
          cameraDeviceId?: string
          joinRole?: 'member' | 'listener' | 'host' | 'co_host'
        }
      }) => Promise<{
        success: boolean
        error?: string
      }>
      closeCurrentWindow: () => Promise<{
        success: boolean
        error?: string
      }>
      minimizeCurrentWindow: () => Promise<{
        success: boolean
        error?: string
      }>
      enterMiniMode: (payload?: { participantCount?: number }) => Promise<{
        success: boolean
        alreadyMini?: boolean
        error?: string
      }>
      exitMiniMode: () => Promise<{
        success: boolean
        restored?: boolean
        error?: string
      }>
      setCurrentWindowResizable: (resizable: boolean) => Promise<{
        success: boolean
        error?: string
      }>
      maximizeCurrentWindow: () => Promise<{
        success: boolean
        isMaximized: boolean
        isFullScreen: boolean
        error?: string
      }>
      toggleFullscreenCurrentWindow: () => Promise<{
        success: boolean
        isMaximized: boolean
        isFullScreen: boolean
        error?: string
      }>
      isMaximizedCurrentWindow: () => Promise<{
        success: boolean
        isMaximized: boolean
        isFullScreen: boolean
        error?: string
      }>
      expandForDrawer: () => Promise<{
        success: boolean
        expanded?: boolean
        error?: string
      }>
      collapseFromDrawer: () => Promise<{
        success: boolean
        error?: string
      }>
      expandCurrentWindowHeight: () => Promise<{
        success: boolean
        skipped?: string
        error?: string
      }>
      getRecordingFolder: () => Promise<string | null>
      isRecordingFolderValid: (payload: { folder: string }) => Promise<{ success: boolean; valid: boolean; error?: string }>
      chooseRecordingFolder: () => Promise<{ success: boolean; cancelled?: boolean; folder?: string }>
      openRecordingStream: (payload: {
        sessionId: string
        folder: string
        roomSlug: string
        filename: string
      }) => Promise<{ success: boolean; webmPath?: string; error?: string }>
      writeRecordingChunk: (payload: { sessionId: string; bytes: Uint8Array }) => Promise<{
        success: boolean
        error?: string
      }>
      closeRecordingStream: (payload: { sessionId: string }) => Promise<{
        success: boolean
        webmPath?: string
        error?: string
      }>
      convertBackground: (payload: {
        webmPath: string
        isH264: boolean
        recordMeta?: {
          roomId?: string
          roomName?: string
          roomCategory?: string
          roomCategoryId?: string
          roomTitle?: string
          firstParticipantName?: string
          date?: string
        }
      }) => Promise<{
        success: boolean
        error?: string
      }>
      onConvertDone: (cb: (result: {
        success: boolean
        mp4Path?: string
        webmPath?: string
        error?: string
      }) => void) => () => void
      saveRecording?: (payload: {
        bytes: Uint8Array
        defaultFileName: string
        extension: string
      }) => Promise<{
        success: boolean
        filePath?: string
        cancelled?: boolean
        error?: string
      }>
      listRecordingFiles: () => Promise<Array<{
        filename: string
        path: string
        size: number
        createdAt: number
        youtubeVideoId?: string
        youtubeUrl?: string
        youtubeUploadedAt?: number
      }>>
      listRecordingUploadHistory: () => Promise<Array<{
        id: string
        filename: string
        localPath?: string
        youtubeVideoId?: string
        youtubeUrl?: string
        title?: string
        roomId?: string
        roomName?: string
        recordDate?: string
        backendSyncedAt?: number
        backendSyncError?: string
        backendSyncRetryCount?: number
        backendNextRetryAt?: number
        source?: 'manual' | 'auto' | string
        uploadedAt: number
      }>>
      markRecordingUploadHistorySync: (payload: {
        id: string
        backendSyncedAt?: number
        backendSyncError?: string
        backendSyncRetryCount?: number
        backendNextRetryAt?: number
      }) => Promise<{ success: boolean; error?: string }>
      listCurrentUploads: () => Promise<Array<{
        filePath: string
        filename: string
        progress: number
        status: 'uploading' | 'done' | 'error' | string
        error?: string
        source?: 'manual' | 'auto' | string
        startedAt: number
      }>>
      autoUploadStatus: () => Promise<{ enabled: boolean }>
      setAutoUploadEnabled: (payload: { enabled: boolean }) => Promise<{ success: boolean; enabled: boolean; error?: string }>
      deleteRecordingFile: (payload: { path: string }) => Promise<{ success: boolean; error?: string }>
      revealRecordingFile: (payload: { path: string }) => Promise<{ success: boolean; error?: string }>
      saveYoutubeClientId: (payload: { clientId: string; clientSecret?: string }) => Promise<{ success: boolean; error?: string }>
      youtubeStatus: () => Promise<{ connected: boolean; configured: boolean; channelTitle?: string; channelId?: string }>
      youtubeAuth: () => Promise<{ success: boolean; channelTitle?: string; channelId?: string; error?: string; cancelled?: boolean }>
      youtubeRevoke: () => Promise<{ success: boolean; error?: string }>
      youtubeUpload: (payload: { sessionId: string; filePath: string; title: string; description?: string; privacyStatus?: 'public' | 'unlisted' | 'private' }) => Promise<{ success: boolean; videoId?: string; videoUrl?: string; error?: string }>
      youtubeUploadCancel: (payload: { sessionId: string }) => Promise<{ success: boolean; error?: string }>
      onYoutubeProgress: (cb: (data: { sessionId: string; progress: number; done: boolean; videoId?: string; error?: string }) => void) => () => void
      onYoutubeUploaded: (cb: (data: {
        roomId: string
        title: string
        date: string
        url: string
        filePath: string
        filename: string
        source?: 'manual' | 'auto' | string
        uploadedAt: number
      }) => void) => () => void
      onRecordingUploadsState: (cb: (data: Array<{
        filePath: string
        filename: string
        progress: number
        status: 'uploading' | 'done' | 'error' | string
        error?: string
        source?: 'manual' | 'auto' | string
        startedAt: number
      }>) => void) => () => void
    }
  }
}

export {}
