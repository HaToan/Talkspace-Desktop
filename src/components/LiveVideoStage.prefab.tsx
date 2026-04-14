import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  LiveKitRoom,
  MediaDeviceMenu,
  VideoConference as LiveKitVideoConference,
  useConnectionState,
} from '@livekit/components-react'
import { ConnectionState } from 'livekit-client'

const normalizeUrl = (value?: string) => {
  if (!value) return ''
  return value.trim().replace(/\/+$/, '')
}

const CONNECTION_TIMEOUT_MS = 12_000

const getMediaDeviceFailureMessage = (kind?: MediaDeviceKind) => {
  if (kind === 'audioinput') return 'Microphone is unavailable or permission is blocked.'
  if (kind === 'videoinput') return 'Camera is unavailable or permission is blocked.'
  if (kind === 'audiooutput') return 'Speaker device is unavailable.'
  return 'Media device is unavailable or permission is blocked.'
}

function SettingsPanel() {
  return (
    <div className="desktop-vc-settings">
      <div className="desktop-vc-settings__header">
        <strong>Device settings</strong>
        <span>Choose microphone, camera, and speaker</span>
      </div>
      <div className="desktop-vc-settings__body">
        <section className="desktop-vc-settings__section">
          <label>Microphone</label>
          <MediaDeviceMenu kind="audioinput" />
        </section>
        <section className="desktop-vc-settings__section">
          <label>Camera</label>
          <MediaDeviceMenu kind="videoinput" />
        </section>
        <section className="desktop-vc-settings__section">
          <label>Speaker</label>
          <MediaDeviceMenu kind="audiooutput" />
        </section>
      </div>
    </div>
  )
}

function ConnectionGuard({
  onTimeout,
  onUnexpectedDisconnect,
}: {
  onTimeout: () => void
  onUnexpectedDisconnect: () => void
}) {
  const state = useConnectionState()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const everConnectingRef = useRef(false)
  const everConnectedRef = useRef(false)

  useEffect(() => {
    if (state === ConnectionState.Connected) {
      everConnectedRef.current = true
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
      return
    }

    if (state === ConnectionState.Connecting) {
      everConnectingRef.current = true
      if (!timerRef.current) {
        timerRef.current = window.setTimeout(onTimeout, CONNECTION_TIMEOUT_MS)
      }
      return
    }

    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }

    if (state === ConnectionState.Disconnected) {
      if (everConnectingRef.current && !everConnectedRef.current) {
        onUnexpectedDisconnect()
      }
    }
  }, [onTimeout, onUnexpectedDisconnect, state])

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
      }
    }
  }, [])

  return null
}

type PendingSpeakerRequest = {
  id: string
  title: string
  note?: string
  requestedAt?: string
}

type Props = {
  token?: string
  serverUrl?: string
  roomTitle: string
  roomName: string
  localUserName?: string
  localUsername?: string
  localAvatarUrl?: string
  participantAvatarMap?: Record<string, string>
  audience: boolean
  initialMicEnabled?: boolean
  initialCameraEnabled?: boolean
  chatOpen: boolean
  chatBadgeCount?: number
  settingsBadgeCount?: number
  pendingSpeakerRequests?: PendingSpeakerRequest[]
  onToggleChat: () => void
  onLeave: () => void
  onRequestSpeaker?: () => Promise<string | null>
}

