import { FormEvent, useState } from 'react'
import type { UserProfile } from '../types'
import {
  exchangeDesktopHandoffToken,
  extractApiErrorMessage,
  fetchCurrentProfile,
  loginWithPassword,
  submitContactRequest,
} from '../services/auth'

export default function AuthScreen({
  onAuthenticated,
}: {
  onAuthenticated: (profile: UserProfile) => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const [loginForm, setLoginForm] = useState({
    username: '',
    password: '',
  })
  const [supportOpen, setSupportOpen] = useState(false)
  const [supportForm, setSupportForm] = useState({
    phone: '',
    message: '',
  })
  const [supportLoading, setSupportLoading] = useState(false)

  const resolveGoogleApiBaseUrl = () => {
    const fromBase = String(import.meta.env.VITE_API_BASE_URL ?? '').trim()
    if (fromBase) return fromBase

    const fromLegacyBase = String(import.meta.env.NEXT_PUBLIC_BASE_URL ?? '').trim()
    if (fromLegacyBase) return fromLegacyBase

    const fromDomainAuth = String(import.meta.env.NEXT_PUBLIC_DOMAIN_AUTH ?? '').trim()
    if (fromDomainAuth) return fromDomainAuth

    const fromDomain = String(import.meta.env.NEXT_PUBLIC_DOMAIN ?? '').trim()
    if (fromDomain) return fromDomain

    const fromProxy = String(import.meta.env.VITE_API_PROXY_TARGET ?? '').trim()
    if (fromProxy) return fromProxy

    return ''
  }

  const submitGoogleSignin = async () => {
    setError('')
    setMessage('')

    const apiBaseUrl = resolveGoogleApiBaseUrl()
    if (!apiBaseUrl) {
      setError(
        'Google OAuth requires VITE_API_BASE_URL (or NEXT_PUBLIC_BASE_URL / NEXT_PUBLIC_DOMAIN_AUTH) in .env.',
      )
      return
    }

    if (!window.electronAPI?.startGoogleOAuthExternal) {
      setError('Google OAuth is available only in desktop Electron runtime.')
      return
    }

    setLoading(true)
    try {
      const externalResult = await window.electronAPI.startGoogleOAuthExternal({
        apiBaseUrl,
      })
      if (!externalResult.success) {
        if (externalResult.cancelled) {
          setMessage('Google login cancelled.')
          return
        }
        throw new Error(externalResult.error || 'Google OAuth failed.')
      }

      if (!externalResult.handoffToken) {
        throw new Error('Google OAuth did not return handoff token.')
      }
      await exchangeDesktopHandoffToken(externalResult.handoffToken)

      const profile = await fetchCurrentProfile()
      onAuthenticated(profile)
    } catch (err: any) {
      const rawMessage = String(err?.message ?? '')
      if (rawMessage.includes("No handler registered for 'auth:google-oauth-external'")) {
        setError('Desktop app needs restart to load Google OAuth bridge. Please close Electron and run `npm run dev` again.')
        return
      }
      setError(extractApiErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  const submitSignin = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)
    try {
      const profile = await loginWithPassword(loginForm)
      onAuthenticated(profile)
    } catch (err: any) {
      setError(extractApiErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  const submitSupportRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const phone = supportForm.phone.trim().replace(/\s+/g, '')
    const request = supportForm.message.trim()
    if (!phone || !request) {
      setError('Please fill all support fields before sending.')
      setMessage('')
      return
    }
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
      setError('Phone number must include international code, for example: +84974345645')
      setMessage('')
      return
    }

    setError('')
    setSupportLoading(true)
    try {
      await submitContactRequest({
        phone,
        message: request,
      })
      setMessage('Support request sent successfully.')
      setSupportOpen(false)
      setSupportForm({
        phone: '',
        message: '',
      })
    } catch (err: any) {
      setError(extractApiErrorMessage(err))
      setMessage('')
    } finally {
      setSupportLoading(false)
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-logo">TS</div>
          <div>
            <h1>TalkSpace Desktop</h1>
          </div>
        </div>

        <form className="auth-form" onSubmit={submitSignin}>
          <label>
            Username or email
            <input
              className="input"
              value={loginForm.username}
              onChange={(event) =>
                setLoginForm((prev) => ({
                  ...prev,
                  username: event.target.value,
                }))
              }
              required
            />
          </label>
          <label>
            Password
            <input
              className="input"
              type="password"
              value={loginForm.password}
              onChange={(event) =>
                setLoginForm((prev) => ({
                  ...prev,
                  password: event.target.value,
                }))
              }
              required
            />
          </label>
          <button className="primary-button" disabled={loading} type="submit">
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
          <button
            className="ghost-button auth-google-button"
            disabled={loading}
            onClick={() => void submitGoogleSignin()}
            type="button"
          >
            <svg className="auth-google-icon" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
              <path
                fill="#4285F4"
                d="M17.64 9.2045c0-.6382-.0573-1.2518-.1636-1.8409H9v3.4818h4.8436a4.1409 4.1409 0 0 1-1.7964 2.7177v2.2582h2.9086c1.7023-1.5677 2.6842-3.8773 2.6842-6.6168Z"
              />
              <path
                fill="#34A853"
                d="M9 18c2.43 0 4.4673-.8059 5.9564-2.1782l-2.9086-2.2582c-.8059.54-1.8368.8591-3.0478.8591-2.3441 0-4.3282-1.5832-5.0368-3.7091H.9573v2.3318A8.9999 8.9999 0 0 0 9 18Z"
              />
              <path
                fill="#FBBC05"
                d="M3.9632 10.7136A5.409 5.409 0 0 1 3.6818 9c0-.5959.1023-1.1755.2814-1.7136V4.9545H.9573A9 9 0 0 0 0 9c0 1.4536.3482 2.8309.9573 4.0455l3.0059-2.3319Z"
              />
              <path
                fill="#EA4335"
                d="M9 3.5773c1.3214 0 2.5077.4541 3.4405 1.3459l2.5813-2.5814C13.4636.8905 11.4264 0 9 0A8.9999 8.9999 0 0 0 .9573 4.9545l3.0059 2.3319C4.6718 5.1605 6.6559 3.5773 9 3.5773Z"
              />
            </svg>
            <span>{loading ? 'Please wait...' : 'Continue with Google'}</span>
          </button>
          <button
            className="auth-support-link"
            type="button"
            onClick={() => {
              setSupportOpen((value) => !value)
              setError('')
              setMessage('')
            }}
          >
            Need help? Leave your information
          </button>
        </form>
        {supportOpen && (
          <form className="auth-support-panel" onSubmit={submitSupportRequest}>
            <strong className="auth-support-title">Support request</strong>
            <label>
              Phone number
              <input
                className="input"
                value={supportForm.phone}
                onChange={(event) =>
                  setSupportForm((prev) => ({
                    ...prev,
                    phone: event.target.value,
                  }))
                }
                placeholder="+84974345645"
                required
              />
            </label>
            <label>
              Issue details
              <textarea
                className="textarea"
                value={supportForm.message}
                onChange={(event) =>
                  setSupportForm((prev) => ({
                    ...prev,
                    message: event.target.value,
                  }))
                }
                placeholder={'Contact: facebook/...\nMessage: describe your issue...'}
                required
              />
            </label>
            <div className="auth-support-actions">
              <button
                className="ghost-button"
                type="button"
                disabled={supportLoading}
                onClick={() => {
                  setSupportOpen(false)
                  setSupportForm({
                    phone: '',
                    message: '',
                  })
                }}
              >
                Cancel
              </button>
              <button className="primary-button" type="submit">
                {supportLoading ? 'Sending...' : 'Send support'}
              </button>
            </div>
          </form>
        )}

        {error && <div className="error">{error}</div>}
        {message && <div className="notice">{message}</div>}
      </div>
    </div>
  )
}
