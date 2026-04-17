import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import {
  AppPage,
  ChatMessage,
  ParticipantRole,
  RoomParticipant,
  RoomStatus,
  TalkRoom,
  UserProfile,
} from './types'
import AuthScreen from './components/AuthScreen'
import LiveVideoStage from './components/LiveVideoStage'
import { logoutAccount } from './services/auth'
import {
  type InviteLookupUser,
  type RoomCategoryOption,
  assignRoomCoHost,
  assignRoomMember,
  closeRoom as closeRoomApi,
  createRoomCategory as createRoomCategoryApi,
  createRoom as createRoomApi,
  deleteRoom as deleteRoomApi,
  demoteRoomUserToAudience,
  favoriteRoom as favoriteRoomApi,
  findUserForInvite,
  getPrejoin,
  getRoomToken,
  getTalkspacesApiError,
  leaveRoom as leaveRoomApi,
  listFavoriteRooms,
  listMyRooms,
  listRoomRecords,
  listRoomCategories,
  listRoomUsers,
  listSpeakerRequests,
  listRooms,
  openRoom as openRoomApi,
  requestAvatarUploadTarget,
  saveRoomRecord,
  submitHostRequest,
  submitSpeakerRequest,
  unfavoriteRoom as unfavoriteRoomApi,
  updateRoom as updateRoomApi,
  updateProfileSettings,
} from './services/talkspaces'

dayjs.extend(relativeTime)

type CreateRoomInput = {
  title: string
  description: string
  categoryId: string
  maxParticipants: number
  isPrivate: boolean
  audienceEnabled: boolean
  tags: string[]
  scheduledAt?: string
  repeatWeekly?: boolean
}

type JoinRoomOptions = {
  joinAsAudience: boolean
  accessCode?: string
}

type PrejoinDeviceSettings = {
  micEnabled: boolean
  camEnabled: boolean
  backgroundMode: 'none' | 'blur' | 'nature' | 'office'
  microphoneDeviceId?: string
  speakerDeviceId?: string
  cameraDeviceId?: string
  joinRole?: 'member' | 'listener' | 'host' | 'co_host'
  audienceEnabled?: boolean
}

type LaunchConferencePayload = {
  roomId: string
  joinAsAudience: boolean
  prejoinSettings?: PrejoinDeviceSettings
}

const statusTone: Record<RoomStatus, { label: string; className: string }> = {
  open: { label: 'Open', className: 'chip chip-open' },
  scheduled: { label: 'Scheduled', className: 'chip chip-scheduled' },
  closed: { label: 'Closed', className: 'chip chip-closed' },
}

const roleLabel: Record<ParticipantRole, string> = {
  host: 'Host',
  co_host: 'Co-host',
  member: 'Member',
  audience: 'Audience',
}

const roleLabelForSpaceRole: Record<UserProfile['spaceRole'], string> = {
  member: 'Member',
  host: 'Host',
  co_host: 'Co-host',
  admin: 'Admin',
}

type RoomMembershipRole = 'host' | 'co_host' | 'member'

const roomMembershipRoleLabel: Record<RoomMembershipRole, string> = {
  host: 'Host',
  co_host: 'Co-Host',
  member: 'Member',
}

const resolveRoomMembershipRole = (room: TalkRoom, currentUserId: string): RoomMembershipRole => {
  if (room.hostId === currentUserId || room.spaceRole === 'host') return 'host'
  if (room.spaceRole === 'co_host') return 'co_host'
  return 'member'
}

type SidebarNavKey = 'rooms' | 'calendar' | 'chat' | 'participants' | 'programs' | 'recordings'

const SidebarNavIcon = ({ id }: { id: SidebarNavKey }) => {
  if (id === 'rooms') {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
        <path d="M8 4.5V19.5" />
        <path d="M12 9.5H17" />
        <path d="M12 13.5H17" />
      </svg>
    )
  }
  if (id === 'calendar') {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3.5" y="5.5" width="17" height="15" rx="2.5" />
        <path d="M8 3.5V7.5M16 3.5V7.5M3.5 10H20.5" />
      </svg>
    )
  }
  if (id === 'participants') {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="9" cy="9" r="3" />
        <path d="M4.5 18c.6-2.5 2.6-4 4.5-4s3.9 1.5 4.5 4" />
        <circle cx="17" cy="10" r="2.3" />
        <path d="M15.2 17.2c.5-1.6 1.8-2.6 3.4-2.6" />
      </svg>
    )
  }
  if (id === 'chat') {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4.5 6.2A2.7 2.7 0 0 1 7.2 3.5h9.6a2.7 2.7 0 0 1 2.7 2.7v7.2a2.7 2.7 0 0 1-2.7 2.7H11l-4.1 3.2v-3.2H7.2a2.7 2.7 0 0 1-2.7-2.7Z" />
        <path d="M8 8.7h8M8 11.7h5.2" />
      </svg>
    )
  }
  if (id === 'programs') {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M5 4.5h14M6.5 4.5V19.5h11V4.5M9 9h6M9 13h6" />
      </svg>
    )
  }
  if (id === 'recordings') {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <line x1="8" y1="14" x2="16" y2="14" />
        <line x1="8" y1="17" x2="13" y2="17" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 4.5v2.2M12 17.3v2.2M19.5 12h-2.2M6.7 12H4.5M17.3 6.7l-1.6 1.6M8.3 15.7l-1.6 1.6M17.3 17.3l-1.6-1.6M8.3 8.3L6.7 6.7" />
    </svg>
  )
}

const defaultProfile: UserProfile = {
  id: 'u-local',
  username: 'desktop_user',
  name: 'Desktop User',
  email: 'desktop.user@talkspace.local',
  avatar: undefined,
  spaceRole: 'member',
}

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')

