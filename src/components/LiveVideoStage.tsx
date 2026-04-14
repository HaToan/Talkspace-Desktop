import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CarouselLayout,
  Chat,
  ChatToggle,
  ConnectionStateToast,
  DisconnectButton,
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
  useLocalParticipant,
  useMaybeLayoutContext,
  useMaybeTrackRefContext,
  usePinnedTracks,
  useTracks,
} from '@livekit/components-react'
import { ConnectionState, Participant, Track } from 'livekit-client'

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
        onMessage('')
        return
      }

      await localParticipant.setScreenShareEnabled(true)
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
    startFallbackShare,
    stopFallbackShare,
  ])

  const enabled = fallbackEnabled || isScreenShareEnabled

  return (
    <button
      className="lk-button"
      aria-pressed={enabled}
      data-lk-source="screen_share"
      data-lk-enabled={enabled}
      disabled={pending || !canShare}
      onClick={() => void toggleScreenShare()}
      title={enabled ? 'Stop screen share' : 'Share screen'}
      type="button"
    >
      {enabled ? <ScreenShareStopIcon /> : <ScreenShareIcon />}
    </button>
  )
}

function DesktopControlBar({
  audience,
  onMessage,
}: {
  audience: boolean
  onMessage: (message: string) => void
}) {
  const { localParticipant } = useLocalParticipant()
  const layoutContext = useMaybeLayoutContext()
  const canPublish = !audience && Boolean(localParticipant?.permissions?.canPublish)
  const settingsOpen = Boolean(layoutContext?.widget.state?.showSettings)

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
      <ChatToggle title="Chat">
        <span className="desktop-vc-control-icon">Chat</span>
      </ChatToggle>
      <button
        className="lk-button lk-settings-toggle"
        aria-pressed={settingsOpen}
        onClick={() => layoutContext?.widget.dispatch?.({ msg: 'toggle_settings' })}
        title="Settings"
        type="button"
      >
        <GearIcon />
      </button>
      <DisconnectButton title="Leave">
        <LeaveIcon />
      </DisconnectButton>
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

  const handleMinimize = async () => {
    await api?.enterMiniMode?.({ participantCount })
    setIsMiniMode(true)
  }
  const handleMaximize = async () => {
    if (isMiniMode) {
      await api?.exitMiniMode?.()
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
  hostIdentityHints,
}: {
  audience: boolean
  onMessage: (message: string) => void
  resolveParticipantAvatar: (participant?: Participant | null) => string
  roomTitle: string
  hostIdentityHints: string[]
}) {
  const MINI_CAROUSEL_BREAKPOINT = 260
  const MINI_CAROUSEL_GAP = 8
  const [widgetState, setWidgetState] = useState<WidgetState>({
    showChat: false,
    unreadMessages: 0,
    showSettings: false,
  })
  const [isMiniWidth, setIsMiniWidth] = useState(() => window.innerWidth <= MINI_CAROUSEL_BREAKPOINT)
  const [miniCarouselOverflow, setMiniCarouselOverflow] = useState(false)
  const [miniCarouselCanPrev, setMiniCarouselCanPrev] = useState(false)
  const [miniCarouselCanNext, setMiniCarouselCanNext] = useState(false)
  const conferenceRef = useRef<HTMLDivElement | null>(null)
  const layoutContext = useCreateLayoutContext()
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

  return (
    <LayoutContextProvider value={layoutContext} onWidgetChange={setWidgetState}>
      <div className="lk-video-conference desktop-vc-conference" ref={conferenceRef}>
        <DesktopMeetingHeader title={roomTitle} participantCount={tracks.length} />
        <div className="lk-video-conference-inner">
          {!focusTrack ? (
            <div className="lk-grid-layout-wrapper">
              <GridLayout tracks={tracks}>
                <AvatarParticipantTile resolveParticipantAvatar={resolveParticipantAvatar} />
              </GridLayout>
            </div>
          ) : (
            <div className="lk-focus-layout-wrapper">
              <FocusLayoutContainer>
                <div className="desktop-vc-carousel-region">
                  <CarouselLayout tracks={carouselTracks} orientation={isMiniWidth ? 'vertical' : 'horizontal'}>
                    <AvatarParticipantTile resolveParticipantAvatar={resolveParticipantAvatar} />
                  </CarouselLayout>
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
          <DesktopControlBar audience={audience} onMessage={onMessage} />
        </div>
        <Chat style={{ display: widgetState.showChat ? 'grid' : 'none' }} />
        <div
          className="lk-settings-menu-modal"
          style={{ display: widgetState.showSettings ? 'block' : 'none' }}
        >
          <SettingsPanel />
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
          --desktop-vc-focus-stage-top-gap: 6px;
          --desktop-vc-carousel-inline-inset: 10px;
          --desktop-vc-carousel-top-padding: 4px;
          --desktop-vc-carousel-bottom-padding: 8px;
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
            --desktop-vc-focus-stage-top-gap: 4px;
            --desktop-vc-carousel-inline-inset: 8px;
            --desktop-vc-carousel-top-padding: 4px;
            --desktop-vc-carousel-bottom-padding: 6px;
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
            padding: 6px 8px 8px;
            gap: 4px;
            max-height: 46px !important;
            min-height: 46px;
          }
          .desktop-vc-shell .lk-control-bar .lk-button,
          .desktop-vc-shell .lk-control-bar .lk-disconnect-button,
          .desktop-vc-shell .lk-control-bar .lk-chat-toggle,
          .desktop-vc-shell .lk-control-bar .lk-settings-toggle {
            width: 32px;
            height: 32px;
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
        .desktop-vc-shell .lk-focus-layout-wrapper {
          box-sizing: border-box;
          padding-top: var(--desktop-vc-focus-stage-top-gap);
        }
        .desktop-vc-shell .lk-focus-layout {
          grid-template-columns: minmax(0, 1fr);
          grid-template-rows: minmax(0, 1fr) auto;
          align-items: stretch;
        }
        .desktop-vc-shell .lk-focus-layout > .desktop-vc-focus-stage {
          order: 1;
          min-height: 0;
        }
        .desktop-vc-shell .lk-focus-layout > .desktop-vc-carousel-region {
          order: 2;
          position: relative;
          box-sizing: border-box;
          width: calc(100% - var(--desktop-vc-carousel-inline-inset) * 2);
          margin-inline: var(--desktop-vc-carousel-inline-inset);
          padding-top: var(--desktop-vc-carousel-top-padding);
          padding-bottom: var(--desktop-vc-carousel-bottom-padding);
          min-height: 0;
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
            grid-template-rows: auto minmax(0, 1fr);
            align-content: stretch;
            gap: 8px;
          }
          .desktop-vc-shell .lk-focus-layout > .desktop-vc-focus-stage {
            height: auto;
            aspect-ratio: 1 / 1;
          }
          .desktop-vc-shell .lk-focus-layout > .desktop-vc-focus-stage > .lk-participant-tile {
            height: 100%;
          }
          .desktop-vc-shell .lk-focus-layout > .desktop-vc-carousel-region,
          .desktop-vc-shell .lk-focus-layout > .desktop-vc-carousel-region > .lk-carousel {
            height: 100%;
            min-height: 0;
            max-height: none;
          }
        }
        @media (max-width: 260px) {
          .desktop-vc-shell {
            --desktop-vc-fixed-focus-stage-size: 230px;
            --desktop-vc-focus-stage-top-gap: 20px;
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
        }
        .desktop-vc-shell .lk-grid-layout > *,
        .desktop-vc-shell .lk-focus-layout > * {
          position: relative;
          z-index: 1;
        }
        .desktop-vc-shell .lk-carousel {
          width: 100%;
          padding: 6px;
          min-height: 110px;
          max-height: 156px;
          overflow-x: auto;
          overflow-y: hidden;
          border-radius: 18px;
          border: 1px solid var(--vc-border);
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.012), rgba(255, 255, 255, 0)),
            rgba(11, 15, 20, 0.78);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
        }
        .desktop-vc-shell .lk-carousel > * {
          min-width: 150px;
        }
        .desktop-vc-shell .lk-participant-tile {
          border-radius: 20px;
          border: 1px solid rgba(118, 144, 160, 0.16);
          background:
            radial-gradient(circle at top, rgba(56, 201, 188, 0.08), transparent 42%),
            linear-gradient(180deg, rgba(20, 27, 34, 0.96), rgba(10, 14, 18, 0.98));
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.04),
            0 14px 32px rgba(0, 0, 0, 0.18);
          transition: border-color 160ms ease, transform 160ms ease, box-shadow 160ms ease;
        }
        .desktop-vc-shell .lk-participant-tile:hover {
          transform: translateY(-1px);
          border-color: rgba(126, 205, 196, 0.32);
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.05),
            0 16px 36px rgba(0, 0, 0, 0.22);
        }
        .desktop-vc-shell .lk-participant-media-video,
        .desktop-vc-shell .lk-participant-placeholder {
          border-radius: 16px;
        }
        .desktop-vc-shell .lk-participant-placeholder {
          background:
            radial-gradient(circle at 50% 28%, rgba(255, 255, 255, 0.06), transparent 24%),
            radial-gradient(circle at 50% 120%, rgba(99, 210, 198, 0.08), transparent 22%),
            linear-gradient(180deg, rgba(22, 29, 37, 0.96), rgba(10, 14, 18, 0.98));
        }
        .desktop-vc-shell .lk-participant-metadata {
          right: 10px;
          bottom: 10px;
          left: 10px;
        }
        .desktop-vc-shell .lk-participant-metadata-item {
          padding: 0.34rem 0.55rem;
          border: 1px solid rgba(136, 172, 206, 0.18);
          border-radius: 12px;
          background: rgba(6, 10, 14, 0.62);
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
          gap: 10px;
          align-items: center;
          padding: 12px 18px 14px;
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
          width: 46px;
          height: 46px;
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
          border-color: rgba(99, 210, 198, 0.58);
          background:
            linear-gradient(135deg, rgba(39, 150, 137, 0.82), rgba(56, 111, 192, 0.76));
          color: #f3fffd;
          box-shadow: 0 10px 24px rgba(35, 120, 140, 0.28);
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
        .desktop-vc-shell .lk-chat,
        .desktop-vc-shell .lk-settings-menu-modal {
          position: absolute;
          top: 76px;
          right: 12px;
          bottom: calc(var(--desktop-vc-control-bar-height) + var(--desktop-vc-control-gap));
          width: min(360px, 34vw);
          min-width: 300px;
          margin: 0;
          border-radius: 22px;
          border: 1px solid rgba(118, 144, 160, 0.14);
          background:
            radial-gradient(circle at top right, rgba(56, 201, 188, 0.08), transparent 28%),
            linear-gradient(180deg, rgba(13, 18, 24, 0.98), rgba(7, 10, 14, 0.98));
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.03),
            -18px 0 44px rgba(0, 0, 0, 0.34);
          overflow: hidden;
          z-index: 20;
          backdrop-filter: blur(18px);
        }
        .desktop-vc-shell .lk-chat-header,
        .desktop-vc-shell .desktop-vc-settings__header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 16px 18px;
          border-bottom: 1px solid rgba(118, 144, 160, 0.1);
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.015), rgba(255, 255, 255, 0)),
            rgba(12, 17, 22, 0.92);
        }
        .desktop-vc-shell .desktop-vc-settings__header {
          flex-direction: column;
          align-items: flex-start;
        }
        .desktop-vc-shell .desktop-vc-settings__header span {
          color: var(--vc-text-soft);
          font-size: 12px;
        }
        .desktop-vc-shell .desktop-vc-settings__body {
          display: grid;
          gap: 18px;
          padding: 20px 18px;
        }
        .desktop-vc-shell .desktop-vc-settings__section {
          display: grid;
          gap: 10px;
        }
        .desktop-vc-shell .desktop-vc-settings__section label {
          color: var(--vc-text);
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.03em;
          text-transform: uppercase;
        }
        .desktop-vc-shell .desktop-vc-settings button {
          width: 100%;
          justify-content: flex-start;
        }
        .desktop-vc-shell .lk-device-menu,
        .desktop-vc-shell .lk-media-device-select .lk-button {
          background: rgba(12, 17, 22, 0.98);
          border-color: rgba(118, 144, 160, 0.14);
          color: var(--vc-text);
        }
        .desktop-vc-shell .lk-chat-form {
          border-top: 1px solid rgba(118, 144, 160, 0.1);
          background: rgba(9, 12, 16, 0.94);
        }
        .desktop-vc-shell .lk-chat-form input,
        .desktop-vc-shell .lk-chat-form textarea {
          background: rgba(18, 24, 30, 0.9);
          border: 1px solid rgba(118, 144, 160, 0.12);
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
          hostIdentityHints={hostIdentityHints}
        />
      </LiveKitRoom>
      {!!actionMessage && <div className="error desktop-vc-inline-error">{actionMessage}</div>}
    </div>
  )
}
