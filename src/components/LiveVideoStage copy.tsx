import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CarouselLayout,
  ConnectionStateToast,
  FocusLayout,
  FocusLayoutContainer,
  GridLayout,
  LayoutContextProvider,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  isTrackReference,
  useCreateLayoutContext,
  useLocalParticipant,
  useMaybeTrackRefContext,
  usePinnedTracks,
  useRoomContext,
  useTrackToggle,
  useTracks,
} from '@livekit/components-react'
import { Participant, Track } from 'livekit-client'

const normalizeUrl = (value?: string) => {
  if (!value) return ''
  return value.trim().replace(/\/+$/, '')
}

const isSameTrackRef = (left: any, right: any) => {
  if (!left || !right) return false
  const leftSid = left.publication?.trackSid
  const rightSid = right.publication?.trackSid
  if (leftSid && rightSid) return leftSid === rightSid
  return (
    left.participant?.identity === right.participant?.identity &&
    left.source === right.source
  )
}

const isScreenShareNotSupportedError = (error: any) => {
  const message = String(error?.message || '').toLowerCase()
  const name = String(error?.name || '').toLowerCase()
  return message.includes('not supported') || name.includes('notsupported')
}

const getScreenShareFriendlyError = (error: any) => {
  const message = String(error?.message || '').toLowerCase()
  const name = String(error?.name || '').toLowerCase()
  if (name.includes('notallowed') || message.includes('permission denied')) {
    return 'Screen share permission denied. Allow screen capture in OS/Electron settings.'
  }
  if (name.includes('notfound') || message.includes('could not start video source')) {
    return 'No screen source available to capture.'
  }
  return `Screen share failed: ${error?.message || 'unknown error'}`
}

const getSupportedRecordingMimeType = () => {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]
  for (const candidate of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(candidate)) {
      return candidate
    }
  }
  return ''
}

const buildRecordingFileName = (prefix = 'talkspace-meeting') => {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `${prefix}-${date}-${time}.webm`
}

type RecordingQualityPreset = 'performance' | 'balanced' | 'quality'

type RecordingQualityConfig = {
  width: number
  height: number
  frameRate: number
  videoBitsPerSecond: number
  label: string
}

const RECORDING_QUALITY_CONFIGS: Record<RecordingQualityPreset, RecordingQualityConfig> = {
  performance: {
    width: 1280,
    height: 720,
    frameRate: 30,
    videoBitsPerSecond: 6_000_000,
    label: 'Performance (720p30)',
  },
  balanced: {
    width: 1920,
    height: 1080,
    frameRate: 30,
    videoBitsPerSecond: 12_000_000,
    label: 'Balanced (1080p30)',
  },
  quality: {
    width: 1920,
    height: 1080,
    frameRate: 60,
    videoBitsPerSecond: 20_000_000,
    label: 'Quality (1080p60)',
  },
}
const SHARE_COMPOSER_MIN_PANEL_WIDTH = 280
const SHARE_COMPOSER_MAX_PANEL_WIDTH = 340
const SHARE_COMPOSER_PANEL_RATIO = 0.18
const SHARE_COMPOSER_TILE_GAP = 8
const SHARE_COMPOSER_MAX_TILES = 8
const SHARE_COMPOSER_TILE_MIN_HEIGHT = 82
const SHARE_COMPOSER_TILE_MAX_HEIGHT = 420
const SHARE_COMPOSER_TILE_RADIUS = 12
const SHARE_COMPOSER_SHARE_RADIUS = 18

type StageLayoutMode = 'auto' | 'grid' | 'focus' | 'share' | 'host-share'

const normalizeKey = (value?: string) => value?.trim().toLowerCase() || ''
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const extractCssUrl = (raw: string) => {
  if (!raw) return ''
  const matched = raw.match(/url\((['"]?)(.*?)\1\)/i)
  return matched?.[2]?.trim() || ''
}

const getRecordingModeLabel = (mode: 'room' | 'share-only' | 'share-composer') => {
  if (mode === 'share-only') return 'Shared window only (HQ)'
  if (mode === 'share-composer') return 'Share + participants (HQ share)'
  return 'Room content only'
}

const getRecordingQualityLabel = (preset: RecordingQualityPreset) =>
  RECORDING_QUALITY_CONFIGS[preset]?.label || RECORDING_QUALITY_CONFIGS.balanced.label

const getAvatarFromParticipantMetadata = (participant?: Participant | null) => {
  const metadata = participant?.metadata
  if (!metadata) return ''

  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>
    const candidates = [
      parsed.avatar,
      parsed.avatarUrl,
      parsed.picture,
      parsed.photo,
      parsed.image,
      parsed.imageUrl,
    ]
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim()
      }
    }
  } catch {
    // ignore malformed participant metadata
  }
  return ''
}

const toCssUrl = (rawUrl: string) => `url("${encodeURI(rawUrl)}")`

const AvatarParticipantTile = ({
  resolveParticipantAvatar,
}: {
  resolveParticipantAvatar: (participant?: Participant | null) => string
}) => {
  const trackRef = useMaybeTrackRefContext()
  const avatarUrl = resolveParticipantAvatar(trackRef?.participant)
  const style = avatarUrl
    ? ({ ['--lk-avatar-image' as any]: toCssUrl(avatarUrl) } as React.CSSProperties)
    : undefined

  return (
    <ParticipantTile
      className={avatarUrl ? 'lk-avatar-participant-tile' : undefined}
      style={style}
    />
  )
}

const LiveStageLayout = ({
  resolveParticipantAvatar,
  localParticipantIdentity = '',
  localMicEnabled = false,
  onToggleLocalMic,
  layoutMode,
}: {
  resolveParticipantAvatar: (participant?: Participant | null) => string
  localParticipantIdentity?: string
  localMicEnabled?: boolean
  onToggleLocalMic?: () => void
  layoutMode: StageLayoutMode
}) => {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    {
      onlySubscribed: false,
    },
  )
  const layoutContext = useCreateLayoutContext()
  const focusTrack = usePinnedTracks(layoutContext)?.[0]
  const cameraTracks = tracks.filter((track) => track.source === Track.Source.Camera)
  const screenShareTracks = tracks
    .filter(isTrackReference)
    .filter((track) => track.publication.source === Track.Source.ScreenShare)
  const [autoFocusedTrackSid, setAutoFocusedTrackSid] = useState<string | null>(null)
  const preferredCameraTrack = cameraTracks[0] || null
  const preferredScreenShareTrack = screenShareTracks[0] || null

  useEffect(() => {
    if (layoutMode === 'auto') return
    if (autoFocusedTrackSid !== null) {
      setAutoFocusedTrackSid(null)
    }
  }, [autoFocusedTrackSid, layoutMode])

  useEffect(() => {
    if (layoutMode !== 'auto') {
      return
    }

    const hasSubscribedScreenShare = screenShareTracks.some(
      (track) => track.publication.isSubscribed,
    )

    if (hasSubscribedScreenShare && !autoFocusedTrackSid && screenShareTracks[0]) {
      layoutContext.pin.dispatch?.({
        msg: 'set_pin',
        trackReference: screenShareTracks[0],
      })
      setAutoFocusedTrackSid(screenShareTracks[0].publication.trackSid ?? null)
      return
    }

    if (
      autoFocusedTrackSid &&
      !screenShareTracks.some((track) => track.publication.trackSid === autoFocusedTrackSid)
    ) {
      if (
        focusTrack &&
        isTrackReference(focusTrack) &&
        focusTrack.publication.trackSid === autoFocusedTrackSid
      ) {
        layoutContext.pin.dispatch?.({ msg: 'clear_pin' })
      }
      setAutoFocusedTrackSid(null)
      return
    }
  }, [autoFocusedTrackSid, focusTrack, layoutContext.pin, layoutMode, screenShareTracks])

  useEffect(() => {
    if (!focusTrack || isTrackReference(focusTrack)) {
      return
    }

    const updatedFocusTrack = tracks.find(
      (track) =>
        track.participant.identity === focusTrack.participant.identity &&
        track.source === focusTrack.source,
    )

    if (updatedFocusTrack && isTrackReference(updatedFocusTrack) && !isSameTrackRef(updatedFocusTrack, focusTrack)) {
      layoutContext.pin.dispatch?.({
        msg: 'set_pin',
        trackReference: updatedFocusTrack,
      })
    }
  }, [focusTrack, layoutContext.pin, tracks])

  useEffect(() => {
    if (layoutMode === 'auto') {
      return
    }

    if (layoutMode === 'grid') {
      if (focusTrack) {
        layoutContext.pin.dispatch?.({ msg: 'clear_pin' })
      }
      return
    }

    const preferredTrack =
      layoutMode === 'focus'
        ? preferredCameraTrack || preferredScreenShareTrack
        : layoutMode === 'share' || layoutMode === 'host-share'
          ? preferredScreenShareTrack || preferredCameraTrack
          : null

    if (preferredTrack && !isSameTrackRef(preferredTrack, focusTrack)) {
      layoutContext.pin.dispatch?.({
        msg: 'set_pin',
        trackReference: preferredTrack,
      })
      return
    }

    if (!preferredTrack && focusTrack) {
      layoutContext.pin.dispatch?.({ msg: 'clear_pin' })
    }
  }, [focusTrack, layoutContext.pin, layoutMode, preferredCameraTrack, preferredScreenShareTrack])

  const renderFocusTrack =
    focusTrack ||
    (layoutMode === 'focus'
      ? preferredCameraTrack || preferredScreenShareTrack
      : layoutMode === 'share' || layoutMode === 'host-share'
        ? preferredScreenShareTrack || preferredCameraTrack
        : null)
  const carouselTracks = tracks.filter((track) => !isSameTrackRef(track, renderFocusTrack))
  const isScreenShareFocus =
    Boolean(renderFocusTrack) &&
    isTrackReference(renderFocusTrack) &&
    renderFocusTrack.publication.source === Track.Source.ScreenShare
  const showGridLayout =
    layoutMode === 'grid' || !renderFocusTrack || (layoutMode === 'auto' && !focusTrack)
  const showHostScreenShareLayout =
    !showGridLayout &&
    isScreenShareFocus &&
    layoutMode === 'host-share'
  const showScreenShareLayout =
    !showGridLayout &&
    isScreenShareFocus &&
    (layoutMode === 'share' || layoutMode === 'auto')

  return (
    <LayoutContextProvider value={layoutContext}>
      {showGridLayout ? (
        <div className="livekit-grid-wrapper livekit-grid-wrapper--expanded">
          <GridLayout className="livekit-grid" tracks={tracks}>
            <AvatarParticipantTile resolveParticipantAvatar={resolveParticipantAvatar} />
          </GridLayout>
        </div>
      ) : (
        <div
          className={`livekit-focus-wrapper ${
            showHostScreenShareLayout
              ? 'livekit-focus-wrapper--screenshare-host'
              : showScreenShareLayout
                ? 'livekit-focus-wrapper--screenshare'
                : ''
          } livekit-focus-wrapper--expanded`}
        >
          <FocusLayoutContainer>
            {showScreenShareLayout || showHostScreenShareLayout ? (
              <>
                <CarouselLayout tracks={carouselTracks} orientation="horizontal">
                  <AvatarParticipantTile resolveParticipantAvatar={resolveParticipantAvatar} />
                </CarouselLayout>
                <FocusLayout trackRef={renderFocusTrack} />
              </>
            ) : (
              <>
                <CarouselLayout tracks={carouselTracks} orientation="horizontal">
                  <AvatarParticipantTile resolveParticipantAvatar={resolveParticipantAvatar} />
                </CarouselLayout>
                <FocusLayout trackRef={renderFocusTrack} />
              </>
            )}
          </FocusLayoutContainer>
        </div>
      )}
    </LayoutContextProvider>
  )
}

