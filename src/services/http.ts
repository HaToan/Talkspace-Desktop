import axios from 'axios'

const normalizeBaseUrl = (value?: string) => {
  if (!value) return ''
  return value.trim().replace(/\/+$/, '')
}

const ACCESS_TOKEN_KEY = 'talkspaceDesktop.accessToken'

let accessToken: string | null = null

const readStoredAccessToken = () => {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(ACCESS_TOKEN_KEY)
  const token = raw?.trim()
  return token || null
}

const persistAccessToken = (token: string | null) => {
  if (typeof window === 'undefined') return
  if (!token) {
    window.localStorage.removeItem(ACCESS_TOKEN_KEY)
    return
  }
  window.localStorage.setItem(ACCESS_TOKEN_KEY, token)
}

const isLocalDev =
  typeof window !== 'undefined' &&
  (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost')

// In local dev, always use relative /api via Vite proxy to avoid CORS preflight failures.
const baseURL = isLocalDev
  ? '/'
  : normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL) ||
    normalizeBaseUrl(import.meta.env.NEXT_PUBLIC_BASE_URL) ||
    normalizeBaseUrl(import.meta.env.NEXT_PUBLIC_DOMAIN_AUTH) ||
    normalizeBaseUrl(import.meta.env.NEXT_PUBLIC_DOMAIN) ||
    '/'

export const apiClient = axios.create({
  baseURL,
  withCredentials: true,
  timeout: 20_000,
  headers: {
    'Content-Type': 'application/json',
  },
})

export const setApiAccessToken = (token?: string | null) => {
  const normalized = token?.trim() || null
  accessToken = normalized
  persistAccessToken(normalized)
  if (normalized) {
    apiClient.defaults.headers.common.Authorization = `Bearer ${normalized}`
  } else {
    delete apiClient.defaults.headers.common.Authorization
  }
}

export const clearApiAccessToken = () => {
  setApiAccessToken(null)
}

export const getApiAccessToken = () => accessToken || readStoredAccessToken()

apiClient.interceptors.request.use((config) => {
  const token = accessToken || readStoredAccessToken()
  if (token) {
    config.headers = config.headers ?? {}
    config.headers.Authorization = `Bearer ${token}`
  } else if (config.headers && 'Authorization' in config.headers) {
    delete (config.headers as Record<string, string>)['Authorization']
  }
  return config
})

export type AppApiResponse<T> = {
  success?: boolean
  message?: string
  data?: T
  error?: {
    code?: string
    message?: string
  }
}

export const unwrapData = <T>(payload: AppApiResponse<T> | T) => {
  const maybe = payload as AppApiResponse<T>
  if (maybe && typeof maybe === 'object' && 'data' in maybe) {
    return maybe.data as T
  }
  return payload as T
}

export type ApiError = {
  response?: {
    data?: {
      error?: { message?: string }
      message?: string
    }
    status?: number
  }
  message?: string
}

export const getApiErrorMessage = (error: ApiError) =>
  error?.response?.data?.error?.message ||
  error?.response?.data?.message ||
  error?.message ||
  'Request failed.'
