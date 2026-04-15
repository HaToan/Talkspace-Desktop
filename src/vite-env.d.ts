/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_API_PROXY_TARGET?: string
  readonly VITE_LIVEKIT_URL?: string
  readonly NEXT_PUBLIC_BASE_URL?: string
  readonly NEXT_PUBLIC_DOMAIN?: string
  readonly NEXT_PUBLIC_DOMAIN_AUTH?: string
  readonly NEXT_PUBLIC_LIVEKIT_URL?: string
}

declare global {
  interface Window {
    electronAPI?: {
      getVersions: () => Promise<{
        electron: string
        chrome: string
        node: string
        platform: string
      }>
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
        initialSettings?: {
          micEnabled?: boolean
          camEnabled?: boolean
          backgroundMode?: 'none' | 'blur' | 'dim'
          microphoneDeviceId?: string
          speakerDeviceId?: string
          cameraDeviceId?: string
        }
      }) => Promise<{
        confirmed: boolean
        settings?: {
          micEnabled: boolean
          camEnabled: boolean
          backgroundMode: 'none' | 'blur' | 'dim'
          microphoneDeviceId?: string
          speakerDeviceId?: string
          cameraDeviceId?: string
        }
      }>
      openConferenceWindow: (payload: {
        roomId: string
        roomTitle: string
        joinAsAudience: boolean
        prejoinSettings?: {
          micEnabled: boolean
          camEnabled: boolean
          backgroundMode: 'none' | 'blur' | 'dim'
          microphoneDeviceId?: string
          speakerDeviceId?: string
          cameraDeviceId?: string
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
      saveRecording: (payload: {
        bytes: Uint8Array
        defaultFileName: string
        extension?: 'webm' | 'mp4'
      }) => Promise<{
        success: boolean
        cancelled?: boolean
        filePath?: string
        error?: string
      }>
    }
  }
}

export {}