const DeviceSettingsPanel = ({
  onError,
  onClose,
  pendingSpeakerRequests,
  recordingMode,
  onRecordingModeChange,
  recordingQuality,
  onRecordingQualityChange,
}: {
  onError: (message: string) => void
  onClose: () => void
  pendingSpeakerRequests: Array<{
    id: string
    title: string
    note?: string
    requestedAt?: string
  }>
  recordingMode: 'room' | 'share-only' | 'share-composer'
  onRecordingModeChange: (mode: 'room' | 'share-only' | 'share-composer') => void
  recordingQuality: RecordingQualityPreset
  onRecordingQualityChange: (preset: RecordingQualityPreset) => void
}) => {
  const room = useRoomContext()
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([])
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([])
  const [selectedAudioInputId, setSelectedAudioInputId] = useState('')
  const [selectedVideoInputId, setSelectedVideoInputId] = useState('')

  useEffect(() => {
    let active = true

    const loadDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        if (!active) return
        setAudioInputs(devices.filter((item) => item.kind === 'audioinput'))
        setVideoInputs(devices.filter((item) => item.kind === 'videoinput'))
      } catch (error: any) {
        onError(`Load devices failed: ${error?.message || 'unknown error'}`)
      }
    }

    void loadDevices()
    return () => {
      active = false
    }
  }, [onError])

  const switchDevice = async (kind: MediaDeviceKind, deviceId: string) => {
    try {
      await room.switchActiveDevice(kind, deviceId)
    } catch (error: any) {
      onError(`Switch device failed: ${error?.message || 'unknown error'}`)
    }
  }

  return (
    <aside className="livekit-settings-drawer" role="dialog" aria-label="Settings panel">
      <div className="livekit-settings-drawer-header">
        <strong>Settings</strong>
        <button className="ghost-button" onClick={onClose} type="button">
          Close
        </button>
      </div>
      <div className="livekit-settings-panel">
        <label className="livekit-device-field">
          <span>Microphone</span>
          <select
            className="select livekit-device-select"
            value={selectedAudioInputId}
            onChange={(event) => {
              const value = event.target.value
              setSelectedAudioInputId(value)
              void switchDevice('audioinput', value)
            }}
          >
            <option value="">Default microphone</option>
            {audioInputs.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Microphone (${device.deviceId.slice(0, 6)})`}
              </option>
            ))}
          </select>
        </label>
        <label className="livekit-device-field">
          <span>Camera</span>
          <select
            className="select livekit-device-select"
            value={selectedVideoInputId}
            onChange={(event) => {
              const value = event.target.value
              setSelectedVideoInputId(value)
              void switchDevice('videoinput', value)
            }}
          >
            <option value="">Default camera</option>
            {videoInputs.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Camera (${device.deviceId.slice(0, 6)})`}
              </option>
            ))}
          </select>
        </label>
        <label className="livekit-device-field">
          <span>Recording mode</span>
          <select
            className="select livekit-device-select"
            value={recordingMode}
            onChange={(event) =>
              onRecordingModeChange(
                event.target.value === 'share-composer'
                  ? 'share-composer'
                  : event.target.value === 'share-only'
                    ? 'share-only'
                    : 'room',
              )
            }
          >
            <option value="room">Room content only</option>
            <option value="share-only">Shared window only (HQ)</option>
            <option value="share-composer">Share + participants (HQ share)</option>
          </select>
        </label>
        <label className="livekit-device-field">
          <span>Recording quality</span>
          <select
            className="select livekit-device-select"
            value={recordingQuality}
            onChange={(event) =>
              onRecordingQualityChange(
                event.target.value === 'performance'
                  ? 'performance'
                  : event.target.value === 'quality'
                    ? 'quality'
                    : 'balanced',
              )
            }
          >
            <option value="performance">{getRecordingQualityLabel('performance')}</option>
            <option value="balanced">{getRecordingQualityLabel('balanced')}</option>
            <option value="quality">{getRecordingQualityLabel('quality')}</option>
          </select>
        </label>
        <div className="livekit-settings-requests">
          <div className="livekit-settings-requests-header">
            <strong>Speaker Requests</strong>
            <span>{pendingSpeakerRequests.length}</span>
          </div>
          {pendingSpeakerRequests.length === 0 && (
            <div className="muted-copy">No pending request.</div>
          )}
          {pendingSpeakerRequests.map((request) => (
            <div key={request.id} className="livekit-request-item">
              <strong>{request.title}</strong>
              {request.note ? <p>{request.note}</p> : null}
              {request.requestedAt ? <small>{request.requestedAt}</small> : null}
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}

const ControlIcon = ({
  name,
}: {
  name: 'mic' | 'camera' | 'screen' | 'record' | 'chat' | 'settings' | 'hand' | 'leave'
}) => {
  if (name === 'mic') {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 14a3 3 0 0 0 3-3V7a3 3 0 0 0-6 0v4a3 3 0 0 0 3 3z" />
        <path d="M17 11a5 5 0 0 1-10 0M12 16v4M9 20h6" />
      </svg>
    )
  }
  if (name === 'camera') {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 8a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1.5l3.5-2v9l-3.5-2V16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8z" />
      </svg>
    )
  }
  if (name === 'screen') {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3.5" y="4.5" width="17" height="11" rx="2.5" />
        <path d="M12 16v3.5M8.5 19.5h7" />
      </svg>
    )
  }
  if (name === 'record') {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="5.2" fill="currentColor" stroke="none" />
      </svg>
    )
  }
  if (name === 'chat') {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M5 6.5h14v9H9l-4 3z" />
      </svg>
    )
  }
  if (name === 'settings') {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="2.8" />
        <path d="M12 4.5v2M12 17.5v2M4.5 12h2M17.5 12h2M6.8 6.8l1.4 1.4M15.8 15.8l1.4 1.4M17.2 6.8l-1.4 1.4M8.2 15.8l-1.4 1.4" />
      </svg>
    )
  }
  if (name === 'hand') {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M7 11V6.5a1.5 1.5 0 0 1 3 0V11" />
        <path d="M10 11V5.5a1.5 1.5 0 0 1 3 0V11" />
        <path d="M13 11V7a1.5 1.5 0 0 1 3 0v5.5c0 3.6-2.3 6-5.6 6-3.7 0-6.2-2.7-6.2-6.5V11a1.5 1.5 0 0 1 3 0z" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M8 7l8 10M16 7l-8 10" />
    </svg>
  )
}