const makeId = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36)}`

const isFuture = (iso?: string) => (iso ? dayjs(iso).isAfter(dayjs()) : false)

const formatSchedule = (iso?: string) =>
  iso ? `${dayjs(iso).format('DD/MM/YYYY HH:mm')} (${dayjs(iso).fromNow()})` : 'No schedule'

const AUTH_PROFILE_KEY = 'talkspaceDesktop.authProfile'

const roomStatusWeight: Record<RoomStatus, number> = {
  open: 0,
  scheduled: 1,
  closed: 2,
}

const mergeRoomLists = (...lists: TalkRoom[][]) => {
  const map = new Map<string, TalkRoom>()
  for (const list of lists) {
    for (const room of list) {
      if (!room?.id) continue
      map.set(room.id, room)
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    const statusDiff = roomStatusWeight[a.status] - roomStatusWeight[b.status]
    if (statusDiff !== 0) return statusDiff
    const aTime = a.scheduledAt || a.startedAt || ''
    const bTime = b.scheduledAt || b.startedAt || ''
    if (aTime !== bTime) return bTime.localeCompare(aTime)
    return b.participantCount - a.participantCount
  })
}

const parseStoredProfile = () => {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(AUTH_PROFILE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<UserProfile>
    if (!parsed.id || !parsed.username || !parsed.name) return null
    return {
      id: String(parsed.id),
      username: String(parsed.username),
      name: String(parsed.name),
      email: String(parsed.email ?? ''),
      avatar:
        typeof parsed.avatar === 'string' && parsed.avatar.trim()
          ? parsed.avatar.trim()
          : undefined,
      spaceRole:
        parsed.spaceRole === 'host' ||
        parsed.spaceRole === 'co_host' ||
        parsed.spaceRole === 'admin'
          ? parsed.spaceRole
          : 'member',
    } as UserProfile
  } catch {
    return null
  }
}

function MainTitlebar() {
  const [isMaximized, setIsMaximized] = useState(false)
  const api = (window as any).electronAPI

  useEffect(() => {
    api?.isMaximizedCurrentWindow?.().then((res: any) => {
      if (res) setIsMaximized(res.isMaximized || res.isFullScreen)
    })
  }, [api])

  const handleMinimize = () => api?.minimizeCurrentWindow?.()
  const handleMaximize = async () => {
    const res = await api?.maximizeCurrentWindow?.()
    if (res) setIsMaximized(res.isMaximized)
  }
  const handleClose = () => api?.closeCurrentWindow?.()

  return (
    <div className="main-titlebar" aria-label="Window title bar">
      <div className="main-titlebar__brand main-titlebar__drag">
        <span className="main-titlebar__mark">TS</span>
        <span className="main-titlebar__brand-text">
          <strong>TalkSpace</strong>
          <span>Desktop</span>
        </span>
      </div>
      <div className="main-titlebar__spacer main-titlebar__drag" />
      <div className="main-titlebar__winctrl" aria-label="Window controls">
        <button
          className="main-winbtn main-winbtn--minimize"
          onClick={handleMinimize}
          title="Minimize"
          aria-label="Minimize"
        >
          <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor" /></svg>
        </button>
        <button
          className="main-winbtn main-winbtn--maximize"
          onClick={handleMaximize}
          title={isMaximized ? 'Restore' : 'Maximize'}
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <rect x="2" y="0" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.2" />
              <rect x="0" y="2" width="8" height="8" rx="1" fill="var(--main-titlebar-bg)" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <rect x="0.6" y="0.6" width="8.8" height="8.8" rx="1" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          )}
        </button>
        <button
          className="main-winbtn main-winbtn--close"
          onClick={handleClose}
          title="Close"
          aria-label="Close"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}

function App() {
  const [page, setPage] = useState<AppPage>({ key: 'rooms' })
  const [authProfile, setAuthProfile] = useState<UserProfile | null>(null)
  const profile = authProfile ?? defaultProfile
  const isHostSpaceRole = profile?.spaceRole === 'host'

  const [categories, setCategories] = useState<RoomCategoryOption[]>([])
  const [rooms, setRooms] = useState<TalkRoom[]>([])
  const [myRooms, setMyRooms] = useState<TalkRoom[]>([])
  const [roomsLoading, setRoomsLoading] = useState(false)
  const [roomsError, setRoomsError] = useState('')
  const [globalNotice, setGlobalNotice] = useState('')

  const [participantsByRoom, setParticipantsByRoom] = useState<Record<string, RoomParticipant[]>>({})
  const [participantsLoading, setParticipantsLoading] = useState<Record<string, boolean>>({})
  const [joinedRoomIds, setJoinedRoomIds] = useState<Set<string>>(new Set())
  const [favoriteRoomIds, setFavoriteRoomIds] = useState<Set<string>>(new Set())
  const [chatByRoom, setChatByRoom] = useState<Record<string, ChatMessage[]>>({})
  const [conferenceSessionByRoom, setConferenceSessionByRoom] = useState<
    Record<string, { token: string; livekitUrl?: string }>
  >({})
  const [runtimeVersion, setRuntimeVersion] = useState('')

  type UpdatePhase =
    | { phase: 'idle' }
    | { phase: 'available'; version: string }
    | { phase: 'downloading'; percent: number }
    | { phase: 'ready'; version: string }
    | { phase: 'error'; message: string }
  const [updateState, setUpdateState] = useState<UpdatePhase>({ phase: 'idle' })

  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<'all' | RoomStatus>('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [editingRoom, setEditingRoom] = useState<TalkRoom | null>(null)

  const [participantsRoomId, setParticipantsRoomId] = useState<string>('')
  const [chatRoomId, setChatRoomId] = useState<string>('')
  const [participantQuery, setParticipantQuery] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteLookupUser, setInviteLookupUser] = useState<InviteLookupUser | null>(null)
  const [inviteLookupLoading, setInviteLookupLoading] = useState(false)
  const [participantsNotice, setParticipantsNotice] = useState('')

  const [calendarMonth, setCalendarMonth] = useState(dayjs())
  const [calendarSelectedDay, setCalendarSelectedDay] = useState(dayjs().format('YYYY-MM-DD'))
  const [prejoinSettingsByRoom, setPrejoinSettingsByRoom] = useState<
    Record<string, PrejoinDeviceSettings>
  >({})
  const [isConferenceLaunchWindow] = useState(() => {
    if (typeof window === 'undefined') return false
    const params = new URLSearchParams(window.location.search)
    return params.get('launchMode') === 'conference'
  })
  const [launchConferencePayload, setLaunchConferencePayload] = useState<LaunchConferencePayload | null>(
    () => parseLaunchConferenceFromUrl(),
  )
  const launchConferenceStartedRef = useRef(false)

  const derivedCategories = useMemo(() => {
    const map = new Map<string, RoomCategoryOption>()
    for (const room of rooms) {
      if (!room.categoryId) continue
      map.set(room.categoryId, {
        id: room.categoryId,
        name: room.categoryName || 'General',
        icon: room.categoryIcon || '#',
      })
    }
    return Array.from(map.values())
  }, [rooms])

  const categoryOptions = categories.length > 0 ? categories : derivedCategories
  const categoryById = useMemo(
    () => new Map(categoryOptions.map((item) => [item.id, item])),
    [categoryOptions],
  )

  useEffect(() => {
    const loadVersions = async () => {
      if (!window.electronAPI?.getVersions) return
      const versions = await window.electronAPI.getVersions()
      setRuntimeVersion(versions.app ? `v${versions.app}` : `Electron ${versions.electron}`)
    }
    void loadVersions()
  }, [])

  useEffect(() => {
    const api = window.electronAPI
    if (!api) return
    const unsubs = [
      api.onUpdateAvailable?.((info: { version: string }) =>
        setUpdateState({ phase: 'available', version: info.version }),
      ),
      api.onDownloadProgress?.((p: { percent: number }) =>
        setUpdateState({ phase: 'downloading', percent: Math.floor(p.percent) }),
      ),
      api.onUpdateDownloaded?.((info: { version: string }) =>
        setUpdateState({ phase: 'ready', version: info.version }),
      ),
    ]
    return () => { unsubs.forEach((fn) => fn?.()) }
  }, [])

  useEffect(() => {
    const storedProfile = parseStoredProfile()
    if (storedProfile) {
      setAuthProfile(storedProfile)
    }
  }, [])

  const loadRoomsSnapshot = async () => {
    const [roomsResult, myRoomsResult] = await Promise.allSettled([
      listRooms({ offset: 0, limit: 200 }),
      listMyRooms(),
    ])
    if (roomsResult.status === 'rejected' && myRoomsResult.status === 'rejected') {
      throw roomsResult.reason
    }
    const publicRooms = roomsResult.status === 'fulfilled' ? roomsResult.value.items : []
    const myRooms = myRoomsResult.status === 'fulfilled' ? myRoomsResult.value : []
    return {
      rooms: mergeRoomLists(myRooms, publicRooms),
      myRooms,
    }
  }

  const refreshRooms = async () => {
    const [roomsSnapshot, categoriesSnapshot] = await Promise.allSettled([
      loadRoomsSnapshot(),
      listRoomCategories(),
    ])

    if (roomsSnapshot.status === 'rejected') {
      throw roomsSnapshot.reason
    }

    setRooms(roomsSnapshot.value.rooms)
    setMyRooms(roomsSnapshot.value.myRooms)

    if (categoriesSnapshot.status === 'fulfilled') {
      setCategories(categoriesSnapshot.value)
    }

    return roomsSnapshot.value.rooms
  }

  const refreshFavorites = async () => {
    const favorites = await listFavoriteRooms()
    setFavoriteRoomIds(new Set(favorites.map((room: TalkRoom) => room.id)))
  }

  const fetchParticipants = async (room: TalkRoom, force = false): Promise<RoomParticipant[]> => {
    if (!force && participantsByRoom[room.id]) {
      return participantsByRoom[room.id]
    }

    setParticipantsLoading((prev) => ({
      ...prev,
      [room.id]: true,
    }))

    try {
      const participants = await listRoomUsers(room.roomName)
      setParticipantsByRoom((prev) => ({
        ...prev,
        [room.id]: participants,
      }))
      return participants
    } finally {
      setParticipantsLoading((prev) => ({
        ...prev,
        [room.id]: false,
      }))
    }
  }

  useEffect(() => {
    if (!authProfile) return

    let active = true

    const bootstrap = async () => {
      setRoomsLoading(true)
      setRoomsError('')
      setGlobalNotice('')

      try {
        const [categoriesResult, roomsResult, favoritesResult] = await Promise.allSettled([
          listRoomCategories(),
          loadRoomsSnapshot(),
          listFavoriteRooms(),
        ])

        if (!active) return

        if (categoriesResult.status === 'fulfilled') {
          setCategories(categoriesResult.value)
        } else {
          setCategories([])
        }

        if (roomsResult.status === 'fulfilled') {
          setRooms(roomsResult.value.rooms)
          setMyRooms(roomsResult.value.myRooms)
        } else {
          throw roomsResult.reason
        }

        if (favoritesResult.status === 'fulfilled') {
          setFavoriteRoomIds(new Set(favoritesResult.value.map((room: TalkRoom) => room.id)))
        } else {
          setFavoriteRoomIds(new Set())
        }
      } catch (error: any) {
        if (!active) return
        setRoomsError(getTalkspacesApiError(error))
        setRooms([])
        setMyRooms([])
      } finally {
        if (active) {
          setRoomsLoading(false)
        }
      }
    }

    void bootstrap()
    return () => {
      active = false
    }
  }, [authProfile])

  useEffect(() => {
    if (!authProfile) return
    if (page.key !== 'rooms') return

    const timer = window.setInterval(() => {
      void refreshRooms().catch(() => undefined)
    }, 5000)

    return () => {
      window.clearInterval(timer)
    }
  }, [authProfile, page.key])

  useEffect(() => {
    if (page.key === 'detail') {
      setPage({ key: 'rooms' })
      return
    }
    if (page.key === 'participants' && !isHostSpaceRole) {
      setPage({ key: 'rooms' })
      return
    }
    if (page.key === 'programs') {
      setPage({ key: 'rooms' })
      return
    }
    if (page.key === 'conference' && !rooms.some((room) => room.id === page.roomId)) {
      setPage({ key: 'rooms' })
    }
  }, [isHostSpaceRole, page, rooms])

  const selectedRoom = useMemo(() => {
    if (page.key !== 'detail' && page.key !== 'conference') return null
    return rooms.find((room) => room.id === page.roomId) ?? null
  }, [page, rooms])

  const participantsManageRooms = useMemo(
    () =>
      rooms.filter(
        (room) => room.hostId === profile.id || room.spaceRole === 'host' || room.spaceRole === 'co_host',
      ),
    [profile.id, rooms],
  )

  const participantsPageRoom = useMemo(
    () => participantsManageRooms.find((room) => room.id === participantsRoomId) ?? null,
    [participantsManageRooms, participantsRoomId],
  )
  const chatPageRoom = useMemo(() => rooms.find((room) => room.id === chatRoomId) ?? null, [chatRoomId, rooms])

  useEffect(() => {
    if (!participantsManageRooms.find((room) => room.id === participantsRoomId)) {
      setParticipantsRoomId(participantsManageRooms[0]?.id ?? '')
    }
  }, [participantsManageRooms, participantsRoomId])

  useEffect(() => {
    if (!rooms.find((room) => room.id === chatRoomId)) {
      setChatRoomId(rooms[0]?.id ?? '')
    }
  }, [chatRoomId, rooms])

  useEffect(() => {
    setInviteLookupUser(null)
    setInviteLookupLoading(false)
  }, [participantsRoomId])

  useEffect(() => {
    if (!authProfile) return
    const targets: TalkRoom[] = []
    if (selectedRoom) targets.push(selectedRoom)
    if (participantsPageRoom) targets.push(participantsPageRoom)

    for (const room of targets) {
      if (participantsByRoom[room.id] || participantsLoading[room.id]) continue
      void fetchParticipants(room).catch((error: any) => {
        setParticipantsNotice(getTalkspacesApiError(error))
      })
    }
  }, [authProfile, participantsByRoom, participantsLoading, participantsPageRoom, selectedRoom])

  useEffect(() => {
    if (!authProfile) return
    if (page.key !== 'conference') return

    const room = rooms.find((item) => item.id === page.roomId)
    if (!room) return

    let active = true
    const timer = window.setInterval(() => {
      if (!active) return
      void (async () => {
        const participants = await fetchParticipants(room, true)
        const me =
          participants?.find((participant) => participant.username === profile.username) ??
          participants?.find((participant) => participant.id === profile.id)

        if (!me) return

        if (page.audience && me.participantType === 'member') {
          await refreshConferenceToken(room.id)
          if (!active) return
          setPage({ key: 'conference', roomId: room.id, audience: false })
          setGlobalNotice('You were approved as speaker. Mic/camera is now available.')
          return
        }

        if (!page.audience && me.participantType === 'audience') {
          if (!active) return
          setPage({ key: 'conference', roomId: room.id, audience: true })
        }
      })().catch(() => undefined)
    }, 5000)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [authProfile, page, profile.id, profile.username, rooms])

  const filteredRooms = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rooms.filter((room) => {
      if (categoryFilter !== 'all' && room.categoryId !== categoryFilter) return false
      if (statusFilter !== 'all' && room.status !== statusFilter) return false
      if (!q) return true

      const categoryName = room.categoryName || categoryById.get(room.categoryId)?.name || ''
      const haystack = [room.title, room.description, categoryName, room.hostName, room.tags.join(' ')]
        .join(' ')
        .toLowerCase()

      return haystack.includes(q)
    })
  }, [categoryById, categoryFilter, rooms, search, statusFilter])

  const participantsPageList = useMemo(() => {
    if (!participantsPageRoom) return []
    const q = participantQuery.trim().toLowerCase()
    const participants = participantsByRoom[participantsPageRoom.id] ?? []
    if (!q) return participants
    return participants.filter((participant) => {
      const text = `${participant.name} ${participant.username} ${participant.role}`.toLowerCase()
      return text.includes(q)
    })
  }, [participantQuery, participantsByRoom, participantsPageRoom])

  const participantsRoomAll = useMemo(
    () => (participantsPageRoom ? participantsByRoom[participantsPageRoom.id] ?? [] : []),
    [participantsByRoom, participantsPageRoom],
  )

  const calendarDays = useMemo(() => {
    const start = calendarMonth.startOf('month').startOf('week')
    const end = calendarMonth.endOf('month').endOf('week')
    const days: dayjs.Dayjs[] = []
    let cursor = start
    while (cursor.isBefore(end) || cursor.isSame(end, 'day')) {
      days.push(cursor)
      cursor = cursor.add(1, 'day')
    }
    return days
  }, [calendarMonth])

  const scheduledByDay = useMemo(() => {
    const map = new Map<string, TalkRoom[]>()
    const monthStart = calendarMonth.startOf('month')
    const monthEnd = calendarMonth.endOf('month')

    for (const room of rooms) {
      if (!room.scheduledAt) continue
      const scheduled = dayjs(room.scheduledAt)
      if (!scheduled.isValid()) continue

      const pushDate = (date: dayjs.Dayjs) => {
        const key = date.format('YYYY-MM-DD')
        const list = map.get(key) ?? []
        list.push(room)
        list.sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? ''))
        map.set(key, list)
      }

      if (room.repeatWeekly) {
        let cursor = scheduled
        while (cursor.isBefore(monthStart, 'day')) {
          cursor = cursor.add(1, 'week')
        }
        while (!cursor.isAfter(monthEnd, 'day')) {
          pushDate(cursor)
          cursor = cursor.add(1, 'week')
        }
      } else if (!scheduled.isBefore(monthStart, 'day') && !scheduled.isAfter(monthEnd, 'day')) {
        pushDate(scheduled)
      }
    }

    return map
  }, [calendarMonth, rooms])

  const selectedDayEvents = useMemo(
    () => scheduledByDay.get(calendarSelectedDay) ?? [],
    [calendarSelectedDay, scheduledByDay],
  )

  const persistAuthProfile = (nextProfile: UserProfile | null) => {
    if (typeof window === 'undefined') return
    if (!nextProfile) {
      window.localStorage.removeItem(AUTH_PROFILE_KEY)
      return
    }
    window.localStorage.setItem(AUTH_PROFILE_KEY, JSON.stringify(nextProfile))
  }

  const handleAuthenticated = (nextProfile: UserProfile) => {
    setAuthProfile(nextProfile)
    persistAuthProfile(nextProfile)
    setPage({ key: 'rooms' })
  }

  const handleSignout = async () => {
    try {
      await logoutAccount()
    } catch {
      // ignore logout failure and still clear local session
    }

    setAuthProfile(null)
    persistAuthProfile(null)
    setPage({ key: 'rooms' })
    setCreateOpen(false)
    setRooms([])
    setParticipantsByRoom({})
    setJoinedRoomIds(new Set())
    setFavoriteRoomIds(new Set())
    setChatByRoom({})
    setConferenceSessionByRoom({})
    setRoomsError('')
    setGlobalNotice('')
  }

  const createRoom = async (payload: CreateRoomInput) => {
    try {
      setRoomsError('')

      const scheduledAt = payload.scheduledAt ? dayjs(payload.scheduledAt).toISOString() : undefined
      const createdRoom = await createRoomApi({
        title: payload.title,
        description: payload.description,
        categoryId: payload.categoryId || undefined,
        maxParticipants: payload.maxParticipants,
        isPrivate: payload.isPrivate,
        audienceEnabled: payload.isPrivate ? payload.audienceEnabled : false,
        tagSlugs: payload.tags,
        scheduledAt,
        repeatWeekly: Boolean(scheduledAt && payload.repeatWeekly),
      })

      setRooms((prev) => mergeRoomLists([createdRoom], prev))
      setCreateOpen(false)
      setPage({ key: 'rooms' })
      setGlobalNotice('Room created successfully.')
      return null
    } catch (error: any) {
      return getTalkspacesApiError(error)
    }
  }

  const updateRoom = async (roomId: string, payload: CreateRoomInput) => {
    try {
      setRoomsError('')

      const scheduledAt = payload.scheduledAt ? dayjs(payload.scheduledAt).toISOString() : undefined
      const updatedRoom = await updateRoomApi(roomId, {
        title: payload.title,
        description: payload.description,
        categoryId: payload.categoryId || undefined,
        maxParticipants: payload.maxParticipants,
        isPrivate: payload.isPrivate,
        audienceEnabled: payload.isPrivate ? payload.audienceEnabled : false,
        tagSlugs: payload.tags,
        scheduledAt,
        repeatWeekly: Boolean(scheduledAt && payload.repeatWeekly),
      })

      setRooms((prev) => prev.map((room) => (room.id === roomId ? updatedRoom : room)))
      setMyRooms((prev) => prev.map((room) => (room.id === roomId ? updatedRoom : room)))
      setEditingRoom(null)
      setGlobalNotice('Room updated successfully.')
      return null
    } catch (error: any) {
      return getTalkspacesApiError(error)
    }
  }

  const openEditRoomModal = (roomId: string) => {
    const room = rooms.find((item) => item.id === roomId) ?? myRooms.find((item) => item.id === roomId)
    if (!room) {
      setGlobalNotice('Room not found.')
      return
    }
    setEditingRoom(room)
  }

  const editingRoomInitialValues = useMemo<Partial<CreateRoomInput> | undefined>(() => {
    if (!editingRoom) return undefined
    return {
      title: editingRoom.title,
      description: editingRoom.description || '',
      categoryId: editingRoom.categoryId || categoryOptions[0]?.id || '',
      maxParticipants: editingRoom.maxParticipants ?? 0,
      isPrivate: Boolean(editingRoom.isPrivate),
      audienceEnabled: Boolean(editingRoom.audienceEnabled),
      tags: editingRoom.tags || [],
      scheduledAt: editingRoom.scheduledAt ? dayjs(editingRoom.scheduledAt).format('YYYY-MM-DDTHH:mm') : '',
      repeatWeekly: Boolean(editingRoom.repeatWeekly),
    }
  }, [editingRoom, categoryOptions])

  const toggleFavorite = async (roomId: string) => {
    try {
      const isFavorite = favoriteRoomIds.has(roomId)
      if (isFavorite) {
        await unfavoriteRoomApi(roomId)
      } else {
        await favoriteRoomApi(roomId)
      }

      setFavoriteRoomIds((prev) => {
        const next = new Set(prev)
        if (isFavorite) {
          next.delete(roomId)
        } else {
          next.add(roomId)
        }
        return next
      })

      setGlobalNotice(isFavorite ? 'Removed from favorites.' : 'Added to favorites.')
      return null
    } catch (error: any) {
      return getTalkspacesApiError(error)
    }
  }

  const joinRoom = async (roomId: string, options: JoinRoomOptions): Promise<string | null> => {
    const room = rooms.find((item) => item.id === roomId)
    if (!room) return 'Room not found.'

    if (room.status === 'closed') {
      return 'This room is closed.'
    }

    if (room.status === 'scheduled' && isFuture(room.scheduledAt) && room.hostId !== profile.id) {
      return 'This room is not open yet.'
    }

    const alreadyJoined = joinedRoomIds.has(room.id)
    const wouldBeFull = room.maxParticipants > 0 && room.participantCount >= room.maxParticipants && !alreadyJoined

    if (wouldBeFull) {
      return 'Room is full.'
    }

    try {
      const prejoin = await getPrejoin(room.roomName)
      const resolvedParticipantType = prejoin.participantType
      const resolvedJoinAsAudience = prejoin.participantType === 'audience'

      // Keep parity with web flow: authenticated users always use /rooms/:roomName/token.
      const joinResponse = await getRoomToken(
        room.roomName,
        profile.name,
        resolvedJoinAsAudience || resolvedParticipantType === 'member'
          ? undefined
          : options.accessCode?.trim() || undefined,
      )

      if (!joinResponse.token) {
        return 'Unable to get room token.'
      }

      setConferenceSessionByRoom((prev) => ({
        ...prev,
        [room.id]: {
          token: joinResponse.token,
          livekitUrl: joinResponse.livekitUrl,
        },
      }))

      if (!alreadyJoined) {
        setJoinedRoomIds((prev) => {
          const next = new Set(prev)
          next.add(room.id)
          return next
        })
      }

      await fetchParticipants(room, true)

      setChatByRoom((prev) => {
        const current = prev[room.id] ?? []
        if (current.length > 0) return prev
        return {
          ...prev,
          [room.id]: [
            {
              id: makeId('chat'),
              roomId: room.id,
              sender: 'System',
              text: `Welcome to ${room.title}.`,
              time: new Date().toISOString(),
            },
          ],
        }
      })

      void refreshRooms().catch(() => undefined)
      setPage({ key: 'conference', roomId: room.id, audience: resolvedJoinAsAudience })
      return null
    } catch (error: any) {
      return getTalkspacesApiError(error)
    }
  }

  const runJoinWithPrejoin = async (
    roomId: string,
    options: JoinRoomOptions,
    prejoinSettings?: PrejoinDeviceSettings,
  ): Promise<string | null> => {
    const room = rooms.find((item) => item.id === roomId)
    if (!room) return 'Room not found.'

    let resolvedJoinAsAudience = options.joinAsAudience
    try {
      const prejoin = await getPrejoin(room.roomName)
      resolvedJoinAsAudience = prejoin.participantType === 'audience'
    } catch (error: any) {
      return getTalkspacesApiError(error)
    }

    const resolvedJoinRole: 'member' | 'listener' = resolvedJoinAsAudience ? 'listener' : 'member'
    const allowedJoinRoles: Array<'member' | 'listener'> = [resolvedJoinRole]

    if (prejoinSettings) {
      setPrejoinSettingsByRoom((prev) => ({
        ...prev,
        [roomId]: prejoinSettings,
      }))
    }

    if (window.electronAPI?.openPrejoinWindow) {
      try {
        const roomCategory = room.categoryName || categoryById.get(room.categoryId)?.name || 'General'
        const canManageAudience =
          room.hostId === profile.id ||
          room.spaceRole === 'host' ||
          room.spaceRole === 'co_host' ||
          profile.spaceRole === 'host' ||
          profile.spaceRole === 'admin'
        const cachedJoinRole = prejoinSettings?.joinRole || prejoinSettingsByRoom[roomId]?.joinRole
        const initialJoinRole =
          (cachedJoinRole === 'member' || cachedJoinRole === 'listener') &&
          allowedJoinRoles.includes(cachedJoinRole)
            ? cachedJoinRole
            : resolvedJoinRole
        const prejoinResult = await window.electronAPI.openPrejoinWindow({
          roomTitle: 'TalkSpace Prejoin',
          joinAsAudience: resolvedJoinAsAudience,
          canManageAudience,
          userInfo: {
            name: profile.name,
            username: profile.username,
            avatar: profile.avatar,
          },
          allowedJoinRoles,
          initialSettings: {
            ...(prejoinSettings || prejoinSettingsByRoom[roomId]),
            joinRole: initialJoinRole,
            audienceEnabled: room.audienceEnabled,
          },
          roomInfo: {
            title: room.title,
            category: roomCategory,
            status: room.status,
            hostName: room.hostName,
            description: room.description || '',
            participantCount: room.participantCount,
            maxParticipants: room.maxParticipants,
            isPrivate: room.isPrivate,
            audienceEnabled: room.audienceEnabled,
            scheduleLabel: formatSchedule(room.scheduledAt),
            roomName: room.roomName || room.id,
          },
        })
        if (!prejoinResult?.confirmed) {
          return null
        }

        const rawFinalPrejoinSettings = prejoinResult.settings as
          | (PrejoinDeviceSettings & { audienceEnabled?: boolean })
          | undefined
        const nextAudienceEnabled =
          typeof rawFinalPrejoinSettings?.audienceEnabled === 'boolean'
            ? rawFinalPrejoinSettings.audienceEnabled
            : undefined
        if (
          typeof nextAudienceEnabled === 'boolean' &&
          nextAudienceEnabled !== room.audienceEnabled
        ) {
          try {
            const updatedRoom = await updateRoomApi(roomId, {
              audienceEnabled: nextAudienceEnabled,
            })
            setRooms((prev) => prev.map((item) => (item.id === roomId ? updatedRoom : item)))
            setMyRooms((prev) => prev.map((item) => (item.id === roomId ? updatedRoom : item)))
          } catch (error: any) {
            return getTalkspacesApiError(error)
          }
        }

        const finalPrejoinSettings = rawFinalPrejoinSettings
          ? {
              micEnabled: Boolean(rawFinalPrejoinSettings.micEnabled),
              camEnabled: Boolean(rawFinalPrejoinSettings.camEnabled),
              backgroundMode: rawFinalPrejoinSettings.backgroundMode,
              microphoneDeviceId: rawFinalPrejoinSettings.microphoneDeviceId,
              speakerDeviceId: rawFinalPrejoinSettings.speakerDeviceId,
              cameraDeviceId: rawFinalPrejoinSettings.cameraDeviceId,
              joinRole: resolvedJoinRole,
            }
          : undefined

        if (finalPrejoinSettings) {
          setPrejoinSettingsByRoom((prev) => ({
            ...prev,
            [roomId]: finalPrejoinSettings,
          }))
        }

        if (window.electronAPI?.openConferenceWindow) {
          const openConferenceResult = await window.electronAPI.openConferenceWindow({
            roomId,
            roomTitle: `${room?.title || 'Room'} - ${profile.name}`,
            joinAsAudience: resolvedJoinAsAudience,
            prejoinSettings: finalPrejoinSettings,
          })
          if (!openConferenceResult?.success) {
            return openConferenceResult?.error || 'Unable to open Meeting window.'
          }
          return null
        }

        return joinRoom(roomId, {
          ...options,
          joinAsAudience: resolvedJoinAsAudience,
        })
      } catch (error: any) {
        return error?.message || 'Unable to open Prejoin window.'
      }
    }

    if (window.electronAPI?.openConferenceWindow) {
      try {
        const openConferenceResult = await window.electronAPI.openConferenceWindow({
          roomId,
          roomTitle: `${room?.title || 'Room'} - ${profile.name}`,
          joinAsAudience: resolvedJoinAsAudience,
          prejoinSettings,
        })
        if (!openConferenceResult?.success) {
          return openConferenceResult?.error || 'Unable to open Meeting window.'
        }
        return null
      } catch (error: any) {
        return error?.message || 'Unable to open Meeting window.'
      }
    }

    return joinRoom(roomId, {
      ...options,
      joinAsAudience: resolvedJoinAsAudience,
    })
  }

  const openRoomWindow = async (roomId: string) => {
    const result = await runJoinWithPrejoin(
      roomId,
      { joinAsAudience: false },
      prejoinSettingsByRoom[roomId],
    )
    if (result) {
      setGlobalNotice(result)
    }
  }

  useEffect(() => {
    if (!launchConferencePayload) return
    if (!authProfile) return
    if (launchConferenceStartedRef.current) return

    const targetRoom = rooms.find((item) => item.id === launchConferencePayload.roomId)
    if (!targetRoom) {
      if (roomsLoading || (!roomsError && rooms.length === 0)) {
        return
      }
      if (!roomsLoading) {
        setGlobalNotice('Room not found for conference window.')
        clearLaunchConferenceFromUrl()
        setLaunchConferencePayload(null)
      }
      return
    }

    launchConferenceStartedRef.current = true

    if (launchConferencePayload.prejoinSettings) {
      setPrejoinSettingsByRoom((prev) => ({
        ...prev,
        [targetRoom.id]: launchConferencePayload.prejoinSettings as PrejoinDeviceSettings,
      }))
    }

    void (async () => {
      const result = await joinRoom(targetRoom.id, {
        joinAsAudience: launchConferencePayload.joinAsAudience,
      })
      if (result) {
        setGlobalNotice(result)
      }
      clearLaunchConferenceFromUrl()
      setLaunchConferencePayload(null)
    })()
  }, [authProfile, launchConferencePayload, rooms, roomsLoading])

  const refreshConferenceToken = async (roomId: string) => {
    const room = rooms.find((item) => item.id === roomId)
    if (!room) return

    const joinResponse = await getRoomToken(room.roomName, profile.name)
    if (!joinResponse.token) return

    setConferenceSessionByRoom((prev) => ({
      ...prev,
      [room.id]: {
        token: joinResponse.token,
        livekitUrl: joinResponse.livekitUrl,
      },
    }))
  }

  const leaveRoom = async (roomId: string) => {
    const room = rooms.find((item) => item.id === roomId)

    if (room) {
      try {
        await leaveRoomApi(room.roomName)
      } catch {
        // continue leaving local UI even if network failed
      }
    }

    setJoinedRoomIds((prev) => {
      const next = new Set(prev)
      next.delete(roomId)
      return next
    })

    setConferenceSessionByRoom((prev) => {
      const next = { ...prev }
      delete next[roomId]
      return next
    })

    if (room) {
      try {
        await fetchParticipants(room, true)
      } catch {
        // ignore participant refresh failure
      }
    }

    void refreshRooms().catch(() => undefined)
    setPage({ key: 'rooms' })
  }

  const sendChat = (roomId: string, message: string) => {
    if (!message.trim()) return
    setChatByRoom((prev) => ({
      ...prev,
      [roomId]: [
        ...(prev[roomId] ?? []),
        {
          id: makeId('chat'),
          roomId,
          sender: profile.name,
          text: message.trim(),
          time: new Date().toISOString(),
        },
      ],
    }))
  }

  const addParticipant = async (roomId: string, name: string, role: ParticipantRole) => {
    const room = rooms.find((item) => item.id === roomId)
    if (!room) {
      setParticipantsNotice('Room not found.')
      return false
    }

    const normalized = slugify(name.replace(/^@/, ''))
    if (!normalized) {
      setParticipantsNotice('ID is required.')
      return false
    }

    try {
      if (role === 'co_host') {
        await assignRoomCoHost(room.roomName, normalized)
      } else if (role === 'audience') {
        await assignRoomMember(room.roomName, normalized)
        await demoteRoomUserToAudience(room.roomName, normalized)
      } else {
        await assignRoomMember(room.roomName, normalized)
      }

      await fetchParticipants(room, true)
      await refreshRooms()
      setParticipantsNotice(`Added @${normalized} as ${roleLabel[role]}.`)
      return true
    } catch (error: any) {
      setParticipantsNotice(getTalkspacesApiError(error))
      return false
    }
  }

  const lookupInviteUser = async (nameOrId: string) => {
    const normalized = nameOrId.trim()
    if (!normalized) {
      setParticipantsNotice('ID is required.')
      setInviteLookupUser(null)
      return
    }

    setInviteLookupLoading(true)
    try {
      const user = await findUserForInvite(normalized)
      setInviteLookupUser(user)
      setParticipantsNotice('')
    } catch (error: any) {
      setInviteLookupUser(null)
      setParticipantsNotice(getTalkspacesApiError(error))
    } finally {
      setInviteLookupLoading(false)
    }
  }

  const updateParticipantRole = async (
    roomId: string,
    participantId: string,
    nextRole: ParticipantRole,
  ) => {
    const room = rooms.find((item) => item.id === roomId)
    const participant = (participantsByRoom[roomId] ?? []).find((item) => item.id === participantId)

    if (!room || !participant) {
      setParticipantsNotice('Participant not found.')
      return
    }

    if (!participant.username) {
      setParticipantsNotice('Cannot update role for this participant.')
      return
    }

    try {
      if (nextRole === 'co_host') {
        await assignRoomCoHost(room.roomName, participant.username)
      } else if (nextRole === 'audience') {
        await demoteRoomUserToAudience(room.roomName, participant.username)
      } else {
        await assignRoomMember(room.roomName, participant.username)
      }

      await fetchParticipants(room, true)
      setParticipantsNotice(`Updated @${participant.username} to ${roleLabel[nextRole]}.`)
    } catch (error: any) {
      setParticipantsNotice(getTalkspacesApiError(error))
    }
  }

  const saveSettings = async (next: UserProfile) => {
    try {
      const response = await updateProfileSettings(profile.username, {
        name: next.name,
        username: next.username,
        avatar: next.avatar,
      })

      const nextProfile = response.profile ?? next
      setAuthProfile(nextProfile)
      persistAuthProfile(nextProfile)
      setGlobalNotice('Profile updated.')
      return null
    } catch (error: any) {
      return getTalkspacesApiError(error)
    }
  }

  const submitHostRequestFromPrograms = async (payload: {
    reason: string
    experience?: string
    socialLinks?: string
  }) => {
    try {
      await submitHostRequest(payload)
      return null
    } catch (error: any) {
      return getTalkspacesApiError(error)
    }
  }

  const requestSpeaker = async (roomId: string) => {
    try {
      await submitSpeakerRequest(roomId, 'Request from desktop app')
      return null
    } catch (error: any) {
      return getTalkspacesApiError(error)
    }
  }

  const openSelectedRoom = async () => {
    if (!selectedRoom) return 'Room not found.'

    try {
      const updated = await openRoomApi(selectedRoom.id)
      setRooms((prev) => prev.map((room) => (room.id === selectedRoom.id ? updated : room)))
      setMyRooms((prev) => prev.map((room) => (room.id === selectedRoom.id ? updated : room)))
      setGlobalNotice('')
      return null
    } catch (error: any) {
      return getTalkspacesApiError(error)
    }
  }

  const closeSelectedRoom = async () => {
    if (!selectedRoom) return 'Room not found.'

    try {
      await closeRoomApi(selectedRoom.id)
      setRooms((prev) =>
        prev.map((room) => (room.id === selectedRoom.id ? { ...room, status: 'closed' } : room)),
      )
      setMyRooms((prev) =>
        prev.map((room) => (room.id === selectedRoom.id ? { ...room, status: 'closed' } : room)),
      )
      setGlobalNotice('')
      return null
    } catch (error: any) {
      return getTalkspacesApiError(error)
    }
  }

  const deleteSelectedRoom = async () => {
    if (!selectedRoom) return 'Room not found.'

    try {
      await deleteRoomApi(selectedRoom.id)
      setRooms((prev) => prev.filter((room) => room.id !== selectedRoom.id))
      setMyRooms((prev) => prev.filter((room) => room.id !== selectedRoom.id))
      setParticipantsByRoom((prev) => {
        const next = { ...prev }
        delete next[selectedRoom.id]
        return next
      })
      setConferenceSessionByRoom((prev) => {
        const next = { ...prev }
        delete next[selectedRoom.id]
        return next
      })
      setPage({ key: 'rooms' })
      setGlobalNotice('')
      return null
    } catch (error: any) {
      return getTalkspacesApiError(error)
    }
  }

  const renderMain = () => {
    if (page.key === 'conference' && selectedRoom) {
      return (
        <ConferenceView
          room={selectedRoom}
          chat={chatByRoom[selectedRoom.id] ?? []}
          currentUser={profile}
          participants={participantsByRoom[selectedRoom.id] ?? []}
          token={conferenceSessionByRoom[selectedRoom.id]?.token}
          livekitUrl={conferenceSessionByRoom[selectedRoom.id]?.livekitUrl}
          audience={page.audience}
          prejoinSettings={prejoinSettingsByRoom[selectedRoom.id]}
          canManageSpeakerRequests={
            selectedRoom.hostId === profile.id ||
            selectedRoom.spaceRole === 'host' ||
            selectedRoom.spaceRole === 'co_host' ||
            profile.spaceRole === 'admin' ||
            profile.spaceRole === 'host'
          }
          onLeave={() => {
            void (async () => {
              await leaveRoom(selectedRoom.id)
              if (isConferenceLaunchWindow && window.electronAPI?.closeCurrentWindow) {
                await window.electronAPI.closeCurrentWindow()
              }
            })()
          }}
          onSendChat={(text) => sendChat(selectedRoom.id, text)}
          onRequestSpeaker={async () => requestSpeaker(selectedRoom.id)}
        />
      )
    }

    if (page.key === 'calendar') {
      return (
        <CalendarView
          rooms={rooms}
          currentUserId={profile.id}
          month={calendarMonth}
          selectedDay={calendarSelectedDay}
          days={calendarDays}
          scheduledByDay={scheduledByDay}
          selectedDayEvents={selectedDayEvents}
          onMonthChange={setCalendarMonth}
          onSelectDay={setCalendarSelectedDay}
          onOpenRoom={(roomId) => {
            void openRoomWindow(roomId)
          }}
          onCreateRoom={() => setCreateOpen(true)}
          onEditRoom={openEditRoomModal}
          onReopenRoom={async (roomId) => {
            try {
              const updated = await openRoomApi(roomId)
              setRooms((prev) => prev.map((room) => (room.id === roomId ? updated : room)))
              setMyRooms((prev) => prev.map((room) => (room.id === roomId ? updated : room)))
              setGlobalNotice('')
              return null
            } catch (error: any) {
              return getTalkspacesApiError(error)
            }
          }}
          onDeleteRoom={async (roomId) => {
            try {
              await deleteRoomApi(roomId)
              setRooms((prev) => prev.filter((room) => room.id !== roomId))
              setMyRooms((prev) => prev.filter((room) => room.id !== roomId))
              setParticipantsByRoom((prev) => {
                const next = { ...prev }
                delete next[roomId]
                return next
              })
              setConferenceSessionByRoom((prev) => {
                const next = { ...prev }
                delete next[roomId]
                return next
              })
              setGlobalNotice('')
              return null
            } catch (error: any) {
              return getTalkspacesApiError(error)
            }
          }}
        />
      )
    }

    if (page.key === 'chat') {
      return (
        <RoomChatView
          rooms={rooms}
          room={chatPageRoom}
          roomId={chatRoomId}
          currentUser={profile}
          chat={chatPageRoom ? chatByRoom[chatPageRoom.id] ?? [] : []}
          onRoomChange={setChatRoomId}
          onSendChat={(text) => {
            if (!chatPageRoom) return
            sendChat(chatPageRoom.id, text)
          }}
        />
      )
    }

    if (page.key === 'participants' && isHostSpaceRole) {
      return (
        <ParticipantsView
          rooms={participantsManageRooms}
          room={participantsPageRoom}
          currentUserId={profile.id}
          roomId={participantsRoomId}
          participants={participantsPageList}
          allParticipants={participantsRoomAll}
          loading={participantsPageRoom ? Boolean(participantsLoading[participantsPageRoom.id]) : false}
          query={participantQuery}
          inviteName={inviteName}
          inviteLookupUser={inviteLookupUser}
          inviteLookupLoading={inviteLookupLoading}
          notice={participantsNotice}
          onRoomChange={(value) => setParticipantsRoomId(value)}
          onQueryChange={setParticipantQuery}
          onInviteNameChange={(value) => {
            setInviteName(value)
            setInviteLookupUser(null)
          }}
          onFindInviteUser={() => void lookupInviteUser(inviteName)}
          onInviteAsRole={async (role) => {
            if (!participantsPageRoom) return
            const selectedUsername = inviteLookupUser?.username || inviteName
            const success = await addParticipant(participantsPageRoom.id, selectedUsername, role)
            if (success) {
              setInviteName('')
              setInviteLookupUser(null)
            }
          }}
          onPromote={(participant) => {
            if (!participantsPageRoom) return
            void updateParticipantRole(participantsPageRoom.id, participant.id, 'member')
          }}
          onCoHost={(participant) => {
            if (!participantsPageRoom) return
            void updateParticipantRole(participantsPageRoom.id, participant.id, 'co_host')
          }}
          onAudience={(participant) => {
            if (!participantsPageRoom) return
            void updateParticipantRole(participantsPageRoom.id, participant.id, 'audience')
          }}
        />
      )
    }

    if (page.key === 'programs') {
      return <ProgramsView onSubmitHostRequest={submitHostRequestFromPrograms} />
    }

    if (page.key === 'recordings') {
      return <RecordingsView currentUserId={profile.id} />
    }

    if (page.key === 'settings') {
      return <SettingsView profile={profile} onSave={saveSettings} />
    }

    return (
      <RoomsView
        rooms={filteredRooms}
        allRooms={rooms}
        myRooms={myRooms}
        currentUserId={profile.id}
        categories={categories}
        favoriteRoomIds={favoriteRoomIds}
        loading={roomsLoading}
        error={roomsError}
        total={rooms.length}
        search={search}
        categoryFilter={categoryFilter}
        statusFilter={statusFilter}
        onSearchChange={setSearch}
        onCategoryFilterChange={setCategoryFilter}
        onStatusFilterChange={setStatusFilter}
        onToggleFavorite={(roomId) => {
          void toggleFavorite(roomId)
        }}
        onRetry={() => {
          setRoomsLoading(true)
          setRoomsError('')
          void Promise.all([refreshRooms(), refreshFavorites().catch(() => undefined)])
            .catch((error: any) => {
              setRoomsError(getTalkspacesApiError(error))
            })
            .finally(() => {
              setRoomsLoading(false)
            })
        }}
        onOpenRoom={(roomId) => {
          void openRoomWindow(roomId)
        }}
        onEditRoom={openEditRoomModal}
        onReopenRoom={async (roomId) => {
          try {
            const updated = await openRoomApi(roomId)
            setRooms((prev) => prev.map((room) => (room.id === roomId ? updated : room)))
            setMyRooms((prev) => prev.map((room) => (room.id === roomId ? updated : room)))
            setGlobalNotice('')
            return null
          } catch (error: any) {
            return getTalkspacesApiError(error)
          }
        }}
        onCloseRoom={async (roomId) => {
          try {
            await closeRoomApi(roomId)
            setRooms((prev) => prev.map((room) => (room.id === roomId ? { ...room, status: 'closed' } : room)))
            setMyRooms((prev) => prev.map((room) => (room.id === roomId ? { ...room, status: 'closed' } : room)))
            setGlobalNotice('')
            return null
          } catch (error: any) {
            return getTalkspacesApiError(error)
          }
        }}
        onDeleteRoom={async (roomId) => {
          try {
            await deleteRoomApi(roomId)
            setRooms((prev) => prev.filter((room) => room.id !== roomId))
            setMyRooms((prev) => prev.filter((room) => room.id !== roomId))
            setParticipantsByRoom((prev) => {
              const next = { ...prev }
              delete next[roomId]
              return next
            })
            setConferenceSessionByRoom((prev) => {
              const next = { ...prev }
              delete next[roomId]
              return next
            })
            setGlobalNotice('')
            return null
          } catch (error: any) {
            return getTalkspacesApiError(error)
          }
        }}
        onCreateRoom={() => setCreateOpen(true)}
      />
    )
  }

  if (!authProfile) {
    return <AuthScreen onAuthenticated={handleAuthenticated} />
  }

  if (isConferenceLaunchWindow) {
    const isConferenceReady = page.key === 'conference' && Boolean(selectedRoom)

    return (
      <div className="conference-window-root">
        {isConferenceReady ? (
          <section className="conference-window-main">{renderMain()}</section>
        ) : (
          <section className="conference-window-placeholder">
            <h2>Opening meeting...</h2>
            {roomsError && <div className="error">{roomsError}</div>}
            {globalNotice && <div className="notice">{globalNotice}</div>}
          </section>
        )}
      </div>
    )
  }

  const pageLabel =
    page.key === 'conference' ? 'Conference' : page.key.charAt(0).toUpperCase() + page.key.slice(1)
  const isImmersivePage = page.key === 'conference'
  const isChatPage = page.key === 'chat'
  const isCalendarPage = page.key === 'calendar'

  return (
    <div className="main-window-root">
      <MainTitlebar />
      <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">TS</div>
          <div>
            <div className="brand-title">TalkSpace Desktop</div>
            {runtimeVersion && <div className="brand-subtitle">{runtimeVersion}</div>}
          </div>
        </div>
        {updateState.phase !== 'idle' && (
          <div className={`update-banner${updateState.phase === 'ready' ? ' update-banner--ready' : updateState.phase === 'error' ? ' update-banner--error' : ''}`}>
            {updateState.phase === 'available' && (
              <>
                <div className="update-banner__text">Có phiên bản mới <strong>v{updateState.version}</strong></div>
                <div className="update-banner__actions">
                  <button className="update-banner__btn" onClick={() => window.electronAPI?.downloadUpdate?.()}>Cập nhật</button>
                  <button className="update-banner__btn update-banner__btn--dismiss" onClick={() => setUpdateState({ phase: 'idle' })}>Bỏ qua</button>
                </div>
              </>
            )}
            {updateState.phase === 'downloading' && (
              <>
                <div className="update-banner__text">Đang tải... {updateState.percent}%</div>
                <div className="update-banner__progress">
                  <div className="update-banner__progress-fill" style={{ width: `${updateState.percent}%` }} />
                </div>
              </>
            )}
            {updateState.phase === 'ready' && (
              <>
                <div className="update-banner__text">Sẵn sàng cài đặt <strong>v{updateState.version}</strong></div>
                <div className="update-banner__actions">
                  <button className="update-banner__btn" onClick={() => window.electronAPI?.quitAndInstall?.()}>Khởi động lại</button>
                </div>
              </>
            )}
            {updateState.phase === 'error' && (
              <div className="update-banner__text">Lỗi cập nhật: {updateState.message}</div>
            )}
          </div>
        )}
        <nav className="menu">
          {[
            { key: 'rooms', label: 'Rooms' },
            { key: 'calendar', label: 'Calendar' },
            { key: 'chat', label: 'Chat' },
            ...(isHostSpaceRole ? [{ key: 'participants', label: 'Participants' }] : []),
            { key: 'recordings', label: 'Recordings' },
          ].map((item) => (
            <button
              key={item.key}
              className={`menu-item ${page.key === item.key ? 'active' : ''}`}
              onClick={() => setPage({ key: item.key as AppPage['key'] } as AppPage)}
              title={item.label}
              aria-label={item.label}
            >
              <span className="menu-icon">
                <SidebarNavIcon id={item.key as SidebarNavKey} />
              </span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-profile">
          <button
            type="button"
            className="sidebar-avatar-trigger"
            onClick={() => setPage({ key: 'settings' })}
            title="Open settings"
            aria-label="Open settings"
          >
            <div className="avatar">
              {profile.avatar ? (
                <img src={profile.avatar} alt={profile.name} className="avatar-image" />
              ) : (
                profile.name.slice(0, 1).toUpperCase()
              )}
            </div>
          </button>
          <div className="profile-meta">
            <div className="profile-name">{profile.name}</div>
            <div className="profile-role">{roleLabelForSpaceRole[profile.spaceRole]}</div>
          </div>
          <button className="ghost-button sidebar-logout" onClick={handleSignout}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="main-content">
        {/* <header className="main-header">
          <div>
            <h1>{pageLabel}</h1>
            <p>Desktop meetings synced with VXSpace web services.</p>
          </div>
          {roomsError && <div className="error">{roomsError}</div>}
          {globalNotice && <div className="notice">{globalNotice}</div>}
        </header> */}
        <section
          className={`main-section ${isImmersivePage ? 'main-section-immersive' : ''} ${isChatPage ? 'main-section-chat' : ''} ${isCalendarPage ? 'main-section-calendar' : ''}`}
        >
          {renderMain()}
        </section>
      </main>

      {createOpen && (
        <CreateRoomModal
          categories={categoryOptions}
          onCancel={() => setCreateOpen(false)}
          onCreate={createRoom}
        />
      )}

      {editingRoom && (
        <CreateRoomModal
          categories={categoryOptions}
          onCancel={() => setEditingRoom(null)}
          onCreate={(payload) => updateRoom(editingRoom.id, payload)}
          titleText="Edit room"
          submitLabel="Save changes"
          initialValues={editingRoomInitialValues}
        />
      )}

    </div>
    </div>
  )
}

const parseLaunchConferenceFromUrl = (): LaunchConferencePayload | null => {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  if (params.get('launchMode') !== 'conference') return null

  const roomId = params.get('roomId')?.trim()
  if (!roomId) return null

  const joinAsAudience = params.get('audience') === '1'
  const rawPrejoin = params.get('prejoin')
  if (!rawPrejoin) {
    return {
      roomId,
      joinAsAudience,
    }
  }

  try {
    const parsed = JSON.parse(rawPrejoin) as Partial<PrejoinDeviceSettings>
    const normalizedBackgroundMode =
      parsed.backgroundMode === 'none' ||
      parsed.backgroundMode === 'blur' ||
      parsed.backgroundMode === 'nature' ||
      parsed.backgroundMode === 'office'
        ? parsed.backgroundMode
        : parsed.backgroundMode === 'dim'
          ? 'office'
        : 'none'
    const prejoinSettings: PrejoinDeviceSettings = {
      micEnabled: Boolean(parsed.micEnabled),
      camEnabled: Boolean(parsed.camEnabled),
      backgroundMode: normalizedBackgroundMode,
      microphoneDeviceId:
        typeof parsed.microphoneDeviceId === 'string' && parsed.microphoneDeviceId.trim()
          ? parsed.microphoneDeviceId
          : undefined,
      speakerDeviceId:
        typeof parsed.speakerDeviceId === 'string' && parsed.speakerDeviceId.trim()
          ? parsed.speakerDeviceId
          : undefined,
      cameraDeviceId:
        typeof parsed.cameraDeviceId === 'string' && parsed.cameraDeviceId.trim()
          ? parsed.cameraDeviceId
          : undefined,
      joinRole:
        parsed.joinRole === 'member' ||
        parsed.joinRole === 'listener' ||
        parsed.joinRole === 'host' ||
        parsed.joinRole === 'co_host'
          ? parsed.joinRole
          : undefined,
    }
    return {
      roomId,
      joinAsAudience,
      prejoinSettings,
    }
  } catch {
    return {
      roomId,
      joinAsAudience,
    }
  }
}

const clearLaunchConferenceFromUrl = () => {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.delete('launchMode')
  url.searchParams.delete('roomId')
  url.searchParams.delete('audience')
  url.searchParams.delete('prejoin')
  const nextUrl = `${url.pathname}${url.search}${url.hash}`
  window.history.replaceState(null, '', nextUrl || '/')
}

function RoomsView({
  rooms,
  allRooms,
  myRooms,
  currentUserId,
  categories,
  favoriteRoomIds,
  loading,
  error,
  total,
  search,
  categoryFilter,
  statusFilter,
  onSearchChange,
  onCategoryFilterChange,
  onStatusFilterChange,
  onToggleFavorite,
  onRetry,
  onOpenRoom,
  onEditRoom,
  onReopenRoom,
  onCloseRoom,
  onDeleteRoom,
  onCreateRoom,
}: {
  rooms: TalkRoom[]
  allRooms: TalkRoom[]
  myRooms: TalkRoom[]
  currentUserId: string
  categories: RoomCategoryOption[]
  favoriteRoomIds: Set<string>
  loading: boolean
  error: string
  total: number
  search: string
  categoryFilter: string
  statusFilter: 'all' | RoomStatus
  onSearchChange: (value: string) => void
  onCategoryFilterChange: (value: string) => void
  onStatusFilterChange: (value: 'all' | RoomStatus) => void
  onToggleFavorite: (roomId: string) => void
  onRetry: () => void
  onOpenRoom: (roomId: string) => void
  onEditRoom: (roomId: string) => void
  onReopenRoom: (roomId: string) => Promise<string | null>
  onCloseRoom: (roomId: string) => Promise<string | null>
  onDeleteRoom: (roomId: string) => Promise<string | null>
  onCreateRoom: () => void
}) {
  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  )
  const openRooms = useMemo(() => allRooms.filter((room) => room.status === 'open'), [allRooms])
  const visibleOpenRooms = useMemo(() => rooms.filter((room) => room.status === 'open'), [rooms])
  const [myRoomsDrawerOpen, setMyRoomsDrawerOpen] = useState(false)
  const [myRoomsSearch, setMyRoomsSearch] = useState('')
  const drawerSearchQuery = myRoomsSearch.trim().toLowerCase()
  const matchesDrawerQuery = (room: TalkRoom) => {
    if (!drawerSearchQuery) return true
    const category = categoryById.get(room.categoryId)
    const haystack = [
      room.title,
      room.hostName,
      room.hostUsername,
      room.categoryName,
      category?.name,
      ...room.tags,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return haystack.includes(drawerSearchQuery)
  }
  const sortRoomsByStatusAndName = (list: TalkRoom[]) =>
    [...list].sort((left, right) => {
      const statusDiff = roomStatusWeight[left.status] - roomStatusWeight[right.status]
      if (statusDiff !== 0) return statusDiff
      return left.title.localeCompare(right.title)
    })
  const drawerRoomPool = useMemo(() => mergeRoomLists(myRooms, allRooms), [allRooms, myRooms])
  const favoriteRooms = useMemo(
    () => sortRoomsByStatusAndName(drawerRoomPool.filter((room) => favoriteRoomIds.has(room.id)).filter(matchesDrawerQuery)),
    [drawerRoomPool, favoriteRoomIds, drawerSearchQuery, categoryById],
  )
  const ownedRooms = useMemo(
    () => sortRoomsByStatusAndName(myRooms.filter((room) => room.hostId === currentUserId).filter(matchesDrawerQuery)),
    [currentUserId, myRooms, drawerSearchQuery, categoryById],
  )
  const memberRooms = useMemo(
    () => sortRoomsByStatusAndName(myRooms.filter((room) => room.hostId !== currentUserId).filter(matchesDrawerQuery)),
    [currentUserId, myRooms, drawerSearchQuery, categoryById],
  )
  const drawerHasNoResults =
    favoriteRooms.length === 0 &&
    ownedRooms.length === 0 &&
    memberRooms.length === 0 &&
    drawerSearchQuery.length > 0
  const [drawerActionLoadingId, setDrawerActionLoadingId] = useState<string | null>(null)
  const [drawerActionError, setDrawerActionError] = useState('')

  const runDrawerAction = async (actionId: string, action: () => Promise<string | null>) => {
    if (drawerActionLoadingId) return
    setDrawerActionLoadingId(actionId)
    setDrawerActionError('')
    const result = await action()
    if (result) {
      setDrawerActionError(result)
    }
    setDrawerActionLoadingId(null)
  }
  const formatDrawerRoomTime = (room: TalkRoom) => {
    if (room.status === 'open' && room.startedAt) return `Opened ${dayjs(room.startedAt).fromNow()}`
    if (room.status === 'scheduled' && room.scheduledAt) return `Starts ${dayjs(room.scheduledAt).fromNow()}`
    if (room.status === 'closed' && room.endedAt) return `Closed ${dayjs(room.endedAt).fromNow()}`
    return 'No activity'
  }
  const categoryChips = useMemo(() => {
    const base = categories.filter((category) => Boolean(category.id))
    return base
  }, [categories])
  const getRoomCategoryLabel = (room: TalkRoom) =>
    categoryById.get(room.categoryId)?.name?.trim() || room.categoryName?.trim() || 'General'

  const renderDrawerRoomItem = (room: TalkRoom, mode: 'owner' | 'member' | 'favorite') => {
    const isRoomActionLoading = drawerActionLoadingId?.startsWith(`${room.id}:`) ?? false
    const canManageRoom = mode === 'owner' || room.spaceRole === 'co_host' || room.spaceRole === 'host'
    const roomRole = resolveRoomMembershipRole(room, currentUserId)

    return (
      <article key={`${mode}:${room.id}`} className="rooms-myrooms-item" onClick={() => onOpenRoom(room.id)}>
        <div className="rooms-myrooms-item-top">
          <div className="rooms-myrooms-item-title-wrap">
            <span className="rooms-myrooms-item-thumb">
              {room.thumbnail ? (
                <img src={room.thumbnail} alt={room.title} className="rooms-myrooms-item-thumb-image" />
              ) : (
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M12 4.5v9M8.5 8a3.5 3.5 0 1 1 7 0v5.5a3.5 3.5 0 1 1-7 0z" />
                  <path d="M6.5 11.5v1.5a5.5 5.5 0 1 0 11 0v-1.5M12 18.5v2.5M9.5 21h5" />
                </svg>
              )}
            </span>
            <span className="rooms-myrooms-item-title-text">
              <strong>{room.title}</strong>
              <small>{getRoomCategoryLabel(room)}</small>
            </span>
          </div>
          <span className={`rooms-myrooms-role-badge rooms-myrooms-role-${roomRole}`}>
            {roomMembershipRoleLabel[roomRole]}
          </span>
        </div>
        <div className="rooms-myrooms-item-meta">
          <span className="rooms-myrooms-item-meta-entry">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.9">
              <path d="M16 19v-1.2a3.3 3.3 0 0 0-3.3-3.3H7.3A3.3 3.3 0 0 0 4 17.8V19" />
              <circle cx="10" cy="8" r="3.1" />
              <path d="M19.8 19v-1a3 3 0 0 0-2.3-2.9M14.5 5.4a3 3 0 0 1 0 5.2" />
            </svg>
            <span>
            {room.participantCount}
            {room.maxParticipants > 0 ? `/${room.maxParticipants}` : '/-'} people
            </span>
          </span>
          <span className="rooms-myrooms-item-meta-entry">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.9">
              <circle cx="12" cy="12" r="8.2" />
              <path d="M12 7.5v5l3.3 2" />
            </svg>
            <span>{formatDrawerRoomTime(room)}</span>
          </span>
        </div>
        {canManageRoom && (
          <div className="rooms-myrooms-actions-row">
            <div className="rooms-myrooms-actions-main">
              <button
                className="rooms-myrooms-action-wide rooms-myrooms-action-edit"
                onClick={(event) => {
                  event.stopPropagation()
                  onEditRoom(room.id)
                }}
                type="button"
              >
                Edit room
              </button>
              {room.status === 'open' ? (
                <button
                  className="rooms-myrooms-action-wide rooms-myrooms-action-close"
                  disabled={isRoomActionLoading}
                  onClick={(event) => {
                    event.stopPropagation()
                    void runDrawerAction(`${room.id}:close`, () => onCloseRoom(room.id))
                  }}
                  type="button"
                >
                  Close room
                </button>
              ) : (
                <button
                  className="rooms-myrooms-action-wide rooms-myrooms-action-reopen"
                  disabled={isRoomActionLoading}
                  onClick={(event) => {
                    event.stopPropagation()
                    void runDrawerAction(`${room.id}:reopen`, () => onReopenRoom(room.id))
                  }}
                  type="button"
                >
                  Reopen room
                </button>
              )}
            </div>
            <button
              className="rooms-myrooms-action-btn rooms-myrooms-action-delete"
              disabled={isRoomActionLoading}
              onClick={(event) => {
                event.stopPropagation()
                if (!window.confirm(`Delete room "${room.title}"?`)) return
                void runDrawerAction(`${room.id}:delete`, () => onDeleteRoom(room.id))
              }}
              type="button"
              title="Delete room"
              aria-label={`Delete room ${room.title}`}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9">
                <path d="M4 7.5h16" />
                <path d="M9.5 3.5h5" />
                <rect x="6.5" y="7.5" width="11" height="13" rx="2" />
                <path d="M10 11v6M14 11v6" />
              </svg>
            </button>
          </div>
        )}
      </article>
    )
  }

  return (
    <div className="rooms-view">
      <div className="hero-card rooms-hero-card">
        <div>
          <p className="hero-eyebrow">
            <svg viewBox="64 64 896 896" focusable="false" data-icon="video-camera" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M912 302.3L784 376V224c0-35.3-28.7-64-64-64H128c-35.3 0-64 28.7-64 64v576c0 35.3 28.7 64 64 64h592c35.3 0 64-28.7 64-64V648l128 73.7c21.3 12.3 48-3.1 48-27.6V330c0-24.6-26.7-40-48-27.7zM712 792H136V232h576v560zm176-167l-104-59.8V458.9L888 399v226zM208 360h112c4.4 0 8-3.6 8-8v-48c0-4.4-3.6-8-8-8H208c-4.4 0-8 3.6-8 8v48c0 4.4 3.6 8 8 8z"></path></svg>
            
            <span className='livespace-text'>Live Space</span>
          </p>
          <h2><strong>TalkSpace</strong></h2>
          <p className="hero-subtitle">
            {openRooms.length} phong dang mo
          </p>
        </div>
        <button className="primary-button" onClick={onCreateRoom}>
          + Tao phong
        </button>
      </div>

      <div className="filters">
        <div className="rooms-search-row">
          <div className="rooms-search-shell">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9">
              <circle cx="11" cy="11" r="6.4" />
              <path d="M16 16 20 20" />
            </svg>
            <input
              className="input rooms-search-input"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Tim theo ten phong hoac danh muc..."
            />
          </div>
          <button
            className="ghost-button rooms-myrooms-trigger"
            onClick={() => setMyRoomsDrawerOpen(true)}
            type="button"
            title="Rooms"
            aria-label="Open my rooms"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M6.5 4.5v15M12 6.5v11M17.5 3.5v17" />
              <circle cx="6.5" cy="9" r="1.8" />
              <circle cx="12" cy="14.5" r="1.8" />
              <circle cx="17.5" cy="8" r="1.8" />
            </svg>
            <span className="rooms-myrooms-badge">{myRooms.length > 99 ? '99+' : myRooms.length}</span>
          </button>
        </div>
        <div className="rooms-category-row">
          <button
            className={`chip rooms-category-chip ${categoryFilter === 'all' ? 'rooms-category-chip-active' : ''}`}
            onClick={() => onCategoryFilterChange('all')}
            type="button"
          >
            Tat ca
          </button>
          {categoryChips.map((category) => (
            <button
              key={category.id}
              className={`chip rooms-category-chip ${categoryFilter === category.id ? 'rooms-category-chip-active' : ''}`}
              onClick={() => onCategoryFilterChange(category.id)}
              type="button"
            >
              {category.name}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="filters">
          <div className="error">{error}</div>
          <button className="ghost-button rooms-retry-button" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}

      <div className="room-grid">
        {loading && (
          <div className="empty-state">
            <h3>Loading rooms</h3>
            <p>Waiting for API response.</p>
          </div>
        )}

        {!loading && visibleOpenRooms.length === 0 && (
          <div className="empty-state">
            <h3>No open rooms</h3>
            <p>Try changing search keyword or create a new room.</p>
          </div>
        )}

        {!loading &&
          visibleOpenRooms.map((room) => {
            return (
              <article key={room.id} className="room-card" onClick={() => onOpenRoom(room.id)}>
                <div className="room-card-stage">
                  <span className={`room-stage-status room-stage-status-${room.status}`}>
                    <span className="room-stage-status-dot" />
                    {room.status === 'open' ? 'Dang mo' : room.status === 'scheduled' ? 'Sap mo' : 'Da dong'}
                  </span>
                  <div className="room-stage-icons">
                    {room.isPrivate && (
                      <span className="room-stage-icon" title="Private">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9">
                          <rect x="5.5" y="10.5" width="13" height="9" rx="2" />
                          <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
                        </svg>
                      </span>
                    )}
                    {room.audienceEnabled && (
                      <span className="room-stage-icon" title="Audience mode">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9">
                          <path d="M4.5 15.5a4 4 0 0 0 0-7M19.5 15.5a4 4 0 0 1 0-7M8 13.5a2.5 2.5 0 1 0 0-3M12 6.5v11" />
                        </svg>
                      </span>
                    )}
                  </div>
                  <div className="room-stage-center">
                    <div className="room-audio-visual" aria-hidden="true">
                      <span className="room-audio-pulse room-audio-pulse-1" />
                      <span className="room-audio-pulse room-audio-pulse-2" />
                      <span className="room-audio-pulse room-audio-pulse-3" />

                      <div className="room-audio-bars room-audio-bars-left">
                        <span className="room-audio-bar" />
                        <span className="room-audio-bar" />
                        <span className="room-audio-bar" />
                        <span className="room-audio-bar" />
                      </div>

                      <svg className="room-audio-mic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M12 3.5v9.2M8.6 7.8a3.4 3.4 0 1 1 6.8 0v4.9a3.4 3.4 0 1 1-6.8 0z" />
                        <path d="M6.5 11.8v1.3a5.5 5.5 0 1 0 11 0v-1.3M12 18.6v2.8M9.7 21.4h4.6" />
                      </svg>

                      <div className="room-audio-bars room-audio-bars-right">
                        <span className="room-audio-bar" />
                        <span className="room-audio-bar" />
                        <span className="room-audio-bar" />
                        <span className="room-audio-bar" />
                      </div>
                    </div>
                  </div>
                  <span className="room-stage-participants">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.9">
                      <path d="M16 19v-1.2a3.3 3.3 0 0 0-3.3-3.3H7.3A3.3 3.3 0 0 0 4 17.8V19" />
                      <circle cx="10" cy="8" r="3.1" />
                    </svg>
                    {room.participantCount}
                  </span>
                </div>
                <div className="room-card-body">
                  <span className="room-category-pill">{getRoomCategoryLabel(room)}</span>
                  <h3>{room.title}</h3>
                  <div className="room-host-row">
                    <span className="room-host-avatar">
                      {room.hostAvatar ? (
                        <img src={room.hostAvatar} alt={room.hostName} className="room-host-avatar-image" />
                      ) : (
                        (room.hostName || '?').slice(0, 1).toUpperCase()
                      )}
                    </span>
                    <span>{room.hostName}</span>
                  </div>
                </div>
              </article>
            )
          })}
      </div>

      {myRoomsDrawerOpen && (
        <>
          <button
            className="rooms-myrooms-backdrop"
            onClick={() => setMyRoomsDrawerOpen(false)}
            type="button"
            aria-label="Close my rooms drawer"
          />
          <aside className="rooms-myrooms-drawer" role="dialog" aria-label="My rooms">
            <div className="rooms-myrooms-drawer-head">
              <div className="rooms-myrooms-drawer-title">
                <span className="rooms-myrooms-drawer-mark" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.9">
                    <path d="M4 11.5 12 5l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-3.5V14h-6v6.5H5.5A1.5 1.5 0 0 1 4 19z" />
                  </svg>
                </span>
                <strong>Rooms</strong>
                {myRooms.length > 0 && <span className="rooms-myrooms-drawer-total">{myRooms.length}</span>}
              </div>
              <button
                className="ghost-button rooms-myrooms-close"
                onClick={() => setMyRoomsDrawerOpen(false)}
                type="button"
                aria-label="Close my rooms"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 6 18 18M18 6 6 18" />
                </svg>
              </button>
            </div>
            <div className="rooms-myrooms-search-box">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9">
                <circle cx="11" cy="11" r="6.4" />
                <path d="M16 16 20 20" />
              </svg>
              <input
                className="rooms-myrooms-search-input"
                value={myRoomsSearch}
                onChange={(event) => setMyRoomsSearch(event.target.value)}
                placeholder="Tim theo ten phong hoac danh muc..."
              />
              {myRoomsSearch && (
                <button
                  className="rooms-myrooms-search-clear"
                  onClick={() => setMyRoomsSearch('')}
                  type="button"
                  aria-label="Clear my rooms search"
                >
                  x
                </button>
              )}
            </div>
            <div className="rooms-myrooms-drawer-list">
              {drawerHasNoResults && (
                <div className="empty-state">
                  <h3>No matching rooms</h3>
                  <p>Try another keyword.</p>
                </div>
              )}
              {drawerActionError && <div className="error rooms-myrooms-action-error">{drawerActionError}</div>}
              <div className="rooms-myrooms-section-head">
                <span>Favorites</span>
                <span className="rooms-myrooms-section-count">{favoriteRooms.length}</span>
                <span className="rooms-myrooms-section-line" />
              </div>
              {favoriteRooms.length === 0 && (
                <div className="rooms-myrooms-empty-inline">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                    <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9z" />
                  </svg>
                  <span>No favorite rooms yet</span>
                </div>
              )}
              {favoriteRooms.map((room) => renderDrawerRoomItem(room, 'favorite'))}

              <div className="rooms-myrooms-section-head">
                <span>My Rooms</span>
                <span className="rooms-myrooms-section-count">{ownedRooms.length}</span>
                <span className="rooms-myrooms-section-line" />
              </div>
              {ownedRooms.map((room) => renderDrawerRoomItem(room, 'owner'))}

              <div className="rooms-myrooms-section-head">
                <span>Member Rooms</span>
                <span className="rooms-myrooms-section-count">{memberRooms.length}</span>
                <span className="rooms-myrooms-section-line" />
              </div>
              {memberRooms.map((room) => renderDrawerRoomItem(room, 'member'))}
            </div>
          </aside>
        </>
      )}
    </div>
  )
}

function RoomDetailView({
  room,
  categoryName,
  isFavorite,
  canManage,
  initialPrejoinSettings,
  onJoin,
  onToggleFavorite,
  onOpenRoom,
  onCloseRoom,
  onDeleteRoom,
}: {
  room: TalkRoom
  categoryName: string
  isFavorite: boolean
  canManage: boolean
  initialPrejoinSettings?: PrejoinDeviceSettings
  onJoin: (payload: {
    joinAsAudience: boolean
    accessCode?: string
    prejoinSettings: PrejoinDeviceSettings
  }) => Promise<string | null>
  onToggleFavorite: () => Promise<string | null>
  onOpenRoom: () => Promise<string | null>
  onCloseRoom: () => Promise<string | null>
  onDeleteRoom: () => Promise<string | null>
}) {
  const [prejoinType, setPrejoinType] = useState<'member' | 'audience' | null>(null)
  const [prejoinRoleLoading, setPrejoinRoleLoading] = useState(false)
  const [accessCode, setAccessCode] = useState('')
  const [error, setError] = useState('')
  const [joining, setJoining] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState('')
  const [micEnabled, setMicEnabled] = useState(initialPrejoinSettings?.micEnabled ?? true)
  const [camEnabled, setCamEnabled] = useState(initialPrejoinSettings?.camEnabled ?? true)
  const [backgroundMode, setBackgroundMode] = useState<PrejoinDeviceSettings['backgroundMode']>(
    initialPrejoinSettings?.backgroundMode ?? 'none',
  )
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([])
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([])
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([])
  const [selectedAudioInputId, setSelectedAudioInputId] = useState(
    initialPrejoinSettings?.microphoneDeviceId ?? '',
  )
  const [selectedAudioOutputId, setSelectedAudioOutputId] = useState(
    initialPrejoinSettings?.speakerDeviceId ?? '',
  )
  const [selectedVideoInputId, setSelectedVideoInputId] = useState(initialPrejoinSettings?.cameraDeviceId ?? '')
  const [previewError, setPreviewError] = useState('')
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const stopPreview = () => {
    const stream = streamRef.current
    if (!stream) return
    stream.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }

  useEffect(() => {
    setPrejoinType(null)
    setPrejoinRoleLoading(false)
    setAccessCode('')
    setError('')
    setActionError('')
    setJoining(false)
    setActionLoading(false)
    setMicEnabled(initialPrejoinSettings?.micEnabled ?? true)
    setCamEnabled(initialPrejoinSettings?.camEnabled ?? true)
    setBackgroundMode(initialPrejoinSettings?.backgroundMode ?? 'none')
    setSelectedAudioInputId(initialPrejoinSettings?.microphoneDeviceId ?? '')
    setSelectedAudioOutputId(initialPrejoinSettings?.speakerDeviceId ?? '')
    setSelectedVideoInputId(initialPrejoinSettings?.cameraDeviceId ?? '')
    setPreviewError('')
    stopPreview()
  }, [room.id, initialPrejoinSettings])

  useEffect(() => {
    let active = true
    setPrejoinRoleLoading(true)
    void (async () => {
      try {
        const result = await getPrejoin(room.roomName)
        if (!active) return
        setPrejoinType(result.participantType)
      } catch {
        if (!active) return
        setPrejoinType(null)
      } finally {
        if (active) {
          setPrejoinRoleLoading(false)
        }
      }
    })()
    return () => {
      active = false
    }
  }, [room.roomName])

  const loadDevices = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    const devices = await navigator.mediaDevices.enumerateDevices()
    setAudioInputs(devices.filter((item) => item.kind === 'audioinput'))
    setAudioOutputs(devices.filter((item) => item.kind === 'audiooutput'))
    setVideoInputs(devices.filter((item) => item.kind === 'videoinput'))
  }

  const startPreview = async () => {
    stopPreview()
    if (!navigator.mediaDevices?.getUserMedia) {
      setPreviewError('Media devices are unavailable in this environment.')
      return
    }
    if (!micEnabled && !camEnabled) {
      setPreviewError('')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: micEnabled
          ? {
              deviceId: selectedAudioInputId ? { exact: selectedAudioInputId } : undefined,
            }
          : false,
        video: camEnabled
          ? {
              deviceId: selectedVideoInputId ? { exact: selectedVideoInputId } : undefined,
              width: { ideal: 1280 },
              height: { ideal: 720 },
            }
          : false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        void videoRef.current.play().catch(() => undefined)
        if (selectedAudioOutputId && 'setSinkId' in videoRef.current) {
          try {
            await (videoRef.current as any).setSinkId(selectedAudioOutputId)
          } catch {
            // Ignore unsupported sink routing errors.
          }
        }
      }
      setPreviewError('')
      await loadDevices()
    } catch (e: any) {
      setPreviewError(e?.message || 'Cannot access microphone/camera.')
    }
  }

  useEffect(() => {
    void loadDevices().catch(() => undefined)
    return () => stopPreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void startPreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micEnabled, camEnabled, selectedAudioInputId, selectedAudioOutputId, selectedVideoInputId])

  const resolvedJoinAsAudience = prejoinType === 'audience'
  const hideAccessCode = prejoinType === 'member'
  const joinModeLabel =
    prejoinType === 'audience'
      ? 'Audience / Listener mode'
      : prejoinType === 'member'
        ? 'Speaker mode'
        : 'Auto mode'
  const roomUnavailable = room.status === 'closed'

  useEffect(() => {
    if (!resolvedJoinAsAudience) return
    setMicEnabled(false)
    setCamEnabled(false)
  }, [resolvedJoinAsAudience])

  const handleJoin = async () => {
    setJoining(true)
    const result = await onJoin({
      joinAsAudience: resolvedJoinAsAudience,
      accessCode,
      prejoinSettings: {
        micEnabled,
        camEnabled,
        backgroundMode,
        microphoneDeviceId: selectedAudioInputId || undefined,
        speakerDeviceId: selectedAudioOutputId || undefined,
        cameraDeviceId: selectedVideoInputId || undefined,
      },
    })
    setError(result ?? '')
    setJoining(false)
  }

  const runAction = async (action: () => Promise<string | null>) => {
    setActionLoading(true)
    setActionError('')
    const result = await action()
    setActionError(result ?? '')
    setActionLoading(false)
  }
  const roomStatusLabel =
    room.status === 'open' ? 'Open' : room.status === 'scheduled' ? 'Scheduled' : 'Closed'
  const roomScheduleLabel = formatSchedule(room.scheduledAt)

  return (
    <div className="detail-layout detail-layout-room">
      <div className="detail-card detail-card-room">
        <div className="detail-room-hero">
          <div className="detail-room-status-row">
            <span className={`detail-room-status detail-room-status-${room.status}`}>
              <span className="detail-room-status-dot" />
              {roomStatusLabel}
            </span>
            <div className="detail-room-flags">
              {room.isPrivate && <span className="chip">Private</span>}
              {room.audienceEnabled && <span className="chip">Audience enabled</span>}
            </div>
          </div>
          <div className="detail-room-head-actions">
            <button
              className="room-favorite-toggle detail-room-favorite"
              type="button"
              onClick={() => void runAction(onToggleFavorite)}
            >
              {isFavorite ? 'Unstar' : 'Star'}
            </button>
          </div>
        </div>

        <div className="detail-room-title-block">
          <h2>{room.title}</h2>
          <p className="detail-room-subtitle">{categoryName}</p>
          {room.description && <p className="detail-description detail-room-description">{room.description}</p>}
        </div>

        <div className="detail-room-meta-inline">
          <span>
            {room.participantCount}
            {room.maxParticipants > 0 ? ` / ${room.maxParticipants}` : ''} participants
          </span>
          <span>{roomScheduleLabel}</span>
        </div>

        <div className="detail-join-box detail-join-box-room">
          <div className="prejoin-header prejoin-header-room">
            <div className="prejoin-header-title">
              <span className="prejoin-header-icon" aria-hidden>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 8a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1.5l3.5-2v9l-3.5-2V16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8z" />
                </svg>
              </span>
              <h3>Prejoin setup</h3>
            </div>
            <span>{joinModeLabel}</span>
          </div>
          {room.isPrivate && (
            <div className="detail-private-note">
              Private room access is enabled.
            </div>
          )}
          {prejoinRoleLoading && <div className="notice">Checking join role...</div>}

          {room.isPrivate && !resolvedJoinAsAudience && !hideAccessCode && (
            <label className="detail-access-code">
              Access code
              <input
                className="input"
                placeholder="Enter access code"
                value={accessCode}
                onChange={(event) => setAccessCode(event.target.value)}
                type="password"
              />
            </label>
          )}

          <div className="prejoin-preview">
            <video
              ref={videoRef}
              className={`prejoin-video prejoin-video-${backgroundMode}`}
              autoPlay
              muted
              playsInline
            />
            <div className="prejoin-overlay-controls">
              <button
                className={`prejoin-overlay-toggle ${micEnabled ? 'active' : 'off'}`}
                type="button"
                onClick={() => setMicEnabled((value) => !value)}
                disabled={resolvedJoinAsAudience}
                aria-label={micEnabled ? 'Microphone on' : 'Microphone off'}
                title={micEnabled ? 'Turn off audio' : 'Turn on audio'}
              >
                {micEnabled ? (
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 14a3 3 0 0 0 3-3V7a3 3 0 0 0-6 0v4a3 3 0 0 0 3 3z" />
                    <path d="M17 11a5 5 0 0 1-10 0M12 16v4M9 20h6" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 14a3 3 0 0 0 3-3V7a3 3 0 0 0-6 0v4a3 3 0 0 0 3 3z" />
                    <path d="M17 11a5 5 0 0 1-3.3 4.7M12 16v4M9 20h6M3 3l18 18" />
                  </svg>
                )}
              </button>
              <button
                className={`prejoin-overlay-toggle ${camEnabled ? 'active' : 'off'}`}
                type="button"
                onClick={() => setCamEnabled((value) => !value)}
                disabled={resolvedJoinAsAudience}
                aria-label={camEnabled ? 'Camera on' : 'Camera off'}
                title={camEnabled ? 'Turn off video' : 'Turn on video'}
              >
                {camEnabled ? (
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 8a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1.5l3.5-2v9l-3.5-2V16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8z" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 8a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1.5l3.5-2v9l-3.5-2V16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8zM3 3l18 18" />
                  </svg>
                )}
              </button>
            </div>
            <div className="prejoin-overlay-background">
              <select
                className="select"
                value={backgroundMode}
                onChange={(event) =>
                  setBackgroundMode(event.target.value as PrejoinDeviceSettings['backgroundMode'])
                }
              >
                <option value="none">Background: none</option>
                <option value="blur">Background: blur</option>
                <option value="nature">Background: nature</option>
                <option value="office">Background: office</option>
              </select>
            </div>
            {!camEnabled && <div className="prejoin-video-placeholder">Camera is off</div>}
          </div>

          <div className="prejoin-devices">
            <label className="prejoin-field">
              <span>Select microphone</span>
              <select
                className="select"
                value={selectedAudioInputId}
                onChange={(event) => setSelectedAudioInputId(event.target.value)}
                disabled={resolvedJoinAsAudience}
              >
                <option value="">Default microphone</option>
                {audioInputs.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Microphone (${device.deviceId.slice(0, 6)})`}
                  </option>
                ))}
              </select>
            </label>
            <label className="prejoin-field">
              <span>Select speaker</span>
              <select
                className="select"
                value={selectedAudioOutputId}
                onChange={(event) => setSelectedAudioOutputId(event.target.value)}
              >
                <option value="">Default speaker</option>
                {audioOutputs.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Speaker (${device.deviceId.slice(0, 6)})`}
                  </option>
                ))}
              </select>
            </label>
            <label className="prejoin-field">
              <span>Select camera</span>
              <select
                className="select"
                value={selectedVideoInputId}
                onChange={(event) => setSelectedVideoInputId(event.target.value)}
                disabled={resolvedJoinAsAudience}
              >
                <option value="">Default camera</option>
                {videoInputs.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Camera (${device.deviceId.slice(0, 6)})`}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {resolvedJoinAsAudience && <div className="notice">Audience mode: mic/camera stays off.</div>}
        {previewError && <div className="warning">{previewError}</div>}

        {roomUnavailable ? (
          <div className="warning">This room is closed and can no longer be joined.</div>
        ) : (
          <button
            className="primary-button detail-join-button detail-join-button-room"
            onClick={() => void handleJoin()}
            disabled={joining || prejoinRoleLoading}
          >
            {joining ? 'Joining...' : resolvedJoinAsAudience ? 'Join as listener' : 'Join room'}
          </button>
        )}

        {canManage && room.status === 'closed' && (
          <div className="detail-manage-row">
            <button className="ghost-button" onClick={() => void runAction(onOpenRoom)} disabled={actionLoading}>
              Open room
            </button>
          </div>
        )}

        {(error || actionError) && (
          <div className="detail-room-errors">
            {error && <div className="error">{error}</div>}
            {actionError && <div className="error">{actionError}</div>}
          </div>
        )}
      </div>
    </div>
  )
}

