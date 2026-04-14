import { apiClient, getApiErrorMessage, unwrapData } from './http'
import type { RoomParticipant, TalkRoom, UserProfile } from '../types'

type ListRoomsParams = {
  offset?: number
  limit?: number
  categoryId?: string
  tagSlug?: string
}

type ApiRoom = any
type ApiParticipant = any

export type RoomCategoryOption = {
  id: string
  name: string
  icon: string
  slug?: string
  roomCount?: number
}

const normalizeRoom = (raw: ApiRoom): TalkRoom => ({
  id: String(raw?.id ?? ''),
  roomName: String(raw?.roomName ?? raw?.id ?? ''),
  title: String(raw?.title ?? 'Untitled room'),
  description: String(raw?.description ?? ''),
  status:
    raw?.status === 'scheduled' || raw?.status === 'closed' ? raw.status : 'open',
  categoryId: String(raw?.category?.id ?? ''),
  categoryName: String(raw?.category?.name ?? ''),
  categoryIcon: String(raw?.category?.icon ?? ''),
  hostId: String(raw?.host?.id ?? ''),
  hostName: String(raw?.host?.name ?? raw?.host?.username ?? 'Unknown'),
  hostUsername: String(raw?.host?.username ?? ''),
  participantCount: Number(raw?.participantCount ?? 0),
  maxParticipants: Number(raw?.maxParticipants ?? 0),
  isPrivate: Boolean(raw?.isPrivate),
  audienceEnabled: Boolean(raw?.audienceEnabled),
  tags: Array.isArray(raw?.tags)
    ? raw.tags
        .map((tag: any) =>
          typeof tag === 'string' ? tag : String(tag?.slug ?? tag?.name ?? ''),
        )
        .filter(Boolean)
    : [],
  scheduledAt: raw?.scheduledAt || undefined,
  repeatWeekly: Boolean(raw?.repeatWeekly),
  startedAt: raw?.startedAt || undefined,
  endedAt: raw?.endedAt || undefined,
  spaceRole:
    raw?.spaceRole === 'host' || raw?.spaceRole === 'co_host'
      ? raw.spaceRole
      : undefined,
  thumbnail: raw?.thumbnail || undefined,
})

const normalizeParticipant = (raw: ApiParticipant): RoomParticipant => {
  const role =
    raw?.role === 'host'
      ? 'host'
      : raw?.role === 'co_host'
        ? 'co_host'
        : raw?.participantType === 'audience'
          ? 'audience'
          : 'member'

  return {
    id: String(raw?.id ?? raw?.user?.id ?? ''),
    username: String(raw?.user?.username ?? ''),
    name: String(raw?.user?.name ?? raw?.user?.username ?? 'Unknown'),
    avatar:
      typeof raw?.user?.avatar === 'string' && raw.user.avatar.trim()
        ? raw.user.avatar.trim()
        : undefined,
    role,
    participantType: raw?.participantType === 'audience' ? 'audience' : 'member',
    joinedAt: raw?.joinedAt || new Date().toISOString(),
  }
}

export const listRoomCategories = async (): Promise<RoomCategoryOption[]> => {
  const response = await apiClient.get('/api/v1/room-categories?withCount=true')
  const data = unwrapData<any[]>(response.data) ?? []
  return data.map((category) => ({
    id: String(category?.id ?? ''),
    name: String(category?.name ?? 'General'),
    icon: String(category?.icon ?? ''),
    slug: category?.slug ? String(category.slug) : undefined,
    roomCount:
      typeof category?.roomCount === 'number' ? category.roomCount : undefined,
  }))
}

export const listRooms = async (params: ListRoomsParams = {}) => {
  const response = await apiClient.get('/api/v1/rooms', {
    params: {
      offset: params.offset ?? 0,
      limit: params.limit ?? 20,
      categoryId: params.categoryId || undefined,
      tagSlug: params.tagSlug || undefined,
    },
  })
  const data = unwrapData<any>(response.data)
  const items = Array.isArray(data?.items) ? data.items : []
  return {
    items: items.map(normalizeRoom),
    total: Number(data?.total ?? items.length),
  }
}