const LiveRoomContent = ({
  audience,
  roomName,
  connectError,
  chatOpen,
  initialMicEnabled,
  initialCameraEnabled,
  chatBadgeCount,
  settingsBadgeCount,
  pendingSpeakerRequests,
  resolveParticipantAvatar,
  onToggleChat,
  onLeave,
  onRequestSpeaker,
  layoutMode,
}: {
  audience: boolean
  roomName: string
  connectError: string
  chatOpen: boolean
  initialMicEnabled: boolean
  initialCameraEnabled: boolean
  chatBadgeCount: number
  settingsBadgeCount: number
  pendingSpeakerRequests: Array<{
    id: string
    title: string
    note?: string
    requestedAt?: string
  }>
  resolveParticipantAvatar: (participant?: Participant | null) => string
  onToggleChat: () => void
  onLeave: () => void
  onRequestSpeaker?: () => Promise<string | null>
  layoutMode: StageLayoutMode
}) => {
  const room = useRoomContext()
  const { localParticipant } = useLocalParticipant()
  const micToggle = useTrackToggle({ source: Track.Source.Microphone })
  const camToggle = useTrackToggle({ source: Track.Source.Camera })
  const shareToggle = useTrackToggle({ source: Track.Source.ScreenShare })
  const canPublish = audience ? false : Boolean(localParticipant?.permissions?.canPublish)
  const canPublishRef = useRef(canPublish)
  const [actionMessage, setActionMessage] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [requestLoading, setRequestLoading] = useState(false)
  const [screenShareFallbackPending, setScreenShareFallbackPending] = useState(false)
  const [screenShareFallbackEnabled, setScreenShareFallbackEnabled] = useState(false)
  const [recordingPending, setRecordingPending] = useState(false)
  const [recordingEnabled, setRecordingEnabled] = useState(false)
  const [recordingMode, setRecordingMode] = useState<'room' | 'share-only' | 'share-composer'>(
    'room',
  )
  const [recordingQuality, setRecordingQuality] = useState<RecordingQualityPreset>('balanced')
  const initialDevicesAppliedRef = useRef(false)
  const fallbackPublishedTrackRef = useRef<any>(null)
  const activeShareSourceIdRef = useRef('')
  const leaveAfterRecordingRef = useRef(false)
  const recordingStreamRef = useRef<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<BlobPart[]>([])
  const avatarImageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map())
  const captureAreaRef = useRef<HTMLDivElement | null>(null)
  const canvasCaptureRef = useRef<{
    canvas: HTMLCanvasElement
    sourceVideo: HTMLVideoElement
    sourceStream: MediaStream
    rafId: number | null
    resizeObserver: ResizeObserver | null
    onWindowResize: (() => void) | null
  } | null>(null)

  useEffect(() => {
    canPublishRef.current = canPublish
  }, [canPublish])

  useEffect(() => {
    setScreenShareFallbackEnabled(false)
    fallbackPublishedTrackRef.current = null
    activeShareSourceIdRef.current = ''
    initialDevicesAppliedRef.current = false
  }, [roomName])

  useEffect(() => {
    if (initialDevicesAppliedRef.current) return
    if (!localParticipant || !canPublish) return
    initialDevicesAppliedRef.current = true

    if (initialMicEnabled && !micToggle.enabled && !micToggle.pending) {
      void micToggle.toggle().catch(() => undefined)
    }
    if (initialCameraEnabled && !camToggle.enabled && !camToggle.pending) {
      void camToggle.toggle().catch(() => undefined)
    }
  }, [
    camToggle,
    canPublish,
    initialCameraEnabled,
    initialMicEnabled,
    localParticipant,
    micToggle,
  ])

  useEffect(() => {
    return () => {
      const track = fallbackPublishedTrackRef.current
      if (track) {
        try {
          track.stop?.()
        } catch {
          // no-op
        }
      }
    }
  }, [])

  useEffect(() => {
    return () => {
      const recorder = mediaRecorderRef.current
      if (recorder && recorder.state === 'recording') {
        recorder.stop()
      }
      const stream = recordingStreamRef.current
      if (stream) {
        stream.getTracks().forEach((track) => track.stop())
      }
      mediaRecorderRef.current = null
      recordingStreamRef.current = null
      recordedChunksRef.current = []
      leaveAfterRecordingRef.current = false
      if (canvasCaptureRef.current) {
        if (canvasCaptureRef.current.rafId !== null) {
          cancelAnimationFrame(canvasCaptureRef.current.rafId)
        }
        canvasCaptureRef.current.resizeObserver?.disconnect()
        if (canvasCaptureRef.current.onWindowResize) {
          window.removeEventListener('resize', canvasCaptureRef.current.onWindowResize)
        }
        canvasCaptureRef.current.sourceVideo.pause()
        canvasCaptureRef.current.sourceVideo.srcObject = null
        canvasCaptureRef.current.sourceStream.getTracks().forEach((track) => track.stop())
        canvasCaptureRef.current = null
      }
      void window.electronAPI?.setCurrentWindowResizable?.(true)
    }
  }, [])

  useEffect(() => {
    if (!settingsOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSettingsOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [settingsOpen])

  const waitForPublishPermission = async (timeoutMs = 1800, stepMs = 120) => {
    if (canPublishRef.current) return true
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      await new Promise((resolve) => window.setTimeout(resolve, stepMs))
      if (canPublishRef.current) return true
    }
    return canPublishRef.current
  }

  const runToggle = async (fn: (...args: any[]) => Promise<unknown>, label: string) => {
    if (!canPublishRef.current) {
      const granted = await waitForPublishPermission()
      if (!granted) {
        setActionMessage('')
        return
      }
    }
    try {
      await fn()
      setActionMessage('')
    } catch (error: any) {
      setActionMessage(`${label} failed: ${error?.message || 'unknown error'}`)
    }
  }

  const toggleScreenShare = async () => {
    if (shareToggle.enabled) {
      activeShareSourceIdRef.current = ''
      await runToggle(shareToggle.toggle, 'Screen share')
      return
    }

    if (screenShareFallbackEnabled) {
      await stopScreenShareFallback()
      setActionMessage('')
      return
    }

    if (!canPublishRef.current) {
      const granted = await waitForPublishPermission()
      if (!granted) {
        setActionMessage('')
        return
      }
    }

    if (window.electronAPI?.pickDesktopSource) {
      setScreenShareFallbackPending(true)
      try {
        const pickedSource = await window.electronAPI.pickDesktopSource()
        if (!pickedSource?.id) return
        await startScreenShareFallback(pickedSource.id)
      } catch (error: any) {
        setActionMessage(getScreenShareFriendlyError(error))
      } finally {
        setScreenShareFallbackPending(false)
      }
      return
    }

    setScreenShareFallbackPending(true)
    try {
      await shareToggle.toggle()
      setActionMessage('')
    } catch (error: any) {
      if (!isScreenShareNotSupportedError(error)) {
        setActionMessage(getScreenShareFriendlyError(error))
        return
      }
    } finally {
      setScreenShareFallbackPending(false)
    }
  }

  const stopScreenShareFallback = async () => {
    const publishedTrack = fallbackPublishedTrackRef.current
    if (!publishedTrack) {
      setScreenShareFallbackEnabled(false)
      activeShareSourceIdRef.current = ''
      return
    }
    try {
      await localParticipant?.unpublishTrack(publishedTrack, true)
      publishedTrack.stop?.()
    } catch {
      // no-op
    } finally {
      fallbackPublishedTrackRef.current = null
      setScreenShareFallbackEnabled(false)
      activeShareSourceIdRef.current = ''
    }
  }

  const startScreenShareFallback = async (sourceId: string) => {
    if (!sourceId) {
      throw new Error('No selected source.')
    }

    const mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          maxWidth: 3840,
          maxHeight: 2160,
          maxFrameRate: 30,
        },
      } as any,
    })

    const mediaTrack = mediaStream.getVideoTracks()[0]
    if (!mediaTrack) {
      throw new Error('Desktop capture track missing.')
    }

    mediaTrack.onended = () => {
      void stopScreenShareFallback()
    }

    const publication = await localParticipant?.publishTrack(mediaTrack, {
      source: Track.Source.ScreenShare,
      simulcast: false,
    })

    if (!publication?.track) {
      mediaTrack.stop()
      throw new Error('Unable to publish desktop capture track.')
    }

    fallbackPublishedTrackRef.current = publication.track
    setScreenShareFallbackEnabled(true)
    activeShareSourceIdRef.current = sourceId
    setActionMessage('')
  }
  const toggleScreenShareRef = useRef(toggleScreenShare)
  useEffect(() => {
    toggleScreenShareRef.current = toggleScreenShare
  }, [toggleScreenShare])

  const stopRecordingStream = () => {
    const stream = recordingStreamRef.current
    if (stream) {
      stream.getTracks().forEach((track) => track.stop())
    }
    recordingStreamRef.current = null
    if (canvasCaptureRef.current) {
      if (canvasCaptureRef.current.rafId !== null) {
        cancelAnimationFrame(canvasCaptureRef.current.rafId)
      }
      canvasCaptureRef.current.resizeObserver?.disconnect()
      if (canvasCaptureRef.current.onWindowResize) {
        window.removeEventListener('resize', canvasCaptureRef.current.onWindowResize)
      }
      canvasCaptureRef.current.sourceVideo.pause()
      canvasCaptureRef.current.sourceVideo.srcObject = null
      canvasCaptureRef.current.sourceStream.getTracks().forEach((track) => track.stop())
      canvasCaptureRef.current = null
    }
    void window.electronAPI?.setCurrentWindowResizable?.(true)
  }

  const createRoomVideoOnlyStream = async (quality: RecordingQualityConfig) => {
    const captureRoot = captureAreaRef.current
    if (!captureRoot) {
      throw new Error('Room video area not available.')
    }

    const rect = captureRoot.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) {
      throw new Error('Room video area is too small to record.')
    }

    if (!window.electronAPI?.getCurrentWindowSource) {
      throw new Error('Desktop recording bridge is unavailable.')
    }

    const windowSource = await window.electronAPI.getCurrentWindowSource()
    if (!windowSource?.id) {
      throw new Error('Unable to resolve meeting window source.')
    }

    const sourceStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: windowSource.id,
          maxWidth: 3840,
          maxHeight: 2160,
          maxFrameRate: quality.frameRate,
        },
      } as any,
    })

    const sourceVideo = document.createElement('video')
    sourceVideo.muted = true
    sourceVideo.playsInline = true
    sourceVideo.autoplay = true
    sourceVideo.srcObject = sourceStream

    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        reject(new Error('Unable to initialize recording source.'))
      }, 4000)

      const cleanup = () => {
        window.clearTimeout(timer)
        sourceVideo.removeEventListener('loadedmetadata', onReady)
        sourceVideo.removeEventListener('error', onError)
      }

      const onReady = () => {
        cleanup()
        resolve()
      }
      const onError = () => {
        cleanup()
        reject(new Error('Recording source failed to load.'))
      }

      sourceVideo.addEventListener('loadedmetadata', onReady)
      sourceVideo.addEventListener('error', onError)
      void sourceVideo.play().catch(onError)
    })

    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) {
      sourceVideo.pause()
      sourceVideo.srcObject = null
      sourceStream.getTracks().forEach((track) => track.stop())
      throw new Error('Canvas context is unavailable.')
    }

    const getCaptureMetrics = () => {
      const areaRect = captureRoot.getBoundingClientRect()
      const viewportWidth = Math.max(
        1,
        window.innerWidth || document.documentElement.clientWidth || 1,
      )
      const viewportHeight = Math.max(
        1,
        window.innerHeight || document.documentElement.clientHeight || 1,
      )
      const sourceWidth = Math.max(1, sourceVideo.videoWidth || canvas.width)
      const sourceHeight = Math.max(1, sourceVideo.videoHeight || canvas.height)
      const scaleX = sourceWidth / viewportWidth
      const scaleY = sourceHeight / viewportHeight
      const sx = Math.max(0, Math.floor(areaRect.left * scaleX))
      const sy = Math.max(0, Math.floor(areaRect.top * scaleY))
      const sw = Math.max(2, Math.min(sourceWidth - sx, Math.floor(areaRect.width * scaleX)))
      const sh = Math.max(2, Math.min(sourceHeight - sy, Math.floor(areaRect.height * scaleY)))
      return {
        sx,
        sy,
        sw,
        sh,
      }
    }

    const fixedOutputWidth = quality.width
    const fixedOutputHeight = quality.height

    const applyCanvasSize = () => {
      canvas.width = fixedOutputWidth
      canvas.height = fixedOutputHeight
      context.imageSmoothingEnabled = false
      context.imageSmoothingQuality = 'high'
    }

    applyCanvasSize()

    const drawFrame = () => {
      const { sx, sy, sw, sh } = getCaptureMetrics()
      const scale = Math.min(fixedOutputWidth / sw, fixedOutputHeight / sh, 1)
      const drawWidth = Math.max(2, Math.floor(sw * scale))
      const drawHeight = Math.max(2, Math.floor(sh * scale))
      const drawX = Math.floor((fixedOutputWidth - drawWidth) / 2)
      const drawY = Math.floor((fixedOutputHeight - drawHeight) / 2)

      context.setTransform(1, 0, 0, 1, 0, 0)
      context.fillStyle = '#050f22'
      context.fillRect(0, 0, canvas.width, canvas.height)

      if (sourceVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        try {
          context.drawImage(sourceVideo, sx, sy, sw, sh, drawX, drawY, drawWidth, drawHeight)
        } catch {
          // ignore transient frame draw error
        }
      }

      if (canvasCaptureRef.current) {
        canvasCaptureRef.current.rafId = requestAnimationFrame(drawFrame)
      }
    }

    const resizeObserver = null
    const onWindowResize = null

    canvasCaptureRef.current = {
      canvas,
      sourceVideo,
      sourceStream,
      rafId: requestAnimationFrame(drawFrame),
      resizeObserver,
      onWindowResize,
    }

    const sourceVideoTrack = sourceStream.getVideoTracks()[0]
    if (sourceVideoTrack) {
      sourceVideoTrack.onended = () => {
        if (mediaRecorderRef.current?.state === 'recording') {
          mediaRecorderRef.current.stop()
        }
      }
    }

    return canvas.captureStream(quality.frameRate)
  }

  const createShareComposerStream = async (
    sourceId: string,
    quality: RecordingQualityConfig,
  ) => {
    const captureRoot = captureAreaRef.current
    if (!captureRoot) {
      throw new Error('Room video area not available.')
    }
    if (!sourceId) {
      throw new Error('No active shared window source.')
    }

    const sourceStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          maxWidth: 3840,
          maxHeight: 2160,
          maxFrameRate: quality.frameRate,
        },
      } as any,
    })

    const sourceVideo = document.createElement('video')
    sourceVideo.muted = true
    sourceVideo.playsInline = true
    sourceVideo.autoplay = true
    sourceVideo.srcObject = sourceStream

    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        reject(new Error('Unable to initialize share source.'))
      }, 4000)

      const cleanup = () => {
        window.clearTimeout(timer)
        sourceVideo.removeEventListener('loadedmetadata', onReady)
        sourceVideo.removeEventListener('error', onError)
      }

      const onReady = () => {
        cleanup()
        resolve()
      }
      const onError = () => {
        cleanup()
        reject(new Error('Share source failed to load.'))
      }

      sourceVideo.addEventListener('loadedmetadata', onReady)
      sourceVideo.addEventListener('error', onError)
      void sourceVideo.play().catch(onError)
    })

    const sourceWidth = Math.max(2, sourceVideo.videoWidth || 1280)
    const sourceHeight = Math.max(2, sourceVideo.videoHeight || 720)
    const outputWidth = quality.width
    const outputHeight = quality.height
    const panelWidth = clamp(
      Math.floor(outputWidth * SHARE_COMPOSER_PANEL_RATIO),
      SHARE_COMPOSER_MIN_PANEL_WIDTH,
      SHARE_COMPOSER_MAX_PANEL_WIDTH,
    )
    const panelGap = SHARE_COMPOSER_TILE_GAP
    const shareAreaX = panelGap * 2 + panelWidth
    const shareAreaY = panelGap
    const shareAreaWidth = Math.max(2, outputWidth - shareAreaX - panelGap)
    const shareAreaHeight = Math.max(2, outputHeight - panelGap * 2)

    const canvas = document.createElement('canvas')
    canvas.width = outputWidth
    canvas.height = outputHeight
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) {
      sourceVideo.pause()
      sourceVideo.srcObject = null
      sourceStream.getTracks().forEach((track) => track.stop())
      throw new Error('Canvas context is unavailable.')
    }
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'

    const collectVisuals = () => {
      const rootRect = captureRoot.getBoundingClientRect()
      const rootArea = Math.max(1, rootRect.width * rootRect.height)
      const tiles = Array.from(captureRoot.querySelectorAll('.lk-participant-tile')) as HTMLElement[]
      const result: Array<{ video: HTMLVideoElement | null; avatarUrl: string; name: string }> = []

      for (const tile of tiles) {
        const tileRect = tile.getBoundingClientRect()
        const tileArea = Math.max(1, tileRect.width * tileRect.height)
        if (tileArea > rootArea * 0.52) {
          continue
        }

        const video = tile.querySelector('video') as HTMLVideoElement | null
        const nameElement = tile.querySelector('.lk-participant-name') as HTMLElement | null
        const style = getComputedStyle(tile)
        const avatarFromTile = extractCssUrl(style.getPropertyValue('--lk-avatar-image'))
        const placeholder = tile.querySelector('.lk-participant-placeholder') as HTMLElement | null
        const avatarFromPlaceholder = extractCssUrl(
          getComputedStyle(placeholder || tile).getPropertyValue('background-image'),
        )

        result.push({
          video,
          avatarUrl: avatarFromTile || avatarFromPlaceholder,
          name: nameElement?.innerText?.trim() || 'Participant',
        })
      }

      return result.slice(0, SHARE_COMPOSER_MAX_TILES)
    }

    const getAvatarImage = (avatarUrl: string) => {
      if (!avatarUrl) return null
      const cached = avatarImageCacheRef.current.get(avatarUrl)
      if (cached) return cached
      const image = new Image()
      image.crossOrigin = 'anonymous'
      image.src = avatarUrl
      avatarImageCacheRef.current.set(avatarUrl, image)
      return image
    }

    const drawCover = (
      video: CanvasImageSource,
      sx: number,
      sy: number,
      sw: number,
      sh: number,
      dx: number,
      dy: number,
      dw: number,
      dh: number,
    ) => {
      context.drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh)
    }

    const drawRoundedRectPath = (
      x: number,
      y: number,
      width: number,
      height: number,
      radius: number,
    ) => {
      const r = Math.max(0, Math.min(radius, Math.floor(Math.min(width, height) / 2)))
      context.beginPath()
      context.moveTo(x + r, y)
      context.lineTo(x + width - r, y)
      context.quadraticCurveTo(x + width, y, x + width, y + r)
      context.lineTo(x + width, y + height - r)
      context.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
      context.lineTo(x + r, y + height)
      context.quadraticCurveTo(x, y + height, x, y + height - r)
      context.lineTo(x, y + r)
      context.quadraticCurveTo(x, y, x + r, y)
      context.closePath()
    }

    let frameIndex = 0
    let visuals: Array<{ video: HTMLVideoElement | null; avatarUrl: string; name: string }> = []
    const refreshVisuals = () => {
      visuals = collectVisuals()
    }
    refreshVisuals()

    const drawFrame = () => {
      frameIndex += 1
      if (frameIndex % 15 === 0) {
        refreshVisuals()
      }

      context.setTransform(1, 0, 0, 1, 0, 0)
      context.fillStyle = '#06142a'
      context.fillRect(0, 0, outputWidth, outputHeight)

      const shareCardRadius = Math.max(
        8,
        Math.floor((SHARE_COMPOSER_SHARE_RADIUS * outputHeight) / 1080),
      )
      const shareCardX = shareAreaX
      const shareCardY = shareAreaY
      const shareCardWidth = shareAreaWidth
      const shareCardHeight = shareAreaHeight

      const shareScale = Math.min(shareCardWidth / sourceWidth, shareCardHeight / sourceHeight)
      const drawShareWidth = Math.max(2, Math.floor(sourceWidth * shareScale))
      const drawShareHeight = Math.max(2, Math.floor(sourceHeight * shareScale))
      const drawShareX = shareCardX + Math.floor((shareCardWidth - drawShareWidth) / 2)
      const drawShareY = shareCardY + Math.floor((shareCardHeight - drawShareHeight) / 2)

      context.fillStyle = '#081a36'
      drawRoundedRectPath(
        shareCardX,
        shareCardY,
        shareCardWidth,
        shareCardHeight,
        shareCardRadius,
      )
      context.fill()

      if (sourceVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const sourceVideoWidth = Math.max(1, sourceVideo.videoWidth)
        const sourceVideoHeight = Math.max(1, sourceVideo.videoHeight)
        const backdropScale = Math.max(shareCardWidth / sourceVideoWidth, shareCardHeight / sourceVideoHeight)
        const backdropWidth = Math.max(2, Math.floor(sourceVideoWidth * backdropScale))
        const backdropHeight = Math.max(2, Math.floor(sourceVideoHeight * backdropScale))
        const backdropX = shareCardX + Math.floor((shareCardWidth - backdropWidth) / 2)
        const backdropY = shareCardY + Math.floor((shareCardHeight - backdropHeight) / 2)

        // Decorative backdrop: use blurred current share frame to fill outer area.
        context.save()
        drawRoundedRectPath(shareCardX, shareCardY, shareCardWidth, shareCardHeight, shareCardRadius)
        context.clip()
        context.filter = 'blur(18px) brightness(0.48) saturate(1.08)'
        drawCover(
          sourceVideo,
          0,
          0,
          sourceVideoWidth,
          sourceVideoHeight,
          backdropX,
          backdropY,
          backdropWidth,
          backdropHeight,
        )
        context.filter = 'none'
        context.restore()

        const clipRadius = Math.max(8, Math.floor(shareCardRadius * 0.9))
        context.save()
        drawRoundedRectPath(drawShareX, drawShareY, drawShareWidth, drawShareHeight, clipRadius)
        context.clip()
        drawCover(
          sourceVideo,
          0,
          0,
          sourceVideoWidth,
          sourceVideoHeight,
          drawShareX,
          drawShareY,
          drawShareWidth,
          drawShareHeight,
        )
        context.restore()
      }

      const panelX = panelGap
      const panelY = panelGap
      const panelHeight = shareAreaHeight
      const tileWidth = Math.max(2, panelWidth)
      const panelRadius = Math.max(10, Math.floor((14 * outputHeight) / 1080))
      context.fillStyle = 'rgba(10, 27, 52, 0.94)'
      drawRoundedRectPath(panelX, panelY, tileWidth, panelHeight, panelRadius)
      context.fill()
      const maxTilesByHeight = Math.max(
        1,
        Math.floor((panelHeight + panelGap) / (SHARE_COMPOSER_TILE_MIN_HEIGHT + panelGap)),
      )
      const visibleVisuals = visuals.slice(0, Math.min(SHARE_COMPOSER_MAX_TILES, maxTilesByHeight))
      const tileCount = visibleVisuals.length

      const preferredHeights = visibleVisuals.map((visual) => {
        const tileMaxHeight =
          tileCount <= 1
            ? Math.floor(panelHeight * 0.9)
            : tileCount === 2
              ? Math.floor(panelHeight * 0.46)
              : tileCount === 3
                ? Math.floor(panelHeight * 0.32)
                : SHARE_COMPOSER_TILE_MAX_HEIGHT

        if (visual?.video && visual.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          const vw = Math.max(1, visual.video.videoWidth)
          const vh = Math.max(1, visual.video.videoHeight)
          const ratio = Math.max(0.25, Math.min(4, vw / vh))
          return clamp(
            Math.floor(tileWidth / ratio),
            SHARE_COMPOSER_TILE_MIN_HEIGHT,
            tileMaxHeight,
          )
        }

        // Avatar/default: keep closer to square portrait card instead of stretched full-height.
        return clamp(
          Math.floor(tileWidth * 0.96),
          SHARE_COMPOSER_TILE_MIN_HEIGHT,
          tileMaxHeight,
        )
      })

      const totalPreferredHeight = preferredHeights.reduce((sum, value) => sum + value, 0)
      const totalGap = panelGap * Math.max(0, visibleVisuals.length - 1)
      const availableHeightForTiles = Math.max(1, panelHeight - totalGap)
      const heightScale =
        totalPreferredHeight > availableHeightForTiles
          ? availableHeightForTiles / totalPreferredHeight
          : 1
      const scaledHeights = preferredHeights.map((height) =>
        Math.max(
          SHARE_COMPOSER_TILE_MIN_HEIGHT,
          Math.floor(height * heightScale),
        ),
      )
      const totalRenderedHeight =
        scaledHeights.reduce((sum, value) => sum + value, 0) + totalGap
      const startY = panelY + Math.max(0, Math.floor((panelHeight - totalRenderedHeight) / 2))

      let currentY = startY
      for (let index = 0; index < visibleVisuals.length; index += 1) {
        const visual = visibleVisuals[index]
        const tileHeight = scaledHeights[index]
        const tileY = currentY
        currentY += tileHeight + panelGap

        context.fillStyle = '#0b1f40'
        drawRoundedRectPath(panelX, tileY, tileWidth, tileHeight, SHARE_COMPOSER_TILE_RADIUS)
        context.fill()
        context.strokeStyle = 'rgba(121, 156, 210, 0.2)'
        context.lineWidth = 1
        context.stroke()

        const contentHeight = Math.max(2, tileHeight - 2)
        const contentX = panelX + 1
        const contentY = tileY + 1
        const contentWidth = Math.max(2, tileWidth - 2)
        const innerRadius = Math.max(6, SHARE_COMPOSER_TILE_RADIUS - 3)
        if (visual?.video && visual.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          const vw = Math.max(1, visual.video.videoWidth)
          const vh = Math.max(1, visual.video.videoHeight)
          const backdropScale = Math.max(contentWidth / vw, contentHeight / vh)
          const backdropWidth = Math.max(2, Math.floor(vw * backdropScale))
          const backdropHeight = Math.max(2, Math.floor(vh * backdropScale))
          const backdropX = contentX + Math.floor((contentWidth - backdropWidth) / 2)
          const backdropY = contentY + Math.floor((contentHeight - backdropHeight) / 2)
          const containScale = Math.min(contentWidth / vw, contentHeight / vh)
          const drawW = Math.max(2, Math.floor(vw * containScale))
          const drawH = Math.max(2, Math.floor(vh * containScale))
          const drawX = contentX + Math.floor((contentWidth - drawW) / 2)
          const drawY = contentY + Math.floor((contentHeight - drawH) / 2)

          context.save()
          drawRoundedRectPath(contentX, contentY, contentWidth, contentHeight, innerRadius)
          context.clip()
          context.filter = 'blur(10px) brightness(0.58) saturate(1.05)'
          drawCover(visual.video, 0, 0, vw, vh, backdropX, backdropY, backdropWidth, backdropHeight)
          context.filter = 'none'
          drawCover(visual.video, 0, 0, vw, vh, drawX, drawY, drawW, drawH)
          context.restore()
        } else if (visual?.avatarUrl) {
          const image = getAvatarImage(visual.avatarUrl)
          if (image && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
            const iw = Math.max(1, image.naturalWidth)
            const ih = Math.max(1, image.naturalHeight)
            const backdropScale = Math.max(contentWidth / iw, contentHeight / ih)
            const backdropWidth = Math.max(2, Math.floor(iw * backdropScale))
            const backdropHeight = Math.max(2, Math.floor(ih * backdropScale))
            const backdropX = contentX + Math.floor((contentWidth - backdropWidth) / 2)
            const backdropY = contentY + Math.floor((contentHeight - backdropHeight) / 2)

            context.save()
            drawRoundedRectPath(contentX, contentY, contentWidth, contentHeight, innerRadius)
            context.clip()
            context.filter = 'blur(10px) brightness(0.62) saturate(1.06)'
            drawCover(image, 0, 0, iw, ih, backdropX, backdropY, backdropWidth, backdropHeight)
            context.filter = 'none'
            context.restore()

            const maxAvatarSize = Math.min(contentWidth, contentHeight)
            const avatarSize = Math.max(46, Math.floor(maxAvatarSize * 0.76))
            const scale = Math.min(avatarSize / iw, avatarSize / ih)
            const drawW = Math.max(2, Math.floor(iw * scale))
            const drawH = Math.max(2, Math.floor(ih * scale))
            const drawX = contentX + Math.floor((contentWidth - drawW) / 2)
            const drawY = contentY + Math.floor((contentHeight - drawH) / 2)
            context.save()
            context.beginPath()
            context.arc(
              drawX + Math.floor(drawW / 2),
              drawY + Math.floor(drawH / 2),
              Math.max(2, Math.floor(Math.min(drawW, drawH) / 2)),
              0,
              Math.PI * 2,
            )
            context.clip()
            drawCover(image, 0, 0, iw, ih, drawX, drawY, drawW, drawH)
            context.restore()
          }
        } else {
          context.fillStyle = 'rgba(20, 45, 86, 0.76)'
          drawRoundedRectPath(contentX, contentY, contentWidth, contentHeight, innerRadius)
          context.fill()
          context.fillStyle = 'rgba(211, 230, 255, 0.9)'
          const placeholderSize = Math.max(30, Math.floor(Math.min(contentWidth, contentHeight) * 0.34))
          context.beginPath()
          context.arc(
            contentX + Math.floor(contentWidth / 2),
            contentY + Math.floor(contentHeight / 2),
            Math.floor(placeholderSize / 2),
            0,
            Math.PI * 2,
          )
          context.fill()
          context.fillStyle = '#0b1f40'
          context.font = `bold ${Math.max(13, Math.floor(placeholderSize * 0.42))}px Segoe UI`
          context.textAlign = 'center'
          context.textBaseline = 'middle'
          const initial = (visual?.name?.trim()?.[0] || 'U').toUpperCase()
          context.fillText(
            initial,
            contentX + Math.floor(contentWidth / 2),
            contentY + Math.floor(contentHeight / 2),
          )
          context.textAlign = 'left'
        }

        const label = visual?.name?.slice(0, 36) || `Participant ${index + 1}`
        const labelX = panelX + Math.max(6, Math.floor(tileWidth * 0.04))
        const labelBottomInset = Math.max(6, Math.floor(tileHeight * 0.05))
        const labelY = tileY + tileHeight - labelBottomInset
        const maxLabelWidth = Math.max(24, tileWidth - Math.max(12, Math.floor(tileWidth * 0.08)))
        const labelFontSize = clamp(
          Math.floor(Math.min(tileWidth, tileHeight) * 0.09),
          12,
          20,
        )

        context.textAlign = 'left'
        context.textBaseline = 'alphabetic'
        context.font = `700 ${labelFontSize}px Segoe UI`
        let fittedLabel = label
        while (
          fittedLabel.length > 1 &&
          context.measureText(`${fittedLabel}...`).width > maxLabelWidth
        ) {
          fittedLabel = fittedLabel.slice(0, -1)
        }
        if (fittedLabel !== label) {
          fittedLabel = `${fittedLabel}...`
        }

        context.strokeStyle = 'rgba(2, 10, 24, 0.86)'
        context.lineWidth = Math.max(1.5, Math.floor(labelFontSize * 0.12))
        context.lineJoin = 'round'
        context.strokeText(fittedLabel, labelX, labelY)
        context.fillStyle = '#f4f9ff'
        context.fillText(fittedLabel, labelX, labelY)
      }

      if (visibleVisuals.length === 0) {
        context.fillStyle = 'rgba(10, 31, 59, 0.82)'
        drawRoundedRectPath(
          panelX + 6,
          panelY + Math.floor(panelHeight * 0.42),
          Math.max(2, tileWidth - 12),
          68,
          12,
        )
        context.fill()
        context.fillStyle = '#dbe9ff'
        context.font = '600 13px Segoe UI'
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        context.fillText(
          'No participant video',
          panelX + Math.floor(tileWidth / 2),
          panelY + Math.floor(panelHeight * 0.46),
        )
        context.textAlign = 'left'
      }

      if (canvasCaptureRef.current) {
        canvasCaptureRef.current.rafId = requestAnimationFrame(drawFrame)
      }
    }

    canvasCaptureRef.current = {
      canvas,
      sourceVideo,
      sourceStream,
      rafId: requestAnimationFrame(drawFrame),
      resizeObserver: null,
      onWindowResize: null,
    }

    const sourceVideoTrack = sourceStream.getVideoTracks()[0]
    if (sourceVideoTrack) {
      sourceVideoTrack.onended = () => {
        if (mediaRecorderRef.current?.state === 'recording') {
          mediaRecorderRef.current.stop()
        }
      }
    }

    return canvas.captureStream(quality.frameRate)
  }

  const createShareOnlyStream = async (sourceId: string, quality: RecordingQualityConfig) => {
    if (!sourceId) {
      throw new Error('No active shared window source.')
    }

    const sourceStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          maxWidth: 3840,
          maxHeight: 2160,
          maxFrameRate: quality.frameRate,
        },
      } as any,
    })

    const sourceVideo = document.createElement('video')
    sourceVideo.muted = true
    sourceVideo.playsInline = true
    sourceVideo.autoplay = true
    sourceVideo.srcObject = sourceStream

    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        reject(new Error('Unable to initialize shared window source.'))
      }, 4000)

      const cleanup = () => {
        window.clearTimeout(timer)
        sourceVideo.removeEventListener('loadedmetadata', onReady)
        sourceVideo.removeEventListener('error', onError)
      }

      const onReady = () => {
        cleanup()
        resolve()
      }
      const onError = () => {
        cleanup()
        reject(new Error('Shared window source failed to load.'))
      }

      sourceVideo.addEventListener('loadedmetadata', onReady)
      sourceVideo.addEventListener('error', onError)
      void sourceVideo.play().catch(onError)
    })

    const track = sourceStream.getVideoTracks()[0]
    if (!track) {
      sourceStream.getTracks().forEach((item) => item.stop())
      throw new Error('Shared source video track is unavailable.')
    }

    const canvas = document.createElement('canvas')
    canvas.width = quality.width
    canvas.height = quality.height
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) {
      sourceVideo.pause()
      sourceVideo.srcObject = null
      sourceStream.getTracks().forEach((item) => item.stop())
      throw new Error('Canvas context is unavailable.')
    }

    const drawFrame = () => {
      const sourceWidth = Math.max(1, sourceVideo.videoWidth || quality.width)
      const sourceHeight = Math.max(1, sourceVideo.videoHeight || quality.height)
      const scale = Math.min(quality.width / sourceWidth, quality.height / sourceHeight)
      const drawWidth = Math.max(2, Math.floor(sourceWidth * scale))
      const drawHeight = Math.max(2, Math.floor(sourceHeight * scale))
      const drawX = Math.floor((quality.width - drawWidth) / 2)
      const drawY = Math.floor((quality.height - drawHeight) / 2)

      context.setTransform(1, 0, 0, 1, 0, 0)
      context.fillStyle = '#071021'
      context.fillRect(0, 0, quality.width, quality.height)

      if (sourceVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        context.drawImage(sourceVideo, 0, 0, sourceWidth, sourceHeight, drawX, drawY, drawWidth, drawHeight)
      }

      if (canvasCaptureRef.current) {
        canvasCaptureRef.current.rafId = requestAnimationFrame(drawFrame)
      }
    }

    canvasCaptureRef.current = {
      canvas,
      sourceVideo,
      sourceStream,
      rafId: requestAnimationFrame(drawFrame),
      resizeObserver: null,
      onWindowResize: null,
    }

    track.onended = () => {
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop()
      }
    }

    return canvas.captureStream(quality.frameRate)
  }

  const persistRecording = async () => {
    const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' })
    recordedChunksRef.current = []
    if (blob.size === 0) {
      setActionMessage('Recording has no data.')
      return
    }

    const arrayBuffer = await blob.arrayBuffer()
    const bytes = new Uint8Array(arrayBuffer)
    const defaultFileName = buildRecordingFileName()

    if (window.electronAPI?.saveRecording) {
      const result = await window.electronAPI.saveRecording({
        bytes,
        defaultFileName,
        extension: 'webm',
      })
      if (result.success) {
        setActionMessage(result.filePath ? `Saved recording: ${result.filePath}` : 'Recording saved.')
        return
      }
      if (result.cancelled) {
        setActionMessage('Recording save cancelled.')
        return
      }
      setActionMessage(result.error || 'Unable to save recording.')
      return
    }

    // Fallback when not running under Electron bridge.
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = defaultFileName
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(url)
    setActionMessage('Recording downloaded.')
  }

  const resolveShareSourceForRecording = async () => {
    if (activeShareSourceIdRef.current) return activeShareSourceIdRef.current
    if (!window.electronAPI?.pickDesktopSource) return ''
    const pickedSource = await window.electronAPI.pickDesktopSource()
    if (!pickedSource?.id) return ''
    activeShareSourceIdRef.current = pickedSource.id
    return pickedSource.id
  }

  const startRecording = async () => {
    if (recordingPending || recordingEnabled) return
    setRecordingPending(true)

    try {
      await window.electronAPI?.setCurrentWindowResizable?.(false)
      const qualityConfig = RECORDING_QUALITY_CONFIGS[recordingQuality]
      const shouldUseShareOnly = recordingMode === 'share-only'
      const shouldUseShareComposer = recordingMode === 'share-composer'
      let activeShareSourceId = activeShareSourceIdRef.current
      if ((shouldUseShareComposer || shouldUseShareOnly) && !activeShareSourceId) {
        activeShareSourceId = await resolveShareSourceForRecording()
      }
      if ((shouldUseShareComposer || shouldUseShareOnly) && !activeShareSourceId) {
        setRecordingPending(false)
        void window.electronAPI?.setCurrentWindowResizable?.(true)
        setActionMessage('Recording cancelled. Select a shared window source first.')
        return
      }

      const stream =
        shouldUseShareComposer && activeShareSourceId
          ? await createShareComposerStream(activeShareSourceId, qualityConfig)
          : shouldUseShareOnly && activeShareSourceId
            ? await createShareOnlyStream(activeShareSourceId, qualityConfig)
            : await createRoomVideoOnlyStream(qualityConfig)

      if (!stream) {
        setActionMessage('Recording is not supported in this environment.')
        setRecordingPending(false)
        return
      }

      const mimeType = getSupportedRecordingMimeType()
      const recorderOptions: MediaRecorderOptions = {
        videoBitsPerSecond: qualityConfig.videoBitsPerSecond,
      }
      if (mimeType) {
        recorderOptions.mimeType = mimeType
      }
      const recorder = new MediaRecorder(stream, recorderOptions)

      recordingStreamRef.current = stream
      mediaRecorderRef.current = recorder
      recordedChunksRef.current = []

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data)
        }
      }

      recorder.onerror = (event: any) => {
        setActionMessage(event?.error?.message || 'Recording failed.')
      }

      recorder.onstop = () => {
        setRecordingEnabled(false)
        setRecordingPending(false)
        void persistRecording().finally(() => {
          stopRecordingStream()
          mediaRecorderRef.current = null
          if (leaveAfterRecordingRef.current) {
            leaveAfterRecordingRef.current = false
            onLeave()
          }
        })
      }

      const videoTrack = stream.getVideoTracks()[0]
      if (videoTrack) {
        videoTrack.onended = () => {
          if (mediaRecorderRef.current?.state === 'recording') {
            mediaRecorderRef.current.stop()
          }
        }
      }

      recorder.start(1000)
      setRecordingEnabled(true)
      setActionMessage(
        shouldUseShareComposer
          ? `Recording started (share+participants, ${qualityConfig.label}).`
          : shouldUseShareOnly
            ? `Recording started (shared window, ${qualityConfig.label}).`
            : `Recording started (${qualityConfig.label}).`,
      )
    } catch (error: any) {
      stopRecordingStream()
      mediaRecorderRef.current = null
      setRecordingEnabled(false)
      setRecordingPending(false)
      setActionMessage(error?.message || 'Unable to start recording.')
    }
  }

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state !== 'recording') return
    setRecordingPending(true)
    recorder.stop()
  }

  const toggleRecording = () => {
    if (recordingEnabled) {
      stopRecording()
      return
    }
    void startRecording()
  }

  const leaveMeeting = () => {
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state === 'recording') {
      leaveAfterRecordingRef.current = true
      stopRecording()
      return
    }
    onLeave()
  }
  return (
    <>
      <div ref={captureAreaRef} className="livekit-room-capture-area">
        <LiveStageLayout
          resolveParticipantAvatar={resolveParticipantAvatar}
          localParticipantIdentity={localParticipant?.identity || ''}
          localMicEnabled={micToggle.enabled}
          onToggleLocalMic={() => {
            void runToggle(micToggle.toggle, 'Microphone')
          }}
          layoutMode={layoutMode}
        />
      </div>
      <div className="control-bar-shell" data-audience={!canPublish ? 'true' : undefined}>
        <div className="lk-control-bar lk-control-bar--custom">
          <div className="lk-control-group lk-control-group-primary">
            <button
              className={`control lk-button ${micToggle.enabled ? 'active' : ''}`}
              disabled={micToggle.pending || !canPublish}
              onClick={() => void runToggle(micToggle.toggle, 'Microphone')}
              type="button"
              title="Microphone"
              aria-label="Microphone"
            >
              <ControlIcon name="mic" />
            </button>
            <button
              className={`control lk-button ${camToggle.enabled ? 'active' : ''}`}
              disabled={camToggle.pending || !canPublish}
              onClick={() => void runToggle(camToggle.toggle, 'Camera')}
              type="button"
              title="Camera"
              aria-label="Camera"
            >
              <ControlIcon name="camera" />
            </button>
            <button
              className={`control lk-button ${shareToggle.enabled || screenShareFallbackEnabled ? 'active' : ''}`}
              disabled={
                (shareToggle.pending || screenShareFallbackPending) ||
                (!canPublish && !shareToggle.enabled && !screenShareFallbackEnabled)
              }
              onClick={() => void toggleScreenShare()}
              type="button"
              title={shareToggle.enabled || screenShareFallbackEnabled ? 'Stop sharing' : 'Share screen'}
              aria-label={shareToggle.enabled || screenShareFallbackEnabled ? 'Stop sharing' : 'Share screen'}
            >
              <ControlIcon name="screen" />
            </button>
          </div>
          <div className="lk-control-group lk-control-group-secondary">
            <button
              className={`control lk-button ${recordingEnabled ? 'active record-active' : ''}`}
              onClick={toggleRecording}
              disabled={recordingPending}
              type="button"
              title={
                recordingEnabled
                  ? `Stop recording (${getRecordingModeLabel(recordingMode)} · ${getRecordingQualityLabel(recordingQuality)})`
                  : `Record meeting (${getRecordingModeLabel(recordingMode)} · ${getRecordingQualityLabel(recordingQuality)})`
              }
              aria-label={recordingEnabled ? 'Stop recording' : 'Record meeting'}
            >
              <ControlIcon name="record" />
              {!recordingEnabled && (
                <span className="control-tooltip" role="status" aria-live="polite">
                  {`${getRecordingModeLabel(recordingMode)} · ${getRecordingQualityLabel(recordingQuality)}`}
                </span>
              )}
            </button>
            <button
              className={`control lk-button ${chatOpen ? 'active' : ''}`}
              onClick={onToggleChat}
              type="button"
              title="Chat"
              aria-label="Chat"
            >
              <ControlIcon name="chat" />
              {!chatOpen && chatBadgeCount > 0 && <span className="control-badge">{chatBadgeCount}</span>}
            </button>
            <button
              className={`control lk-button ${settingsOpen ? 'active' : ''}`}
              onClick={() => setSettingsOpen((value) => !value)}
              type="button"
              title="Settings"
              aria-label="Settings"
            >
              <ControlIcon name="settings" />
              {!settingsOpen && settingsBadgeCount > 0 && (
                <span className="control-badge">{settingsBadgeCount}</span>
              )}
            </button>
            {!canPublish && onRequestSpeaker && (
              <button
                className="control lk-button"
                onClick={() =>
                  void (async () => {
                    setRequestLoading(true)
                    const result = await onRequestSpeaker()
                    setActionMessage(result ?? 'Speaker request submitted.')
                    setRequestLoading(false)
                  })()
                }
                disabled={requestLoading}
                type="button"
                title="Request speaker"
                aria-label="Request speaker"
              >
                <ControlIcon name="hand" />
              </button>
            )}
            <button
              className="control lk-button control-danger"
              onClick={leaveMeeting}
              type="button"
              title="Leave"
              aria-label="Leave"
            >
              <ControlIcon name="leave" />
            </button>
          </div>
        </div>
      </div>
      {settingsOpen && (
        <>
          <button
            className="livekit-settings-backdrop"
            onClick={() => setSettingsOpen(false)}
            type="button"
            aria-label="Close settings"
          />
          <DeviceSettingsPanel
            onError={setActionMessage}
            onClose={() => setSettingsOpen(false)}
            pendingSpeakerRequests={pendingSpeakerRequests}
            recordingMode={recordingMode}
            onRecordingModeChange={setRecordingMode}
            recordingQuality={recordingQuality}
            onRecordingQualityChange={setRecordingQuality}
          />
        </>
      )}
      <ConnectionStateToast />
      <RoomAudioRenderer />
      {!!actionMessage && <div className="error">{actionMessage}</div>}
      {connectError && (
        <div className="error">
          {connectError} ({roomName})
        </div>
      )}
    </>
  )
}