function RoomChatView({
  rooms,
  room,
  roomId,
  currentUser,
  chat,
  onRoomChange,
  onSendChat,
}: {
  rooms: TalkRoom[]
  room: TalkRoom | null
  roomId: string
  currentUser: UserProfile
  chat: ChatMessage[]
  onRoomChange: (roomId: string) => void
  onSendChat: (text: string) => void
}) {
  const [roomSearch, setRoomSearch] = useState('')
  const [message, setMessage] = useState('')
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  const normalizedRoomSearch = roomSearch.trim().toLowerCase()
  const filteredRooms = useMemo(() => {
    if (!normalizedRoomSearch) return rooms
    return rooms.filter((item) => {
      const searchable = `${item.title} ${item.hostName ?? ''} ${item.categoryName ?? ''} ${item.roomName ?? ''}`.toLowerCase()
      return searchable.includes(normalizedRoomSearch)
    })
  }, [normalizedRoomSearch, rooms])

  useEffect(() => {
    setMessage('')
  }, [room?.id])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' })
  }, [chat.length, room?.id])

  const submitMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = message.trim()
    if (!room || !trimmed) return
    onSendChat(trimmed)
    setMessage('')
  }

  return (
    <div className="chat-room-page">
      <aside className="chat-room-sidebar">
        <div className="chat-room-sidebar-head">
          <strong>Chat</strong>
          <span>{rooms.length}</span>
        </div>

        <div className="chat-room-sidebar-search">
          <input
            className="input"
            value={roomSearch}
            onChange={(event) => setRoomSearch(event.target.value)}
            placeholder="Search room"
          />
        </div>

        <div className="chat-room-sidebar-caption">Rooms and channels</div>

        <div className="chat-room-room-list">
          {rooms.length === 0 && (
            <div className="chat-room-room-empty">No rooms available</div>
          )}
          {rooms.length > 0 && filteredRooms.length === 0 && (
            <div className="chat-room-room-empty">No matching rooms</div>
          )}

          {filteredRooms.map((item) => {
            const isActive = item.id === roomId
            const roomTitle = item.title.trim() || '...'
            return (
              <button
                key={item.id}
                type="button"
                className={`chat-room-room-item ${isActive ? 'active' : ''}`}
                onClick={() => onRoomChange(item.id)}
              >
                <div className="chat-room-room-item-title">
                  <strong>{roomTitle}</strong>
                  <span>{item.isPrivate ? 'Private' : 'Public'}</span>
                </div>
                <div className="chat-room-room-item-meta">
                  <span>Host: {item.hostName}</span>
                  <span>
                    {item.participantCount}
                    {item.maxParticipants > 0 ? ` / ${item.maxParticipants}` : ''} participants
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      </aside>

      <section className="chat-room-main">
        <div className="chat-room-main-header">
          <div className="chat-room-main-title">
            <strong>{room ? room.title : 'Room chat'}</strong>
            <span>{room ? `Host: ${room.hostName}` : 'Select a room to start chat'}</span>
          </div>
          {room && (
            <div className="chat-room-meta">
              <span className={statusTone[room.status].className}>{statusTone[room.status].label}</span>
              <span className="chat-room-meta-pill">{room.isPrivate ? 'Private' : 'Public'}</span>
              <span className="chat-room-meta-pill">
                {chat.length} messages
              </span>
            </div>
          )}
        </div>

        <div className="chat-room-messages">
          {!room && (
            <div className="empty-state">
              <h3>No room selected</h3>
              <p>Select a room from above to view and send messages.</p>
            </div>
          )}

          {room && chat.length === 0 && (
            <div className="empty-state">
              <h3>No messages yet</h3>
              <p>Start the conversation in this room.</p>
            </div>
          )}

          {room &&
            chat.map((entry) => {
              const isMine =
                entry.sender === currentUser.name ||
                entry.sender === currentUser.username ||
                entry.sender === `@${currentUser.username}`
              return (
                <article key={entry.id} className={`chat-room-message ${isMine ? 'chat-room-message-self' : ''}`}>
                  <div className="chat-room-message-meta">
                    <span>{entry.sender}</span>
                    <time>{dayjs(entry.time).format('HH:mm')}</time>
                  </div>
                  <p>{entry.text}</p>
                </article>
              )
            })}
          <div ref={messagesEndRef} />
        </div>

        <form className="chat-room-input-bar" onSubmit={submitMessage}>
          <input
            className="input"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={room ? 'Type a message...' : 'Select a room first'}
            disabled={!room}
          />
          <button className="primary-button" type="submit" disabled={!room || !message.trim()}>
            Send
          </button>
        </form>
      </section>
    </div>
  )
}

function ConferenceView({
  room,
  chat,
  currentUser,
  participants,
  token,
  livekitUrl,
  audience,
  prejoinSettings,
  canManageSpeakerRequests,
  onLeave,
  onSendChat,
  onRequestSpeaker,
}: {
  room: TalkRoom
  chat: ChatMessage[]
  currentUser: UserProfile
  participants: RoomParticipant[]
  token?: string
  livekitUrl?: string
  audience: boolean
  prejoinSettings?: PrejoinDeviceSettings
  canManageSpeakerRequests: boolean
  onLeave: () => void
  onSendChat: (text: string) => void
  onRequestSpeaker?: () => Promise<string | null>
}) {
  const [chatOpen, setChatOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [chatUnreadCount, setChatUnreadCount] = useState(0)
  const [pendingSpeakerRequests, setPendingSpeakerRequests] = useState<
    Array<{ id: string; title: string; note?: string; requestedAt?: string }>
  >([])
  const participantAvatarMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const participant of participants) {
      const avatarUrl = participant.avatar?.trim()
      if (!avatarUrl) continue
      if (participant.id) {
        map[participant.id] = avatarUrl
      }
      if (participant.username) {
        const username = participant.username.trim()
        if (username) {
          map[username] = avatarUrl
          map[`@${username}`] = avatarUrl
        }
      }
      if (participant.name) {
        const displayName = participant.name.trim()
        if (displayName) {
          map[displayName] = avatarUrl
        }
      }
    }
    return map
  }, [participants])
  const previousChatCountRef = useRef(0)

  useEffect(() => {
    setMessage('')
    setChatUnreadCount(0)
    previousChatCountRef.current = chat.length
  }, [audience, chat.length, room.id])

  useEffect(() => {
    const previous = previousChatCountRef.current
    const next = chat.length
    if (!chatOpen && next > previous) {
      setChatUnreadCount((value) => value + (next - previous))
    }
    if (chatOpen) {
      setChatUnreadCount(0)
    }
    previousChatCountRef.current = next
  }, [chat.length, chatOpen])

  useEffect(() => {
    if (!canManageSpeakerRequests || audience) {
      setPendingSpeakerRequests([])
      return
    }

    let active = true
    const fetchPending = async () => {
      try {
        const items = await listSpeakerRequests(room.id, 'pending')
        if (!active) return
        const normalized = (Array.isArray(items) ? items : []).map((item: any) => {
          const user = item?.user ?? item?.requester ?? item?.createdBy ?? {}
          const title =
            user?.name ||
            user?.username ||
            item?.username ||
            item?.name ||
            `Request #${String(item?.id ?? '')}`
          return {
            id: String(item?.id ?? `${title}-${item?.createdAt ?? ''}`),
            title: String(title),
            note: item?.note ? String(item.note) : undefined,
            requestedAt: item?.createdAt ? dayjs(item.createdAt).format('HH:mm DD/MM') : undefined,
          }
        })
        setPendingSpeakerRequests(normalized)
      } catch {
        // keep existing state on transient polling errors
      }
    }

    void fetchPending()
    const timer = window.setInterval(() => {
      void fetchPending()
    }, 5000)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [audience, canManageSpeakerRequests, room.id])

  const submitChat = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!message.trim()) return
    onSendChat(message)
    setMessage('')
  }

  return (
    <div className="conference-layout">
      <div className="conference-main conference-main-meeting">

        <LiveVideoStage
          key={`${room.id}:${token ?? 'no-token'}`}
          token={token}
          serverUrl={livekitUrl}
          roomTitle={room.title}
          roomName={room.roomName}
          roomCategory={room.categoryName}
          roomCategoryId={room.categoryId}
          roomId={room.id}
          hostId={room.hostId}
          hostName={room.hostName}
          hostUsername={room.hostUsername}
          localUserName={currentUser.name}
          localUsername={currentUser.username}
          localAvatarUrl={currentUser.avatar}
          participantAvatarMap={participantAvatarMap}
          audience={audience}
          initialMicEnabled={Boolean(prejoinSettings?.micEnabled)}
          initialCameraEnabled={Boolean(prejoinSettings?.camEnabled)}
          chatOpen={chatOpen}
          chatBadgeCount={chatUnreadCount}
          settingsBadgeCount={pendingSpeakerRequests.length}
          pendingSpeakerRequests={pendingSpeakerRequests}
          canManage={
            room.hostId === currentUser.id ||
            room.spaceRole === 'host' ||
            room.spaceRole === 'co_host' ||
            currentUser.spaceRole === 'admin' ||
            currentUser.spaceRole === 'host'
          }
          onToggleChat={() => setChatOpen((value) => !value)}
          onLeave={onLeave}
          onRequestSpeaker={onRequestSpeaker}
        />
      </div>

      {chatOpen && (
        <>
          <button
            className="conference-drawer-backdrop"
            onClick={() => setChatOpen(false)}
            type="button"
            aria-label="Close chat drawer"
          />
          <aside className="chat-panel chat-panel-drawer">
            <div className="chat-header">
              <strong>Room chat</strong>
              <span>{chat.length} messages</span>
            </div>
            <div className="chat-messages">
              {chat.map((entry) => (
                <div key={entry.id} className="chat-message">
                  <div className="chat-meta">
                    <span>{entry.sender}</span>
                    <time>{dayjs(entry.time).format('HH:mm')}</time>
                  </div>
                  <p>{entry.text}</p>
                </div>
              ))}
            </div>
            <form className="chat-form" onSubmit={submitChat}>
              <input
                className="input"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Type a message..."
              />
              <button className="primary-button" type="submit">
                Send
              </button>
            </form>
          </aside>
        </>
      )}
    </div>
  )
}