export const listMyRooms = async (month?: number, year?: number) => {
  const response = await apiClient.get('/api/v1/rooms/my', {
    params:
      month && year
        ? {
            month,
            year,
          }
        : undefined,
  })
  const data = unwrapData<any>(response.data)
  const items = Array.isArray(data?.items) ? data.items : []
  return items.map(normalizeRoom)
}

export const listFavoriteRooms = async () => {
  const response = await apiClient.get('/api/v1/rooms/my/favorites')
  const data = unwrapData<any>(response.data)
  const items = Array.isArray(data?.items) ? data.items : []
  return items.map(normalizeRoom)
}

export const getRoomByIdOrName = async (idOrName: string) => {
  const response = await apiClient.get(`/api/v1/rooms/${encodeURIComponent(idOrName)}`)
  return normalizeRoom(unwrapData(response.data))
}

export const createRoom = async (payload: {
  title: string
  description?: string
  categoryId?: string
  maxParticipants?: number
  isPrivate?: boolean
  audienceEnabled?: boolean
  tagSlugs?: string[]
  scheduledAt?: string
  repeatWeekly?: boolean
}) => {
  const response = await apiClient.post('/api/v1/rooms', payload)
  return normalizeRoom(unwrapData(response.data))
}

export const updateRoom = async (
  roomId: string,
  payload: {
    title?: string
    description?: string
    categoryId?: string
    maxParticipants?: number
    isPrivate?: boolean
    audienceEnabled?: boolean
    tagSlugs?: string[]
    scheduledAt?: string
    repeatWeekly?: boolean
  },
) => {
  const response = await apiClient.patch(
    `/api/v1/rooms/${encodeURIComponent(roomId)}`,
    payload,
  )
  return normalizeRoom(unwrapData(response.data))
}

export const closeRoom = async (roomId: string) => {
  await apiClient.post(`/api/v1/rooms/${encodeURIComponent(roomId)}/close`)
}

export const openRoom = async (roomId: string) => {
  const response = await apiClient.post(`/api/v1/rooms/${encodeURIComponent(roomId)}/open`)
  return normalizeRoom(unwrapData(response.data))
}

export const deleteRoom = async (roomId: string) => {
  await apiClient.delete(`/api/v1/rooms/${encodeURIComponent(roomId)}`)
}

export const getPrejoin = async (
  roomName: string,
): Promise<{ participantType: 'member' | 'audience' }> => {
  const response = await apiClient.get(`/api/v1/rooms/${encodeURIComponent(roomName)}/prejoin`)
  const data = unwrapData<any>(response.data)
  return {
    participantType: data?.participantType === 'member' ? 'member' : 'audience',
  }
}

export const getRoomToken = async (
  roomName: string,
  name?: string,
  accessCode?: string,
) => {
  const params: Record<string, string> = {}
  if (name) params.name = name
  if (accessCode) params.accessCode = accessCode

  const response = await apiClient.get(`/api/v1/rooms/${encodeURIComponent(roomName)}/token`, {
    params: Object.keys(params).length > 0 ? params : undefined,
  })
  const data = unwrapData<any>(response.data)
  return {
    token: String(data?.token ?? ''),
    roomName: String(data?.roomName ?? roomName),
    livekitUrl: data?.livekitUrl ? String(data.livekitUrl) : undefined,
  }
}

export const getGuestRoomToken = async (roomName: string) => {
  const response = await apiClient.get(
    `/api/v1/rooms/${encodeURIComponent(roomName)}/guest-token`,
  )
  const data = unwrapData<any>(response.data)
  return {
    token: String(data?.token ?? ''),
    roomName: String(data?.roomName ?? roomName),
    ttlSeconds: Number(data?.ttlSeconds ?? 0),
    livekitUrl: data?.livekitUrl ? String(data.livekitUrl) : undefined,
  }
}

export const leaveRoom = async (roomName: string) => {
  await apiClient.post(`/api/v1/rooms/${encodeURIComponent(roomName)}/leave`)
}

export const listRoomUsers = async (roomName: string) => {
  const response = await apiClient.get(`/api/v1/rooms/${encodeURIComponent(roomName)}/users`)
  const data = unwrapData<any>(response.data)
  const items = Array.isArray(data?.items) ? data.items : []
  return items.map(normalizeParticipant)
}