export default function LiveVideoStage({
  token,
  serverUrl,
  roomTitle,
  roomName,
  localUserName,
  localUsername,
  localAvatarUrl,
  participantAvatarMap = {},
  audience,
  initialMicEnabled = false,
  initialCameraEnabled = false,
  chatOpen,
  chatBadgeCount = 0,
  settingsBadgeCount = 0,
  pendingSpeakerRequests = [],
  onToggleChat,
  onLeave,
  onRequestSpeaker,
}: {
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
  pendingSpeakerRequests?: Array<{
    id: string
    title: string
    note?: string
    requestedAt?: string
  }>
  onToggleChat: () => void
  onLeave: () => void
  onRequestSpeaker?: () => Promise<string | null>
}) {
  const resolvedServerUrl = useMemo(() => {
    return (
      normalizeUrl(serverUrl) ||
      normalizeUrl(import.meta.env.VITE_LIVEKIT_URL) ||
      normalizeUrl(import.meta.env.NEXT_PUBLIC_LIVEKIT_URL)
    )
  }, [serverUrl])
  const [connectError, setConnectError] = useState('')
  const [layoutMode, setLayoutMode] = useState<StageLayoutMode>('auto')
  const avatarMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const [rawKey, rawValue] of Object.entries(participantAvatarMap)) {
      const key = normalizeKey(rawKey)
      const value = typeof rawValue === 'string' ? rawValue.trim() : ''
      if (!key || !value) continue
      map.set(key, value)
    }
    return map
  }, [participantAvatarMap])

  useEffect(() => {
    setLayoutMode('auto')
  }, [roomName])

  const resolveParticipantAvatar = useCallback(
    (participant?: Participant | null) => {
      if (!participant) return ''

      const fromMetadata = getAvatarFromParticipantMetadata(participant)
      if (fromMetadata) return fromMetadata

      const localAvatar = localAvatarUrl?.trim() || ''
      const participantIdentity = normalizeKey(participant.identity)
      const participantDisplayName = normalizeKey(participant.name)
      const localIdentityCandidates = [normalizeKey(localUsername), normalizeKey(localUserName)]

      if (
        localAvatar &&
        (localIdentityCandidates.includes(participantIdentity) ||
          localIdentityCandidates.includes(participantDisplayName))
      ) {
        return localAvatar
      }

      const directMatch = avatarMap.get(participantIdentity) || avatarMap.get(participantDisplayName)
      if (directMatch) return directMatch

      const tokenCandidates = Array.from(
        new Set(
          `${participantIdentity} ${participantDisplayName}`
            .split(/[^a-z0-9._@-]+/i)
            .map((item) => normalizeKey(item))
            .filter(Boolean),
        ),
      )
      for (const token of tokenCandidates) {
        const byToken = avatarMap.get(token) || avatarMap.get(token.replace(/^@/, ''))
        if (byToken) return byToken
      }

      for (const [key, value] of avatarMap.entries()) {
        if (!key) continue
        if (
          participantIdentity.includes(key) ||
          participantDisplayName.includes(key) ||
          key.includes(participantIdentity) ||
          key.includes(participantDisplayName)
        ) {
          return value
        }
      }

      return ''
    },
    [avatarMap, localAvatarUrl, localUserName, localUsername],
  )

  if (!resolvedServerUrl) {
    return (
      <div className="stage">
        <h2>{roomTitle}</h2>
        <p>Set `VITE_LIVEKIT_URL` (or `NEXT_PUBLIC_LIVEKIT_URL`) to show video conference.</p>
      </div>
    )
  }

  if (!token) {
    return (
      <div className="stage">
        <h2>{roomTitle}</h2>
        <p>Joining room and preparing media session...</p>
      </div>
    )
  }

  return (
    <LiveKitRoom
      token={token}
      serverUrl={resolvedServerUrl}
      connect
      audio={false}
      video={false}
      className="stage livekit-stage"
      data-lk-theme="default"
      onError={(error) => {
        setConnectError(error?.message || 'Unable to connect media server.')
      }}
    >
          <LiveRoomContent
            audience={audience}
            roomName={roomName}
        connectError={connectError}
        chatOpen={chatOpen}
        initialMicEnabled={initialMicEnabled}
        initialCameraEnabled={initialCameraEnabled}
        chatBadgeCount={chatBadgeCount}
        settingsBadgeCount={settingsBadgeCount}
        pendingSpeakerRequests={pendingSpeakerRequests}
        resolveParticipantAvatar={resolveParticipantAvatar}
        onToggleChat={onToggleChat}
            onLeave={onLeave}
            onRequestSpeaker={onRequestSpeaker}
            layoutMode={layoutMode}
          />
    </LiveKitRoom>
  )
}