function CalendarView({
  rooms,
  currentUserId,
  month,
  selectedDay,
  days,
  scheduledByDay,
  selectedDayEvents,
  onMonthChange,
  onSelectDay,
  onOpenRoom,
  onCreateRoom,
  onEditRoom,
  onReopenRoom,
  onDeleteRoom,
}: {
  rooms: TalkRoom[]
  currentUserId: string
  month: dayjs.Dayjs
  selectedDay: string
  days: dayjs.Dayjs[]
  scheduledByDay: Map<string, TalkRoom[]>
  selectedDayEvents: TalkRoom[]
  onMonthChange: (next: dayjs.Dayjs) => void
  onSelectDay: (dayKey: string) => void
  onOpenRoom: (roomId: string) => void
  onCreateRoom: () => void
  onEditRoom: (roomId: string) => void
  onReopenRoom: (roomId: string) => Promise<string | null>
  onDeleteRoom: (roomId: string) => Promise<string | null>
}) {
  const scheduledCount = rooms.filter((room) => !!room.scheduledAt).length
  const [dayDrawerOpen, setDayDrawerOpen] = useState(false)
  const [drawerActionLoadingId, setDrawerActionLoadingId] = useState<string | null>(null)
  const [drawerActionError, setDrawerActionError] = useState('')
  const selectedDayLabel = dayjs(selectedDay).format('DD/MM/YYYY')

  const runDrawerAction = async (actionId: string, action: () => Promise<string | null>) => {
    if (drawerActionLoadingId) return
    setDrawerActionLoadingId(actionId)
    setDrawerActionError('')
    const result = await action()
    if (result) {
      setDrawerActionError(result)
    }
    setDrawerActionLoadingId(null)
  }

  const handleSelectDay = (dayKey: string) => {
    onSelectDay(dayKey)
    setDrawerActionError('')
    setDayDrawerOpen(true)
  }

  const renderScheduledRoomItem = (room: TalkRoom, source: 'panel' | 'drawer' = 'panel') => {
    const scheduledAt = room.scheduledAt ? dayjs(room.scheduledAt) : null
    const hasSchedule = Boolean(scheduledAt && scheduledAt.isValid())
    const scheduleTime = hasSchedule ? scheduledAt!.format('HH:mm') : '--:--'
    const scheduleDate = hasSchedule ? scheduledAt!.format('ddd, DD/MM/YYYY') : 'No schedule date'
    const scheduleRelative = hasSchedule ? scheduledAt!.fromNow() : 'No schedule'
    const statusLabel = room.status === 'open' ? 'Open' : room.status === 'scheduled' ? 'Scheduled' : 'Closed'
    const roomRole = resolveRoomMembershipRole(room, currentUserId)
    const canManageRoom = room.hostId === currentUserId || room.spaceRole === 'co_host' || room.spaceRole === 'host'
    const isRoomActionLoading = drawerActionLoadingId?.startsWith(`${room.id}:`) ?? false

    if (source === 'drawer') {
      return (
        <article key={`${source}:${room.id}`} className="rooms-myrooms-item calendar-day-room-item" onClick={() => onOpenRoom(room.id)}>
          <div className="rooms-myrooms-item-top">
            <div className="rooms-myrooms-item-title-wrap">
              <span className="rooms-myrooms-item-thumb">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M4.5 7.5h15M8 4v3.5M16 4v3.5M5 7.5v11a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 18.5v-11" />
                </svg>
              </span>
              <span className="rooms-myrooms-item-title-text">
                <strong>{room.title}</strong>
                <small>{room.categoryName?.trim() || 'General'}</small>
              </span>
            </div>
            <div className="calendar-day-room-badges">
              <span className={`rooms-myrooms-role-badge rooms-myrooms-role-${roomRole}`}>
                {roomMembershipRoleLabel[roomRole]}
              </span>
              <span className={`event-status-badge event-status-${room.status}`}>{statusLabel}</span>
            </div>
          </div>

          <div className="rooms-myrooms-item-meta">
            <span className="rooms-myrooms-item-meta-entry">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.9">
                <circle cx="12" cy="12" r="8.2" />
                <path d="M12 7.5v5l3.3 2" />
              </svg>
              <span>{scheduleTime} ({scheduleRelative})</span>
            </span>
            <span className="rooms-myrooms-item-meta-entry">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.9">
                <path d="M16 19v-1.2a3.3 3.3 0 0 0-3.3-3.3H7.3A3.3 3.3 0 0 0 4 17.8V19" />
                <circle cx="10" cy="8" r="3.1" />
              </svg>
              <span>
                {room.participantCount}
                {room.maxParticipants > 0 ? `/${room.maxParticipants}` : '/-'} people
              </span>
            </span>
            <span className="rooms-myrooms-item-meta-entry">{scheduleDate}</span>
          </div>

          {canManageRoom && (
            <div className="rooms-myrooms-actions-row">
              <div className="rooms-myrooms-actions-main rooms-myrooms-actions-main-3">
                <button
                  className="rooms-myrooms-action-wide rooms-myrooms-action-edit"
                  onClick={(event) => {
                    event.stopPropagation()
                    onEditRoom(room.id)
                  }}
                  type="button"
                >
                  Edit room
                </button>
                <button
                  className="rooms-myrooms-action-wide rooms-myrooms-action-reopen"
                  disabled={isRoomActionLoading || room.status === 'open'}
                  onClick={(event) => {
                    event.stopPropagation()
                    if (room.status === 'open') return
                    void runDrawerAction(`${room.id}:reopen`, () => onReopenRoom(room.id))
                  }}
                  type="button"
                >
                  Open room
                </button>
                <button
                  className="rooms-myrooms-action-wide rooms-myrooms-action-delete"
                  disabled={isRoomActionLoading}
                  onClick={(event) => {
                    event.stopPropagation()
                    if (!window.confirm(`Delete room "${room.title}"?`)) return
                    void runDrawerAction(`${room.id}:delete`, () => onDeleteRoom(room.id))
                  }}
                  type="button"
                >
                  Delete room
                </button>
              </div>
            </div>
          )}
        </article>
      )
    }

    return (
      <button
        key={`${source}:${room.id}`}
        className="event-item"
        onClick={() => onOpenRoom(room.id)}
      >
        <div className="event-item-head">
          <div className="event-time-badge">
            <strong>{scheduleTime}</strong>
            <small>{scheduleDate}</small>
          </div>
          <span className={`event-status-badge event-status-${room.status}`}>{statusLabel}</span>
        </div>
        <strong className="event-title">{room.title}</strong>
        <div className="event-schedule-line">Starts {scheduleRelative}</div>
        <div className="event-meta-row">
          <span className="event-meta-pill">{room.categoryName?.trim() || 'General'}</span>
          <span className="event-meta-text">Host: {room.hostName}</span>
          <span className="event-meta-text">{room.isPrivate ? 'Private' : 'Public'}</span>
        </div>
        {room.description?.trim() ? <p className="event-description">{room.description.trim()}</p> : null}
      </button>
    )
  }

  return (
    <>
      <div className="calendar-view">
        <div className="calendar-header">
          <div>
            <h2>{month.format('MMMM YYYY')}</h2>
            <p>{scheduledCount} scheduled rooms</p>
          </div>
          <div className="calendar-nav">
            <button className="ghost-button" onClick={() => onMonthChange(month.subtract(1, 'month'))}>
              Prev
            </button>
            <button className="ghost-button" onClick={() => onMonthChange(dayjs())}>
              Today
            </button>
            <button className="ghost-button" onClick={() => onMonthChange(month.add(1, 'month'))}>
              Next
            </button>
            <button className="primary-button calendar-create-room-btn" onClick={onCreateRoom} type="button">
              + Create room
            </button>
          </div>
        </div>

        <div className="calendar-grid">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((weekday) => (
            <div key={weekday} className="calendar-weekday">
              {weekday}
            </div>
          ))}
          {days.map((date) => {
            const key = date.format('YYYY-MM-DD')
            const events = scheduledByDay.get(key) ?? []
            const isCurrentMonth = date.month() === month.month()
            const isSelected = selectedDay === key

            return (
              <button
                key={key}
                className={`calendar-day ${isCurrentMonth ? '' : 'muted'} ${isSelected ? 'selected' : ''}`}
                onClick={() => handleSelectDay(key)}
              >
                <div className="calendar-day-top">
                  <span className="calendar-day-date">{date.date()}</span>
                  {events.length > 0 ? <span className="calendar-day-count">{events.length}</span> : null}
                </div>
                <div className="calendar-day-events">
                  {events.slice(0, 2).map((room) => (
                    <span key={room.id} className="calendar-day-event-line">
                      <em>{room.scheduledAt ? dayjs(room.scheduledAt).format('HH:mm') : '--:--'}</em>
                      <b>{room.title}</b>
                    </span>
                  ))}
                  {events.length > 2 && <span className="calendar-day-more">+{events.length - 2} more</span>}
                </div>
              </button>
            )
          })}
        </div>

      </div>

      {dayDrawerOpen && (
        <>
          <button
            className="rooms-myrooms-backdrop calendar-day-drawer-backdrop"
            onClick={() => setDayDrawerOpen(false)}
            type="button"
            aria-label="Close day schedules drawer"
          />
          <aside className="rooms-myrooms-drawer calendar-day-drawer" role="dialog" aria-label="Day schedules">
            <div className="rooms-myrooms-drawer-head">
              <div className="rooms-myrooms-drawer-title">
                <span className="rooms-myrooms-drawer-mark" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.9">
                    <rect x="4.5" y="5.5" width="15" height="14" rx="2" />
                    <path d="M8 3.5v4M16 3.5v4M4.5 9.5h15" />
                  </svg>
                </span>
                <strong>{selectedDayLabel}</strong>
                <span className="rooms-myrooms-drawer-total">{selectedDayEvents.length}</span>
              </div>
              <button
                className="ghost-button rooms-myrooms-close"
                onClick={() => setDayDrawerOpen(false)}
                type="button"
                aria-label="Close day schedules"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 6 18 18M18 6 6 18" />
                </svg>
              </button>
            </div>
            <div className="rooms-myrooms-drawer-list calendar-day-drawer-list">
              {drawerActionError && <div className="error rooms-myrooms-action-error">{drawerActionError}</div>}
              <div className="rooms-myrooms-section-head">
                <span>Meeting schedules</span>
                <span className="rooms-myrooms-section-count">{selectedDayEvents.length}</span>
                <span className="rooms-myrooms-section-line" />
              </div>
              {selectedDayEvents.length === 0 ? (
                <div className="rooms-myrooms-empty-inline">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9">
                    <circle cx="12" cy="12" r="8" />
                    <path d="M12 7.5v5l3 2" />
                  </svg>
                  <span>No scheduled rooms for this day.</span>
                </div>
              ) : (
                selectedDayEvents.map((room) => renderScheduledRoomItem(room, 'drawer'))
              )}
            </div>
          </aside>
        </>
      )}
    </>
  )
}

