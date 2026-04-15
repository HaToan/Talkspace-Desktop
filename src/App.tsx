import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
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
  type RoomCategoryOption,
  assignRoomCoHost,
  assignRoomMember,
  closeRoom as closeRoomApi,
  createRoom as createRoomApi,
  deleteRoom as deleteRoomApi,
  demoteRoomUserToAudience,
  favoriteRoom as favoriteRoomApi,
  getPrejoin,
  getRoomToken,
  getTalkspacesApiError,
  leaveRoom as leaveRoomApi,
  listFavoriteRooms,
  listMyRooms,
  listRoomCategories,
  listRoomUsers,
  listSpeakerRequests,
  listRooms,
  openRoom as openRoomApi,
  submitHostRequest,
  submitSpeakerRequest,
  unfavoriteRoom as unfavoriteRoomApi,
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

type SidebarNavKey = 'rooms' | 'calendar' | 'participants' | 'programs' | 'settings'

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
  if (id === 'programs') {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M5 4.5h14M6.5 4.5V19.5h11V4.5M9 9h6M9 13h6" />
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

const dayKey = (iso: string) => dayjs(iso).format('YYYY-MM-DD')
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
  const [runtimeVersion, setRuntimeVersion] = useState('Electron')

  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<'all' | RoomStatus>('all')
  const [createOpen, setCreateOpen] = useState(false)

  const [participantsRoomId, setParticipantsRoomId] = useState<string>('')
  const [participantQuery, setParticipantQuery] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteRole, setInviteRole] = useState<ParticipantRole>('member')
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
      setRuntimeVersion(`Electron ${versions.electron} Â· Node ${versions.node}`)
    }
    void loadVersions()
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
    if (!rooms.find((room) => room.id === participantsRoomId)) {
      setParticipantsRoomId(rooms[0]?.id ?? '')
    }
  }, [participantsRoomId, rooms])

  useEffect(() => {
    if (page.key === 'detail') {
      setPage({ key: 'rooms' })
      return
    }
    if (page.key === 'conference' && !rooms.some((room) => room.id === page.roomId)) {
      setPage({ key: 'rooms' })
    }
  }, [page, rooms])

  const selectedRoom = useMemo(() => {
    if (page.key !== 'detail' && page.key !== 'conference') return null
    return rooms.find((room) => room.id === page.roomId) ?? null
  }, [page, rooms])

  const participantsPageRoom = useMemo(
    () => rooms.find((room) => room.id === participantsRoomId) ?? null,
    [participantsRoomId, rooms],
  )

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
        const key = dayKey(date.toISOString())
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
        repeatWeekly: Boolean(scheduledAt),
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
        const cachedJoinRole = prejoinSettings?.joinRole || prejoinSettingsByRoom[roomId]?.joinRole
        const initialJoinRole =
          (cachedJoinRole === 'member' || cachedJoinRole === 'listener') &&
          allowedJoinRoles.includes(cachedJoinRole)
            ? cachedJoinRole
            : resolvedJoinRole
        const prejoinResult = await window.electronAPI.openPrejoinWindow({
          roomTitle: 'TalkSpace Prejoin',
          joinAsAudience: resolvedJoinAsAudience,
          userInfo: {
            name: profile.name,
            username: profile.username,
            avatar: profile.avatar,
          },
          allowedJoinRoles,
          initialSettings: {
            ...(prejoinSettings || prejoinSettingsByRoom[roomId]),
            joinRole: initialJoinRole,
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

        const rawFinalPrejoinSettings = prejoinResult.settings as PrejoinDeviceSettings | undefined
        const finalPrejoinSettings = rawFinalPrejoinSettings
          ? {
              ...rawFinalPrejoinSettings,
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
      setParticipantsNotice('Username is required.')
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
            selectedRoom.spaceRole === 'co_host'
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
        />
      )
    }

    if (page.key === 'participants') {
      return (
        <ParticipantsView
          rooms={rooms}
          roomId={participantsRoomId}
          participants={participantsPageList}
          loading={participantsPageRoom ? Boolean(participantsLoading[participantsPageRoom.id]) : false}
          query={participantQuery}
          inviteName={inviteName}
          inviteRole={inviteRole}
          notice={participantsNotice}
          onRoomChange={(value) => setParticipantsRoomId(value)}
          onQueryChange={setParticipantQuery}
          onInviteNameChange={setInviteName}
          onInviteRoleChange={setInviteRole}
          onInvite={async () => {
            if (!participantsPageRoom) return
            const success = await addParticipant(participantsPageRoom.id, inviteName, inviteRole)
            if (success) {
              setInviteName('')
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
    return <AuthScreen runtimeVersion={runtimeVersion} onAuthenticated={handleAuthenticated} />
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

  return (
    <div className="main-window-root">
      <MainTitlebar />
      <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">TS</div>
          <div>
            <div className="brand-title">TalkSpace Desktop</div>
            <div className="brand-subtitle">{runtimeVersion}</div>
          </div>
        </div>
        <nav className="menu">
          {[
            { key: 'rooms', label: 'Rooms' },
            { key: 'calendar', label: 'Calendar' },
            { key: 'participants', label: 'Participants' },
            { key: 'programs', label: 'Programs' },
            { key: 'settings', label: 'Settings' },
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
          <div className="avatar">
            {profile.avatar ? (
              <img src={profile.avatar} alt={profile.name} className="avatar-image" />
            ) : (
              profile.name.slice(0, 1).toUpperCase()
            )}
          </div>
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
        <header className="main-header">
          <div>
            <h1>{pageLabel}</h1>
            <p>Desktop meetings synced with VXSpace web services.</p>
          </div>
          {roomsError && <div className="error">{roomsError}</div>}
          {globalNotice && <div className="notice">{globalNotice}</div>}
        </header>
        <section className={`main-section ${isImmersivePage ? 'main-section-immersive' : ''}`}>
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
    const canManageRoom = mode === 'owner'

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
            <button
              className="rooms-myrooms-action-wide rooms-myrooms-action-edit"
              onClick={(event) => {
                event.stopPropagation()
                onOpenRoom(room.id)
              }}
              type="button"
            >
              Open window
            </button>
            {room.status !== 'open' ? (
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
            ) : null}
          </div>
        )}
      </article>
    )
  }

  return (
    <div className="rooms-view">
      <div className="hero-card rooms-hero-card">
        <div>
          <p className="hero-eyebrow">Live Spaces</p>
          <h2>TalkSpace</h2>
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
          <button className="ghost-button" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}

      <div className="open-rooms-head">
        <h3>Rooms</h3>
        <span>Auto refresh 5s</span>
      </div>

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
                    <svg viewBox="0 0 24 24" width="52" height="52" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M12 3.5v9.2M8.6 7.8a3.4 3.4 0 1 1 6.8 0v4.9a3.4 3.4 0 1 1-6.8 0z" />
                      <path d="M6.5 11.8v1.3a5.5 5.5 0 1 0 11 0v-1.3M12 18.6v2.8M9.7 21.4h4.6" />
                    </svg>
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
                    <span className="room-host-avatar">{(room.hostName || '?').slice(0, 1).toUpperCase()}</span>
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
  month,
  selectedDay,
  days,
  scheduledByDay,
  selectedDayEvents,
  onMonthChange,
  onSelectDay,
  onOpenRoom,
}: {
  rooms: TalkRoom[]
  month: dayjs.Dayjs
  selectedDay: string
  days: dayjs.Dayjs[]
  scheduledByDay: Map<string, TalkRoom[]>
  selectedDayEvents: TalkRoom[]
  onMonthChange: (next: dayjs.Dayjs) => void
  onSelectDay: (dayKey: string) => void
  onOpenRoom: (roomId: string) => void
}) {
  const scheduledCount = rooms.filter((room) => !!room.scheduledAt).length

  return (
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
              onClick={() => onSelectDay(key)}
            >
              <div className="calendar-day-top">
                <span>{date.date()}</span>
                <span>{events.length > 0 ? events.length : ''}</span>
              </div>
              <div className="calendar-day-events">
                {events.slice(0, 2).map((room) => (
                  <span key={room.id}>{room.title}</span>
                ))}
                {events.length > 2 && <span>+{events.length - 2} more</span>}
              </div>
            </button>
          )
        })}
      </div>

      <div className="calendar-events-panel">
        <h3>Events on {dayjs(selectedDay).format('DD/MM/YYYY')}</h3>
        {selectedDayEvents.length === 0 ? (
          <p className="muted-copy">No scheduled rooms for this day.</p>
        ) : (
          <div className="event-list">
            {selectedDayEvents.map((room) => (
              <button key={room.id} className="event-item" onClick={() => onOpenRoom(room.id)}>
                <strong>{room.title}</strong>
                <span>{formatSchedule(room.scheduledAt)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ParticipantsView({
  rooms,
  roomId,
  participants,
  loading,
  query,
  inviteName,
  inviteRole,
  notice,
  onRoomChange,
  onQueryChange,
  onInviteNameChange,
  onInviteRoleChange,
  onInvite,
  onPromote,
  onCoHost,
  onAudience,
}: {
  rooms: TalkRoom[]
  roomId: string
  participants: RoomParticipant[]
  loading: boolean
  query: string
  inviteName: string
  inviteRole: ParticipantRole
  notice: string
  onRoomChange: (value: string) => void
  onQueryChange: (value: string) => void
  onInviteNameChange: (value: string) => void
  onInviteRoleChange: (value: ParticipantRole) => void
  onInvite: () => Promise<void> | void
  onPromote: (participant: RoomParticipant) => void
  onCoHost: (participant: RoomParticipant) => void
  onAudience: (participant: RoomParticipant) => void
}) {
  return (
    <div className="participants-view">
      <div className="participants-controls">
        <select className="select" value={roomId} onChange={(event) => onRoomChange(event.target.value)}>
          {rooms.map((room) => (
            <option key={room.id} value={room.id}>
              {room.title}
            </option>
          ))}
        </select>
        <input
          className="input"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search participant..."
        />
      </div>

      <div className="invite-box">
        <input
          className="input"
          value={inviteName}
          onChange={(event) => onInviteNameChange(event.target.value)}
          placeholder="Add participant by username"
        />
        <select
          className="select"
          value={inviteRole}
          onChange={(event) => onInviteRoleChange(event.target.value as ParticipantRole)}
        >
          <option value="member">Member</option>
          <option value="co_host">Co-host</option>
          <option value="audience">Audience</option>
        </select>
        <button className="primary-button" onClick={() => void onInvite()}>
          Add
        </button>
      </div>

      {notice && <div className="notice">{notice}</div>}

      <div className="participant-list">
        {loading && (
          <div className="empty-state">
            <h3>Loading participants</h3>
            <p>Waiting for API response.</p>
          </div>
        )}
        {!loading &&
          participants.map((participant) => (
            <div key={participant.id} className="participant-row">
              <div>
                <strong>{participant.name}</strong>
                <span>{participant.username ? `@${participant.username}` : 'guest'}</span>
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
        {!loading && participants.length === 0 && (
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

function SettingsView({
  profile,
  onSave,
}: {
  profile: UserProfile
  onSave: (next: UserProfile) => Promise<string | null>
}) {
  const [name, setName] = useState(profile.name)
  const [username, setUsername] = useState(profile.username)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setName(profile.name)
    setUsername(profile.username)
  }, [profile])

  const submit = async () => {
    setLoading(true)
    const result = await onSave({
      ...profile,
      name: name.trim() || profile.name,
      username: username.trim() || profile.username,
    })

    if (result) {
      setMessage(result)
    } else {
      setMessage('Saved profile settings.')
    }

    setLoading(false)
  }

  return (
    <div className="settings-view">
      <div className="form-card">
        <h3>Profile settings</h3>
        <label>
          Display name
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Username
          <input className="input" value={username} onChange={(event) => setUsername(event.target.value)} />
        </label>
        <label>
          Talkspace role
          <input className="input" value={roleLabelForSpaceRole[profile.spaceRole]} readOnly />
        </label>
        <button className="primary-button" onClick={() => void submit()} disabled={loading}>
          {loading ? 'Saving...' : 'Save'}
        </button>
        {message && <div className="notice">{message}</div>}
      </div>
    </div>
  )
}

function CreateRoomModal({
  categories,
  onCancel,
  onCreate,
}: {
  categories: RoomCategoryOption[]
  onCancel: () => void
  onCreate: (payload: CreateRoomInput) => Promise<string | null>
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '')
  const [maxParticipants, setMaxParticipants] = useState(50)
  const [isPrivate, setIsPrivate] = useState(false)
  const [audienceEnabled, setAudienceEnabled] = useState(false)
  const [scheduledAt, setScheduledAt] = useState('')
  const [tags, setTags] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!categoryId && categories.length > 0) {
      setCategoryId(categories[0].id)
    }
  }, [categories, categoryId])

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
      <div className="modal">
        <h3>Create TalkSpace room</h3>
        <div className="modal-grid">
          <label>
            Room title
            <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label>
            Category
            <select className="select" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.icon} {category.name}
                </option>
              ))}
            </select>
          </label>
          <label className="modal-full">
            Description
            <textarea className="textarea" value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <label>
            Max participants
            <input
              className="input"
              type="number"
              min={0}
              value={maxParticipants}
              onChange={(event) => setMaxParticipants(Number(event.target.value || 0))}
            />
          </label>
          <label>
            Schedule (optional)
            <input
              className="input"
              type="datetime-local"
              value={scheduledAt}
              onChange={(event) => setScheduledAt(event.target.value)}
            />
          </label>
          <label className="modal-full">
            Tags (comma separated)
            <input className="input" value={tags} onChange={(event) => setTags(event.target.value)} />
          </label>
          <label className="switch-line">
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
            Private room
          </label>
          <label className="switch-line">
            <input
              type="checkbox"
              disabled={!isPrivate}
              checked={audienceEnabled}
              onChange={(event) => setAudienceEnabled(event.target.checked)}
            />
            Allow audience mode
          </label>
        </div>

        {error && <div className="error">{error}</div>}

        <div className="modal-actions">
          <button className="ghost-button" onClick={onCancel} disabled={loading}>
            Cancel
          </button>
          <button className="primary-button" onClick={() => void submit()} disabled={loading}>
            {loading ? 'Creating...' : 'Create room'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default App
