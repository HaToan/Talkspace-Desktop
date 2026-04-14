export type RoomStatus = 'open' | 'scheduled' | 'closed'
export type SpaceRole = 'member' | 'host' | 'co_host' | 'admin'

export interface UserProfile {
  id: string
  username: string
  name: string
  email: string
  avatar?: string
  spaceRole: SpaceRole
}

export interface RoomCategory {
  id: string
  name: string
  icon: string
}

export interface TalkRoom {
  id: string
  roomName: string
  title: string
  description: string
  status: RoomStatus
  categoryId: string
  categoryName?: string
  categoryIcon?: string
  hostId: string
  hostName: string
  hostUsername?: string
  participantCount: number
  maxParticipants: number
  isPrivate: boolean
  audienceEnabled: boolean
  tags: string[]
  thumbnail?: string
  scheduledAt?: string
  accessCode?: string
  repeatWeekly?: boolean
  startedAt?: string
  endedAt?: string
  spaceRole?: 'host' | 'co_host' | 'participant'
}

export type ParticipantRole = 'host' | 'co_host' | 'member' | 'audience'

export interface RoomParticipant {
  id: string
  username: string
  name: string
  avatar?: string
  role: ParticipantRole
  participantType: 'member' | 'audience'
  joinedAt: string
}

export interface ChatMessage {
  id: string
  roomId: string
  sender: string
  text: string
  time: string
}

export type AppPage =
  | { key: 'rooms' }
  | { key: 'calendar' }
  | { key: 'participants' }
  | { key: 'programs' }
  | { key: 'settings' }
  | { key: 'detail'; roomId: string }
  | { key: 'conference'; roomId: string; audience: boolean }
