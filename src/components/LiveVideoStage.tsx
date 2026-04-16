import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CarouselLayout,
  Chat,
  ChatIcon,
  ChatToggle,
  ConnectionStateToast,
  FocusLayoutContainer,
  GearIcon,
  GridLayout,
  LayoutContextProvider,
  LeaveIcon,
  LiveKitRoom,
  MediaDeviceMenu,
  ParticipantTile,
  RoomAudioRenderer,
  ScreenShareIcon,
  ScreenShareStopIcon,
  TrackToggle,
  type WidgetState,
  isTrackReference,
  useConnectionState,
  useCreateLayoutContext,
  useDataChannel,
  useLocalParticipant,
  useMaybeLayoutContext,
  useMaybeTrackRefContext,
  useParticipants,
  usePinnedTracks,
  useRoomContext,
  useTracks,
} from '@livekit/components-react'
import { ConnectionState, LocalTrackPublication, Participant, Track } from 'livekit-client'
import { BackgroundProcessor, supportsBackgroundProcessors, type BackgroundProcessorWrapper } from '@livekit/track-processors'
import { apiClient, getApiErrorMessage } from '../services/http'

// ─── Action drop — compatible with talkspaces.action.v1 ──────────────────────
const ACTION_DROP_TOPIC = 'talkspaces.action.v1'
const ROOM_CHAT_TOPIC = 'talkspaces.chat.v1'
const ACTION_THROTTLE_MS = 700

type RoomActionKind = 'flower' | 'icon' | 'team_badge'

interface RoomActionEventV1 {
  version: 'v1'
  id: string
  roomId?: string
  actor: { id: string; name?: string; avatar?: string }
  kind: RoomActionKind
  code: string
  sentAt: number
  display?: { lane?: number; durationMs?: number; scale?: number }
}

const isRoomActionEventV1 = (value: unknown): value is RoomActionEventV1 => {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    v.version === 'v1' &&
    typeof v.id === 'string' &&
    typeof v.kind === 'string' &&
    typeof v.code === 'string'
  )
}

// Action presets — must stay in sync with the web's ACTION_PRESETS list
const ACTION_PRESETS = [
  { kind: 'flower'     as RoomActionKind, code: 'heart_sparkle', label: 'Heart',    glyph: '💖' },
  { kind: 'icon'       as RoomActionKind, code: 'thumbs_up',     label: 'Like',     glyph: '👍' },
  { kind: 'icon'       as RoomActionKind, code: 'party',         label: 'Celebrate',glyph: '🎉' },
  { kind: 'icon'       as RoomActionKind, code: 'clap',          label: 'Clap',     glyph: '👏' },
  { kind: 'icon'       as RoomActionKind, code: 'joy',           label: 'Laugh',    glyph: '😂' },
  { kind: 'icon'       as RoomActionKind, code: 'wow',           label: 'Wow',      glyph: '😮' },
  { kind: 'icon'       as RoomActionKind, code: 'sad',           label: 'Sad',      glyph: '😢' },
  { kind: 'icon'       as RoomActionKind, code: 'thinking',      label: 'Think',    glyph: '🤔' },
  { kind: 'team_badge' as RoomActionKind, code: 'thumbs_down',   label: 'Dislike',  glyph: '👎' },
] as const

// code → display glyph (covers all known codes)
const ACTION_GLYPH_BY_CODE: Record<string, string> = Object.fromEntries(
  ACTION_PRESETS.map((p) => [p.code, p.glyph]),
)

// Legacy lk-reactions backward compat
type LegacyReactionPayload = { id: string; emoji: string; senderName: string }
const LEGACY_GLYPH_TO_CODE: Record<string, string> = {
  '👍': 'thumbs_up', '❤️': 'heart_sparkle', '😂': 'joy',
  '😮': 'wow', '👏': 'clap', '🎉': 'party',
}

type ActiveReaction = {
  id: string
  emoji: string
  lane: number        // 0–4, maps to left: (14 + lane * 16)%
  actorName: string
  durationMs: number
}

const normalizeUrl = (value?: string) => {
  if (!value) return ''
  return value.trim().replace(/\/+$/, '')
}

const CONNECTION_TIMEOUT_MS = 12_000
const normalizeKey = (value?: string) => value?.trim().toLowerCase() || ''
const splitIdentityTokens = (value?: string) =>
  (value || '')
    .split(/[^a-z0-9._@-]+/i)
    .map((part) => normalizeKey(part))
    .filter(Boolean)

const getParticipantMetadataRecord = (participant?: Participant | null) => {
  const metadata = participant?.metadata
  if (!metadata) return null
  try {
    const parsed = JSON.parse(metadata)
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>
    }
  } catch {
    // ignore malformed metadata
  }
  return null
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

const getMediaDeviceFailureMessage = (kind?: MediaDeviceKind) => {
  if (kind === 'audioinput') return 'Microphone is unavailable or permission is blocked.'
  if (kind === 'videoinput') return 'Camera is unavailable or permission is blocked.'
  if (kind === 'audiooutput') return 'Speaker device is unavailable.'
  return 'Media device is unavailable or permission is blocked.'
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
  if (message.includes('cancel') || message.includes('dismissed')) {
    return ''
  }
  return `Screen share failed: ${error?.message || 'unknown error'}`
}

const getAvatarFromParticipantMetadata = (participant?: Participant | null) => {
  const parsed = getParticipantMetadataRecord(participant)
  if (!parsed) return ''

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

  return ''
}

const toCssUrl = (rawUrl: string) => `url("${encodeURI(rawUrl)}")`

// ─── Recording ────────────────────────────────────────────────────────────────
type RecordingQualityPreset = 'performance' | 'balanced' | 'quality'

type RecordingQualityConfig = {
  width: number
  height: number
  frameRate: number
  videoBitsPerSecond: number
  label: string
}

const RECORDING_QUALITY_CONFIGS: Record<RecordingQualityPreset, RecordingQualityConfig> = {
  performance: { width: 1280, height: 720, frameRate: 30, videoBitsPerSecond: 6_000_000, label: 'Performance (720p30)' },
  balanced: { width: 1920, height: 1080, frameRate: 30, videoBitsPerSecond: 12_000_000, label: 'Balanced (1080p30)' },
  quality: { width: 1920, height: 1080, frameRate: 60, videoBitsPerSecond: 20_000_000, label: 'Quality (1080p60)' },
}

const getSupportedRecordingMimeType = (): { mimeType: string; isH264: boolean } => {
  // Prefer H.264 — if supported, FFmpeg can remux in seconds instead of re-encoding
  const h264Candidates = ['video/webm;codecs=h264,opus', 'video/webm;codecs=avc1,opus']
  for (const c of h264Candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) {
      return { mimeType: c, isH264: true }
    }
  }
  // Fallback to VP9/VP8 — will require full re-encode
  const vpxCandidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
  for (const c of vpxCandidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) {
      return { mimeType: c, isH264: false }
    }
  }
  return { mimeType: '', isH264: false }
}

const buildRecordingFileName = () => {
  const now = new Date()
  const pad = (v: number) => String(v).padStart(2, '0')
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `${date}-${time}.webm`
}