function ParticipantsView({
  rooms,
  room,
  currentUserId,
  roomId,
  participants,
  allParticipants,
  loading,
  query,
  inviteName,
  inviteLookupUser,
  inviteLookupLoading,
  notice,
  onRoomChange,
  onQueryChange,
  onInviteNameChange,
  onFindInviteUser,
  onInviteAsRole,
  onPromote,
  onCoHost,
  onAudience,
}: {
  rooms: TalkRoom[]
  room: TalkRoom | null
  currentUserId: string
  roomId: string
  participants: RoomParticipant[]
  allParticipants: RoomParticipant[]
  loading: boolean
  query: string
  inviteName: string
  inviteLookupUser: InviteLookupUser | null
  inviteLookupLoading: boolean
  notice: string
  onRoomChange: (value: string) => void
  onQueryChange: (value: string) => void
  onInviteNameChange: (value: string) => void
  onFindInviteUser: () => void
  onInviteAsRole: (role: ParticipantRole) => Promise<void> | void
  onPromote: (participant: RoomParticipant) => void
  onCoHost: (participant: RoomParticipant) => void
  onAudience: (participant: RoomParticipant) => void
}) {
  const [activeTab, setActiveTab] = useState<'member' | 'audience'>('member')
  const [roomSearchQuery, setRoomSearchQuery] = useState('')
  const [isRoomSelectOpen, setIsRoomSelectOpen] = useState(false)
  const roomCloseTimerRef = useRef<number | null>(null)

  const memberCount = useMemo(
    () => allParticipants.filter((participant) => participant.participantType !== 'audience').length,
    [allParticipants],
  )
  const audienceCount = useMemo(
    () => allParticipants.filter((participant) => participant.participantType === 'audience').length,
    [allParticipants],
  )
  const displayedParticipants = useMemo(
    () =>
      participants.filter((participant) =>
        activeTab === 'audience'
          ? participant.participantType === 'audience'
          : participant.participantType !== 'audience',
      ),
    [activeTab, participants],
  )

  const normalizedRoomSearchQuery = roomSearchQuery.trim().toLowerCase()
  const filteredRooms = useMemo(() => {
    if (!normalizedRoomSearchQuery) return rooms
    return rooms.filter((item) => {
      const searchable = `${item.title} ${item.categoryName ?? ''} ${item.hostName ?? ''} ${item.roomName ?? ''}`.toLowerCase()
      return searchable.includes(normalizedRoomSearchQuery)
    })
  }, [normalizedRoomSearchQuery, rooms])

  const roomTag = room?.categoryName || room?.tags?.[0] || 'Uncategorized'
  const hasInviteCandidate = Boolean(inviteLookupUser)

  const roomRoleLabel = (item: TalkRoom) =>
    item.hostId === currentUserId || item.spaceRole === 'host' ? 'Host' : 'Co-host'
  const roomRoleShort = (item: TalkRoom) =>
    item.hostId === currentUserId || item.spaceRole === 'host' ? '(Ho)' : '(Co)'
  const roomPrivacyLabel = (item: TalkRoom) => (item.isPrivate ? 'Private' : 'Public')
  const roomPrivacyIcon = (item: TalkRoom) => (item.isPrivate ? '\uD83D\uDD12' : '\uD83C\uDF10')
  const roomOptionLabel = (item: TalkRoom) => `${roomPrivacyIcon(item)} ${roomRoleShort(item)} ${item.title}`
  const selectedRoomRole = room ? roomRoleLabel(room) : 'Role'
  const selectedRoomAccess = room ? roomPrivacyLabel(room) : 'Access'
  const selectedRoomAccessIcon = room ? roomPrivacyIcon(room) : '\uD83C\uDF10'
  const selectedRoomLabel = room ? roomOptionLabel(room) : ''
  const roomSearchDisplayValue = isRoomSelectOpen ? roomSearchQuery : roomSearchQuery || selectedRoomLabel

  const clearRoomCloseTimer = () => {
    if (roomCloseTimerRef.current !== null) {
      window.clearTimeout(roomCloseTimerRef.current)
      roomCloseTimerRef.current = null
    }
  }

  const handleSelectRoom = (item: TalkRoom) => {
    onRoomChange(item.id)
    setRoomSearchQuery('')
    setIsRoomSelectOpen(false)
    clearRoomCloseTimer()
  }

  useEffect(() => {
    return () => {
      clearRoomCloseTimer()
    }
  }, [])

  return (
    <div className="participants-view participants-web-layout">
      <div className="participants-top-row">
        <div className="participants-room-block">
          <label className="participants-room-label">Select room</label>
          <div className="participants-room-combobox">
            <input
              className="input participants-room-combobox-input"
              value={roomSearchDisplayValue}
              onChange={(event) => setRoomSearchQuery(event.target.value)}
              onFocus={() => {
                clearRoomCloseTimer()
                setIsRoomSelectOpen(true)
              }}
              onBlur={() => {
                clearRoomCloseTimer()
                roomCloseTimerRef.current = window.setTimeout(() => {
                  setIsRoomSelectOpen(false)
                  setRoomSearchQuery('')
                  roomCloseTimerRef.current = null
                }, 120)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  if (filteredRooms[0]) {
                    handleSelectRoom(filteredRooms[0])
                  }
                }
                if (event.key === 'Escape') {
                  clearRoomCloseTimer()
                  setIsRoomSelectOpen(false)
                  setRoomSearchQuery('')
                }
              }}
              placeholder={rooms.length === 0 ? 'No host/co-host rooms' : 'Type to search and select room'}
              disabled={rooms.length === 0}
            />
            <button
              type="button"
              className="ghost-button participants-room-combobox-toggle"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                clearRoomCloseTimer()
                setIsRoomSelectOpen((prev) => !prev)
              }}
              aria-label="Toggle room list"
            >
              <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="m5 7 5 6 5-6" />
              </svg>
            </button>
            {isRoomSelectOpen && (
              <div className="participants-room-combobox-menu">
                {rooms.length === 0 ? (
                  <div className="participants-room-combobox-empty">No host/co-host rooms</div>
                ) : filteredRooms.length === 0 ? (
                  <div className="participants-room-combobox-empty">No matching rooms</div>
                ) : (
                  filteredRooms.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`participants-room-combobox-item ${item.id === roomId ? 'active' : ''}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => handleSelectRoom(item)}
                    >
                      <span>{roomOptionLabel(item)}</span>
                      <small>
                        {roomRoleLabel(item)} • {roomPrivacyLabel(item)}
                      </small>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <div className="participants-room-tags">
            <span className="participants-room-pill participants-room-pill-role">Role: {selectedRoomRole}</span>
            <span className="participants-room-pill participants-room-pill-access">
              {selectedRoomAccessIcon} {selectedRoomAccess}
            </span>
            <span className="participants-room-pill participants-room-pill-category">{roomTag}</span>
            <span className="participants-room-pill participants-room-pill-member">Member: {memberCount}</span>
            <span className="participants-room-pill participants-room-pill-audience">Audience: {audienceCount}</span>
          </div>
          <div className="participants-room-legend" aria-hidden="true">
            <span>(Ho) Host</span>
            <span>(Co) Co-host</span>
            <span>{'\uD83D\uDD12'} Private</span>
            <span>{'\uD83C\uDF10'} Public</span>
          </div>
        </div>
      </div>
      <div className="participants-invite-panel">
        <div className="participants-invite-head">
          <div className="participants-invite-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9">
              <path d="M7 8.5h10M7 12h6M5 5.5h14v13H5z" />
              <circle cx="9" cy="16.5" r="1.6" />
            </svg>
          </div>
          <div>
            <strong>Add member by ID</strong>
            <p>Find user quickly and assign member/co-host.</p>
          </div>
        </div>

        <div className="participants-invite-search">
          <input
            className="input"
            value={inviteName}
            onChange={(event) => onInviteNameChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                onFindInviteUser()
              }
            }}
              placeholder="Enter ID"
          />
          <button
            className="primary-button participants-invite-find-btn"
            onClick={onFindInviteUser}
            disabled={inviteLookupLoading}
          >
            {inviteLookupLoading ? 'Searching...' : 'Find user'}
          </button>
        </div>

        {hasInviteCandidate && (
          <div className="participants-invite-candidate">
            <div className="participants-invite-candidate-user">
              <span className="participants-list-avatar">
                {inviteLookupUser?.avatar ? (
                  <img
                    src={inviteLookupUser.avatar}
                    alt={inviteLookupUser.name}
                    className="participants-list-avatar-image"
                  />
                ) : (
                  inviteLookupUser?.name?.slice(0, 1).toUpperCase() ?? '?'
                )}
              </span>
              <div className="participants-list-user-meta">
                <strong>{inviteLookupUser?.name}</strong>
                <span>@{inviteLookupUser?.username}</span>
              </div>
            </div>
            <div className="participants-invite-candidate-actions">
              <button className="primary-button" onClick={() => void onInviteAsRole('member')}>
                Add as member
              </button>
              <button className="primary-button participants-invite-cohost-btn" onClick={() => void onInviteAsRole('co_host')}>
                Add co-host
              </button>
            </div>
          </div>
        )}
      </div>

      {notice && <div className="notice">{notice}</div>}

      <div className="participants-tabs">
        <button
          type="button"
          className={`participants-tab ${activeTab === 'member' ? 'active' : ''}`}
          onClick={() => setActiveTab('member')}
        >
          Members ({memberCount})
        </button>
        <button
          type="button"
          className={`participants-tab ${activeTab === 'audience' ? 'active' : ''}`}
          onClick={() => setActiveTab('audience')}
        >
          Audience ({audienceCount})
        </button>
      </div>

      <input
        className="input participants-list-search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="Search by name or ID"
      />

      <div className="participant-list">
        {loading && (
          <div className="empty-state">
            <h3>Loading participants</h3>
            <p>Waiting for API response.</p>
          </div>
        )}
        {!loading &&
          displayedParticipants.map((participant) => (
            <div key={participant.id} className="participant-row">
              <div className="participants-list-user">
                <span className="participants-list-avatar">
                  {participant.avatar ? (
                    <img src={participant.avatar} alt={participant.name} className="participants-list-avatar-image" />
                  ) : (
                    participant.name.slice(0, 1).toUpperCase()
                  )}
                </span>
                <div className="participants-list-user-meta">
                  <strong>{participant.name}</strong>
                  <span>{dayjs(participant.joinedAt).isValid() ? dayjs(participant.joinedAt).format('DD/MM HH:mm') : 'Guest'}</span>
                </div>
              </div>
              <div className="participant-row-actions">
                <span className="chip">{roleLabel[participant.role]}</span>
                {participant.role !== 'member' && participant.role !== 'host' && (
                  <button className="ghost-button" onClick={() => onPromote(participant)}>
                    Set member
                  </button>
                )}
                {participant.role !== 'co_host' && participant.role !== 'host' && (
                  <button className="ghost-button" onClick={() => onCoHost(participant)}>
                    Set co-host
                  </button>
                )}
                {participant.role !== 'audience' && participant.role !== 'host' && (
                  <button className="ghost-button" onClick={() => onAudience(participant)}>
                    Set audience
                  </button>
                )}
              </div>
            </div>
          ))}
        {!loading && displayedParticipants.length === 0 && (
          <div className="empty-state">
            <h3>No participants</h3>
            <p>Invite members or open the room to receive participants.</p>
          </div>
        )}
      </div>
    </div>
  )
}

function ProgramsView({
  onSubmitHostRequest,
}: {
  onSubmitHostRequest: (payload: {
    reason: string
    experience?: string
    socialLinks?: string
  }) => Promise<string | null>
}) {
  const [reason, setReason] = useState('')
  const [experience, setExperience] = useState('')
  const [socialLinks, setSocialLinks] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const submit = async () => {
    if (!reason.trim()) {
      setMessage('Reason is required.')
      return
    }

    setLoading(true)
    const result = await onSubmitHostRequest({
      reason: reason.trim(),
      experience: experience.trim() || undefined,
      socialLinks: socialLinks.trim() || undefined,
    })

    if (result) {
      setMessage(result)
    } else {
      setReason('')
      setExperience('')
      setSocialLinks('')
      setMessage('Host request submitted.')
    }

    setLoading(false)
  }

  return (
    <div className="programs-view">
      <div className="form-card">
        <h3>Host request</h3>
        <label>
          Reason
          <textarea className="textarea" value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
        <label>
          Experience
          <textarea
            className="textarea"
            value={experience}
            onChange={(event) => setExperience(event.target.value)}
          />
        </label>
        <label>
          Social links
          <input className="input" value={socialLinks} onChange={(event) => setSocialLinks(event.target.value)} />
        </label>
        <button className="primary-button" onClick={() => void submit()} disabled={loading}>
          {loading ? 'Submitting...' : 'Submit request'}
        </button>
        {message && <div className="notice">{message}</div>}
      </div>
    </div>
  )
}

type RecordingFile = {
  filename: string
  path: string
  size: number
  createdAt: number
  youtubeVideoId?: string
  youtubeUrl?: string
  youtubeUploadedAt?: number
}

function RecordingsView({ currentUserId }: { currentUserId: string }) {
  const api = (window as any).electronAPI
  const PARTICIPANT_RECORDS_PAGE_SIZE = 10
  const participantHistoryInFlightRef = useRef(false)
  const participantHistoryLoadPromiseRef = useRef<Promise<void> | null>(null)
  const [files, setFiles] = useState<RecordingFile[]>([])
  const [loading, setLoading] = useState(false)
  const [ytStatus, setYtStatus] = useState<{ connected: boolean; configured: boolean; channelTitle?: string; channelId?: string } | null>(null)
  const [ytAuthPending, setYtAuthPending] = useState(false)
  const [ytAuthError, setYtAuthError] = useState('')
  const [showClientIdInput, setShowClientIdInput] = useState(false)
  const [clientIdInput, setClientIdInput] = useState('')
  const [clientSecretInput, setClientSecretInput] = useState('')
  const [savingClientId, setSavingClientId] = useState(false)
  const [uploads, setUploads] = useState<Record<string, { filename: string; progress: number; done: boolean; error?: string; videoId?: string }>>({})
  const [recordingFolder, setRecordingFolder] = useState<string | null>(null)
  const [pickingFolder, setPickingFolder] = useState(false)
  const [autoUploadEnabled, setAutoUploadEnabled] = useState(false)
  const [savingAutoUpload, setSavingAutoUpload] = useState(false)
  const [currentUploads, setCurrentUploads] = useState<Array<{
    filePath: string
    filename: string
    progress: number
    status: string
    error?: string
    source?: string
    startedAt: number
  }>>([])
  const [uploadHistory, setUploadHistory] = useState<Array<{
    id: string
    filename: string
    youtubeUrl?: string
    uploadedAt: number
    roomId?: string
    roomName?: string
    recordDate?: string
    backendSyncedAt?: number
    backendSyncError?: string
    backendSyncRetryCount?: number
    backendNextRetryAt?: number
    source?: string
    title?: string
  }>>([])
  const [historyMode, setHistoryMode] = useState<'host' | 'participants'>('host')
  const [participantHistoryLoading, setParticipantHistoryLoading] = useState(false)
  const [participantHistoryPagingRoomId, setParticipantHistoryPagingRoomId] = useState<string | null>(null)
  const [participantHistoryGroups, setParticipantHistoryGroups] = useState<Array<{
    roomId: string
    roomLabel: string
    total: number
    currentPage: number
    pageSize: number
    items: Array<{
      id: string
      title: string
      url: string
      date: string
      categoryName?: string
    }>
  }>>([])

  const loadFiles = useCallback(async () => {
    if (!api?.listRecordingFiles) return
    setLoading(true)
    try {
      const result = await api.listRecordingFiles()
      setFiles((result || []).sort((a: RecordingFile, b: RecordingFile) => b.createdAt - a.createdAt))
    } finally {
      setLoading(false)
    }
  }, [api])

  const loadYtStatus = useCallback(async () => {
    if (!api?.youtubeStatus) return
    const status = await api.youtubeStatus()
    setYtStatus({ configured: true, ...status })
  }, [api])

  const loadRecordingFolder = useCallback(async () => {
    if (!api?.getRecordingFolder) return
    const folder = await api.getRecordingFolder()
    setRecordingFolder(folder || null)
  }, [api])

  const loadUploadHistory = useCallback(async () => {
    if (!api?.listRecordingUploadHistory) return
    const history = await api.listRecordingUploadHistory()
    setUploadHistory(Array.isArray(history) ? history : [])
  }, [api])
  const loadCurrentUploads = useCallback(async () => {
    if (!api?.listCurrentUploads) return
    const list = await api.listCurrentUploads()
    setCurrentUploads(Array.isArray(list) ? list : [])
  }, [api])

  const loadAutoUploadStatus = useCallback(async () => {
    if (!api?.autoUploadStatus) return
    const status = await api.autoUploadStatus()
    setAutoUploadEnabled(Boolean(status?.enabled))
  }, [api])

  useEffect(() => {
    loadFiles()
    loadYtStatus()
    loadRecordingFolder()
    loadAutoUploadStatus()
    loadUploadHistory()
    loadCurrentUploads()
  }, [loadFiles, loadYtStatus, loadRecordingFolder, loadAutoUploadStatus, loadUploadHistory, loadCurrentUploads])

  useEffect(() => {
    if (!api?.onYoutubeProgress) return
    return api.onYoutubeProgress((data: any) => {
      setUploads((prev) => {
        const existing = prev[data.sessionId] || {}
        return { ...prev, [data.sessionId]: { ...existing, progress: data.progress, done: data.done, error: data.error, videoId: data.videoId } }
      })
      if (data?.done && data?.videoId) {
        void loadFiles()
        void loadUploadHistory()
      }
      void loadCurrentUploads()
    })
  }, [api, loadFiles, loadUploadHistory, loadCurrentUploads])
  useEffect(() => {
    if (!api?.onRecordingUploadsState) return
    return api.onRecordingUploadsState((rows: any[]) => {
      setCurrentUploads(Array.isArray(rows) ? rows : [])
    })
  }, [api])
  useEffect(() => {
    if (!api?.onYoutubeUploaded) return
    return api.onYoutubeUploaded(() => {
      void loadUploadHistory()
    })
  }, [api, loadUploadHistory])

  const syncBackoffMs = (retryCount: number) => {
    const base = 30_000
    const exp = Math.max(0, Math.min(6, retryCount))
    return Math.min(60 * 60 * 1000, base * Math.pow(2, exp))
  }

  const syncUploadHistoryToBackend = useCallback(async () => {
    if (!api?.markRecordingUploadHistorySync || !uploadHistory.length) return
    const now = Date.now()
    const pending = uploadHistory
      .filter((item) => {
        if (!item?.id) return false
        if (!item?.youtubeUrl || !item?.roomId) return false
        if (item.backendSyncedAt) return false
        if (Number(item.backendNextRetryAt || 0) > now) return false
        return true
      })
      .sort((a, b) => Number(a.uploadedAt || 0) - Number(b.uploadedAt || 0))
      .slice(0, 3)

    if (!pending.length) return

    for (const item of pending) {
      const roomId = String(item.roomId || '').trim()
      const url = String(item.youtubeUrl || '').trim()
      const fallbackTitle = item.filename?.replace(/\.[^.]+$/, '') || 'Recording'
      const title = String(item.title || fallbackTitle).trim()
      const date = String(item.recordDate || '').trim() || new Date(item.uploadedAt || Date.now()).toISOString()
      if (!roomId || !url || !title) continue

      try {
        await saveRoomRecord(roomId, { title, url, date })
        await api.markRecordingUploadHistorySync({
          id: item.id,
          backendSyncedAt: Date.now(),
          backendSyncError: '',
          backendSyncRetryCount: Number(item.backendSyncRetryCount || 0),
          backendNextRetryAt: 0,
        })
      } catch (err: any) {
        const status = Number(err?.response?.status || 0)
        if (status === 409) {
          await api.markRecordingUploadHistorySync({
            id: item.id,
            backendSyncedAt: Date.now(),
            backendSyncError: '',
            backendSyncRetryCount: Number(item.backendSyncRetryCount || 0),
            backendNextRetryAt: 0,
          })
          continue
        }
        const retryCount = Number(item.backendSyncRetryCount || 0) + 1
        const nextRetryAt = Date.now() + syncBackoffMs(retryCount)
        const message = getTalkspacesApiError(err)
        await api.markRecordingUploadHistorySync({
          id: item.id,
          backendSyncError: message,
          backendSyncRetryCount: retryCount,
          backendNextRetryAt: nextRetryAt,
        })
      }
    }
    await loadUploadHistory()
  }, [api, uploadHistory, loadUploadHistory])

  useEffect(() => {
    void syncUploadHistoryToBackend()
    const timer = window.setInterval(() => {
      void syncUploadHistoryToBackend()
    }, 30_000)
    return () => {
      window.clearInterval(timer)
    }
  }, [syncUploadHistoryToBackend])

  const handleDelete = async (file: RecordingFile) => {
    if (!window.confirm(`Delete "${file.filename}"?`)) return
    await api?.deleteRecordingFile?.({ path: file.path })
    loadFiles()
  }

  const handleReveal = (file: RecordingFile) => {
    api?.revealRecordingFile?.({ path: file.path })
  }

  const handleChooseRecordingFolder = async () => {
    if (!api?.chooseRecordingFolder) return
    setPickingFolder(true)
    try {
      const result = await api.chooseRecordingFolder()
      if (result?.success && result.folder) {
        setRecordingFolder(result.folder)
        await loadFiles()
      }
    } finally {
      setPickingFolder(false)
    }
  }

  const handleToggleAutoUpload = async (enabled: boolean) => {
    if (!api?.setAutoUploadEnabled) return
    setSavingAutoUpload(true)
    try {
      const result = await api.setAutoUploadEnabled({ enabled })
      if (result?.success) setAutoUploadEnabled(Boolean(result.enabled))
    } finally {
      setSavingAutoUpload(false)
    }
  }

  const handleSaveClientId = async () => {
    const id = clientIdInput.trim()
    if (!id) return
    setSavingClientId(true)
    try {
      await api?.saveYoutubeClientId?.({ clientId: id, clientSecret: clientSecretInput.trim() })
      setShowClientIdInput(false)
      setClientIdInput('')
      setClientSecretInput('')
      await loadYtStatus()
    } finally {
      setSavingClientId(false)
    }
  }

  const handleYtAuth = async () => {
    setYtAuthError('')
    setYtAuthPending(true)
    try {
      const result = await api?.youtubeAuth?.()
      if (result?.success) {
        setYtStatus((prev) => ({ ...prev, connected: true, configured: true, channelTitle: result.channelTitle }))
      } else {
        setYtAuthError(result?.error || 'Authentication failed.')
      }
    } catch (err: any) {
      setYtAuthError(err?.message || 'Unexpected error.')
    } finally {
      setYtAuthPending(false)
    }
  }

  const handleYtRevoke = async () => {
    await api?.youtubeRevoke?.()
    setYtStatus((prev) => ({ ...prev, connected: false, configured: prev?.configured ?? true }))
    setYtAuthError('')
  }

  const handleUpload = (file: RecordingFile) => {
    const sessionId = `yt-${Date.now()}-${file.filename}`
    setUploads((prev) => ({ ...prev, [sessionId]: { filename: file.filename, progress: 0, done: false } }))
    api?.youtubeUpload?.({
      sessionId,
      filePath: file.path,
      title: file.filename.replace(/\.[^.]+$/, ''),
      privacyStatus: 'unlisted',
    })
  }

  const handleCancelUpload = (sessionId: string) => {
    api?.youtubeUploadCancel?.({ sessionId })
    setUploads((prev) => {
      const next = { ...prev }
      delete next[sessionId]
      return next
    })
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }

  const formatDate = (ts: number) =>
    new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const formatUploadHistoryTitle = (item: {
    title?: string
    filename: string
    recordDate?: string
    uploadedAt: number
  }) => {
    const rawTitle = (item.title && item.title.trim()) || item.filename.replace(/\.[^.]+$/, '')
    return rawTitle.replace(/^\[[^\]]+\]\s*-\s*/u, '').trim() || rawTitle
  }

  const activeUploads = Object.entries(uploads)
  const groupedUploadHistory = useMemo(() => {
    const map = new Map<string, { key: string; label: string; items: typeof uploadHistory }>()
    for (const item of uploadHistory) {
      const roomName = String(item.roomName || '').trim()
      const roomId = String(item.roomId || '').trim()
      const key = roomId || roomName || '__unknown__'
      const label = roomName || (roomId ? `Room ${roomId}` : 'Unknown room')
      const existing = map.get(key)
      if (existing) {
        existing.items.push(item)
      } else {
        map.set(key, { key, label, items: [item] })
      }
    }
    return Array.from(map.values())
      .map((group) => ({
        ...group,
        items: [...group.items].sort((a, b) => Number(b.uploadedAt || 0) - Number(a.uploadedAt || 0)),
      }))
      .sort((a, b) => Number(b.items[0]?.uploadedAt || 0) - Number(a.items[0]?.uploadedAt || 0))
  }, [uploadHistory])

  const loadParticipantHistory = useCallback(async () => {
    if (participantHistoryLoadPromiseRef.current) return participantHistoryLoadPromiseRef.current
    const run = async () => {
      if (participantHistoryInFlightRef.current) return
      participantHistoryInFlightRef.current = true
      setParticipantHistoryLoading(true)
      try {
        const rooms: TalkRoom[] = await listMyRooms()
        const participantRooms = rooms.filter((room: TalkRoom) => String(room.hostId || '') !== String(currentUserId || ''))
        const uniqueParticipantRooms: TalkRoom[] = []
        const seenRoomIds = new Set<string>()
        for (const room of participantRooms) {
          let roomId = String(room.id || '').trim()
          if (/^\d+$/.test(roomId)) roomId = String(Number(roomId))
          if (!roomId || seenRoomIds.has(roomId)) continue
          seenRoomIds.add(roomId)
          uniqueParticipantRooms.push({ ...room, id: roomId })
        }
        if (!uniqueParticipantRooms.length) {
          setParticipantHistoryGroups([])
          return
        }
        const requestByRoomId = new Map<string, Promise<{ total: number; items: Array<{ id: string; title: string; url: string; date: string; categoryName?: string }> }>>()
        const settled = await Promise.allSettled(
          uniqueParticipantRooms.map(async (room: TalkRoom) => {
            const roomId = String(room.id || '').trim()
            if (!requestByRoomId.has(roomId)) {
              requestByRoomId.set(
                roomId,
                listRoomRecords(roomId, { offset: 0, limit: PARTICIPANT_RECORDS_PAGE_SIZE }).then((result) => ({
                  total: Number(result.total || 0),
                  items: (result.items || []).map((item) => ({
                    id: item.id,
                    title: item.title,
                    url: item.url,
                    date: item.date,
                    categoryName: item.category?.name || undefined,
                  })),
                })),
              )
            }
            const page = await requestByRoomId.get(roomId)!
            return {
              roomId,
              roomLabel: (room.title && room.title.trim()) || room.roomName || `Room ${roomId}`,
              total: page.total,
              currentPage: 1,
              pageSize: PARTICIPANT_RECORDS_PAGE_SIZE,
              items: page.items,
            }
          }),
        )
        const fulfilledGroups: Array<{
          roomId: string
          roomLabel: string
          total: number
          currentPage: number
          pageSize: number
          items: Array<{ id: string; title: string; url: string; date: string; categoryName?: string }>
        }> = []
        for (const item of settled) {
          if (item.status !== 'fulfilled') continue
          fulfilledGroups.push(item.value)
        }
        const groups = fulfilledGroups
          .filter((group) => group.items.length > 0)
          .map((group) => ({
            ...group,
            items: group.items.sort(
              (a: { date: string }, b: { date: string }) =>
                dayjs(b.date).valueOf() - dayjs(a.date).valueOf(),
            ),
          }))
          .sort(
            (
              a: { items: Array<{ date: string }> },
              b: { items: Array<{ date: string }> },
            ) => dayjs(b.items[0]?.date || 0).valueOf() - dayjs(a.items[0]?.date || 0).valueOf(),
          )
        setParticipantHistoryGroups(groups)
      } catch {
        setParticipantHistoryGroups([])
      } finally {
        setParticipantHistoryLoading(false)
        participantHistoryInFlightRef.current = false
      }
    }
    const promise = run().finally(() => {
      participantHistoryLoadPromiseRef.current = null
    })
    participantHistoryLoadPromiseRef.current = promise
    return promise
  }, [currentUserId])

  const loadParticipantHistoryPage = useCallback(async (roomId: string, page: number) => {
    const room = participantHistoryGroups.find((g) => g.roomId === roomId)
    if (!room) return
    const totalPages = Math.max(1, Math.ceil(Math.max(0, room.total) / Math.max(1, room.pageSize)))
    const nextPage = Math.max(1, Math.min(totalPages, page))
    if (nextPage === room.currentPage) return

    setParticipantHistoryPagingRoomId(roomId)
    try {
      const result = await listRoomRecords(roomId, {
        offset: (nextPage - 1) * room.pageSize,
        limit: room.pageSize,
      })
      const nextItems = (result.items || []).map((item) => ({
        id: item.id,
        title: item.title,
        url: item.url,
        date: item.date,
        categoryName: item.category?.name || undefined,
      }))
      setParticipantHistoryGroups((prev) =>
        prev.map((group) =>
          group.roomId === roomId
            ? {
                ...group,
                total: Number(result.total || group.total || 0),
                currentPage: nextPage,
                items: nextItems,
              }
            : group,
        ),
      )
    } catch {
      // keep previous page on transient errors
    } finally {
      setParticipantHistoryPagingRoomId(null)
    }
  }, [participantHistoryGroups])

  const handleHistoryModeChange = useCallback((mode: 'host' | 'participants') => {
    setHistoryMode(mode)
    if (mode === 'participants' && participantHistoryGroups.length === 0) {
      void loadParticipantHistory()
    }
  }, [participantHistoryGroups.length, loadParticipantHistory])

  return (
    <div className="recordings-view">
      <div className="recordings-view__header">
        <div>
          <h2 className="recordings-view__title">Recordings</h2>
          <p className="recordings-view__subtitle">{files.length} file{files.length !== 1 ? 's' : ''} recorded</p>
          {recordingFolder && <p className="recordings-view__subtitle recordings-view__subtitle--path" title={recordingFolder}>{recordingFolder}</p>}
        </div>
        <div className="recordings-view__header-actions">
          <button className="recordings-view__browse" onClick={handleChooseRecordingFolder} disabled={pickingFolder} title="Select recording folder" type="button">
            {pickingFolder ? 'Opening…' : 'Browse'}
          </button>
          <button
            className="recordings-view__refresh"
            onClick={() => {
              void loadFiles()
              if (historyMode === 'participants') {
                void loadParticipantHistory()
              }
            }}
            title="Refresh"
            type="button"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" />
            </svg>
          </button>
        </div>
      </div>

      {/* YouTube section */}
      <div className="recordings-view__yt-card">
        <div className="recordings-view__yt-head">
          <div className="recordings-view__yt-card-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#FF0000" aria-hidden="true">
              <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
            </svg>
            YouTube Upload
          </div>
          <label className="recordings-view__auto-upload-toggle">
            <input
              type="checkbox"
              checked={autoUploadEnabled}
              disabled={savingAutoUpload}
              onChange={(e) => { void handleToggleAutoUpload(e.target.checked) }}
            />
            <span>Auto upload</span>
          </label>
        </div>

        {ytStatus?.connected ? (
          <div className="recordings-view__yt-connected">
            {ytStatus.channelId ? (
              <a
                className="recordings-view__yt-channel"
                href={`https://www.youtube.com/channel/${encodeURIComponent(ytStatus.channelId)}`}
                target="_blank"
                rel="noreferrer"
                title="Open YouTube channel"
              >
                <svg width="13" height="13" viewBox="0 0 20 20" fill="#22c55e" aria-hidden="true"><circle cx="10" cy="10" r="10" /><path d="M6 10l3 3 5-5" stroke="#fff" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                {ytStatus.channelTitle || 'Connected'}
              </a>
            ) : (
              <span className="recordings-view__yt-channel">
                <svg width="13" height="13" viewBox="0 0 20 20" fill="#22c55e" aria-hidden="true"><circle cx="10" cy="10" r="10" /><path d="M6 10l3 3 5-5" stroke="#fff" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                {ytStatus.channelTitle || 'Connected'}
              </span>
            )}
            <button className="recordings-view__yt-btn recordings-view__yt-btn--disconnect" onClick={handleYtRevoke} type="button">Disconnect</button>
          </div>
        ) : ytStatus?.configured === false ? (
          /* Client ID not configured */
          <div className="recordings-view__yt-disconnected">
            {!showClientIdInput ? (
              <>
                <span className="recordings-view__yt-hint">
                  YouTube OAuth chưa được cấu hình. Nhập Google OAuth Client ID (và Client Secret nếu cần) để bật upload.
                </span>
                <button className="recordings-view__yt-btn recordings-view__yt-btn--connect" onClick={() => setShowClientIdInput(true)} type="button">
                  Nhập OAuth config
                </button>
              </>
            ) : (
              <div className="recordings-view__yt-clientid-form">
                <input
                  className="recordings-view__yt-clientid-input"
                  type="text"
                  placeholder="Dán Google OAuth Client ID vào đây..."
                  value={clientIdInput}
                  onChange={(e) => setClientIdInput(e.target.value)}
                  autoFocus
                />
                <input
                  className="recordings-view__yt-clientid-input"
                  type="password"
                  placeholder="Client Secret (nếu Google yêu cầu)..."
                  value={clientSecretInput}
                  onChange={(e) => setClientSecretInput(e.target.value)}
                />
                <div className="recordings-view__yt-clientid-actions">
                  <button className="recordings-view__yt-btn recordings-view__yt-btn--connect" onClick={handleSaveClientId} disabled={savingClientId || !clientIdInput.trim()} type="button">
                    {savingClientId ? 'Saving…' : 'Save'}
                  </button>
                  <button className="recordings-view__yt-btn recordings-view__yt-btn--disconnect" onClick={() => { setShowClientIdInput(false); setClientIdInput(''); setClientSecretInput('') }} type="button">
                    Cancel
                  </button>
                </div>
                <a className="recordings-view__yt-help" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">
                  Tạo credentials tại Google Cloud Console →
                </a>
              </div>
            )}
          </div>
        ) : (
          /* Configured but not connected */
          <div className="recordings-view__yt-disconnected">
            {ytAuthError ? (
              <>
                <div className="recordings-view__yt-error">{ytAuthError}</div>
                {ytAuthError.includes('comply') || ytAuthError.includes('policy') || ytAuthError.includes('access_denied') ? (
                  <div className="recordings-view__yt-setup-guide">
                    <p className="recordings-view__yt-setup-title">⚠️ Cần cấu hình OAuth Consent Screen</p>
                    <ol className="recordings-view__yt-setup-steps">
                      <li>Vào <a href="https://console.cloud.google.com/apis/credentials/consent" target="_blank" rel="noreferrer">OAuth consent screen</a></li>
                      <li>Chọn <strong>External</strong> → Create</li>
                      <li>Điền App name, email → Save</li>
                      <li>Sang tab <strong>Test users</strong> → Add users</li>
                      <li>Thêm email Google bạn muốn dùng → Save</li>
                    </ol>
                  </div>
                ) : null}
              </>
            ) : null}
            <div className="recordings-view__yt-actions">
              <button className="recordings-view__yt-btn recordings-view__yt-btn--connect" onClick={handleYtAuth} disabled={ytAuthPending} type="button">
                {ytAuthPending ? (
                  <><span className="recordings-view__yt-spinner" /> Đang mở trình duyệt…</>
                ) : ytAuthError ? 'Thử lại' : 'Connect YouTube'}
              </button>
              <button className="recordings-view__yt-btn recordings-view__yt-btn--disconnect" onClick={() => setShowClientIdInput((v) => !v)} type="button" title="Change Client ID">
                <svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg>
              </button>
            </div>
            {showClientIdInput && (
              <div className="recordings-view__yt-clientid-form">
                <input
                  className="recordings-view__yt-clientid-input"
                  type="text"
                  placeholder="Dán Google OAuth Client ID vào đây..."
                  value={clientIdInput}
                  onChange={(e) => setClientIdInput(e.target.value)}
                  autoFocus
                />
                <input
                  className="recordings-view__yt-clientid-input"
                  type="password"
                  placeholder="Client Secret (nếu Google yêu cầu)..."
                  value={clientSecretInput}
                  onChange={(e) => setClientSecretInput(e.target.value)}
                />
                <div className="recordings-view__yt-clientid-actions">
                  <button className="recordings-view__yt-btn recordings-view__yt-btn--connect" onClick={handleSaveClientId} disabled={savingClientId || !clientIdInput.trim()} type="button">
                    {savingClientId ? 'Saving…' : 'Save'}
                  </button>
                  <button className="recordings-view__yt-btn recordings-view__yt-btn--disconnect" onClick={() => { setShowClientIdInput(false); setClientIdInput(''); setClientSecretInput('') }} type="button">Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Active uploads */}
      {activeUploads.length > 0 && (
        <div className="recordings-view__uploads">
          <div className="recordings-view__section-label">Uploading</div>
          {activeUploads.map(([sid, u]) => (
            <div key={sid} className="recordings-view__upload-row">
              <div className="recordings-view__upload-info">
                <span className="recordings-view__upload-name">{u.filename}</span>
                {u.error ? (
                  <span className="recordings-view__upload-status recordings-view__upload-status--error">Failed: {u.error}</span>
                ) : u.done ? (
                  <span className="recordings-view__upload-status recordings-view__upload-status--done">
                    Uploaded
                    {u.videoId && <a href={`https://youtube.com/watch?v=${u.videoId}`} target="_blank" rel="noreferrer"> — View</a>}
                  </span>
                ) : (
                  <span className="recordings-view__upload-status">{Math.round(u.progress)}%</span>
                )}
              </div>
              {!u.done && !u.error && (
                <div className="recordings-view__upload-bar">
                  <div className="recordings-view__upload-fill" style={{ width: `${u.progress}%` }} />
                </div>
              )}
              {(u.done || u.error) && (
                <button className="recordings-view__upload-dismiss" onClick={() => handleCancelUpload(sid)} type="button" title="Dismiss">×</button>
              )}
              {!u.done && !u.error && (
                <button className="recordings-view__upload-dismiss" onClick={() => handleCancelUpload(sid)} type="button" title="Cancel">×</button>
              )}
            </div>
          ))}
        </div>
      )}

      {currentUploads.length > 0 && (
        <div className="recordings-view__uploads">
          <div className="recordings-view__section-label">Uploading now</div>
          {currentUploads.map((u) => (
            <div key={u.filePath} className="recordings-view__upload-row">
              <div className="recordings-view__upload-info">
                <span className="recordings-view__upload-name" title={u.filePath}>{u.filename}</span>
                {u.status === 'error' ? (
                  <span className="recordings-view__upload-status recordings-view__upload-status--error">Failed: {u.error || 'unknown'}</span>
                ) : (
                  <span className="recordings-view__upload-status">
                    {Math.round(u.progress || 0)}% {u.source ? `· ${u.source}` : ''}
                  </span>
                )}
              </div>
              {u.status !== 'error' && (
                <div className="recordings-view__upload-bar">
                  <div className="recordings-view__upload-fill" style={{ width: `${u.progress || 0}%` }} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="recordings-view__list">
        <div className="recordings-view__section-head">
          <div className="recordings-view__section-label">Uploaded history</div>
          <div className="recordings-view__history-switch" role="tablist" aria-label="Uploaded history mode">
            <button
              className={`recordings-view__history-switch-btn ${historyMode === 'host' ? 'active' : ''}`}
              onClick={() => handleHistoryModeChange('host')}
              type="button"
            >
              Host
            </button>
            <button
              className={`recordings-view__history-switch-btn ${historyMode === 'participants' ? 'active' : ''}`}
              onClick={() => handleHistoryModeChange('participants')}
              type="button"
            >
              Participants
            </button>
          </div>
        </div>

        {historyMode === 'host' ? (
          uploadHistory.length > 0 ? (
            groupedUploadHistory.map((group) => (
              <div key={group.key}>
                <div className="recordings-view__section-label">{group.label} ({group.items.length})</div>
                {group.items.slice(0, 20).map((h) => (
                  <div key={h.id} className="recordings-view__item">
                    <div className="recordings-view__item-icon" aria-hidden="true">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="#FF0000">
                        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                      </svg>
                    </div>
                    <div className="recordings-view__item-info">
                      <span className="recordings-view__item-name" title={h.title || h.filename}>
                        {formatUploadHistoryTitle(h)}
                      </span>
                      <span className="recordings-view__item-meta">
                        Uploaded {new Date(h.uploadedAt).toLocaleString()}
                        {h.source ? ` | ${h.source}` : ''}
                        {h.backendSyncedAt
                          ? ' | Sync: Synced'
                          : h.roomId
                            ? ` | Sync: Not synced${h.backendSyncError ? ' (retrying)' : ''}`
                            : ' | Sync: Not synced (missing room)'}
                      </span>
                    </div>
                    <div className="recordings-view__item-actions">
                      {h.youtubeUrl ? (
                        <a className="recordings-view__action" href={h.youtubeUrl} target="_blank" rel="noreferrer" title="Open video">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3z" />
                            <path d="M5 5h6v2H7v10h10v-4h2v6H5z" />
                          </svg>
                        </a>
                      ) : (
                        <button className="recordings-view__action" type="button" disabled title="Video link unavailable">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3z" />
                            <path d="M5 5h6v2H7v10h10v-4h2v6H5z" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))
          ) : (
            <div className="recordings-view__inline-empty">No host uploaded history.</div>
          )
        ) : participantHistoryLoading ? (
          <div className="recordings-view__inline-empty">Loading participant records...</div>
        ) : participantHistoryGroups.length > 0 ? (
          participantHistoryGroups.map((group) => (
            <div key={group.roomId}>
              <div className="recordings-view__section-label">{group.roomLabel} ({group.items.length})</div>
              {group.items.map((item) => (
                <div key={item.id} className="recordings-view__item">
                  <div className="recordings-view__item-icon" aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="#FF0000">
                      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                    </svg>
                  </div>
                  <div className="recordings-view__item-info">
                    <span className="recordings-view__item-name" title={item.title}>
                      {item.title}
                    </span>
                    <span className="recordings-view__item-meta">
                      Published {dayjs(item.date).isValid() ? dayjs(item.date).format('DD MMM YYYY HH:mm') : item.date}
                      {item.categoryName ? ` | ${item.categoryName}` : ''}
                    </span>
                  </div>
                  <div className="recordings-view__item-actions">
                    {item.url ? (
                      <a className="recordings-view__action" href={item.url} target="_blank" rel="noreferrer" title="Open video">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <path d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3z" />
                          <path d="M5 5h6v2H7v10h10v-4h2v6H5z" />
                        </svg>
                      </a>
                    ) : (
                      <button className="recordings-view__action" type="button" disabled title="Video link unavailable">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <path d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3z" />
                          <path d="M5 5h6v2H7v10h10v-4h2v6H5z" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {group.total > group.pageSize && (
                <div className="recordings-view__pager">
                  {Array.from({ length: Math.max(1, Math.ceil(group.total / group.pageSize)) }, (_, idx) => idx + 1).map((pageNo) => (
                    <button
                      key={`${group.roomId}:${pageNo}`}
                      className={`recordings-view__pager-btn ${group.currentPage === pageNo ? 'active' : ''}`}
                      onClick={() => { void loadParticipantHistoryPage(group.roomId, pageNo) }}
                      disabled={participantHistoryPagingRoomId === group.roomId}
                      type="button"
                    >
                      {pageNo}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))
        ) : (
          <div className="recordings-view__inline-empty">No participant records found.</div>
        )}
      </div>

      {/* File list */}
      <div className="recordings-view__list">
        {loading && <div className="recordings-view__empty">Loading…</div>}
        {!loading && files.length === 0 && (
          <div className="recordings-view__empty">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.3" aria-hidden="true">
              <path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
            <span>No recordings yet. Start a recording in a conference room.</span>
          </div>
        )}
        {files.map((file) => (
          <div key={file.path} className="recordings-view__item">
            <div className="recordings-view__item-icon" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="18" rx="2" />
                <circle cx="12" cy="12" r="3" />
                <path d="M7 12H9M15 12H17" />
              </svg>
            </div>
            <div className="recordings-view__item-info">
              <span className="recordings-view__item-name" title={file.filename}>{file.filename}</span>
              <span className="recordings-view__item-meta">{formatSize(file.size)} · {formatDate(file.createdAt)}</span>
              {file.youtubeUrl && (
                <a className="recordings-view__item-link" href={file.youtubeUrl} target="_blank" rel="noreferrer">
                  YouTube link
                </a>
              )}
            </div>
            <div className="recordings-view__item-actions">
              {ytStatus?.connected && (
                <button className="recordings-view__action" onClick={() => handleUpload(file)} title="Upload to YouTube" type="button">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                  </svg>
                </button>
              )}
              <button className="recordings-view__action" onClick={() => handleReveal(file)} title="Show in folder" type="button">
                <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path d="M2 5a2 2 0 012-2h3.586A2 2 0 019 3.586l.707.707A2 2 0 0011.414 5H16a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V5z" />
                </svg>
              </button>
              <button className="recordings-view__action recordings-view__action--danger" onClick={() => handleDelete(file)} title="Delete" type="button">
                <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SettingsView({
  profile,
  onSave,
}: {
  profile: UserProfile
  onSave: (next: UserProfile) => Promise<string | null>
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [name, setName] = useState(profile.name)
  const [username, setUsername] = useState(profile.username)
  const [avatar, setAvatar] = useState(profile.avatar)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)

  useEffect(() => {
    setName(profile.name)
    setUsername(profile.username)
    setAvatar(profile.avatar)
  }, [profile])

  const copyId = async () => {
    const normalizedUsername = username.trim() || profile.username

    const fallbackCopy = () => {
      const textarea = document.createElement('textarea')
      textarea.value = normalizedUsername
      textarea.setAttribute('readonly', '')
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      textarea.style.pointerEvents = 'none'
      document.body.appendChild(textarea)
      textarea.focus()
      textarea.select()
      const copied = document.execCommand('copy')
      document.body.removeChild(textarea)
      return copied
    }

    try {
      if (window.electronAPI?.copyToClipboard) {
        const result = await window.electronAPI.copyToClipboard(normalizedUsername)
        if (result?.success) {
          setMessage('Copied ID to clipboard')
          return
        }
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(normalizedUsername)
        setMessage('Copied ID to clipboard')
        return
      }

      if (fallbackCopy()) {
        setMessage('Copied ID to clipboard')
        return
      }

      setMessage('Clipboard is not available.')
    } catch {
      if (fallbackCopy()) {
        setMessage('Copied ID to clipboard')
      } else {
        setMessage('Could not copy ID to clipboard')
      }
    }
  }

  const onSelectAvatar = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const extension = file.name.split('.').pop()?.trim().toLowerCase() ?? ''
    if (!extension) {
      setMessage('Invalid image file.')
      return
    }

    setUploadingAvatar(true)
    void (async () => {
      try {
        const target = await requestAvatarUploadTarget(extension)
        const uploadResponse = await fetch(target.presignedUrl, {
          method: 'PUT',
          headers: file.type ? { 'Content-Type': file.type } : undefined,
          body: file,
        })
        if (!uploadResponse.ok) {
          throw new Error(`Upload failed (${uploadResponse.status}).`)
        }

        setAvatar(target.fileUrl)
        setMessage('Photo uploaded. Click Update to save.')
      } catch (error: any) {
        setMessage(getTalkspacesApiError(error))
      } finally {
        setUploadingAvatar(false)
      }
    })()
  }

  const submit = async () => {
    setLoading(true)
    const result = await onSave({
      ...profile,
      name: name.trim() || profile.name,
      username: username.trim() || profile.username,
      avatar,
    })

    if (result) {
      setMessage(result)
    } else {
      setMessage('Saved profile settings.')
    }

    setLoading(false)
  }

  return (
    <div className="settings-view settings-profile-view">
      <div className="settings-profile-heading">
        <h2>Profile info</h2>
        <p>Manage your profile for TalkSpaces.</p>
      </div>

      <div className="settings-profile-shell">
        <section className="settings-profile-hero">
          <div className="settings-profile-user">
            <div className="settings-profile-avatar">
              {avatar ? (
                <img src={avatar} alt={name} className="settings-profile-avatar-image" />
              ) : (
                name.slice(0, 1).toUpperCase()
              )}
            </div>
            <div className="settings-profile-user-meta">
              <strong>{name || profile.name}</strong>
              <span>@{username || profile.username}</span>
            </div>
          </div>

          <div className="settings-profile-actions">
            <button className="ghost-button settings-profile-copy" onClick={() => void copyId()} type="button">
              Copy ID
            </button>
            <button
              className="primary-button settings-profile-upload"
              onClick={() => fileInputRef.current?.click()}
              type="button"
              disabled={uploadingAvatar}
            >
              {uploadingAvatar ? 'Uploading...' : 'Upload photo'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={onSelectAvatar}
              className="settings-profile-file-input"
            />
          </div>
        </section>

        <section className="settings-profile-form">
          <label className="settings-profile-field">
            <span>Display name</span>
            <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
          </label>

          <label className="settings-profile-field">
            <span>Email</span>
            <input className="input" value={profile.email} readOnly />
          </label>

          <div className="settings-profile-submit">
            <button className="primary-button" onClick={() => void submit()} disabled={loading}>
              {loading ? 'Saving...' : 'Update'}
            </button>
          </div>
        </section>

        {message && <div className="notice">{message}</div>}
      </div>
    </div>
  )
}

function CreateRoomModal({
  categories,
  onCancel,
  onCreate,
  initialValues,
  titleText,
  submitLabel,
}: {
  categories: RoomCategoryOption[]
  onCancel: () => void
  onCreate: (payload: CreateRoomInput) => Promise<string | null>
  initialValues?: Partial<CreateRoomInput>
  titleText?: string
  submitLabel?: string
}) {
  const toCategorySlug = (value: string) => {
    const base = value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    return base || `category-${Date.now()}`
  }

  const CREATE_CATEGORY_VALUE = '__create_category__'
  const isEditMode = Boolean(initialValues)
  const timeZoneLabel = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Saigon', [])
  const [categoryOptionsLocal, setCategoryOptionsLocal] = useState<RoomCategoryOption[]>(categories)
  const [title, setTitle] = useState(initialValues?.title ?? '')
  const [description, setDescription] = useState(initialValues?.description ?? '')
  const [categoryId, setCategoryId] = useState(initialValues?.categoryId ?? categories[0]?.id ?? '')
  const [maxParticipants, setMaxParticipants] = useState(initialValues?.maxParticipants ?? 0)
  const [isPrivate, setIsPrivate] = useState(initialValues?.isPrivate ?? false)
  const [audienceEnabled, setAudienceEnabled] = useState(initialValues?.audienceEnabled ?? false)
  const [scheduledAt, setScheduledAt] = useState(initialValues?.scheduledAt ?? '')
  const [repeatWeekly, setRepeatWeekly] = useState(initialValues?.repeatWeekly ?? false)
  const [advancedEnabled, setAdvancedEnabled] = useState(true)
  const [showCreateCategory, setShowCreateCategory] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [creatingCategory, setCreatingCategory] = useState(false)
  const [tags, setTags] = useState((initialValues?.tags ?? []).join(', '))
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setCategoryOptionsLocal((prev) => {
      if (categories.length === 0) return prev
      const map = new Map<string, RoomCategoryOption>()
      prev.forEach((item) => map.set(item.id, item))
      categories.forEach((item) => map.set(item.id, item))
      return Array.from(map.values())
    })
  }, [categories])

  const createCategory = async () => {
    const name = newCategoryName.trim()
    if (!name) {
      setError('Category name is required.')
      return
    }
    try {
      setError('')
      setCreatingCategory(true)
      const createdCategory = await createRoomCategoryApi({
        name,
        slug: toCategorySlug(name),
      })
      setCategoryOptionsLocal((prev) => {
        const withoutDuplicate = prev.filter((item) => item.id !== createdCategory.id)
        return [createdCategory, ...withoutDuplicate]
      })
      setCategoryId(createdCategory.id)
      setNewCategoryName('')
      setShowCreateCategory(false)
    } catch (createError: any) {
      setError(getTalkspacesApiError(createError))
    } finally {
      setCreatingCategory(false)
    }
  }

  const submit = async () => {
    if (!title.trim()) {
      setError('Room title is required.')
      return
    }

    setError('')
    setLoading(true)

    const result = await onCreate({
      title: title.trim(),
      description: description.trim(),
      categoryId,
      maxParticipants,
      isPrivate,
      audienceEnabled,
      scheduledAt: scheduledAt || undefined,
      repeatWeekly: scheduledAt ? repeatWeekly : false,
      tags: tags
        .split(',')
        .map((tag) => tag.trim().replace(/^#/, ''))
        .filter(Boolean),
    })

    if (result) {
      setError(result)
    }

    setLoading(false)
  }

  return (
    <div className="modal-backdrop">
      <div className="modal modal-room-form">
        <div className="modal-room-form-head">
          <div className="modal-room-form-brand">
            <span className="modal-room-form-brand-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="3.8" y="7" width="10.5" height="10" rx="2.1" />
                <path d="M14.3 10.3l5.7-3.3v10l-5.7-3.3" />
              </svg>
            </span>
            <div className="modal-room-form-brand-text">
              <h3>{titleText || 'Create new room'}</h3>
              <p>{isEditMode ? 'Update your TalkSpace room settings' : 'Configure and open your TalkSpace room'}</p>
            </div>
          </div>
          <button className="modal-room-form-close" onClick={onCancel} disabled={loading} type="button" aria-label="Close form">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="modal-room-form-body">
          <label className="modal-field modal-full">
            <span className="modal-field-head">
              <span className="modal-field-label">Room title</span>
              <span className="modal-field-counter">{title.length} / 255</span>
            </span>
            <input
              className="input"
              maxLength={255}
              placeholder="Ex: English speaking practice together"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>

          <div className="modal-grid modal-grid-room-top">
            <label className="modal-field">
              <span className="modal-field-label">Category</span>
              <select
                className="select"
                value={categoryId}
                onChange={(event) => {
                  const selectedValue = event.target.value
                  if (selectedValue === CREATE_CATEGORY_VALUE) {
                    setShowCreateCategory(true)
                    return
                  }
                  setCategoryId(selectedValue)
                }}
              >
                <option value="">Select category</option>
                {categoryOptionsLocal.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
                <option value={CREATE_CATEGORY_VALUE}>+ Create category...</option>
              </select>
              {showCreateCategory && (
                <div className="modal-category-create-inline">
                  <input
                    className="input"
                    placeholder="New category name"
                    value={newCategoryName}
                    onChange={(event) => setNewCategoryName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        void createCategory()
                      }
                    }}
                  />
                  <button
                    className="primary-button modal-category-create-btn"
                    disabled={creatingCategory}
                    onClick={() => void createCategory()}
                    type="button"
                  >
                    {creatingCategory ? 'Creating...' : 'Create'}
                  </button>
                </div>
              )}
            </label>

            <label className="modal-field modal-field-max">
              <span className="modal-field-label">Max (0 = unlimited)</span>
              <input
                className="input"
                type="number"
                min={0}
                value={maxParticipants}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  setMaxParticipants(Number.isFinite(value) ? Math.max(0, value) : 0)
                }}
              />
            </label>
          </div>

          <div className="modal-room-advanced-head">
            <strong>Advanced</strong>
            <label className="modal-switch" aria-label="Toggle advanced settings">
              <input type="checkbox" checked={advancedEnabled} onChange={(event) => setAdvancedEnabled(event.target.checked)} />
              <span className="modal-switch-track" />
            </label>
          </div>

          {advancedEnabled && (
            <div className="modal-room-advanced-body">
              <label className="modal-field modal-full">
                <span className="modal-field-label">Schedule (empty = open now)</span>
                <input
                  className="input"
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(event) => setScheduledAt(event.target.value)}
                />
                <span className="modal-field-hint">Timezone: {timeZoneLabel}</span>
              </label>

              <div className={`modal-switch-row ${!scheduledAt ? 'modal-switch-row-disabled' : ''}`}>
                <div className="modal-switch-row-copy">
                  <span>Repeat weekly</span>
                  <small>Reopen this room every week on this schedule</small>
                </div>
                <label className="modal-switch">
                  <input
                    type="checkbox"
                    checked={repeatWeekly}
                    disabled={!scheduledAt}
                    onChange={(event) => setRepeatWeekly(event.target.checked)}
                  />
                  <span className="modal-switch-track" />
                </label>
              </div>

              <div className="modal-switch-row">
                <div className="modal-switch-row-copy">
                  <span>Private room</span>
                  <small>Require access code to join</small>
                </div>
                <label className="modal-switch">
                  <input
                    type="checkbox"
                    checked={isPrivate}
                    onChange={(event) => {
                      setIsPrivate(event.target.checked)
                      if (!event.target.checked) {
                        setAudienceEnabled(false)
                      }
                    }}
                  />
                  <span className="modal-switch-track" />
                </label>
              </div>
            </div>
          )}
        </div>

        {error && <div className="error">{error}</div>}

        <div className="modal-actions modal-room-form-actions">
          <button className="ghost-button" onClick={onCancel} disabled={loading}>
            Cancel
          </button>
          <button className="primary-button" onClick={() => void submit()} disabled={loading}>
            {loading ? 'Saving...' : submitLabel || (isEditMode ? 'Save changes' : 'Create room')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default App
