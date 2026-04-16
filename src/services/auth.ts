import type { UserProfile } from '../types'
import {
  apiClient,
  clearApiAccessToken,
  getApiAccessToken,
  getApiErrorMessage,
  setApiAccessToken,
  type ApiError,
  unwrapData,
} from './http'

const mapProfile = (raw: any, fallbackUsername?: string): UserProfile => ({
  id: String(raw?.id ?? `local-${fallbackUsername ?? 'user'}`),
  username: String(raw?.username ?? fallbackUsername ?? 'user'),
  name: String(raw?.name ?? raw?.username ?? fallbackUsername ?? 'User'),
  email: String(raw?.email ?? ''),
  avatar:
    typeof raw?.avatar === 'string' && raw.avatar.trim()
      ? raw.avatar.trim()
      : typeof raw?.picture === 'string' && raw.picture.trim()
        ? raw.picture.trim()
        : undefined,
  spaceRole:
    raw?.spaceRole === 'host' ||
    raw?.spaceRole === 'co_host' ||
    raw?.spaceRole === 'admin'
      ? raw.spaceRole
      : 'member',
})

export const extractApiErrorMessage = (error: ApiError) =>
  getApiErrorMessage(error)

export type LoginPayload = {
  username: string
  password: string
}

export type RegisterPayload = {
  name: string
  email: string
  username: string
  password: string
  cccd?: string
  phonenumber?: string
}

const decodeJwtPayload = (token?: string | null) => {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length < 2) return null
  const segment = parts[1]
  try {
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const decoded = atob(padded)
    return JSON.parse(decoded) as Record<string, unknown>
  } catch {
    return null
  }
}

export const loginWithPassword = async (
  payload: LoginPayload,
): Promise<UserProfile> => {
  const loginResponse = await apiClient.post('/api/v1/auth/login', {
    username: payload.username,
    password: payload.password,
    recapcha: '',
  })
  const loginPayload = unwrapData<any>(loginResponse?.data)
  const issuedAccessToken = loginPayload?.accessToken
  if (typeof issuedAccessToken === 'string' && issuedAccessToken.trim()) {
    setApiAccessToken(issuedAccessToken)
  }

  try {
    const profileResponse = await apiClient.get('/api/v1/profile')
    return mapProfile(unwrapData(profileResponse?.data), payload.username)
  } catch {
    const userResponse = await apiClient.get(
      `/api/v1/users/getuser/${encodeURIComponent(payload.username)}`,
    )
    return mapProfile(unwrapData(userResponse?.data), payload.username)
  }
}

export const registerAccount = async (payload: RegisterPayload) => {
  await apiClient.post('/api/v1/auth/register', {
    username: payload.username,
    password: payload.password,
    email: payload.email,
    name: payload.name,
    recapcha: '',
    cccd: payload.cccd ?? '',
    phonenumber: payload.phonenumber ?? '',
  })
}

export const fetchCurrentProfile = async (
  fallbackUsername?: string,
): Promise<UserProfile> => {
  try {
    const profileResponse = await apiClient.get('/api/v1/profile')
    return mapProfile(unwrapData(profileResponse?.data), fallbackUsername)
  } catch {
    let username = fallbackUsername
    if (!username) {
      const jwtPayload = decodeJwtPayload(getApiAccessToken())
      const fromToken = jwtPayload?.username
      if (typeof fromToken === 'string' && fromToken.trim()) {
        username = fromToken.trim()
      }
    }

    if (!username) {
      throw new Error('Unable to load profile.')
    }
    const userResponse = await apiClient.get(
      `/api/v1/users/getuser/${encodeURIComponent(username)}`,
    )
    return mapProfile(unwrapData(userResponse?.data), username)
  }
}

export const confirmRegistration = async (verifyToken: string) => {
  await apiClient.get('/api/v1/auth/confirm-register', {
    params: { verifyToken },
  })
}

export const logoutAccount = async () => {
  try {
    await apiClient.post('/api/v1/auth/logout')
  } finally {
    clearApiAccessToken()
  }
}

export const exchangeDesktopHandoffToken = async (token: string) => {
  const response = await apiClient.post('/api/v1/auth/desktop-handoff/exchange', {
    token,
  })
  const payload = unwrapData<any>(response?.data)
  const issuedAccessToken = payload?.accessToken
  if (typeof issuedAccessToken === 'string' && issuedAccessToken.trim()) {
    setApiAccessToken(issuedAccessToken)
  }
}

export const submitContactRequest = async (payload: {
  phone: string
  message: string
}) => {
  await apiClient.post('/api/v1/contact-requests', {
    phone: payload.phone,
    message: payload.message,
  })
}