const slugifyRoomTitle = (title: string) =>
  title.trim().replace(/[/\\:*?"<>|]+/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '') || 'recording'

function AvatarParticipantTile({
  resolveParticipantAvatar,
  trackRef,
}: {
  resolveParticipantAvatar: (participant?: Participant | null) => string
  trackRef?: any
}) {
  const trackRefFromContext = useMaybeTrackRefContext()
  const resolvedTrackRef = trackRef ?? trackRefFromContext
  const avatarUrl = resolveParticipantAvatar(resolvedTrackRef?.participant)
  const style = avatarUrl
    ? ({ ['--lk-avatar-image' as any]: toCssUrl(avatarUrl) } as React.CSSProperties)
    : undefined

  return (
    <ParticipantTile
      trackRef={trackRef}
      className={avatarUrl ? 'lk-avatar-participant-tile' : undefined}
      style={style}
    />
  )
}

function useReactions() {
  const [reactions, setReactions] = useState<ActiveReaction[]>([])
  const { localParticipant } = useLocalParticipant()
  const actionSeenRef = useRef(new Set<string>())
  const lastSentAtRef = useRef(0)

  const addAction = useCallback((event: RoomActionEventV1) => {
    if (actionSeenRef.current.has(event.id)) return
    actionSeenRef.current.add(event.id)

    const emoji = ACTION_GLYPH_BY_CODE[event.code] ?? (event.kind === 'flower' ? '💖' : '👍')
    const actorName = event.actor.name || event.actor.id || ''
    const lane = event.display?.lane ?? Math.floor(Math.random() * 5)
    const durationMs = Math.max(1400, Math.min(3200, event.display?.durationMs ?? 2600))

    setReactions((prev) => [...prev, { id: event.id, emoji, lane, actorName, durationMs }])
    setTimeout(() => {
      setReactions((prev) => prev.filter((r) => r.id !== event.id))
    }, durationMs + 200)
    setTimeout(() => {
      actionSeenRef.current.delete(event.id)
    }, 60_000)
  }, [])

  // Primary channel: talkspaces.action.v1 (web/mobile compatible)
  const { send: sendV1, message: latestV1 } = useDataChannel(ACTION_DROP_TOPIC)

  useEffect(() => {
    if (!latestV1?.payload) return
    try {
      const parsed = JSON.parse(new TextDecoder().decode(latestV1.payload))
      if (isRoomActionEventV1(parsed)) addAction(parsed)
    } catch {
      // ignore malformed messages
    }
  }, [latestV1?.payload, addAction])

  // Backward compat: lk-reactions (legacy desktop format)
  const handleLegacy = useCallback(
    (msg: { payload: Uint8Array }) => {
      try {
        const data = JSON.parse(new TextDecoder().decode(msg.payload)) as LegacyReactionPayload
        if (!data?.id || !data?.emoji) return
        const code = LEGACY_GLYPH_TO_CODE[data.emoji] ?? 'thumbs_up'
        addAction({
          version: 'v1',
          id: data.id,
          actor: { id: '', name: data.senderName },
          kind: 'icon',
          code,
          sentAt: Date.now(),
        })
      } catch {
        // ignore malformed messages
      }
    },
    [addAction],
  )
  useDataChannel('lk-reactions', handleLegacy)

  const sendReaction = useCallback(
    (code: string) => {
      const now = Date.now()
      if (now - lastSentAtRef.current < ACTION_THROTTLE_MS) return
      lastSentAtRef.current = now

      const preset = ACTION_PRESETS.find((p) => p.code === code)
      if (!preset) return

      const id = `${now}-${Math.random().toString(36).slice(2, 7)}`
      const actorId = localParticipant?.identity || 'unknown'
      const actorName = localParticipant?.name || actorId

      const event: RoomActionEventV1 = {
        version: 'v1',
        id,
        actor: { id: actorId, name: actorName },
        kind: preset.kind,
        code: preset.code,
        sentAt: now,
        display: { durationMs: 2600 },
      }

      try {
        sendV1(new TextEncoder().encode(JSON.stringify(event)), { reliable: false })
      } catch {
        // data channel not ready — show locally anyway
      }
      addAction(event)
    },
    [localParticipant, sendV1, addAction],
  )

  return { reactions, sendReaction }
}

function ReactionOverlay({ reactions }: { reactions: ActiveReaction[] }) {
  if (reactions.length === 0) return null
  return (
    <div className="desktop-vc-reaction-overlay" aria-hidden="true">
      {reactions.map((r) => (
        <div
          key={r.id}
          className="desktop-vc-reaction-particle"
          style={{ left: `${14 + r.lane * 16}%`, animationDuration: `${r.durationMs}ms` }}
        >
          <span className="desktop-vc-reaction-glyph">{r.emoji}</span>
          {r.actorName ? <span className="desktop-vc-reaction-actor">{r.actorName}</span> : null}
        </div>
      ))}
    </div>
  )
}

function ReactionsBar({
  onReact,
  onClose,
}: {
  onReact: (code: string) => void
  onClose: () => void
}) {
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [onClose])

  return (
    <div className="desktop-vc-reactions-bar" ref={barRef} role="toolbar" aria-label="Pick a reaction">
      {ACTION_PRESETS.map((preset) => (
        <button
          key={preset.code}
          className="desktop-vc-reactions-bar__btn"
          onClick={() => { onReact(preset.code); onClose() }}
          type="button"
          title={preset.label}
        >
          {preset.glyph}
        </button>
      ))}
    </div>
  )
}

function SettingsPanel({
  roomId,
  isHost,
  audience,
  onPendingRequestCountChange,
  onRecordingSettingsChange,
}: {
  roomId?: string
  isHost: boolean
  audience: boolean
  onPendingRequestCountChange?: (count: number) => void
  onRecordingSettingsChange?: (settings: { quality: RecordingQualityPreset }) => void
}) {
  // ── Recording settings (managed locally, surfaced via callback) ───────────
  const [recordingQuality, setRecordingQuality] = useState<RecordingQualityPreset>('balanced')

  const handleRecordingQualityChange = useCallback((quality: RecordingQualityPreset) => {
    setRecordingQuality(quality)
    onRecordingSettingsChange?.({ quality })
  }, [onRecordingSettingsChange])

  // ── Background ────────────────────────────────────────────────────────────
  const { cameraTrack } = useLocalParticipant()
  type BgMode = 'none' | 'blur' | 'office' | 'nature'
  const [bgMode, setBgMode] = useState<BgMode>('none')
  const processorRef = useRef<BackgroundProcessorWrapper | null>(null)
  const bgSupported = useMemo(() => supportsBackgroundProcessors(), [])

  const bgImages = {
    office: './backgrounds/bg-office.jpg',
    nature: './backgrounds/bg-nature.jpg',
  } as const

  useEffect(() => {
    const track = (cameraTrack as LocalTrackPublication | undefined)?.track
    if (!track || !bgSupported) return
    if (bgMode === 'none') {
      if (processorRef.current) {
        track.stopProcessor().catch(console.warn)
        processorRef.current = null
      }
      return
    }
    const config =
      bgMode === 'blur'
        ? ({ mode: 'background-blur', blurRadius: 10 } as const)
        : ({ mode: 'virtual-background', imagePath: bgImages[bgMode] } as const)
    if (processorRef.current) {
      processorRef.current.switchTo(config).catch(console.warn)
    } else {
      const p = BackgroundProcessor(config)
      track.setProcessor(p).catch(console.warn)
      processorRef.current = p
    }
  }, [bgMode, cameraTrack, bgSupported, bgImages])

  // ── Kick participants ──────────────────────────────────────────────────────
  const participants = useParticipants()
  const { localParticipant: localP } = useLocalParticipant()
  const [kickingId, setKickingId] = useState<string | null>(null)
  const [kickError, setKickError] = useState('')

  const handleKick = useCallback(async (identity: string, name: string) => {
    if (!roomId || kickingId) return
    const confirmed = window.confirm(`Remove "${name}" from the room?`)
    if (!confirmed) return
    setKickingId(identity)
    setKickError('')
    try {
      await apiClient.post(`api/v1/rooms/${roomId}/kick/${identity}`)
    } catch (err) {
      setKickError(getApiErrorMessage(err as any) || 'Failed to remove participant.')
    } finally {
      setKickingId(null)
    }
  }, [roomId, kickingId])

  // ── Speaker requests ───────────────────────────────────────────────────────
  type SpeakerReq = {
    id: string
    message?: string
    createdAt?: string
    user: { id: string; name?: string; username?: string; avatar?: string }
  }
  const [pendingRequests, setPendingRequests] = useState<SpeakerReq[]>([])
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [expandedReqId, setExpandedReqId] = useState<string | null>(null)
  const [myRequest, setMyRequest] = useState<SpeakerReq | null>(null)
  const [requestMsg, setRequestMsg] = useState('')
  const [requestSubmitting, setRequestSubmitting] = useState(false)
  const [requestCanceling, setRequestCanceling] = useState(false)
  const [speakerError, setSpeakerError] = useState('')

  // Poll pending requests (host only)
  useEffect(() => {
    if (!isHost || !roomId) return
    const fetch = async () => {
      try {
        const res = await apiClient.get(`api/v1/rooms/${roomId}/speaker-requests`)
        const list = (res.data?.data as SpeakerReq[] | undefined) ?? []
        setPendingRequests(list)
      } catch {
        // silently ignore polling errors
      }
    }
    fetch()
    const timer = setInterval(fetch, 5000)
    return () => clearInterval(timer)
  }, [isHost, roomId])

  useEffect(() => {
    onPendingRequestCountChange?.(isHost && roomId ? pendingRequests.length : 0)
  }, [isHost, onPendingRequestCountChange, pendingRequests.length, roomId])

  const handleApprove = useCallback(async (req: SpeakerReq) => {
    if (!roomId || approvingId) return
    setApprovingId(req.id)
    setSpeakerError('')
    try {
      await apiClient.post(`api/v1/rooms/${roomId}/speaker-requests/${req.id}/approve`)
      setPendingRequests((prev) => prev.filter((r) => r.id !== req.id))
    } catch (err) {
      setSpeakerError(getApiErrorMessage(err as any) || 'Failed to approve.')
    } finally {
      setApprovingId(null)
    }
  }, [roomId, approvingId])

  const handleReject = useCallback(async (req: SpeakerReq) => {
    if (!roomId || rejectingId) return
    setRejectingId(req.id)
    setSpeakerError('')
    try {
      await apiClient.post(`api/v1/rooms/${roomId}/speaker-requests/${req.id}/reject`)
      setPendingRequests((prev) => prev.filter((r) => r.id !== req.id))
    } catch (err) {
      setSpeakerError(getApiErrorMessage(err as any) || 'Failed to reject.')
    } finally {
      setRejectingId(null)
    }
  }, [roomId, rejectingId])

  const handleRequestSpeak = useCallback(async () => {
    if (!roomId || requestSubmitting || myRequest) return
    setRequestSubmitting(true)
    setSpeakerError('')
    try {
      const res = await apiClient.post(`api/v1/rooms/${roomId}/speaker-requests`, {
        message: requestMsg.trim() || undefined,
      })
      const created = (res.data?.data as SpeakerReq | undefined) ?? { id: `local-${Date.now()}`, user: { id: '' } }
      setMyRequest(created)
      setRequestMsg('')
    } catch (err) {
      setSpeakerError(getApiErrorMessage(err as any) || 'Could not send request.')
    } finally {
      setRequestSubmitting(false)
    }
  }, [roomId, requestSubmitting, myRequest, requestMsg])

  const handleCancelRequest = useCallback(async () => {
    if (!roomId || !myRequest || requestCanceling) return
    setRequestCanceling(true)
    setSpeakerError('')
    try {
      if (!myRequest.id.startsWith('local-')) {
        await apiClient.post(`api/v1/rooms/${roomId}/speaker-requests/${myRequest.id}/cancel`)
      }
      setMyRequest(null)
      setRequestMsg('')
    } catch (err) {
      setSpeakerError(getApiErrorMessage(err as any) || 'Could not cancel request.')
    } finally {
      setRequestCanceling(false)
    }
  }, [roomId, myRequest, requestCanceling])

  const remoteParticipants = participants.filter((p) => p.identity !== localP?.identity)

  return (
    <div className="desktop-vc-settings">
      <div className="desktop-vc-settings__header">
        <strong>Settings</strong>
        <span>Devices, background and more</span>
      </div>
      <div className="desktop-vc-settings__body">

        {/* Devices */}
        <div className="desktop-vc-settings__group-label">Devices</div>
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

        {/* Background */}
        {bgSupported && (
          <>
            <div className="desktop-vc-settings__group-label">Background</div>
            <div className="desktop-vc-settings__bg-row">
              {([
                { id: 'none',   label: 'None',  thumb: null },
                { id: 'blur',   label: 'Blur',  thumb: null },
                { id: 'office', label: 'Office', thumb: bgImages.office },
                { id: 'nature', label: 'Nature', thumb: bgImages.nature },
              ] as const).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`desktop-vc-settings__bg-btn${bgMode === opt.id ? ' is-active' : ''}`}
                  onClick={() => setBgMode(opt.id)}
                >
                  <span className="desktop-vc-settings__bg-btn-thumb">
                    {opt.thumb ? (
                      <img src={opt.thumb} alt={opt.label} />
                    ) : opt.id === 'blur' ? (
                      <span className="desktop-vc-settings__bg-blur-icon" />
                    ) : (
                      <span className="desktop-vc-settings__bg-none-icon">✕</span>
                    )}
                  </span>
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Speaker requests */}
        {roomId && (
          <>
            <div className="desktop-vc-settings__group-label">
              {isHost ? 'Speaker requests' : 'Request to speak'}
            </div>
            {isHost ? (
              <div className="desktop-vc-settings__speaker-list">
                {speakerError && <p className="desktop-vc-settings__error">{speakerError}</p>}
                {pendingRequests.length === 0 ? (
                  <p className="desktop-vc-settings__empty">No pending requests</p>
                ) : (
                  pendingRequests.map((req) => {
                    const isExpanded = expandedReqId === req.id
                    const displayName = req.user?.name || req.user?.username || req.user?.id || req.id
                    return (
                      <div key={req.id} className="desktop-vc-settings__speaker-row">
                        <div className="desktop-vc-settings__speaker-top">
                          <button
                            type="button"
                            className="desktop-vc-settings__speaker-name-btn"
                            onClick={() => setExpandedReqId(isExpanded ? null : req.id)}
                            title={req.message ? 'Click to see message' : undefined}
                          >
                            <span className="desktop-vc-settings__speaker-name">{displayName}</span>
                            {req.message && (
                              <span className="desktop-vc-settings__speaker-expand-icon">
                                {isExpanded ? '▲' : '▼'}
                              </span>
                            )}
                          </button>
                          <div className="desktop-vc-settings__speaker-actions">
                            <button
                              type="button"
                              className="desktop-vc-settings__action-btn desktop-vc-settings__action-btn--approve"
                              disabled={approvingId === req.id || !!rejectingId}
                              onClick={() => handleApprove(req)}
                            >
                              {approvingId === req.id ? '…' : 'Approve'}
                            </button>
                            <button
                              type="button"
                              className="desktop-vc-settings__action-btn desktop-vc-settings__action-btn--reject"
                              disabled={rejectingId === req.id || !!approvingId}
                              onClick={() => handleReject(req)}
                            >
                              {rejectingId === req.id ? '…' : 'Reject'}
                            </button>
                          </div>
                        </div>
                        {isExpanded && req.message && (
                          <div className="desktop-vc-settings__speaker-msg">{req.message}</div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            ) : audience ? (
              <div className="desktop-vc-settings__speaker-request">
                {speakerError && <p className="desktop-vc-settings__error">{speakerError}</p>}
                {myRequest ? (
                  <div className="desktop-vc-settings__my-request">
                    <span className="desktop-vc-settings__my-request-label">
                      Request pending…
                    </span>
                    <button
                      type="button"
                      className="desktop-vc-settings__action-btn desktop-vc-settings__action-btn--cancel"
                      disabled={requestCanceling}
                      onClick={handleCancelRequest}
                    >
                      {requestCanceling ? '…' : 'Cancel'}
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      className="desktop-vc-settings__request-input"
                      placeholder="Optional message to host…"
                      value={requestMsg}
                      onChange={(e) => setRequestMsg(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleRequestSpeak() }}
                    />
                    <button
                      type="button"
                      className="desktop-vc-settings__action-btn desktop-vc-settings__action-btn--primary"
                      disabled={requestSubmitting}
                      onClick={handleRequestSpeak}
                    >
                      {requestSubmitting ? '…' : 'Request to speak'}
                    </button>
                  </>
                )}
              </div>
            ) : null}
          </>
        )}

        {/* Kick participants (host only) */}
        {isHost && roomId && (
          <>
            <div className="desktop-vc-settings__group-label">Participants</div>
            {kickError && <p className="desktop-vc-settings__error">{kickError}</p>}
            {remoteParticipants.length === 0 ? (
              <p className="desktop-vc-settings__empty">No other participants</p>
            ) : (
              <div className="desktop-vc-settings__kick-list">
                {remoteParticipants.map((p) => {
                  const displayName = p.name || p.identity || 'Unknown'
                  return (
                    <div key={p.identity} className="desktop-vc-settings__kick-row">
                      <span className="desktop-vc-settings__kick-name">{displayName}</span>
                      <button
                        type="button"
                        className="desktop-vc-settings__action-btn desktop-vc-settings__action-btn--danger"
                        disabled={kickingId === p.identity}
                        onClick={() => handleKick(p.identity, displayName)}
                      >
                        {kickingId === p.identity ? '…' : 'Kick'}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* Recording */}
        <>
          <div className="desktop-vc-settings__group-label">Recording</div>
          <section className="desktop-vc-settings__section">
            <label>Quality</label>
            <div className="desktop-vc-settings__radio-group">
              {(['performance', 'balanced', 'quality'] as RecordingQualityPreset[]).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={`desktop-vc-settings__radio-btn${recordingQuality === preset ? ' is-active' : ''}`}
                  onClick={() => handleRecordingQualityChange(preset)}
                >
                  {RECORDING_QUALITY_CONFIGS[preset].label}
                </button>
              ))}
            </div>
          </section>
        </>

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

function ElectronScreenShareButton({
  canShare,
  onMessage,
}: {
  canShare: boolean
  onMessage: (message: string) => void
}) {
  const { localParticipant, isScreenShareEnabled } = useLocalParticipant()
  const [pending, setPending] = useState(false)
  const [fallbackEnabled, setFallbackEnabled] = useState(false)
  const fallbackPublishedTrackRef = useRef<any>(null)
  const shareAutoMiniModeRef = useRef(false)
  const shareEnabled = fallbackEnabled || isScreenShareEnabled
  const previousShareEnabledRef = useRef(shareEnabled)

  const stopFallbackShare = useCallback(async () => {
    const publishedTrack = fallbackPublishedTrackRef.current
    if (!publishedTrack) {
      setFallbackEnabled(false)
      return
    }
    try {
      await localParticipant.unpublishTrack(publishedTrack, true)
      publishedTrack.stop?.()
    } catch {
      // ignore cleanup failure
    } finally {
      fallbackPublishedTrackRef.current = null
      setFallbackEnabled(false)
    }
  }, [localParticipant])

  useEffect(() => {
    return () => {
      void stopFallbackShare()
    }
  }, [stopFallbackShare])

  const exitMiniModeAfterShare = useCallback(async () => {
    if (!shareAutoMiniModeRef.current) return
    shareAutoMiniModeRef.current = false
    try {
      const result = await window.electronAPI?.exitMiniMode?.()
      if (result?.success) {
        window.dispatchEvent(
          new CustomEvent('desktop-vc-mini-mode', {
            detail: { enabled: false, reason: 'screen-share-stop' },
          }),
        )
      }
    } catch {
      // Ignore restore failures: screen share stop should still complete.
    }
  }, [])

  const enterMiniModeAfterShare = useCallback(async () => {
    try {
      const result = await window.electronAPI?.enterMiniMode?.()
      if (result?.success && !result.alreadyMini) {
        shareAutoMiniModeRef.current = true
        window.dispatchEvent(
          new CustomEvent('desktop-vc-mini-mode', {
            detail: { enabled: true, reason: 'screen-share' },
          }),
        )
      }
    } catch {
      // Ignore window resize failures: screen share itself already succeeded.
    }
  }, [])

  useEffect(() => {
    const wasEnabled = previousShareEnabledRef.current
    if (wasEnabled && !shareEnabled) {
      void exitMiniModeAfterShare()
    }
    previousShareEnabledRef.current = shareEnabled
  }, [shareEnabled, exitMiniModeAfterShare])

  const startFallbackShare = useCallback(
    async (sourceId: string) => {
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
        void stopFallbackShare()
      }

      const publication = await localParticipant.publishTrack(mediaTrack, {
        source: Track.Source.ScreenShare,
        simulcast: false,
      })

      if (!publication?.track) {
        mediaTrack.stop()
        throw new Error('Unable to publish desktop capture track.')
      }

      fallbackPublishedTrackRef.current = publication.track
      setFallbackEnabled(true)
    },
    [localParticipant, stopFallbackShare],
  )

  const toggleScreenShare = useCallback(async () => {
    if (pending || !canShare) return
    setPending(true)

    try {
      if (fallbackEnabled) {
        await stopFallbackShare()
        onMessage('')
        return
      }

      if (isScreenShareEnabled) {
        await localParticipant.setScreenShareEnabled(false)
        onMessage('')
        return
      }

      if (window.electronAPI?.pickDesktopSource) {
        const pickedSource = await window.electronAPI.pickDesktopSource()
        if (!pickedSource?.id) {
          onMessage('')
          return
        }
        await startFallbackShare(pickedSource.id)
        await enterMiniModeAfterShare()
        onMessage('')
        return
      }

      await localParticipant.setScreenShareEnabled(true)
      await enterMiniModeAfterShare()
      onMessage('')
    } catch (error: any) {
      onMessage(getScreenShareFriendlyError(error))
    } finally {
      setPending(false)
    }
  }, [
    canShare,
    fallbackEnabled,
    isScreenShareEnabled,
    localParticipant,
    onMessage,
    pending,
    enterMiniModeAfterShare,
    startFallbackShare,
    stopFallbackShare,
  ])

  return (
    <button
      className="lk-button"
      aria-pressed={shareEnabled}
      data-lk-source="screen_share"
      data-lk-enabled={shareEnabled}
      disabled={pending || !canShare}
      onClick={() => void toggleScreenShare()}
      title={shareEnabled ? 'Stop screen share' : 'Share screen'}
      type="button"
    >
      {shareEnabled ? <ScreenShareStopIcon /> : <ScreenShareIcon />}
    </button>
  )
}

function DesktopControlBar({
  audience,
  onMessage,
  onReact,
  chatBadgeCount,
  settingsBadgeCount,
  recordingEnabled,
  recordingPending,
  recordingDuration,
  onToggleRecording,
  recordingQuality,
  onLeaveRequested,
}: {
  audience: boolean
  onMessage: (message: string) => void
  onReact: (code: string) => void
  chatBadgeCount: number
  settingsBadgeCount: number
  recordingEnabled: boolean
  recordingPending: boolean
  recordingDuration: number
  onToggleRecording: () => void
  recordingQuality: RecordingQualityPreset
  onLeaveRequested: () => void
}) {
  const { localParticipant } = useLocalParticipant()
  const layoutContext = useMaybeLayoutContext()
  const canPublish = !audience && Boolean(localParticipant?.permissions?.canPublish)
  const chatOpen = Boolean(layoutContext?.widget.state?.showChat)
  const settingsOpen = Boolean(layoutContext?.widget.state?.showSettings)
  const [pickerOpen, setPickerOpen] = useState(false)
  const reactionsBtnRef = useRef<HTMLButtonElement>(null)
  const toggleSettingsDrawer = useCallback(() => {
    const widget = layoutContext?.widget
    if (!widget?.dispatch) return
    if (chatOpen) {
      widget.dispatch({ msg: 'toggle_chat' })
    }
    widget.dispatch({ msg: 'toggle_settings' })
  }, [chatOpen, layoutContext?.widget])
  useEffect(() => {
    if (!chatOpen || !settingsOpen) return
    layoutContext?.widget.dispatch?.({ msg: 'toggle_settings' })
  }, [chatOpen, layoutContext?.widget, settingsOpen])

  return (
    <div className="lk-control-bar">
      <TrackToggle
        source={Track.Source.Microphone}
        disabled={!canPublish}
        onDeviceError={(error) => onMessage(`Microphone failed: ${error.message}`)}
      />
      <TrackToggle
        source={Track.Source.Camera}
        disabled={!canPublish}
        onDeviceError={(error) => onMessage(`Camera failed: ${error.message}`)}
      />
      <ElectronScreenShareButton canShare={canPublish} onMessage={onMessage} />
      <div className="desktop-vc-record-wrap">
        <button
          className={`lk-button desktop-vc-record-btn${recordingEnabled ? ' desktop-vc-record-btn--active' : ''}`}
          onClick={onToggleRecording}
          disabled={recordingPending}
          type="button"
          aria-label={recordingEnabled ? 'Stop recording' : 'Record meeting'}
          aria-pressed={recordingEnabled}
        >
          {recordingEnabled ? (
            <>
              <span className="desktop-vc-record-btn__dot" aria-hidden="true" />
              <span className="desktop-vc-record-btn__timer">
                {`${String(Math.floor(recordingDuration / 60)).padStart(2, '0')}:${String(recordingDuration % 60).padStart(2, '0')}`}
              </span>
            </>
          ) : (
            <svg
              className="desktop-vc-record-btn__icon"
              aria-hidden="true"
              viewBox="0 0 20 20"
              width="18"
              height="18"
              fill="currentColor"
            >
              <circle cx="10" cy="10" r="6" />
            </svg>
          )}
          <span className="desktop-vc-record-btn__tooltip" role="tooltip">
            {recordingEnabled
              ? `Stop recording · ${RECORDING_QUALITY_CONFIGS[recordingQuality].label}`
              : `Record · ${RECORDING_QUALITY_CONFIGS[recordingQuality].label}`}
          </span>
        </button>
      </div>
      <div className="desktop-vc-reactions-wrap">
        {pickerOpen && (
          <ReactionsBar
            onReact={onReact}
            onClose={() => setPickerOpen(false)}
          />
        )}
        <button
          ref={reactionsBtnRef}
          className="lk-button desktop-vc-reactions-btn"
          aria-pressed={pickerOpen}
          aria-label="Reactions"
          title="Reactions"
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
        >
          <span className="desktop-vc-reactions-btn__icon" aria-hidden="true">🎭</span>
        </button>
      </div>
      <ChatToggle title="Chat">
        <ChatIcon />
        {!chatOpen && chatBadgeCount > 0 && (
          <span className="desktop-vc-control-badge">{chatBadgeCount > 99 ? '99+' : chatBadgeCount}</span>
        )}
      </ChatToggle>
      <button
        className="lk-button lk-settings-toggle"
        aria-pressed={settingsOpen}
        onClick={toggleSettingsDrawer}
        title="Settings"
        type="button"
      >
        <GearIcon />
        {!settingsOpen && settingsBadgeCount > 0 && (
          <span className="desktop-vc-control-badge">{settingsBadgeCount > 99 ? '99+' : settingsBadgeCount}</span>
        )}
      </button>
      <button
        className="lk-button lk-disconnect-button"
        title="Leave"
        type="button"
        onClick={onLeaveRequested}
      >
        <LeaveIcon />
      </button>
    </div>
  )
}

function DesktopMeetingHeader({ title, participantCount }: { title: string; participantCount: number }) {
  const [isMaximized, setIsMaximized] = useState(false)
  const [isMiniMode, setIsMiniMode] = useState(false)
  const api = (window as any).electronAPI

  useEffect(() => {
    api?.isMaximizedCurrentWindow?.().then((res: any) => {
      if (res) setIsMaximized(res.isMaximized || res.isFullScreen)
    })
  }, [api])

  useEffect(() => {
    const onMiniModeEvent = (event: Event) => {
      const customEvent = event as CustomEvent<{ enabled?: boolean }>
      if (typeof customEvent.detail?.enabled === 'boolean') {
        setIsMiniMode(customEvent.detail.enabled)
      }
    }
    window.addEventListener('desktop-vc-mini-mode', onMiniModeEvent as EventListener)
    return () => {
      window.removeEventListener('desktop-vc-mini-mode', onMiniModeEvent as EventListener)
    }
  }, [])

  const handleMinimize = async () => {
    await api?.enterMiniMode?.({ participantCount })
    window.dispatchEvent(new CustomEvent('desktop-vc-mini-mode', { detail: { enabled: true } }))
    setIsMiniMode(true)
  }
  const handleMaximize = async () => {
    if (isMiniMode) {
      await api?.exitMiniMode?.()
      await api?.expandCurrentWindowHeight?.()
      window.dispatchEvent(new CustomEvent('desktop-vc-mini-mode', { detail: { enabled: false } }))
      setIsMiniMode(false)
      return
    }
    const res = await api?.maximizeCurrentWindow?.()
    if (res) setIsMaximized(res.isMaximized)
  }
  const handleClose = () => api?.closeCurrentWindow?.()

  return (
    <header className="desktop-vc-header" aria-label="Meeting header">
      <div className="desktop-vc-header__brand desktop-vc-header__drag">
        <span className="desktop-vc-header__mark">TS</span>
        <span className="desktop-vc-header__brand-text">
          <strong>TalkSpace</strong>
          <span>Meeting</span>
        </span>
      </div>

      <div className="desktop-vc-header__title desktop-vc-header__drag">
        <span className="desktop-vc-header__info">i</span>
        <span className="desktop-vc-header__title-text">{title}</span>
      </div>

      <div className="desktop-vc-header__right">
        <div className="desktop-vc-header__tools desktop-vc-header__drag">
          <span className="desktop-vc-header__secure">Secure</span>
          <span className="desktop-vc-header__chip">HD</span>
          <span className="desktop-vc-header__chip">Layout</span>
        </div>
        <div className="desktop-vc-header__winctrl" aria-label="Window controls">
          <button
            className="desktop-vc-winbtn desktop-vc-winbtn--minimize"
            onClick={handleMinimize}
            title="Minimize"
            aria-label="Minimize"
          >
            <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
          </button>
          <button
            className="desktop-vc-winbtn desktop-vc-winbtn--maximize"
            onClick={handleMaximize}
            title={isMaximized ? 'Restore' : 'Maximize'}
            aria-label={isMaximized ? 'Restore' : 'Maximize'}
          >
            {isMaximized ? (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <rect x="2" y="0" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.2"/>
                <rect x="0" y="2" width="8" height="8" rx="1" fill="var(--desktop-vc-header-bg)" stroke="currentColor" strokeWidth="1.2"/>
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <rect x="0.6" y="0.6" width="8.8" height="8.8" rx="1" stroke="currentColor" strokeWidth="1.2"/>
              </svg>
            )}
          </button>
          <button
            className="desktop-vc-winbtn desktop-vc-winbtn--close"
            onClick={handleClose}
            title="Close"
            aria-label="Close"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>
    </header>
  )
}

function DesktopConference({
  audience,
  onMessage,
  resolveParticipantAvatar,
  roomTitle,
  roomId,
  hostIdentityHints,
}: {
  audience: boolean
  onMessage: (message: string) => void
  resolveParticipantAvatar: (participant?: Participant | null) => string
  roomTitle: string
  roomId?: string
  hostIdentityHints: string[]
}) {
  const MINI_CAROUSEL_BREAKPOINT = 260
  const MINI_CAROUSEL_GAP = 8
  const DESKTOP_CAROUSEL_GAP = 8
  const [widgetState, setWidgetState] = useState<WidgetState>({
    showChat: false,
    unreadMessages: 0,
    showSettings: false,
  })
  const [isMiniWidth, setIsMiniWidth] = useState(() => window.innerWidth <= MINI_CAROUSEL_BREAKPOINT)
  const [miniCarouselOverflow, setMiniCarouselOverflow] = useState(false)
  const [miniCarouselCanPrev, setMiniCarouselCanPrev] = useState(false)
  const [miniCarouselCanNext, setMiniCarouselCanNext] = useState(false)
  const [desktopCarouselOverflow, setDesktopCarouselOverflow] = useState(false)
  const [desktopCarouselCanPrev, setDesktopCarouselCanPrev] = useState(false)
  const [desktopCarouselCanNext, setDesktopCarouselCanNext] = useState(false)
  const [settingsBadgeCount, setSettingsBadgeCount] = useState(0)
  const [recordingEnabled, setRecordingEnabled] = useState(false)
  const [recordingPending, setRecordingPending] = useState(false)
  const [recordingDuration, setRecordingDuration] = useState(0)
  const [recordingQuality, setRecordingQuality] = useState<RecordingQualityPreset>('balanced')
  const conferenceRef = useRef<HTMLDivElement | null>(null)
  const captureAreaRef = useRef<HTMLDivElement | null>(null)
  const recordingStreamRef = useRef<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordingSessionIdRef = useRef<string | null>(null)
  const currentWebmPathRef = useRef<string | null>(null)
  const recordingIsH264Ref = useRef(false)
  const recordingFolderRef = useRef<string | null>(null)
  const pendingWritesRef = useRef<Promise<void>>(Promise.resolve())
  const canvasCaptureRef = useRef<{
    canvas: HTMLCanvasElement
    rafId: number | null
    screenShareVideoEl: HTMLVideoElement | null
    windowVideo: HTMLVideoElement | null
    windowStream: MediaStream | null
    audioContext: AudioContext | null
    capturedAudioTracks: MediaStreamTrack[]
  } | null>(null)
  const leaveAfterRecordingRef = useRef(false)
  const room = useRoomContext()

  useEffect(() => {
    if (!recordingEnabled) { setRecordingDuration(0); return }
    const id = setInterval(() => setRecordingDuration((d) => d + 1), 1000)
    return () => clearInterval(id)
  }, [recordingEnabled])

  const layoutContext = useCreateLayoutContext()
  const { reactions, sendReaction } = useReactions()
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  )
  const focusTrack = usePinnedTracks(layoutContext)?.[0]
  const screenShareTracks = tracks
    .filter(isTrackReference)
    .filter((track) => track.publication.source === Track.Source.ScreenShare)
  const hostIdentitySet = useMemo(() => {
    const set = new Set<string>()
    for (const rawHint of hostIdentityHints) {
      const normalizedHint = normalizeKey(rawHint)
      if (!normalizedHint) continue
      set.add(normalizedHint)
      set.add(normalizedHint.replace(/^@/, ''))
      for (const token of splitIdentityTokens(normalizedHint)) {
        set.add(token)
        set.add(token.replace(/^@/, ''))
      }
    }
    return set
  }, [hostIdentityHints])
  const isHostParticipant = useCallback(
    (participant?: Participant | null) => {
      if (!participant) return false

      const participantIdentity = normalizeKey(participant.identity)
      const participantDisplayName = normalizeKey(participant.name)
      const identityCandidates = [
        participantIdentity,
        participantIdentity.replace(/^@/, ''),
        participantDisplayName,
        participantDisplayName.replace(/^@/, ''),
      ].filter(Boolean)
      if (identityCandidates.some((candidate) => hostIdentitySet.has(candidate))) {
        return true
      }

      const identityTokens = [
        ...splitIdentityTokens(participantIdentity),
        ...splitIdentityTokens(participantDisplayName),
      ]
      if (
        identityTokens.some(
          (token) => hostIdentitySet.has(token) || hostIdentitySet.has(token.replace(/^@/, '')),
        )
      ) {
        return true
      }

      const parsed = getParticipantMetadataRecord(participant)
      if (!parsed) return false

      const roleKeys = ['role', 'roomRole', 'spaceRole', 'participantRole', 'livekitRole']
      for (const key of roleKeys) {
        const value = parsed[key]
        if (typeof value === 'string' && normalizeKey(value) === 'host') {
          return true
        }
      }

      const idKeys = [
        'id',
        'uid',
        'userId',
        'userID',
        'hostId',
        'username',
        'userName',
        'name',
        'displayName',
      ]
      for (const key of idKeys) {
        const value = parsed[key]
        if (typeof value !== 'string') continue
        const normalizedValue = normalizeKey(value)
        if (!normalizedValue) continue
        if (
          hostIdentitySet.has(normalizedValue) ||
          hostIdentitySet.has(normalizedValue.replace(/^@/, ''))
        ) {
          return true
        }
        const tokens = splitIdentityTokens(normalizedValue)
        if (
          tokens.some(
            (token) => hostIdentitySet.has(token) || hostIdentitySet.has(token.replace(/^@/, '')),
          )
        ) {
          return true
        }
      }

      return false
    },
    [hostIdentitySet],
  )
  const { localParticipant } = useLocalParticipant()
  // Depend on identity string (stable) rather than the whole participant object
  // to avoid isHost flickering when LiveKit re-emits participant events.
  const localIdentity = localParticipant?.identity ?? ''
  const isHost = useMemo(
    () => isHostParticipant(localParticipant),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isHostParticipant, localIdentity],
  )
  const prioritizedScreenShareTracks = useMemo(() => {
    return [...screenShareTracks].sort((left, right) => {
      const leftIsHost = isHostParticipant(left.participant)
      const rightIsHost = isHostParticipant(right.participant)
      if (leftIsHost === rightIsHost) return 0
      return rightIsHost ? 1 : -1
    })
  }, [isHostParticipant, screenShareTracks])
  const preferredSubscribedScreenShareTrack = useMemo(
    () => prioritizedScreenShareTracks.find((track) => track.publication.isSubscribed) || null,
    [prioritizedScreenShareTracks],
  )
  const [autoFocusedTrackSid, setAutoFocusedTrackSid] = useState<string | null>(null)
  const hadFocusTrackRef = useRef(Boolean(focusTrack))

  useEffect(() => {
    const onResize = () => {
      setIsMiniWidth(window.innerWidth <= MINI_CAROUSEL_BREAKPOINT)
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
    }
  }, [MINI_CAROUSEL_BREAKPOINT])

  useEffect(() => {
    const hadFocus = hadFocusTrackRef.current
    const hasFocus = Boolean(focusTrack)

    if (!hadFocus && hasFocus && window.innerWidth > 400) {
      ;(window as any).electronAPI?.expandCurrentWindowHeight?.()
    }

    hadFocusTrackRef.current = hasFocus
  }, [focusTrack])

  // Auto-expand the window when the drawer opens in mini/small mode,
  // and restore mini size when the drawer closes.
  // State is tracked on the Electron side (miniDrawerExpandState Map) so the
  // renderer doesn't need to mirror it — calling collapse when no state exists
  // is a safe no-op.
  useEffect(() => {
    const api = (window as any).electronAPI
    const drawerOpen = widgetState.showChat || widgetState.showSettings
    if (drawerOpen && window.innerWidth <= 400) {
      api?.expandForDrawer?.()
    } else if (!drawerOpen) {
      api?.collapseFromDrawer?.()
    }
  }, [widgetState.showChat, widgetState.showSettings])

  useEffect(() => {
    if (
      preferredSubscribedScreenShareTrack &&
      !autoFocusedTrackSid &&
      preferredSubscribedScreenShareTrack.publication.trackSid
    ) {
      layoutContext.pin.dispatch?.({
        msg: 'set_pin',
        trackReference: preferredSubscribedScreenShareTrack,
      })
      setAutoFocusedTrackSid(preferredSubscribedScreenShareTrack.publication.trackSid ?? null)
      return
    }

    if (
      preferredSubscribedScreenShareTrack &&
      autoFocusedTrackSid &&
      preferredSubscribedScreenShareTrack.publication.trackSid &&
      preferredSubscribedScreenShareTrack.publication.trackSid !== autoFocusedTrackSid &&
      focusTrack &&
      isTrackReference(focusTrack) &&
      focusTrack.publication.trackSid === autoFocusedTrackSid
    ) {
      layoutContext.pin.dispatch?.({
        msg: 'set_pin',
        trackReference: preferredSubscribedScreenShareTrack,
      })
      setAutoFocusedTrackSid(preferredSubscribedScreenShareTrack.publication.trackSid ?? null)
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

    if (focusTrack && !isTrackReference(focusTrack)) {
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
    }
  }, [
    autoFocusedTrackSid,
    focusTrack,
    layoutContext.pin,
    preferredSubscribedScreenShareTrack,
    screenShareTracks,
    tracks,
  ])

  const carouselTracks = tracks.filter((track) => !isSameTrackRef(track, focusTrack))
  const canNavigateMiniCarousel = isMiniWidth && miniCarouselOverflow
  const isScreenShareFocused =
    !!focusTrack &&
    isTrackReference(focusTrack) &&
    focusTrack.publication.source === Track.Source.ScreenShare
  const desktopCarouselOrientation: 'vertical' | 'horizontal' =
    isMiniWidth ? 'vertical' : 'horizontal'
  const canNavigateDesktopCarousel =
    !isMiniWidth &&
    desktopCarouselOrientation === 'horizontal' &&
    desktopCarouselOverflow
  const focusLayoutWrapperClassName = [
    'lk-focus-layout-wrapper',
    isScreenShareFocused ? 'desktop-vc-focus-layout--screenshare' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const carouselRegionClassName = `desktop-vc-carousel-region${
    !isMiniWidth && !desktopCarouselOverflow ? ' desktop-vc-carousel-region--centered' : ''
  }`

  const clearFocusStageAmbientBackdrop = useCallback(() => {
    const root = conferenceRef.current
    if (!root) return

    const focusStage = root.querySelector<HTMLElement>('.desktop-vc-focus-stage')
    if (!focusStage) return

    focusStage
      .querySelectorAll<HTMLVideoElement>('video.desktop-vc-ambient-video')
      .forEach((ambientVideo) => ambientVideo.remove())
    focusStage
      .querySelectorAll<HTMLVideoElement>('video.desktop-vc-main-video')
      .forEach((mainVideo) => mainVideo.classList.remove('desktop-vc-main-video'))
    focusStage
      .querySelectorAll<HTMLElement>('.desktop-vc-focus-video-stack')
      .forEach((stack) => stack.classList.remove('desktop-vc-focus-video-stack'))
  }, [])

  const syncFocusStageAmbientBackdrop = useCallback(() => {
    const root = conferenceRef.current
    if (!root) return

    const focusStage = root.querySelector<HTMLElement>('.desktop-vc-focus-stage')
    if (!focusStage) return

    if (!isScreenShareFocused) {
      clearFocusStageAmbientBackdrop()
      return
    }

    const mainVideos = focusStage.querySelectorAll<HTMLVideoElement>(
      'video.lk-participant-media-video:not(.desktop-vc-ambient-video)',
    )

    mainVideos.forEach((mainVideo) => {
      const frame = mainVideo.parentElement
      if (!frame) return

      frame.classList.add('desktop-vc-focus-video-stack')

      let ambientVideo: HTMLVideoElement | null = null
      for (const child of Array.from(frame.children)) {
        if (child instanceof HTMLVideoElement && child.classList.contains('desktop-vc-ambient-video')) {
          ambientVideo = child
          break
        }
      }

      if (!ambientVideo) {
        ambientVideo = document.createElement('video')
        ambientVideo.className = 'lk-participant-media-video desktop-vc-ambient-video'
        ambientVideo.autoplay = true
        ambientVideo.muted = true
        ambientVideo.playsInline = true
        ambientVideo.setAttribute('aria-hidden', 'true')
        frame.insertBefore(ambientVideo, mainVideo)
      }

      const sourceObject = mainVideo.srcObject ?? null
      if (ambientVideo.srcObject !== sourceObject) {
        ambientVideo.srcObject = sourceObject
      }

      if (mainVideo.poster && ambientVideo.poster !== mainVideo.poster) {
        ambientVideo.poster = mainVideo.poster
      }

      if (ambientVideo.paused) {
        void ambientVideo.play().catch(() => {
          // Ignore autoplay restrictions for ambient layer.
        })
      }

      mainVideo.classList.add('desktop-vc-main-video')
    })

    focusStage
      .querySelectorAll<HTMLVideoElement>('video.desktop-vc-ambient-video')
      .forEach((ambientVideo) => {
        const frame = ambientVideo.parentElement
        if (!frame) {
          ambientVideo.remove()
          return
        }
        const mainVideo = frame.querySelector<HTMLVideoElement>(
          'video.lk-participant-media-video:not(.desktop-vc-ambient-video)',
        )
        if (!mainVideo) {
          ambientVideo.remove()
          frame.classList.remove('desktop-vc-focus-video-stack')
          return
        }
        if (ambientVideo.srcObject !== mainVideo.srcObject) {
          ambientVideo.srcObject = mainVideo.srcObject ?? null
        }
      })
  }, [clearFocusStageAmbientBackdrop, isScreenShareFocused])

  const updateMiniCarouselNavigationState = useCallback(() => {
    if (!isMiniWidth) {
      setMiniCarouselOverflow(false)
      setMiniCarouselCanPrev(false)
      setMiniCarouselCanNext(false)
      return
    }

    const root = conferenceRef.current
    if (!root) {
      setMiniCarouselOverflow(false)
      setMiniCarouselCanPrev(false)
      setMiniCarouselCanNext(false)
      return
    }

    const carousel = root.querySelector<HTMLElement>(
      ".lk-focus-layout > .desktop-vc-carousel-region > .lk-carousel[data-lk-orientation='vertical']",
    )
    if (!carousel) {
      setMiniCarouselOverflow(false)
      setMiniCarouselCanPrev(false)
      setMiniCarouselCanNext(false)
      return
    }

    const epsilon = 1
    const overflow = carousel.scrollHeight - carousel.clientHeight > epsilon
    const canPrev = overflow && carousel.scrollTop > epsilon
    const canNext = overflow && carousel.scrollTop + carousel.clientHeight < carousel.scrollHeight - epsilon

    setMiniCarouselOverflow(overflow)
    setMiniCarouselCanPrev(canPrev)
    setMiniCarouselCanNext(canNext)
  }, [isMiniWidth])

  const updateDesktopCarouselNavigationState = useCallback(() => {
    if (isMiniWidth || desktopCarouselOrientation !== 'horizontal') {
      setDesktopCarouselOverflow(false)
      setDesktopCarouselCanPrev(false)
      setDesktopCarouselCanNext(false)
      return
    }

    const root = conferenceRef.current
    if (!root) {
      setDesktopCarouselOverflow(false)
      setDesktopCarouselCanPrev(false)
      setDesktopCarouselCanNext(false)
      return
    }

    const carousel = root.querySelector<HTMLElement>(
      ".lk-focus-layout > .desktop-vc-carousel-region > .lk-carousel[data-lk-orientation='horizontal']",
    )
    if (!carousel) {
      setDesktopCarouselOverflow(false)
      setDesktopCarouselCanPrev(false)
      setDesktopCarouselCanNext(false)
      return
    }

    const epsilon = 1
    const overflow = carousel.scrollWidth - carousel.clientWidth > epsilon
    const canPrev = overflow && carousel.scrollLeft > epsilon
    const canNext = overflow && carousel.scrollLeft + carousel.clientWidth < carousel.scrollWidth - epsilon

    setDesktopCarouselOverflow(overflow)
    setDesktopCarouselCanPrev(canPrev)
    setDesktopCarouselCanNext(canNext)
  }, [desktopCarouselOrientation, isMiniWidth])

  useEffect(() => {
    if (!isMiniWidth) {
      setMiniCarouselOverflow(false)
      setMiniCarouselCanPrev(false)
      setMiniCarouselCanNext(false)
      return
    }

    const root = conferenceRef.current
    if (!root) return

    const carousel = root.querySelector<HTMLElement>(
      ".lk-focus-layout > .desktop-vc-carousel-region > .lk-carousel[data-lk-orientation='vertical']",
    )
    if (!carousel) {
      updateMiniCarouselNavigationState()
      return
    }

    const onScroll = () => updateMiniCarouselNavigationState()
    const onResize = () => updateMiniCarouselNavigationState()

    carousel.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => updateMiniCarouselNavigationState())
        : null
    resizeObserver?.observe(carousel)

    const mutationObserver = new MutationObserver(() => updateMiniCarouselNavigationState())
    mutationObserver.observe(carousel, { childList: true })

    updateMiniCarouselNavigationState()

    return () => {
      carousel.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      resizeObserver?.disconnect()
      mutationObserver.disconnect()
    }
  }, [carouselTracks.length, focusTrack, isMiniWidth, updateMiniCarouselNavigationState])

  useEffect(() => {
    if (isMiniWidth || desktopCarouselOrientation !== 'horizontal') {
      setDesktopCarouselOverflow(false)
      setDesktopCarouselCanPrev(false)
      setDesktopCarouselCanNext(false)
      return
    }

    const root = conferenceRef.current
    if (!root) return

    const carousel = root.querySelector<HTMLElement>(
      ".lk-focus-layout > .desktop-vc-carousel-region > .lk-carousel[data-lk-orientation='horizontal']",
    )
    if (!carousel) {
      updateDesktopCarouselNavigationState()
      return
    }

    const onScroll = () => updateDesktopCarouselNavigationState()
    const onResize = () => updateDesktopCarouselNavigationState()
    const onWheel = (event: WheelEvent) => {
      if (carousel.scrollWidth - carousel.clientWidth <= 1) return
      const primaryDelta =
        Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX
      if (Math.abs(primaryDelta) < 0.5) return
      event.preventDefault()
      carousel.scrollBy({ left: primaryDelta, behavior: 'auto' })
      updateDesktopCarouselNavigationState()
    }

    carousel.addEventListener('scroll', onScroll, { passive: true })
    carousel.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('resize', onResize)

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => updateDesktopCarouselNavigationState())
        : null
    resizeObserver?.observe(carousel)

    const mutationObserver = new MutationObserver(() => updateDesktopCarouselNavigationState())
    mutationObserver.observe(carousel, { childList: true })

    updateDesktopCarouselNavigationState()

    return () => {
      carousel.removeEventListener('scroll', onScroll)
      carousel.removeEventListener('wheel', onWheel)
      window.removeEventListener('resize', onResize)
      resizeObserver?.disconnect()
      mutationObserver.disconnect()
    }
  }, [carouselTracks.length, desktopCarouselOrientation, focusTrack, isMiniWidth, updateDesktopCarouselNavigationState])

  useEffect(() => {
    const root = conferenceRef.current
    if (!root) return

    const mutationObserver = new MutationObserver(() => {
      syncFocusStageAmbientBackdrop()
    })
    mutationObserver.observe(root, { childList: true, subtree: true })

    const intervalId = window.setInterval(() => {
      syncFocusStageAmbientBackdrop()
    }, 900)

    syncFocusStageAmbientBackdrop()

    return () => {
      mutationObserver.disconnect()
      window.clearInterval(intervalId)
      clearFocusStageAmbientBackdrop()
    }
  }, [clearFocusStageAmbientBackdrop, syncFocusStageAmbientBackdrop])

  // ─── Recording ───────────────────────────────────────────────────────────────
  const stopRecordingStream = useCallback(() => {
    if (canvasCaptureRef.current) {
      if (canvasCaptureRef.current.rafId !== null) cancelAnimationFrame(canvasCaptureRef.current.rafId)
      if (canvasCaptureRef.current.screenShareVideoEl) {
        canvasCaptureRef.current.screenShareVideoEl.srcObject = null
        canvasCaptureRef.current.screenShareVideoEl = null
      }
      if (canvasCaptureRef.current.windowVideo) {
        canvasCaptureRef.current.windowVideo.pause()
        canvasCaptureRef.current.windowVideo.srcObject = null
        canvasCaptureRef.current.windowVideo = null
      }
      if (canvasCaptureRef.current.windowStream) {
        canvasCaptureRef.current.windowStream.getTracks().forEach((t) => t.stop())
        canvasCaptureRef.current.windowStream = null
      }
      canvasCaptureRef.current.capturedAudioTracks.forEach((t) => t.stop())
      if (canvasCaptureRef.current.audioContext) {
        void canvasCaptureRef.current.audioContext.close()
        canvasCaptureRef.current.audioContext = null
      }
      canvasCaptureRef.current = null
    }
    if (recordingStreamRef.current) {
      recordingStreamRef.current.getTracks().forEach((t) => t.stop())
      recordingStreamRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      const recorder = mediaRecorderRef.current
      if (recorder && recorder.state === 'recording') recorder.stop()
      stopRecordingStream()
      mediaRecorderRef.current = null
      recordingSessionIdRef.current = null
      leaveAfterRecordingRef.current = false
    }
  }, [stopRecordingStream])

  useEffect(() => {
    const unsub = window.electronAPI?.onConvertDone?.((result) => {
      if (result.success && result.mp4Path) {
        const name = result.mp4Path.split(/[\\/]/).pop() ?? 'recording.mp4'
        onMessage(`MP4 ready: ${name}`)
      } else if (!result.success) {
        onMessage(`MP4 conversion failed: ${result.error || 'unknown'}`)
      }
    })
    return () => unsub?.()
  }, [onMessage])

  const persistRecording = useCallback(async () => {
    const sessionId = recordingSessionIdRef.current
    if (!sessionId) return
    recordingSessionIdRef.current = null

    // Wait for all in-flight chunk writes to complete before closing the stream
    await pendingWritesRef.current

    const closeResult = await window.electronAPI!.closeRecordingStream({ sessionId })
    if (!closeResult.success || !closeResult.webmPath) {
      onMessage(`Failed to save recording: ${closeResult.error || 'unknown'}`)
      return
    }

    const webmPath = closeResult.webmPath
    currentWebmPathRef.current = webmPath
    const name = webmPath.split(/[\\/]/).pop() ?? 'recording.webm'
    onMessage(`Saved: ${name} — converting to MP4…`)

    // Background conversion — non-blocking
    const convertResult = await window.electronAPI!.convertBackground({
      webmPath,
      isH264: recordingIsH264Ref.current,
    })
    if (!convertResult.success) {
      onMessage(`MP4 conversion failed: ${convertResult.error || 'unknown'}`)
    }
  }, [onMessage])

  const createRoomVideoOnlyStream = useCallback(async (quality: RecordingQualityConfig) => {
    const captureRoot = captureAreaRef.current
    if (!captureRoot) throw new Error('Room video area not available.')
    const rect = captureRoot.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) throw new Error('Room video area is too small to record.')
    if (!window.electronAPI?.getCurrentWindowSource) throw new Error('Desktop recording bridge is unavailable.')

    // Pre-fetch the window source for the conference-tile path (camera feeds).
    // desktopCapturer composites GPU-decoded WebRTC video correctly; canvas.drawImage
    // on live WebRTC <video> elements returns black due to hardware overlay paths.
    const windowSource = await window.electronAPI.getCurrentWindowSource()
    if (!windowSource?.id) throw new Error('Unable to resolve meeting window source.')

    const windowStream = await navigator.mediaDevices.getUserMedia({
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
    const windowVideo = document.createElement('video')
    windowVideo.muted = true; windowVideo.playsInline = true; windowVideo.autoplay = true
    windowVideo.srcObject = windowStream
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('Unable to initialize recording source.')), 4000)
      const cleanup = () => {
        window.clearTimeout(timer)
        windowVideo.removeEventListener('loadedmetadata', onReady)
        windowVideo.removeEventListener('error', onError)
      }
      const onReady = () => { cleanup(); resolve() }
      const onError = () => { cleanup(); reject(new Error('Recording source failed to load.')) }
      windowVideo.addEventListener('loadedmetadata', onReady)
      windowVideo.addEventListener('error', onError)
      void windowVideo.play().catch(onError)
    })

    const canvas = document.createElement('canvas')
    canvas.width = quality.width; canvas.height = quality.height
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) {
      windowVideo.pause(); windowVideo.srcObject = null
      windowStream.getTracks().forEach((t) => t.stop())
      throw new Error('Canvas context unavailable.')
    }

    // ── Audio capture ────────────────────────────────────────────────────────
    // Mix microphone + system audio (loopback) via Web Audio API.
    // System audio requires chromeMediaSource:'desktop' which must be requested
    // with a video constraint too (audio-only desktop capture triggers OS dialogs).
    const capturedAudioTracks: MediaStreamTrack[] = []
    let audioContext: AudioContext | null = null
    let mixedAudioTrack: MediaStreamTrack | undefined

    try {
      audioContext = new AudioContext()
      const dest = audioContext.createMediaStreamDestination()
      let connected = false

      // Microphone
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        micStream.getAudioTracks().forEach((t) => {
          audioContext!.createMediaStreamSource(new MediaStream([t])).connect(dest)
          capturedAudioTracks.push(t)
        })
        connected = true
      } catch { /* mic unavailable */ }

      // System audio (loopback) — must include a dummy video constraint
      try {
        const screenSrc = await window.electronAPI?.getScreenSourceForAudio?.()
        if (screenSrc?.id) {
          const sysStream = await navigator.mediaDevices.getUserMedia({
            audio: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: screenSrc.id } } as any,
            video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: screenSrc.id, maxWidth: 1, maxHeight: 1 } } as any,
          })
          sysStream.getVideoTracks().forEach((t) => t.stop()) // video not needed
          sysStream.getAudioTracks().forEach((t) => {
            audioContext!.createMediaStreamSource(new MediaStream([t])).connect(dest)
            capturedAudioTracks.push(t)
          })
          connected = true
        }
      } catch { /* system audio unavailable */ }

      if (connected) {
        mixedAudioTrack = dest.stream.getAudioTracks()[0]
      } else {
        void audioContext.close()
        audioContext = null
      }
    } catch { audioContext = null }
    // ─────────────────────────────────────────────────────────────────────────

    const capture = {
      canvas,
      rafId: null as number | null,
      screenShareVideoEl: null as HTMLVideoElement | null,
      windowVideo,
      windowStream,
      audioContext,
      capturedAudioTracks,
    }
    canvasCaptureRef.current = capture

    const drawFrame = () => {
      context.fillStyle = '#071021'
      context.fillRect(0, 0, quality.width, quality.height)

      // When the local participant is sharing their screen the conference window
      // enters mini mode. Capture the raw MediaStreamTrack directly (full quality,
      // no re-compression artefacts from window compositing).
      const screenSharePub = [...room.localParticipant.trackPublications.values()]
        .find((pub) => pub.source === Track.Source.ScreenShare && pub.track)

      if (screenSharePub?.track?.mediaStreamTrack) {
        const mst = screenSharePub.track.mediaStreamTrack
        if (!capture.screenShareVideoEl || capture.screenShareVideoEl.srcObject === null) {
          const el = document.createElement('video')
          el.muted = true; el.playsInline = true; el.autoplay = true
          el.srcObject = new MediaStream([mst])
          void el.play().catch(() => {})
          capture.screenShareVideoEl = el
        }
        const el = capture.screenShareVideoEl
        if (el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && el.videoWidth > 0) {
          // Letterbox to preserve aspect ratio
          const ar = el.videoWidth / el.videoHeight
          const cAr = quality.width / quality.height
          let dx = 0, dy = 0, dw = quality.width, dh = quality.height
          if (ar > cAr) { dh = quality.width / ar; dy = (quality.height - dh) / 2 }
          else { dw = quality.height * ar; dx = (quality.width - dw) / 2 }
          context.drawImage(el, dx, dy, dw, dh)
        }
      } else {
        // No screen share — clean up helper element and use window capture for tiles
        if (capture.screenShareVideoEl) {
          capture.screenShareVideoEl.srcObject = null
          capture.screenShareVideoEl = null
        }
        if (windowVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          const areaRect = captureRoot.getBoundingClientRect()
          // The control bar is position:fixed and visually overlays the bottom of
          // captureAreaRef. Clip the crop to the top edge of the control bar so it
          // never appears in the recording.
          const controlBarEl = captureRoot.closest('.lk-video-conference')
            ?.querySelector('.lk-control-bar')
          const cropBottom = controlBarEl
            ? Math.min(areaRect.bottom, controlBarEl.getBoundingClientRect().top)
            : areaRect.bottom
          const cropH = Math.max(2, cropBottom - areaRect.top)

          const vw = Math.max(1, window.innerWidth || 1)
          const vh = Math.max(1, window.innerHeight || 1)
          const srcW = Math.max(1, windowVideo.videoWidth || quality.width)
          const srcH = Math.max(1, windowVideo.videoHeight || quality.height)
          const scaleX = srcW / vw; const scaleY = srcH / vh
          const sx = Math.max(0, Math.floor(areaRect.left * scaleX))
          const sy = Math.max(0, Math.floor(areaRect.top * scaleY))
          const sw = Math.max(2, Math.min(srcW - sx, Math.floor(areaRect.width * scaleX)))
          const sh = Math.max(2, Math.min(srcH - sy, Math.floor(cropH * scaleY)))
          context.drawImage(windowVideo, sx, sy, sw, sh, 0, 0, quality.width, quality.height)
        }
      }

      if (canvasCaptureRef.current) canvasCaptureRef.current.rafId = requestAnimationFrame(drawFrame)
    }

    capture.rafId = requestAnimationFrame(drawFrame)
    const videoStream = canvas.captureStream(quality.frameRate)
    if (mixedAudioTrack) {
      return new MediaStream([...videoStream.getVideoTracks(), mixedAudioTrack])
    }
    return videoStream
  }, [room])


  const startRecording = useCallback(async () => {
    if (recordingPending || recordingEnabled) return
    setRecordingPending(true)
    try {
      // Ask for folder once per session
      if (!recordingFolderRef.current && window.electronAPI?.getRecordingFolder) {
        recordingFolderRef.current = await window.electronAPI.getRecordingFolder()
      }
      if (!recordingFolderRef.current && window.electronAPI?.chooseRecordingFolder) {
        const folderResult = await window.electronAPI.chooseRecordingFolder()
        if (!folderResult.success || !folderResult.folder) {
          onMessage('Recording cancelled — no folder selected.')
          setRecordingPending(false); return
        }
        recordingFolderRef.current = folderResult.folder
      }
      if (!recordingFolderRef.current) {
        onMessage('Recording folder not available.'); setRecordingPending(false); return
      }

      const qualityConfig = RECORDING_QUALITY_CONFIGS[recordingQuality]
      const stream = await createRoomVideoOnlyStream(qualityConfig)

      if (!stream) { onMessage('Recording not supported in this environment.'); setRecordingPending(false); return }

      const { mimeType, isH264 } = getSupportedRecordingMimeType()
      recordingIsH264Ref.current = isH264
      const recorderOpts: MediaRecorderOptions = { videoBitsPerSecond: qualityConfig.videoBitsPerSecond }
      if (mimeType) recorderOpts.mimeType = mimeType

      // Open file directly in chosen folder: {folder}/{room-slug}/{timestamp}.webm
      const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const openResult = await window.electronAPI!.openRecordingStream({
        sessionId,
        folder: recordingFolderRef.current,
        roomSlug: slugifyRoomTitle(roomTitle),
        filename: buildRecordingFileName(),
      })
      if (!openResult.success) throw new Error(openResult.error || 'Failed to open recording stream.')
      recordingSessionIdRef.current = sessionId
      currentWebmPathRef.current = openResult.webmPath ?? null
      pendingWritesRef.current = Promise.resolve()

      const recorder = new MediaRecorder(stream, recorderOpts)
      recordingStreamRef.current = stream; mediaRecorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data?.size > 0) {
          // Chain writes sequentially so close-and-convert always runs after all chunks are flushed
          pendingWritesRef.current = pendingWritesRef.current.then(async () => {
            const bytes = new Uint8Array(await e.data.arrayBuffer())
            await window.electronAPI!.writeRecordingChunk({ sessionId, bytes })
          }).catch(() => {})
        }
      }
      recorder.onerror = (e: any) => { onMessage(e?.error?.message || 'Recording failed.') }
      recorder.onstop = () => {
        setRecordingEnabled(false); setRecordingPending(false)
        void persistRecording().finally(() => {
          stopRecordingStream(); mediaRecorderRef.current = null
          if (leaveAfterRecordingRef.current) {
            leaveAfterRecordingRef.current = false
            room.disconnect()
          }
        })
      }
      const videoTrack = stream.getVideoTracks()[0]
      if (videoTrack) videoTrack.onended = () => { if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop() }

      recorder.start(1000); setRecordingEnabled(true); setRecordingPending(false)
    } catch (err: any) {
      stopRecordingStream(); mediaRecorderRef.current = null
      setRecordingEnabled(false); setRecordingPending(false)
      onMessage(err?.message || 'Unable to start recording.')
    }
  }, [recordingPending, recordingEnabled, recordingQuality, roomTitle, createRoomVideoOnlyStream, persistRecording, stopRecordingStream, onMessage])

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state !== 'recording') return
    setRecordingPending(true); recorder.stop()
  }, [])

  const toggleRecording = useCallback(() => {
    if (recordingEnabled) { stopRecording(); return }
    void startRecording()
  }, [recordingEnabled, startRecording, stopRecording])

  const handleLeaveRequested = useCallback(() => {
    if (recordingEnabled || mediaRecorderRef.current?.state === 'recording') {
      leaveAfterRecordingRef.current = true
      stopRecording()
    } else {
      room.disconnect()
    }
  }, [recordingEnabled, stopRecording, room])

  const scrollMiniCarousel = useCallback((direction: 'prev' | 'next') => {
    if (!canNavigateMiniCarousel) return
    const root = conferenceRef.current
    if (!root) return
    const carousel = root.querySelector<HTMLElement>(
      ".lk-focus-layout > .desktop-vc-carousel-region > .lk-carousel[data-lk-orientation='vertical']",
    )
    if (!carousel) return

    const firstTile = carousel.querySelector<HTMLElement>('.lk-participant-tile')
    const tileHeight = firstTile?.getBoundingClientRect().height || carousel.clientHeight
    const computedStyle = window.getComputedStyle(carousel)
    const rowGap = Number.parseFloat(computedStyle.rowGap || computedStyle.gap || '0') || MINI_CAROUSEL_GAP
    const scrollStep = Math.max(40, tileHeight + rowGap)
    carousel.scrollBy({
      top: direction === 'next' ? scrollStep : -scrollStep,
      behavior: 'smooth',
    })
  }, [canNavigateMiniCarousel])
  const scrollDesktopCarousel = useCallback((direction: 'prev' | 'next') => {
    if (!canNavigateDesktopCarousel) return
    const root = conferenceRef.current
    if (!root) return
    const carousel = root.querySelector<HTMLElement>(
      ".lk-focus-layout > .desktop-vc-carousel-region > .lk-carousel[data-lk-orientation='horizontal']",
    )
    if (!carousel) return

    const firstTile = carousel.querySelector<HTMLElement>('.lk-participant-tile')
    const tileWidth = firstTile?.getBoundingClientRect().width || carousel.clientWidth
    const computedStyle = window.getComputedStyle(carousel)
    const gap =
      Number.parseFloat(computedStyle.columnGap || computedStyle.gap || '0') ||
      DESKTOP_CAROUSEL_GAP
    const scrollStep = Math.max(60, tileWidth + gap)
    carousel.scrollBy({
      left: direction === 'next' ? scrollStep : -scrollStep,
      behavior: 'smooth',
    })
  }, [canNavigateDesktopCarousel])
  const chatDrawerClassName = `desktop-vc-drawer desktop-vc-drawer--chat${
    widgetState.showChat ? ' desktop-vc-drawer--open' : ''
  }`
  const settingsDrawerClassName = `lk-settings-menu-modal desktop-vc-drawer desktop-vc-drawer--settings${
    widgetState.showSettings ? ' desktop-vc-drawer--open' : ''
  }`

  useEffect(() => {
    const isDrawerOpen = widgetState.showChat || widgetState.showSettings
    if (!isDrawerOpen) return

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null
      if (!target) return

      // Keep native toggle behavior stable: don't auto-close on chat/settings toggle buttons.
      if (target.closest('.lk-chat-toggle') || target.closest('.lk-settings-toggle')) return

      // Interacting inside drawer (or device picker controls) should not close it.
      if (
        target.closest('.desktop-vc-drawer') ||
        target.closest('.lk-device-menu') ||
        target.closest('.lk-media-device-select')
      ) {
        return
      }

      if (widgetState.showChat) {
        layoutContext.widget.dispatch?.({ msg: 'toggle_chat' })
      }
      if (widgetState.showSettings) {
        layoutContext.widget.dispatch?.({ msg: 'toggle_settings' })
      }
    }

    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [layoutContext.widget, widgetState.showChat, widgetState.showSettings])

  return (
    <LayoutContextProvider value={layoutContext} onWidgetChange={setWidgetState}>
      <div className="lk-video-conference desktop-vc-conference" ref={conferenceRef}>
        <DesktopMeetingHeader title={roomTitle} participantCount={tracks.length} />
        <div className="lk-video-conference-inner">
          <div ref={captureAreaRef} className="desktop-vc-capture-area">
          {!focusTrack ? (
            <div className="lk-grid-layout-wrapper">
              <GridLayout tracks={tracks}>
                <AvatarParticipantTile resolveParticipantAvatar={resolveParticipantAvatar} />
              </GridLayout>
            </div>
          ) : (
            <div className={focusLayoutWrapperClassName}>
              <FocusLayoutContainer>
                <div className={carouselRegionClassName}>
                  <CarouselLayout tracks={carouselTracks} orientation={desktopCarouselOrientation}>
                    <AvatarParticipantTile resolveParticipantAvatar={resolveParticipantAvatar} />
                  </CarouselLayout>
                  {canNavigateDesktopCarousel ? (
                    <div className="desktop-vc-carousel-nav">
                      <button
                        className="desktop-vc-carousel-nav__btn"
                        disabled={!desktopCarouselCanPrev}
                        onClick={() => scrollDesktopCarousel('prev')}
                        type="button"
                      >
                        <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14">
                          <path
                            d="M9.8 3.6 5.4 8l4.4 4.4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                      <button
                        className="desktop-vc-carousel-nav__btn"
                        disabled={!desktopCarouselCanNext}
                        onClick={() => scrollDesktopCarousel('next')}
                        type="button"
                      >
                        <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14">
                          <path
                            d="m6.2 3.6 4.4 4.4-4.4 4.4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </div>
                  ) : null}
                  {canNavigateMiniCarousel ? (
                    <div className="desktop-vc-mini-carousel-nav">
                      <button
                        className="desktop-vc-mini-carousel-nav__btn"
                        disabled={!miniCarouselCanPrev}
                        onClick={() => scrollMiniCarousel('prev')}
                        type="button"
                      >
                        <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14">
                          <path
                            d="M9.8 3.6 5.4 8l4.4 4.4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                      <button
                        className="desktop-vc-mini-carousel-nav__btn"
                        disabled={!miniCarouselCanNext}
                        onClick={() => scrollMiniCarousel('next')}
                        type="button"
                      >
                        <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14">
                          <path
                            d="m6.2 3.6 4.4 4.4-4.4 4.4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </div>
                  ) : null}
                </div>
                <div className="desktop-vc-focus-stage">
                  <AvatarParticipantTile
                    trackRef={focusTrack}
                    resolveParticipantAvatar={resolveParticipantAvatar}
                  />
                </div>
              </FocusLayoutContainer>
            </div>
          )}
          </div>
          <DesktopControlBar
            audience={audience}
            onMessage={onMessage}
            onReact={sendReaction}
            chatBadgeCount={Number(widgetState.unreadMessages || 0)}
            settingsBadgeCount={settingsBadgeCount}
            recordingEnabled={recordingEnabled}
            recordingPending={recordingPending}
            recordingDuration={recordingDuration}
            onToggleRecording={toggleRecording}
            recordingQuality={recordingQuality}
            onLeaveRequested={handleLeaveRequested}
          />
        </div>
        <ReactionOverlay reactions={reactions} />
        <div className={chatDrawerClassName} aria-hidden={!widgetState.showChat}>
          <Chat channelTopic={ROOM_CHAT_TOPIC} />
        </div>
        <div className={settingsDrawerClassName} aria-hidden={!widgetState.showSettings}>
          <SettingsPanel
            roomId={roomId}
            isHost={isHost}
            audience={audience}
            onPendingRequestCountChange={setSettingsBadgeCount}
            onRecordingSettingsChange={({ quality }) => {
              setRecordingQuality(quality)
            }}
          />
        </div>
      </div>
      <RoomAudioRenderer />
      <ConnectionStateToast />
    </LayoutContextProvider>
  )
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
  roomId?: string
  hostId?: string
  hostName?: string
  hostUsername?: string
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
    roomId,
    hostId,
    hostName,
    hostUsername,
    audience,
    localUserName,
    localUsername,
    localAvatarUrl,
    participantAvatarMap = {},
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
  const [actionMessage, setActionMessage] = useState('')
  const [retrySeed, setRetrySeed] = useState(0)
  const hostIdentityHints = useMemo(() => {
    const normalizedSet = new Set<string>()
    for (const value of [hostId, hostUsername, hostName]) {
      const normalized = normalizeKey(value)
      if (!normalized) continue
      normalizedSet.add(normalized)
      normalizedSet.add(normalized.replace(/^@/, ''))
      for (const token of splitIdentityTokens(normalized)) {
        normalizedSet.add(token)
        normalizedSet.add(token.replace(/^@/, ''))
      }
    }
    return Array.from(normalizedSet)
  }, [hostId, hostName, hostUsername])
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

  useEffect(() => {
    setConnectError('')
    setActionMessage('')
    setRetrySeed(0)
  }, [roomName, token, resolvedServerUrl])

  const handleRetry = useCallback(() => {
    setConnectError('')
    setActionMessage('')
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
    setActionMessage(getMediaDeviceFailureMessage(kind))
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
          --vc-meeting-bg: #756797;
          --vc-header-bg: #25272b;
          --desktop-vc-header-height: 44px;
          --desktop-vc-control-bar-height: 72px;
          --desktop-vc-control-gap: 0px;
          --desktop-vc-control-bar-pad-y: 12px;
          --desktop-vc-control-bar-pad-x: 18px;
          --desktop-vc-control-bar-gap-size: 10px;
          --desktop-vc-control-button-size: 46px;
          --desktop-vc-focus-stage-top-gap: 8px;
          --desktop-vc-carousel-inline-inset: 10px;
          --desktop-vc-carousel-top-padding: 4px;
          --desktop-vc-carousel-bottom-padding: 8px;
          --desktop-vc-focus-stack-gap: 4px;
          --desktop-vc-focus-carousel-bottom-padding: 2px;
          --desktop-vc-centered-tile-size: 128px;
          --desktop-vc-carousel-gap-size: 10px;
          --desktop-vc-carousel-tile-max-size: 176px;
          --desktop-vc-carousel-first-item-top: 4px;
          --vc-bg-0: #05070a;
          --vc-bg-1: #0b0f14;
          --vc-bg-2: #11171d;
          --vc-surface: rgba(13, 18, 24, 0.84);
          --vc-surface-strong: rgba(10, 14, 18, 0.96);
          --vc-surface-soft: rgba(21, 28, 36, 0.72);
          --vc-border: rgba(118, 144, 160, 0.16);
          --vc-border-strong: rgba(126, 205, 196, 0.34);
          --vc-text: #eff5fb;
          --vc-text-soft: #8fa2b2;
          --vc-accent: #63d2c6;
          --vc-accent-2: #56b7ff;
          --vc-accent-warm: #d2a068;
          --vc-danger: #ee6b5f;
          --vc-danger-strong: #d45449;
          --lk-control-bar-height: var(--desktop-vc-control-bar-height);
          display: flex;
          flex-direction: column;
          width: 100%;
          flex: 1;
          min-height: 0;
          overflow: hidden;
          color: var(--vc-text);
          background: var(--vc-meeting-bg);
        }
        .desktop-vc-shell .livekit-stage-rebuilt {
          display: flex;
          flex-direction: column;
          align-items: stretch;
          justify-content: stretch;
          width: 100%;
          height: 100%;
          min-height: 0;
          padding: 0;
          gap: 0;
          margin: 0;
          background: var(--vc-meeting-bg);
          border: 0;
          border-radius: 0;
          overflow: hidden;
          box-shadow: none;
        }
        .desktop-vc-shell .desktop-vc-conference,
        .desktop-vc-shell .lk-video-conference-inner,
        .desktop-vc-shell .lk-grid-layout-wrapper,
        .desktop-vc-shell .lk-focus-layout-wrapper,
        .desktop-vc-shell .lk-grid-layout,
        .desktop-vc-shell .lk-focus-layout,
        .desktop-vc-shell .lk-focus-layout-container {
          height: 100%;
          min-height: 0;
        }
        .desktop-vc-shell .lk-video-conference-inner {
          box-sizing: border-box;
          flex: 1;
          min-height: 0;
          padding: var(--desktop-vc-header-height) 14px var(--desktop-vc-control-gap);
        }
        .desktop-vc-shell .desktop-vc-conference {
          position: relative;
          display: flex;
          flex-direction: column;
          flex: 1;
          min-height: 0;
          background: var(--vc-meeting-bg);
        }
        .desktop-vc-shell .desktop-vc-header {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 9999;
          display: flex;
          align-items: center;
          height: var(--desktop-vc-header-height);
          min-width: 0;
          overflow: hidden;
          gap: 6px;
          padding: 0 6px 0 10px;
          color: #f4f6f8;
          background: var(--vc-header-bg);
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.36);
          user-select: none;
        }
        /* Brand: co lại khi hẹp, ẩn text khi không đủ chỗ */
        .desktop-vc-shell .desktop-vc-header__brand {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          flex: 0 1 auto;
          min-width: 0;
          overflow: hidden;
          color: #f9fafb;
        }
        .desktop-vc-shell .desktop-vc-header__mark {
          display: inline-grid;
          place-items: center;
          width: 26px;
          height: 26px;
          flex-shrink: 0;
          border-radius: 8px;
          color: #e9fcf8;
          background: linear-gradient(135deg, rgba(99, 210, 198, 0.9), rgba(86, 183, 255, 0.72));
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.04em;
        }
        .desktop-vc-shell .desktop-vc-header__brand-text {
          display: grid;
          gap: 1px;
          line-height: 1;
          overflow: hidden;
          min-width: 0;
        }
        .desktop-vc-shell .desktop-vc-header__brand-text strong,
        .desktop-vc-shell .desktop-vc-header__brand-text span {
          font-size: 12px;
          letter-spacing: -0.01em;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        /* Title: chiếm hết khoảng trống còn lại, truncate */
        .desktop-vc-shell .desktop-vc-header__title {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
          flex: 1 1 0;
          overflow: hidden;
          color: #f5f6f7;
          font-size: 13px;
          font-weight: 600;
          white-space: nowrap;
          text-overflow: ellipsis;
        }
        .desktop-vc-shell .desktop-vc-header__title-text {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          min-width: 0;
        }
        .desktop-vc-shell .desktop-vc-header__info {
          display: inline-grid;
          place-items: center;
          width: 15px;
          height: 15px;
          flex: 0 0 auto;
          border: 1px solid rgba(255, 255, 255, 0.45);
          border-radius: 999px;
          color: rgba(255, 255, 255, 0.75);
          font-size: 10px;
          font-weight: 700;
          font-family: Georgia, serif;
        }
        /* Tools (Secure/HD/Layout): ẩn khi không đủ chỗ */
        .desktop-vc-shell .desktop-vc-header__right {
          display: flex;
          align-items: center;
          gap: 4px;
          flex: 0 1 auto;
          min-width: 0;
          overflow: hidden;
        }
        .desktop-vc-shell .desktop-vc-header__tools {
          display: flex;
          align-items: center;
          gap: 3px;
          flex: 0 1 auto;
          min-width: 0;
          overflow: hidden;
        }
        .desktop-vc-shell .desktop-vc-header__secure {
          color: #65f0b8;
          font-size: 11px;
          font-weight: 600;
          white-space: nowrap;
          flex-shrink: 1;
          min-width: 0;
          overflow: hidden;
        }
        .desktop-vc-shell .desktop-vc-header__chip,
        .desktop-vc-shell .desktop-vc-header__menu {
          padding: 3px 7px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.06);
          font-size: 11px;
          white-space: nowrap;
          flex-shrink: 1;
          min-width: 0;
          overflow: hidden;
        }
        /* Window controls: không bao giờ bị ẩn */
        .desktop-vc-shell .desktop-vc-header__winctrl {
          display: flex;
          align-items: center;
          flex: 0 0 auto;
          gap: 1px;
        }
        .desktop-vc-shell .desktop-vc-winbtn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 44px;
          border: none;
          background: transparent;
          color: rgba(255,255,255,0.5);
          cursor: pointer;
          -webkit-app-region: no-drag;
          border-radius: 4px;
          flex-shrink: 0;
          transition: background 0.15s, color 0.15s;
        }
        .desktop-vc-shell .desktop-vc-winbtn:hover {
          background: rgba(255,255,255,0.1);
          color: #fff;
        }
        .desktop-vc-shell .desktop-vc-winbtn--close:hover {
          background: rgba(196, 43, 28, 0.85);
          color: #fff;
        }
        .desktop-vc-shell .lk-pagination-control {
          height: 30px !important;
          width: 56px !important;
          bottom: 0.5rem !important;
          overflow: visible !important;
          display: flex !important;
          gap: 2px !important;
          padding: 2px !important;
        }
        .desktop-vc-shell .lk-pagination-count {
          display: none !important;
        }
        .desktop-vc-shell .lk-pagination-control > .lk-button {
          flex: 1 !important;
          width: 26px !important;
          height: 26px !important;
          min-width: 0 !important;
          padding: 0 !important;
          border-radius: 4px !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
        }
        .desktop-vc-shell .lk-pagination-control > .lk-button > svg {
          width: 14px !important;
          height: 14px !important;
          flex-shrink: 0 !important;
        }
        @media (max-width: 400px) {
          .desktop-vc-shell .desktop-vc-header__tools {
            display: none;
          }
          .desktop-vc-shell {
            --desktop-vc-header-height: 36px;
            --desktop-vc-control-bar-height: 46px;
            --desktop-vc-control-gap: 0px;
            --desktop-vc-control-bar-pad-y: 6px;
            --desktop-vc-control-bar-pad-x: 8px;
            --desktop-vc-control-bar-gap-size: 4px;
            --desktop-vc-control-button-size: 32px;
            --desktop-vc-focus-stage-top-gap: 6px;
            --desktop-vc-carousel-inline-inset: 8px;
            --desktop-vc-carousel-top-padding: 4px;
            --desktop-vc-carousel-bottom-padding: 6px;
            --desktop-vc-focus-stack-gap: 3px;
            --desktop-vc-focus-carousel-bottom-padding: 1px;
            --desktop-vc-centered-tile-size: 102px;
            --desktop-vc-carousel-gap-size: 8px;
            --desktop-vc-carousel-tile-max-size: 132px;
            --desktop-vc-carousel-first-item-top: 4px;
          }
          .desktop-vc-shell .desktop-vc-header {
            height: auto;
            min-height: 36px;
            padding-top: 4px;
            padding-bottom: 4px;
          }
          .desktop-vc-shell .desktop-vc-winbtn {
            height: 36px;
          }
          /* Override LiveKit variable để grid không chừa 69px */
          .desktop-vc-shell [data-lk-theme] {
            --lk-control-bar-height: 46px;
          }
          /* Control bar nhỏ hơn ở mini mode */
          .desktop-vc-shell .lk-control-bar {
            padding: var(--desktop-vc-control-bar-pad-y) var(--desktop-vc-control-bar-pad-x);
            gap: var(--desktop-vc-control-bar-gap-size);
            max-height: 46px !important;
            min-height: 46px;
          }
          .desktop-vc-shell .lk-control-bar .lk-button,
          .desktop-vc-shell .lk-control-bar .lk-disconnect-button,
          .desktop-vc-shell .lk-control-bar .lk-chat-toggle,
          .desktop-vc-shell .lk-control-bar .lk-settings-toggle {
            width: var(--desktop-vc-control-button-size);
            height: var(--desktop-vc-control-button-size);
            border-radius: 8px;
          }
          .desktop-vc-shell .lk-video-conference-inner {
            padding-top: var(--desktop-vc-header-height);
            padding-bottom: var(--desktop-vc-control-gap);
            padding-left: 4px;
            padding-right: 4px;
          }
        }
        .desktop-vc-shell .lk-grid-layout,
        .desktop-vc-shell .lk-focus-layout {
          position: relative;
          padding: 0;
          gap: 14px;
          border: 0;
          border-radius: 0;
          background: transparent;
        }
        .desktop-vc-shell .lk-grid-layout-wrapper,
        .desktop-vc-shell .lk-focus-layout-wrapper,
        .desktop-vc-shell .lk-focus-layout-container {
          position: relative;
          z-index: 1;
          background: transparent;
        }
        .desktop-vc-shell .lk-grid-layout-wrapper,
        .desktop-vc-shell .lk-focus-layout-wrapper {
          height: calc(100% - var(--desktop-vc-control-bar-height) - var(--desktop-vc-control-gap)) !important;
        }
        .desktop-vc-shell .lk-grid-layout-wrapper {
          box-sizing: border-box;
          padding-top: var(--desktop-vc-focus-stage-top-gap);
          padding-bottom: var(--desktop-vc-carousel-bottom-padding);
        }
        .desktop-vc-shell .lk-focus-layout-wrapper {
          box-sizing: border-box;
          padding-top: var(--desktop-vc-focus-stage-top-gap);
          padding-bottom: var(--desktop-vc-carousel-bottom-padding);
        }
        .desktop-vc-shell .lk-focus-layout {
          grid-template-columns: minmax(0, 1fr);
          grid-template-rows: auto minmax(0, 1fr);
          align-items: stretch;
          gap: var(--desktop-vc-focus-stack-gap);
        }
        .desktop-vc-shell .lk-focus-layout > .desktop-vc-focus-stage {
          order: 2;
          grid-column: 1;
          grid-row: 2;
          min-height: 0;
        }
        .desktop-vc-shell .lk-focus-layout > .desktop-vc-carousel-region {
          order: 1;
          grid-column: 1;
          grid-row: 1;
          position: relative;
          box-sizing: border-box;
          width: 100%;
          margin-inline: 0;
          padding-top: var(--desktop-vc-carousel-top-padding);
          padding-bottom: var(--desktop-vc-focus-carousel-bottom-padding);
          min-height: 0;
        }
        .desktop-vc-shell .lk-focus-layout > .desktop-vc-carousel-region > .lk-carousel[data-lk-orientation='horizontal'] {
          overflow-x: auto;
          overflow-y: hidden;
          scrollbar-width: none;
          -ms-overflow-style: none;
          justify-content: center;
        }
        .desktop-vc-shell .lk-focus-layout > .desktop-vc-carousel-region > .lk-carousel[data-lk-orientation='horizontal']::-webkit-scrollbar {
          width: 0;
          height: 0;
          display: none;
        }
        .desktop-vc-shell .desktop-vc-carousel-region--centered > .lk-carousel[data-lk-orientation='horizontal'] {
          width: fit-content;
          max-width: 100%;
          margin-inline: auto;
          justify-content: center;
          overflow: hidden;
        }
        .desktop-vc-shell .desktop-vc-carousel-region--centered {
          width: fit-content;
          max-width: 100%;
          justify-self: center;
        }
        .desktop-vc-shell .desktop-vc-carousel-region--centered > .lk-carousel[data-lk-orientation='horizontal'] > * {
          width: var(--desktop-vc-centered-tile-size);
          min-width: var(--desktop-vc-centered-tile-size);
          max-width: var(--desktop-vc-centered-tile-size);
        }
        .desktop-vc-shell .desktop-vc-carousel-nav {
          position: absolute;
          inset: 0;
          z-index: 4;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 6px;
          pointer-events: none;
        }
        .desktop-vc-shell .desktop-vc-carousel-nav__btn {
          width: 28px;
          height: 28px;
          border-radius: 9px;
          border: 1px solid rgba(118, 144, 160, 0.28);
          background: rgba(8, 12, 16, 0.72);
          color: #e5eef8;
          line-height: 1;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          pointer-events: auto;
        }
        .desktop-vc-shell .desktop-vc-carousel-nav__btn:hover {
          border-color: rgba(126, 205, 196, 0.42);
          background: rgba(14, 19, 26, 0.9);
        }
        .desktop-vc-shell .desktop-vc-carousel-nav__btn:disabled {
          opacity: 0.35;
          cursor: default;
        }
        .desktop-vc-shell .desktop-vc-carousel-nav__btn:disabled:hover {
          border-color: rgba(118, 144, 160, 0.28);
          background: rgba(8, 12, 16, 0.72);
        }
        .desktop-vc-shell .desktop-vc-focus-layout--screenshare .lk-focus-layout {
          grid-template-columns: minmax(0, 1fr);
          grid-template-rows: auto minmax(0, 1fr);
        }
        .desktop-vc-shell .desktop-vc-focus-layout--screenshare .lk-focus-layout > .desktop-vc-carousel-region {
          grid-column: 1;
          grid-row: 1;
        }
        .desktop-vc-shell .desktop-vc-focus-layout--screenshare .lk-focus-layout > .desktop-vc-focus-stage {
          grid-column: 1;
          grid-row: 2;
        }
        .desktop-vc-shell .desktop-vc-focus-stage,
        .desktop-vc-shell .desktop-vc-focus-stage > .lk-participant-tile {
          width: 100%;
          height: 100%;
          min-height: 0;
        }
        @media (max-width: 400px) {
          .desktop-vc-shell .lk-grid-layout {
            height: auto;
            max-height: 100%;
            align-content: start;
            grid-auto-rows: auto;
            gap: 8px;
            overflow-y: auto;
          }
          .desktop-vc-shell .lk-grid-layout > .lk-participant-tile {
            height: auto;
            aspect-ratio: 1 / 1;
          }
          .desktop-vc-shell .lk-focus-layout {
            grid-template-columns: minmax(0, 1fr);
            grid-template-rows: auto minmax(0, 1fr);
            align-content: stretch;
            gap: var(--desktop-vc-focus-stack-gap);
          }
          .desktop-vc-shell .lk-focus-layout > .desktop-vc-focus-stage {
            grid-column: auto;
            grid-row: auto;
            height: auto;
            aspect-ratio: 1 / 1;
          }
          .desktop-vc-shell .lk-focus-layout > .desktop-vc-focus-stage > .lk-participant-tile {
            height: 100%;
          }
          .desktop-vc-shell .lk-focus-layout > .desktop-vc-carousel-region,
          .desktop-vc-shell .lk-focus-layout > .desktop-vc-carousel-region > .lk-carousel {
            grid-column: auto;
            grid-row: auto;
            height: 100%;
            min-height: 0;
            max-height: none;
          }
          .desktop-vc-shell .desktop-vc-focus-layout--screenshare .lk-focus-layout > .desktop-vc-focus-stage {
            grid-column: 1;
            grid-row: 1;
          }
          .desktop-vc-shell .desktop-vc-focus-layout--screenshare .lk-focus-layout > .desktop-vc-carousel-region {
            grid-column: 1;
            grid-row: 2;
          }
        }
        @media (max-width: 260px) {
          .desktop-vc-shell {
            --desktop-vc-fixed-focus-stage-size: 230px;
            --desktop-vc-focus-stage-top-gap: 6px;
            --desktop-vc-control-bar-height: 52px;
            --desktop-vc-control-bar-pad-y: 5px;
            --desktop-vc-control-bar-pad-x: 6px;
            --desktop-vc-control-bar-gap-size: 5px;
            --desktop-vc-control-button-size: 34px;
          }
          .desktop-vc-shell .lk-focus-layout {
            grid-template-rows: var(--desktop-vc-fixed-focus-stage-size) minmax(0, 1fr);
            align-content: stretch;
          }
          .desktop-vc-shell .lk-focus-layout > .desktop-vc-focus-stage {
            width: min(100%, var(--desktop-vc-fixed-focus-stage-size));
            height: var(--desktop-vc-fixed-focus-stage-size);
            min-height: var(--desktop-vc-fixed-focus-stage-size);
            max-height: var(--desktop-vc-fixed-focus-stage-size);
            margin-inline: auto;
          }
          .desktop-vc-shell .lk-focus-layout > .desktop-vc-focus-stage > .lk-participant-tile {
            width: 100%;
            height: 100%;
          }
          .desktop-vc-shell .lk-focus-layout > .desktop-vc-carousel-region {
            height: 100%;
            min-height: 0;
            max-height: none;
          }
        .desktop-vc-shell .lk-focus-layout > .desktop-vc-carousel-region > .lk-carousel[data-lk-orientation='vertical'] {
          height: 100%;
          max-height: none;
          padding-top: calc(6px + var(--desktop-vc-carousel-first-item-top));
          overflow-y: auto;
          overflow-x: hidden;
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
          .desktop-vc-shell .lk-focus-layout > .desktop-vc-carousel-region > .lk-carousel[data-lk-orientation='vertical']::-webkit-scrollbar {
            width: 0;
            height: 0;
            display: none;
          }
          .desktop-vc-shell .lk-focus-layout > .desktop-vc-carousel-region > .lk-carousel[data-lk-orientation='vertical'] > * {
            width: 100%;
            min-width: 0;
            height: auto;
            aspect-ratio: 1 / 1;
          }
          .desktop-vc-shell .desktop-vc-mini-carousel-nav {
            position: absolute;
            right: 8px;
            bottom: 8px;
            z-index: 4;
            display: inline-flex;
            gap: 6px;
          }
          .desktop-vc-shell .desktop-vc-mini-carousel-nav__btn {
            width: 26px;
            height: 26px;
            border-radius: 8px;
            border: 1px solid rgba(118, 144, 160, 0.28);
            background: rgba(8, 12, 16, 0.72);
            color: #e5eef8;
            font-size: 14px;
            font-weight: 700;
            line-height: 1;
            cursor: pointer;
          }
          .desktop-vc-shell .desktop-vc-mini-carousel-nav__btn:hover {
            border-color: rgba(126, 205, 196, 0.42);
            background: rgba(14, 19, 26, 0.9);
          }
          .desktop-vc-shell .desktop-vc-mini-carousel-nav__btn:disabled {
            opacity: 0.35;
            cursor: default;
          }
          .desktop-vc-shell .desktop-vc-mini-carousel-nav__btn:disabled:hover {
            border-color: rgba(118, 144, 160, 0.28);
            background: rgba(8, 12, 16, 0.72);
          }
          .desktop-vc-shell .lk-control-bar {
            justify-content: space-evenly;
            padding: var(--desktop-vc-control-bar-pad-y) var(--desktop-vc-control-bar-pad-x);
            gap: var(--desktop-vc-control-bar-gap-size);
            min-height: var(--desktop-vc-control-bar-height);
            max-height: var(--desktop-vc-control-bar-height) !important;
          }
          .desktop-vc-shell .lk-control-bar .lk-button,
          .desktop-vc-shell .lk-control-bar .lk-disconnect-button,
          .desktop-vc-shell .lk-control-bar .lk-chat-toggle,
          .desktop-vc-shell .lk-control-bar .lk-settings-toggle {
            width: var(--desktop-vc-control-button-size);
            height: var(--desktop-vc-control-button-size);
            border-radius: 10px;
          }
          .desktop-vc-shell .desktop-vc-control-icon {
            font-size: 10px;
            letter-spacing: 0.02em;
          }
        }
        .desktop-vc-shell .lk-grid-layout > *,
        .desktop-vc-shell .lk-focus-layout > * {
          position: relative;
          z-index: 1;
        }
        .desktop-vc-shell .lk-carousel {
          --lk-grid-gap: var(--desktop-vc-carousel-gap-size);
          width: 100%;
          padding: 8px;
          gap: var(--desktop-vc-carousel-gap-size);
          min-height: 110px;
          max-height: 156px;
          overflow-x: auto;
          overflow-y: hidden;
          position: relative;
          isolation: isolate;
          border-radius: 18px;
          border: 1px solid rgba(178, 194, 214, 0.24);
          background:
            radial-gradient(circle at 50% 42%, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02) 40%, rgba(20, 24, 32, 0) 74%),
            linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0)),
            rgba(58, 64, 76, 0.58);
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.06),
            0 10px 24px rgba(0, 0, 0, 0.16);
          backdrop-filter: blur(8px) saturate(1.06);
          -webkit-backdrop-filter: blur(8px) saturate(1.06);
        }
        .desktop-vc-shell .lk-carousel::after {
          content: '';
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 0;
          background-image:
            radial-gradient(rgba(255, 255, 255, 0.03) 0.7px, transparent 0.9px),
            radial-gradient(rgba(255, 255, 255, 0.022) 0.6px, transparent 0.85px);
          background-size: 3px 3px, 5px 5px;
          background-position: 0 0, 1px 2px;
          opacity: 0.42;
        }
        .desktop-vc-shell .lk-carousel > * {
          position: relative;
          z-index: 1;
          min-width: 0;
          aspect-ratio: 1 / 1;
        }
        .desktop-vc-shell .lk-carousel[data-lk-orientation='horizontal'] > * {
          width: calc(
            (100% - var(--lk-grid-gap) * (var(--lk-max-visible-tiles, 2) - 1)) /
            var(--lk-max-visible-tiles, 2)
          );
          max-width: min(100%, var(--desktop-vc-carousel-tile-max-size));
        }
        .desktop-vc-shell .lk-participant-tile {
          border-radius: 20px;
          border: 1px solid rgba(178, 194, 214, 0.26);
          background:
            radial-gradient(circle at top, rgba(173, 198, 226, 0.08), transparent 44%),
            linear-gradient(180deg, rgba(50, 56, 68, 0.94), rgba(36, 42, 54, 0.96));
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.04),
            0 12px 24px rgba(0, 0, 0, 0.14);
          transition: border-color 160ms ease, transform 160ms ease, box-shadow 160ms ease;
        }
        .desktop-vc-shell .lk-participant-tile:hover {
          transform: translateY(-1px);
          border-color: rgba(188, 204, 224, 0.4);
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.05),
            0 14px 28px rgba(0, 0, 0, 0.16);
        }
        .desktop-vc-shell .lk-participant-media-video,
        .desktop-vc-shell .lk-participant-placeholder {
          border-radius: 16px;
        }
        .desktop-vc-shell .desktop-vc-focus-stage .desktop-vc-focus-video-stack {
          position: relative;
          overflow: hidden;
          isolation: isolate;
          background: #04070d;
        }
        .desktop-vc-shell .desktop-vc-focus-stage .desktop-vc-focus-video-stack::after {
          content: '';
          position: absolute;
          inset: 0;
          z-index: 1;
          pointer-events: none;
          background:
            linear-gradient(
              90deg,
              rgba(3, 5, 9, 0.18) 0%,
              rgba(3, 5, 9, 0.01) 20%,
              rgba(3, 5, 9, 0.01) 80%,
              rgba(3, 5, 9, 0.18) 100%
            ),
            radial-gradient(circle at center, rgba(8, 12, 18, 0) 58%, rgba(6, 8, 12, 0.24) 100%);
        }
        .desktop-vc-shell .desktop-vc-focus-stage .desktop-vc-ambient-video {
          position: absolute;
          inset: -8%;
          width: 116%;
          height: 116%;
          object-fit: cover;
          filter: blur(14px) saturate(1.06) brightness(0.74);
          transform: scale(1.02);
          opacity: 0.88;
          z-index: 0;
          pointer-events: none;
        }
        .desktop-vc-shell .desktop-vc-focus-stage .desktop-vc-main-video {
          position: relative;
          z-index: 2;
          object-fit: contain;
          background: transparent;
        }
        .desktop-vc-shell .lk-participant-placeholder {
          background:
            radial-gradient(circle at 50% 28%, rgba(255, 255, 255, 0.06), transparent 24%),
            radial-gradient(circle at 50% 120%, rgba(176, 196, 220, 0.08), transparent 24%),
            linear-gradient(180deg, rgba(52, 58, 70, 0.94), rgba(38, 44, 56, 0.96));
        }
        .desktop-vc-shell .lk-participant-metadata {
          right: 10px;
          bottom: 10px;
          left: 10px;
        }
        .desktop-vc-shell .lk-participant-metadata-item {
          padding: 0.34rem 0.55rem;
          border: 1px solid rgba(178, 194, 214, 0.26);
          border-radius: 12px;
          background: rgba(46, 52, 64, 0.62);
          color: var(--vc-text);
          backdrop-filter: blur(10px);
        }
        .desktop-vc-shell .lk-participant-name {
          color: var(--vc-text);
        }
        .desktop-vc-shell .lk-focus-toggle-button {
          opacity: 1;
          top: 10px;
          right: 10px;
          padding: 0.35rem;
          background: rgba(5, 13, 22, 0.72);
          border: 1px solid rgba(118, 144, 160, 0.18);
          color: #dce7fb;
          backdrop-filter: blur(10px);
        }
        .desktop-vc-shell .lk-control-bar {
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          transform: none;
          z-index: 100;
          display: flex;
          justify-content: center;
          gap: var(--desktop-vc-control-bar-gap-size);
          align-items: center;
          padding: var(--desktop-vc-control-bar-pad-y) var(--desktop-vc-control-bar-pad-x);
          box-sizing: border-box;
          min-height: var(--desktop-vc-control-bar-height);
          max-height: none;
          border-top: 1px solid rgba(118, 144, 160, 0.14);
          border-left: 0;
          border-right: 0;
          border-bottom: 0;
          border-radius: 0;
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.02), rgba(255, 255, 255, 0)),
            rgba(7, 10, 14, 0.92);
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.04),
            0 -14px 34px rgba(0, 0, 0, 0.28);
          backdrop-filter: blur(22px);
        }
        .desktop-vc-shell .lk-control-bar .lk-button,
        .desktop-vc-shell .lk-control-bar .lk-disconnect-button,
        .desktop-vc-shell .lk-control-bar .lk-chat-toggle,
        .desktop-vc-shell .lk-control-bar .lk-settings-toggle {
          width: var(--desktop-vc-control-button-size);
          height: var(--desktop-vc-control-button-size);
          padding: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 14px;
          border: 1px solid rgba(118, 144, 160, 0.14);
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.018), rgba(255, 255, 255, 0)),
            rgba(16, 22, 28, 0.94);
          color: var(--vc-text);
          box-shadow: none;
          transition: transform 140ms ease, border-color 140ms ease, background 140ms ease;
        }
        .desktop-vc-shell .lk-control-bar .lk-chat-toggle,
        .desktop-vc-shell .lk-control-bar .lk-settings-toggle {
          position: relative;
          overflow: visible;
        }
        .desktop-vc-shell .desktop-vc-control-badge {
          position: absolute;
          top: -5px;
          right: -5px;
          min-width: 16px;
          height: 16px;
          border-radius: 999px;
          padding: 0 4px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          font-weight: 700;
          color: #fff;
          background: linear-gradient(135deg, #ef4444, #f97316);
          border: 1px solid rgba(255, 255, 255, 0.35);
          pointer-events: none;
        }
        .desktop-vc-shell .lk-control-bar .lk-button:hover,
        .desktop-vc-shell .lk-control-bar .lk-disconnect-button:hover,
        .desktop-vc-shell .lk-control-bar .lk-chat-toggle:hover,
        .desktop-vc-shell .lk-control-bar .lk-settings-toggle:hover {
          transform: translateY(-1px);
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.02), rgba(255, 255, 255, 0)),
            rgba(21, 29, 37, 0.98);
          border-color: rgba(126, 205, 196, 0.32);
        }
        .desktop-vc-shell .lk-control-bar .lk-button[aria-pressed='true'],
        .desktop-vc-shell .lk-control-bar .lk-chat-toggle[aria-pressed='true'],
        .desktop-vc-shell .lk-control-bar .lk-settings-toggle[aria-pressed='true'] {
          border-color: rgba(118, 144, 160, 0.38);
          background:
            linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0)),
            rgba(37, 39, 43, 0.98);
          color: #e8f0f8;
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.07),
            0 0 0 1px rgba(118,144,160,0.12);
        }
        .desktop-vc-shell .lk-control-bar .lk-disconnect-button {
          background: linear-gradient(135deg, var(--vc-danger-strong), var(--vc-danger));
          border-color: rgba(255, 176, 158, 0.46);
          color: #fff2f2;
          box-shadow: 0 10px 24px rgba(168, 46, 35, 0.28);
        }
        .desktop-vc-shell .desktop-vc-control-icon {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .desktop-vc-shell .desktop-vc-drawer {
          --drawer-w: min(360px, 92vw);
          position: fixed;
          top: var(--desktop-vc-header-height);
          left: auto;
          right: 0;
          bottom: calc(var(--desktop-vc-control-bar-height) + var(--desktop-vc-control-gap));
          width: var(--drawer-w);
          min-width: min(280px, 92vw);
          margin: 0;
          border-left: 1px solid rgba(118, 144, 160, 0.14);
          border-radius: 0;
          background: var(--vc-header-bg);
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.04),
            -18px 0 44px rgba(0, 0, 0, 0.34);
          overflow: hidden;
          z-index: 180;
          backdrop-filter: blur(18px);
          transform: translateX(100%);
          opacity: 0;
          pointer-events: none;
          transition: transform 180ms ease, opacity 140ms ease;
        }
        .desktop-vc-shell .desktop-vc-drawer--open {
          transform: translateX(0);
          opacity: 1;
          pointer-events: auto;
        }
        .desktop-vc-shell .desktop-vc-drawer--settings {
          padding: 0 !important;
          align-items: stretch !important;
          gap: 0 !important;
        }
        .desktop-vc-shell .desktop-vc-drawer--settings > .desktop-vc-settings {
          width: 100%;
          height: 100%;
        }
        .desktop-vc-shell .desktop-vc-drawer > .lk-chat {
          height: 100%;
          width: 100%;
          margin: 0;
          display: grid;
          grid-template-rows: auto minmax(0, 1fr) auto;
          align-items: stretch;
          background: var(--vc-header-bg);
        }
        .desktop-vc-shell .desktop-vc-drawer > .desktop-vc-settings {
          height: 100%;
          margin: 0;
          display: flex;
          flex-direction: column;
        }
        .desktop-vc-shell .desktop-vc-drawer > .lk-chat .lk-chat-messages {
          min-height: 0;
          background: var(--vc-header-bg);
        }
        .desktop-vc-shell .lk-chat-header,
        .desktop-vc-shell .desktop-vc-settings__header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 10px 14px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0)),
            var(--vc-header-bg);
        }
        .desktop-vc-shell .desktop-vc-settings__header {
          flex-direction: column;
          align-items: flex-start;
          gap: 2px;
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.02), rgba(255, 255, 255, 0)),
            rgba(0, 0, 0, 0.35);
        }
        .desktop-vc-shell .lk-chat-header {
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.02), rgba(255, 255, 255, 0)),
            rgba(0, 0, 0, 0.35);
        }
        .desktop-vc-shell .desktop-vc-settings__header strong {
          font-size: 15px;
        }
        .desktop-vc-shell .desktop-vc-settings__header span {
          color: var(--vc-text-soft);
          font-size: 11px;
        }
        .desktop-vc-shell .desktop-vc-settings__body {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 14px 16px 20px;
          flex: 1;
          overflow-y: auto;
          min-height: 0;
        }
        /* group-label gets extra top margin to visually separate sections */
        .desktop-vc-shell .desktop-vc-settings__body > .desktop-vc-settings__group-label {
          margin-top: 10px;
        }
        .desktop-vc-shell .desktop-vc-settings__body > .desktop-vc-settings__group-label:first-child {
          margin-top: 0;
        }
        /* each section: label left | device button right */
        .desktop-vc-shell .desktop-vc-settings__section {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .desktop-vc-shell .desktop-vc-settings__section label {
          flex: 1;
          color: var(--vc-text-soft);
          font-size: 13px;
          font-weight: 500;
          white-space: nowrap;
        }
        .desktop-vc-shell .desktop-vc-settings__section .lk-media-device-select {
          flex: 0 0 auto;
          flex-direction: column;
          gap: 4px;
          align-items: flex-end;
        }
        .desktop-vc-shell .desktop-vc-settings button {
          width: 100%;
          justify-content: flex-start;
        }
        /* action buttons inside a row keep their natural width */
        .desktop-vc-shell .desktop-vc-settings__kick-row .desktop-vc-settings__action-btn,
        .desktop-vc-shell .desktop-vc-settings__speaker-row .desktop-vc-settings__action-btn {
          width: auto;
          flex-shrink: 0;
        }
        /* device list item buttons (inside popup) */
        .desktop-vc-shell .lk-media-device-select li {
          list-style: none;
        }
        .desktop-vc-shell .lk-media-device-select .lk-button {
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 7px;
          color: rgba(239, 245, 251, 0.65);
          font-size: 11px;
          letter-spacing: 0;
          width: 100%;
          display: block;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
          text-align: left;
          padding: 0.38rem 0.6rem;
          transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
        }
        .desktop-vc-shell .lk-media-device-select .lk-button:hover {
          background: rgba(255, 255, 255, 0.11);
          border-color: rgba(255, 255, 255, 0.18);
          color: var(--vc-text);
        }
        /* lk-button-menu: trigger button that opens device dropdown */
        .desktop-vc-shell .desktop-vc-settings__section .lk-button.lk-button-menu {
          width: auto;
          max-width: 110px;
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 0.3rem 0.55rem;
          border-radius: 7px;
          background: rgba(255, 255, 255, 0.07);
          border: 1px solid rgba(255, 255, 255, 0.12);
          color: rgba(239, 245, 251, 0.75);
          font-size: 11px;
          cursor: pointer;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
          margin-left: auto;
          transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
        }
        .desktop-vc-shell .desktop-vc-settings__section .lk-button.lk-button-menu:hover {
          background: rgba(255, 255, 255, 0.12);
          border-color: rgba(255, 255, 255, 0.2);
          color: var(--vc-text);
        }
        .desktop-vc-shell .desktop-vc-settings__section .lk-button.lk-button-menu svg {
          flex-shrink: 0;
          opacity: 0.55;
        }
        /* active / selected device */
        .desktop-vc-shell .lk-media-device-select [data-lk-active='true'] > .lk-button {
          background: rgba(99, 210, 198, 0.14);
          border-color: rgba(99, 210, 198, 0.42);
          color: #c6f4ee;
        }
        /* popup dropdown */
        .desktop-vc-shell .lk-device-menu {
          background: #2c2f35;
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 10px;
          box-shadow: 0 8px 28px rgba(0, 0, 0, 0.55);
          color: var(--vc-text);
          width: calc(var(--drawer-w, 360px) * 0.8);
          box-sizing: border-box;
          overflow: hidden;
        }
        .desktop-vc-shell .lk-device-menu .lk-button {
          width: 100%;
          box-sizing: border-box;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          text-align: left;
          justify-content: flex-start;
        }
        /* ── Settings: group label ──────────────────────────────────── */
        .desktop-vc-shell .desktop-vc-settings__group-label {
          font-size: 14px;
          font-weight: 650;
          letter-spacing: 0.01em;
          color: var(--vc-text);
          padding-bottom: 5px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          margin-bottom: 2px;
        }
        /* ── Settings: background toggle ────────────────────────────── */
        .desktop-vc-shell .desktop-vc-settings__bg-row {
          display: flex;
          gap: 8px;
        }
        .desktop-vc-shell .desktop-vc-settings__bg-btn {
          flex: 1;
          padding: 0.38rem 0.5rem;
          border-radius: 7px;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: rgba(239, 245, 251, 0.65);
          font-size: 11px;
          cursor: pointer;
          transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
        }
        .desktop-vc-shell .desktop-vc-settings__bg-btn:hover {
          background: rgba(255, 255, 255, 0.11);
          color: var(--vc-text);
        }
        .desktop-vc-shell .desktop-vc-settings__bg-btn.is-active {
          background: rgba(99, 210, 198, 0.14);
          border-color: rgba(99, 210, 198, 0.42);
          color: #c6f4ee;
        }
        .desktop-vc-shell .desktop-vc-settings__bg-btn {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 5px;
          padding: 5px 5px 6px;
        }
        .desktop-vc-shell .desktop-vc-settings__bg-btn-thumb {
          width: 100%;
          aspect-ratio: 16 / 9;
          border-radius: 4px;
          overflow: hidden;
          background: rgba(255, 255, 255, 0.06);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .desktop-vc-shell .desktop-vc-settings__bg-btn-thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .desktop-vc-shell .desktop-vc-settings__bg-none-icon {
          font-size: 13px;
          color: var(--vc-text-soft);
        }
        .desktop-vc-shell .desktop-vc-settings__bg-blur-icon {
          width: 100%;
          height: 100%;
          display: block;
          background: linear-gradient(135deg, rgba(99,210,198,0.18) 0%, rgba(99,210,198,0.06) 100%);
          backdrop-filter: blur(3px);
        }
        /* ── Settings: action buttons (approve / reject / kick) ──────── */
        .desktop-vc-shell .desktop-vc-settings__action-btn {
          padding: 0.28rem 0.7rem;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 500;
          cursor: pointer;
          border: 1px solid transparent;
          transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
          flex-shrink: 0;
        }
        .desktop-vc-shell .desktop-vc-settings__action-btn:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .desktop-vc-shell .desktop-vc-settings__action-btn--primary {
          background: rgba(99, 210, 198, 0.16);
          border-color: rgba(99, 210, 198, 0.38);
          color: #c6f4ee;
          width: 100%;
          padding: 0.42rem 0.7rem;
        }
        .desktop-vc-shell .desktop-vc-settings__action-btn--primary:hover:not(:disabled) {
          background: rgba(99, 210, 198, 0.26);
        }
        .desktop-vc-shell .desktop-vc-settings__action-btn--approve {
          background: rgba(34, 197, 94, 0.14);
          border-color: rgba(34, 197, 94, 0.35);
          color: #86efac;
        }
        .desktop-vc-shell .desktop-vc-settings__action-btn--approve:hover:not(:disabled) {
          background: rgba(34, 197, 94, 0.24);
        }
        .desktop-vc-shell .desktop-vc-settings__action-btn--reject {
          background: rgba(244, 63, 94, 0.12);
          border-color: rgba(244, 63, 94, 0.32);
          color: #fda4af;
        }
        .desktop-vc-shell .desktop-vc-settings__action-btn--reject:hover:not(:disabled) {
          background: rgba(244, 63, 94, 0.22);
        }
        .desktop-vc-shell .desktop-vc-settings__action-btn--danger {
          background: rgba(244, 63, 94, 0.1);
          border-color: rgba(244, 63, 94, 0.28);
          color: #fda4af;
        }
        .desktop-vc-shell .desktop-vc-settings__action-btn--danger:hover:not(:disabled) {
          background: rgba(244, 63, 94, 0.2);
        }
        .desktop-vc-shell .desktop-vc-settings__action-btn--cancel {
          background: rgba(255, 255, 255, 0.06);
          border-color: rgba(255, 255, 255, 0.12);
          color: rgba(239, 245, 251, 0.65);
        }
        .desktop-vc-shell .desktop-vc-settings__action-btn--cancel:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.1);
          color: var(--vc-text);
        }
        /* ── Settings: speaker requests list ────────────────────────── */
        .desktop-vc-shell .desktop-vc-settings__speaker-list,
        .desktop-vc-shell .desktop-vc-settings__kick-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .desktop-vc-shell .desktop-vc-settings__speaker-row,
        .desktop-vc-shell .desktop-vc-settings__kick-row {
          display: flex;
          flex-direction: column;
          gap: 0;
          padding: 0;
          border-radius: 7px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.07);
          overflow: hidden;
        }
        .desktop-vc-shell .desktop-vc-settings__kick-row {
          flex-direction: row;
          align-items: center;
          gap: 8px;
          padding: 6px 8px;
        }
        .desktop-vc-shell .desktop-vc-settings__speaker-top {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 8px;
          width: 100%;
          box-sizing: border-box;
        }
        .desktop-vc-shell .desktop-vc-settings__speaker-name-btn {
          flex: 1;
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 5px;
          background: none;
          border: none;
          padding: 0;
          cursor: pointer;
          width: auto;
          text-align: left;
          justify-content: flex-start;
        }
        .desktop-vc-shell .desktop-vc-settings__speaker-expand-icon {
          font-size: 8px;
          color: var(--vc-text-soft);
          flex-shrink: 0;
        }
        .desktop-vc-shell .desktop-vc-settings__speaker-msg {
          padding: 6px 10px 8px;
          font-size: 11px;
          color: var(--vc-text-soft);
          font-style: italic;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
          background: rgba(0, 0, 0, 0.12);
          word-break: break-word;
        }
        .desktop-vc-shell .desktop-vc-settings__speaker-name,
        .desktop-vc-shell .desktop-vc-settings__kick-name {
          flex: 1;
          min-width: 0;
          font-size: 11px;
          color: var(--vc-text);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .desktop-vc-shell .desktop-vc-settings__speaker-note {
          font-size: 10px;
          color: var(--vc-text-soft);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 80px;
        }
        .desktop-vc-shell .desktop-vc-settings__speaker-actions {
          display: flex;
          gap: 5px;
          flex-shrink: 0;
        }
        /* ── Settings: audience request-to-speak ─────────────────────── */
        .desktop-vc-shell .desktop-vc-settings__speaker-request {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .desktop-vc-shell .desktop-vc-settings__request-input {
          width: 100%;
          box-sizing: border-box;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 7px;
          color: var(--vc-text);
          font-size: 11px;
          padding: 0.38rem 0.6rem;
          outline: none;
        }
        .desktop-vc-shell .desktop-vc-settings__request-input:focus {
          border-color: rgba(99, 210, 198, 0.4);
        }
        .desktop-vc-shell .desktop-vc-settings__my-request {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .desktop-vc-shell .desktop-vc-settings__my-request-label {
          flex: 1;
          font-size: 11px;
          color: var(--vc-text-soft);
          font-style: italic;
        }
        .desktop-vc-shell .desktop-vc-settings__empty {
          font-size: 11px;
          color: var(--vc-text-soft);
          text-align: center;
          padding: 6px 0;
          margin: 0;
        }
        .desktop-vc-shell .desktop-vc-settings__error {
          font-size: 11px;
          color: #fda4af;
          margin: 0;
          padding: 4px 6px;
          background: rgba(244, 63, 94, 0.1);
          border-radius: 5px;
        }
        .desktop-vc-shell .lk-chat-form {
          border-top: 1px solid rgba(255, 255, 255, 0.08);
          background: var(--vc-header-bg);
        }
        .desktop-vc-shell .lk-chat-form input,
        .desktop-vc-shell .lk-chat-form textarea {
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: var(--vc-text);
        }
        .desktop-vc-shell .lk-chat-entry .lk-message-body {
          background: rgba(16, 22, 29, 0.94);
          border: 1px solid rgba(118, 144, 160, 0.12);
          color: var(--vc-text);
          border-radius: 14px;
        }
        .desktop-vc-shell .lk-chat-entry[data-lk-message-origin='remote'] .lk-message-body {
          background:
            linear-gradient(135deg, rgba(18, 24, 31, 0.96), rgba(12, 17, 22, 0.96));
        }
        .desktop-vc-shell .lk-chat-entry[data-lk-message-origin='local'] .lk-message-body {
          background:
            linear-gradient(135deg, rgba(20, 83, 78, 0.88), rgba(19, 56, 60, 0.92));
          border-color: rgba(99, 210, 198, 0.22);
        }
        .desktop-vc-shell .lk-chat-entry .lk-participant-name,
        .desktop-vc-shell .lk-chat-entry .lk-timestamp {
          color: var(--vc-text-soft);
        }
        .desktop-vc-shell .desktop-vc-inline-error {
          position: fixed;
          left: 16px;
          right: 16px;
          bottom: calc(var(--desktop-vc-control-bar-height) + var(--desktop-vc-control-gap));
          z-index: 101;
          margin: 0;
          color: #fff5ef;
          background:
            linear-gradient(135deg, rgba(133, 44, 26, 0.96), rgba(164, 68, 48, 0.94));
          border-color: rgba(255, 179, 120, 0.32);
          box-shadow: 0 14px 36px rgba(0, 0, 0, 0.24);
        }
        @media (max-width: 900px) {
          .desktop-vc-shell .desktop-vc-drawer {
            width: min(360px, 96vw);
            min-width: min(260px, 96vw);
          }
        }
        /* ── Reaction overlay ─────────────────────────────────────────── */
        .desktop-vc-reaction-overlay {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 150;
          overflow: hidden;
        }
        .desktop-vc-reaction-particle {
          position: absolute;
          bottom: 0;
          display: inline-flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          opacity: 0;
          transform: translate(-50%, 0) scale(0.9);
          animation-name: vc-action-float-up;
          animation-timing-function: ease-out;
          animation-fill-mode: forwards;
          user-select: none;
        }
        .desktop-vc-reaction-glyph {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          font-size: 20px;
          border-radius: 999px;
          background: rgba(8, 15, 30, 0.86);
          border: 1px solid rgba(56, 189, 248, 0.4);
          box-shadow: 0 10px 24px rgba(2, 6, 23, 0.45);
        }
        .desktop-vc-reaction-actor {
          background: rgba(8, 15, 30, 0.75);
          border: 1px solid rgba(30, 58, 95, 0.9);
          border-radius: 999px;
          color: #cbd5e1;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.04em;
          max-width: 90px;
          overflow: hidden;
          padding: 2px 7px;
          text-overflow: ellipsis;
          text-transform: uppercase;
          white-space: nowrap;
        }
        @keyframes vc-action-float-up {
          0%   { opacity: 0; transform: translate(-50%, 12px) scale(0.82); }
          12%  { opacity: 1; transform: translate(-50%, -8px) scale(1);    }
          80%  { opacity: 1; transform: translate(-50%, -44vh) scale(1.03); }
          100% { opacity: 0; transform: translate(-50%, -58vh) scale(0.94); }
        }
        /* ── Reactions picker ─────────────────────────────────────────── */
        .desktop-vc-reactions-wrap {
          position: relative;
        }
        .desktop-vc-reactions-bar {
          position: absolute;
          bottom: calc(100% + 10px);
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          flex-wrap: wrap;
          gap: 3px;
          padding: 6px 8px;
          border-radius: 18px;
          border: 1px solid rgba(118, 144, 160, 0.22);
          background: rgba(10, 14, 19, 0.97);
          backdrop-filter: blur(20px);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255,255,255,0.04);
          z-index: 200;
          max-width: calc(100vw - 16px);
          white-space: nowrap;
        }
        .desktop-vc-reactions-bar__btn {
          width: 32px;
          height: 32px;
          border: none;
          background: transparent;
          border-radius: 8px;
          font-size: 18px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.1s, transform 0.1s;
        }
        .desktop-vc-reactions-bar__btn:hover {
          background: rgba(255, 255, 255, 0.1);
          transform: scale(1.25);
        }
        .desktop-vc-reactions-bar__btn:active {
          transform: scale(0.92);
        }
        .desktop-vc-reactions-btn__icon {
          font-size: 18px;
          line-height: 1;
        }
        @media (max-width: 400px) {
          .desktop-vc-reaction-glyph {
            width: 32px;
            height: 32px;
            font-size: 16px;
          }
          .desktop-vc-reactions-bar__btn {
            width: 28px;
            height: 28px;
            font-size: 16px;
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
        className="livekit-stage-rebuilt"
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
        <DesktopConference
          audience={audience}
          onMessage={setActionMessage}
          resolveParticipantAvatar={resolveParticipantAvatar}
          roomTitle={roomTitle}
          roomId={roomId}
          hostIdentityHints={hostIdentityHints}
        />
      </LiveKitRoom>
      {!!actionMessage && <div className="error desktop-vc-inline-error">{actionMessage}</div>}
    </div>
  )
}