export const assignRoomMember = async (roomName: string, username: string) => {
  await apiClient.post(
    `/api/v1/rooms/${encodeURIComponent(roomName)}/member/${encodeURIComponent(username)}`,
  )
}

export const assignRoomCoHost = async (roomName: string, username: string) => {
  await apiClient.post(
    `/api/v1/rooms/${encodeURIComponent(roomName)}/co-host/${encodeURIComponent(username)}`,
  )
}

export const demoteRoomUserToAudience = async (
  roomName: string,
  username: string,
) => {
  await apiClient.post(
    `/api/v1/rooms/${encodeURIComponent(roomName)}/demote/${encodeURIComponent(username)}`,
  )
}

export const kickRoomUser = async (roomId: string, userId: string) => {
  await apiClient.post(
    `/api/v1/rooms/${encodeURIComponent(roomId)}/kick/${encodeURIComponent(userId)}`,
  )
}

export const favoriteRoom = async (roomId: string) => {
  await apiClient.post(`/api/v1/rooms/${encodeURIComponent(roomId)}/favorite`)
}

export const unfavoriteRoom = async (roomId: string) => {
  await apiClient.delete(`/api/v1/rooms/${encodeURIComponent(roomId)}/favorite`)
}

export const submitHostRequest = async (payload: {
  reason: string
  experience?: string
  socialLinks?: string
}) => {
  await apiClient.post('/api/v1/host-requests', payload)
}

export const listSpeakerRequests = async (roomId: string, status?: string) => {
  const response = await apiClient.get(
    `/api/v1/rooms/${encodeURIComponent(roomId)}/speaker-requests`,
    {
      params: status ? { status } : undefined,
    },
  )
  const data = unwrapData<any>(response.data)
  return Array.isArray(data) ? data : []
}

export const submitSpeakerRequest = async (roomId: string, note?: string) => {
  await apiClient.post(`/api/v1/rooms/${encodeURIComponent(roomId)}/speaker-requests`, {
    note: note ?? '',
  })
}

export const cancelSpeakerRequest = async (
  roomId: string,
  requestId: string,
) => {
  await apiClient.post(
    `/api/v1/rooms/${encodeURIComponent(roomId)}/speaker-requests/${encodeURIComponent(requestId)}/cancel`,
  )
}

export const approveSpeakerRequest = async (
  roomId: string,
  requestId: string,
) => {
  await apiClient.post(
    `/api/v1/rooms/${encodeURIComponent(roomId)}/speaker-requests/${encodeURIComponent(requestId)}/approve`,
  )
}

export const rejectSpeakerRequest = async (
  roomId: string,
  requestId: string,
  reason?: string,
) => {
  await apiClient.post(
    `/api/v1/rooms/${encodeURIComponent(roomId)}/speaker-requests/${encodeURIComponent(requestId)}/reject`,
    reason ? { reason } : {},
  )
}

export const submitActionEvent = async (
  roomId: string,
  payload: Record<string, unknown>,
) => {
  await apiClient.post(`/api/v1/rooms/${encodeURIComponent(roomId)}/action-events`, payload)
}

export const updateProfileSettings = async (
  username: string,
  payload: {
    name?: string
    username?: string
    description?: string
    avatar?: string
    cccd?: string
    phonenumber?: string
  },
) => {
  const response = await apiClient.patch(
    `/api/v1/users/${encodeURIComponent(username)}`,
    payload,
  )
  const data = unwrapData<any>(response.data)
  return {
    ...data,
    profile: {
      id: String(data?.id ?? ''),
      username: String(data?.username ?? username),
      name: String(data?.name ?? ''),
      email: String(data?.email ?? ''),
      avatar:
        typeof data?.avatar === 'string' && data.avatar.trim()
          ? data.avatar.trim()
          : undefined,
      spaceRole:
        data?.spaceRole === 'host' ||
        data?.spaceRole === 'co_host' ||
        data?.spaceRole === 'admin'
          ? data.spaceRole
          : ('member' as const),
    } as UserProfile,
  }
}

export const getPublicUserByUsername = async (username: string) => {
  const response = await apiClient.get(`/api/v1/users/${encodeURIComponent(username)}`)
  return unwrapData<any>(response.data)
}

export const getTalkspacesApiError = (error: any) => getApiErrorMessage(error)