export default function LiveVideoStage(props: Props) {
  const {
    token,
    serverUrl,
    roomTitle,
    roomName,
    audience,
    initialMicEnabled = false,
    initialCameraEnabled = false,
    onLeave,
  } = props

  const resolvedServerUrl = useMemo(() => {
    return (
      normalizeUrl(serverUrl) ||
      normalizeUrl(import.meta.env.VITE_LIVEKIT_URL) ||
      normalizeUrl(import.meta.env.NEXT_PUBLIC_LIVEKIT_URL)
    )
  }, [serverUrl])

  const [connectError, setConnectError] = useState('')
  const [retrySeed, setRetrySeed] = useState(0)

  useEffect(() => {
    setConnectError('')
    setRetrySeed(0)
  }, [roomName, token, resolvedServerUrl])

  const handleRetry = useCallback(() => {
    setConnectError('')
    setRetrySeed((value) => value + 1)
  }, [])

  const handleLiveKitError = useCallback((error: Error) => {
    setConnectError(error?.message || 'Unable to connect media server.')
  }, [])

  const handleTimeout = useCallback(() => {
    setConnectError(
      `Connection timed out after ${CONNECTION_TIMEOUT_MS / 1000}s. Server did not respond: ${resolvedServerUrl}`,
    )
  }, [resolvedServerUrl])

  const handleUnexpectedDisconnect = useCallback(() => {
    setConnectError(`Could not connect to the media server: ${resolvedServerUrl}`)
  }, [resolvedServerUrl])

  const handleMediaDeviceFailure = useCallback((_: unknown, kind?: MediaDeviceKind) => {
    setConnectError(getMediaDeviceFailureMessage(kind))
  }, [])

  if (!resolvedServerUrl) {
    return (
      <div className="stage desktop-vc-state">
        <h2>{roomTitle}</h2>
        <p>Set `VITE_LIVEKIT_URL` (or `NEXT_PUBLIC_LIVEKIT_URL`) to show video conference.</p>
      </div>
    )
  }

  if (!token) {
    return (
      <div className="stage desktop-vc-state">
        <h2>{roomTitle}</h2>
        <p>Joining room and preparing media session...</p>
      </div>
    )
  }

  if (connectError) {
    return (
      <div className="stage desktop-vc-state desktop-vc-state--error">
        <h2>{roomTitle}</h2>
        <p>{connectError}</p>
        <div className="desktop-vc-state__actions">
          <button className="ghost-button" onClick={onLeave} type="button">
            Back
          </button>
          <button className="primary-button" onClick={handleRetry} type="button">
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="desktop-vc-shell" data-lk-theme="default">
      <style>{`
        .desktop-vc-shell {
          width: 100%;
          height: 100%;
          min-height: 0;
          overflow: hidden;
        }
        .desktop-vc-shell .livekit-stage-rebuilt {
          width: 100%;
          height: 100%;
          min-height: 0;
          background: #0b1220;
          border: 1px solid rgba(58, 88, 124, 0.62);
          border-radius: 16px;
          overflow: hidden;
        }
        .desktop-vc-shell .lk-video-conference,
        .desktop-vc-shell .lk-video-conference-inner,
        .desktop-vc-shell .lk-grid-layout-wrapper,
        .desktop-vc-shell .lk-focus-layout-wrapper,
        .desktop-vc-shell .lk-grid-layout,
        .desktop-vc-shell .lk-focus-layout {
          height: 100%;
          min-height: 0;
        }
        .desktop-vc-shell .lk-video-conference {
          background:
            radial-gradient(circle at top, rgba(30, 64, 175, 0.18), transparent 34%),
            linear-gradient(180deg, #08111f, #050b15 60%);
        }
        .desktop-vc-shell .lk-grid-layout,
        .desktop-vc-shell .lk-focus-layout {
          padding: 12px;
          gap: 12px;
        }
        .desktop-vc-shell .lk-participant-tile {
          border-radius: 18px;
          border: 1px solid rgba(71, 124, 196, 0.28);
          background: rgba(8, 17, 32, 0.92);
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03);
        }
        .desktop-vc-shell .lk-participant-media-video,
        .desktop-vc-shell .lk-participant-placeholder {
          border-radius: 16px;
        }
        .desktop-vc-shell .lk-focus-layout {
          grid-template-columns: minmax(0, 1fr);
          grid-template-rows: auto minmax(0, 1fr);
        }
        .desktop-vc-shell .lk-carousel {
          width: 100%;
          padding: 0 2px;
          min-height: 104px;
          max-height: 148px;
          overflow-x: auto;
          overflow-y: hidden;
          border-radius: 14px;
          border: 1px solid rgba(71, 124, 196, 0.22);
          background: rgba(7, 14, 25, 0.72);
        }
        .desktop-vc-shell .lk-carousel > * {
          min-width: 150px;
        }
        .desktop-vc-shell .lk-control-bar {
          position: absolute;
          left: 50%;
          bottom: 18px;
          transform: translateX(-50%);
          z-index: 10;
          padding: 10px 12px;
          border: 1px solid rgba(84, 133, 206, 0.22);
          border-radius: 18px;
          background: rgba(3, 10, 21, 0.82);
          box-shadow: 0 14px 34px rgba(0, 0, 0, 0.35);
          backdrop-filter: blur(18px);
        }
        .desktop-vc-shell .lk-control-bar .lk-button-group-menu {
          display: none !important;
        }
        .desktop-vc-shell .lk-control-bar .lk-button,
        .desktop-vc-shell .lk-control-bar .lk-disconnect-button,
        .desktop-vc-shell .lk-control-bar .lk-chat-toggle {
          width: 44px;
          height: 44px;
          padding: 0;
          border-radius: 12px;
          border: 1px solid rgba(84, 133, 206, 0.22);
          background: rgba(13, 24, 43, 0.96);
          box-shadow: none;
          font-size: 0;
          line-height: 0;
          color: #e2ecff;
        }
        .desktop-vc-shell .lk-control-bar .lk-button:hover,
        .desktop-vc-shell .lk-control-bar .lk-disconnect-button:hover,
        .desktop-vc-shell .lk-control-bar .lk-chat-toggle:hover {
          background: rgba(20, 37, 66, 1);
          border-color: rgba(96, 165, 250, 0.5);
        }
        .desktop-vc-shell .lk-control-bar .lk-disconnect-button {
          background: linear-gradient(135deg, rgba(166, 38, 38, 0.96), rgba(238, 73, 73, 0.9));
          border-color: rgba(255, 126, 126, 0.56);
          color: #fff2f2;
        }
        .desktop-vc-shell .lk-control-bar .lk-disconnect-button:hover {
          background: linear-gradient(135deg, rgba(190, 45, 45, 0.96), rgba(248, 95, 95, 0.92));
          border-color: rgba(255, 151, 151, 0.72);
        }
        .desktop-vc-shell .lk-chat,
        .desktop-vc-shell .lk-settings-menu-modal {
          position: absolute;
          top: 12px;
          right: 12px;
          bottom: 82px;
          width: min(360px, 34vw);
          min-width: 300px;
          margin: 0;
          border-radius: 18px;
          border: 1px solid rgba(71, 124, 196, 0.24);
          background: linear-gradient(180deg, rgba(11, 20, 36, 0.98), rgba(7, 13, 25, 0.98));
          box-shadow: -18px 0 44px rgba(0, 0, 0, 0.36);
          overflow: hidden;
          z-index: 20;
        }
        .desktop-vc-shell .lk-chat-header,
        .desktop-vc-shell .desktop-vc-settings__header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 14px 16px;
          border-bottom: 1px solid rgba(71, 124, 196, 0.18);
          background: rgba(12, 22, 39, 0.96);
        }
        .desktop-vc-shell .desktop-vc-settings__header {
          flex-direction: column;
          align-items: flex-start;
        }
        .desktop-vc-shell .desktop-vc-settings__header span {
          color: #8ea8ce;
          font-size: 12px;
        }
        .desktop-vc-shell .desktop-vc-settings__body {
          display: grid;
          gap: 18px;
          padding: 18px 16px;
        }
        .desktop-vc-shell .desktop-vc-settings__section {
          display: grid;
          gap: 10px;
        }
        .desktop-vc-shell .desktop-vc-settings__section label {
          color: #cddcf5;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.03em;
          text-transform: uppercase;
        }
        .desktop-vc-shell .desktop-vc-settings button {
          width: 100%;
          justify-content: flex-start;
        }
        .desktop-vc-shell .lk-chat-form {
          border-top: 1px solid rgba(71, 124, 196, 0.18);
          background: rgba(9, 16, 29, 0.96);
        }
        .desktop-vc-shell .lk-chat-entry .lk-message-body {
          background: rgba(12, 25, 43, 0.96);
          border: 1px solid rgba(71, 124, 196, 0.18);
          color: #dbe7fb;
        }
        .desktop-vc-shell .lk-participant-tile .lk-focus-toggle-button {
          opacity: 1;
          background: rgba(2, 8, 19, 0.72);
          border: 1px solid rgba(84, 133, 206, 0.24);
        }
        @media (max-width: 900px) {
          .desktop-vc-shell .lk-chat,
          .desktop-vc-shell .lk-settings-menu-modal {
            left: 12px;
            width: auto;
            min-width: 0;
          }
        }
      `}</style>
      <LiveKitRoom
        key={`${roomName}:${retrySeed}:${token}`}
        token={token}
        serverUrl={resolvedServerUrl}
        connect
        audio={!audience && initialMicEnabled}
        video={!audience && initialCameraEnabled}
        className="stage livekit-stage livekit-stage-rebuilt"
        data-lk-theme="default"
        onError={handleLiveKitError}
        onDisconnected={() => {
          if (!connectError) {
            onLeave()
          }
        }}
        onMediaDeviceFailure={handleMediaDeviceFailure}
      >
        <ConnectionGuard
          onTimeout={handleTimeout}
          onUnexpectedDisconnect={handleUnexpectedDisconnect}
        />
        <LiveKitVideoConference SettingsComponent={SettingsPanel} />
      </LiveKitRoom>
    </div>
  )
}
