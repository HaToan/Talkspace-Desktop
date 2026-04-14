import { FormEvent, useState } from 'react'
import type { UserProfile } from '../types'
import {
  confirmRegistration,
  exchangeDesktopHandoffToken,
  extractApiErrorMessage,
  fetchCurrentProfile,
  loginWithPassword,
  registerAccount,
} from '../services/auth'

type AuthMode = 'signin' | 'signup'

const initialRegisterForm = {
  name: '',
  email: '',
  username: '',
  password: '',
  confirmPassword: '',
  cccd: '',
  phonenumber: '',
}

export default function AuthScreen({
  runtimeVersion,
  onAuthenticated,
}: {
  runtimeVersion: string
  onAuthenticated: (profile: UserProfile) => void
}) {
  const [mode, setMode] = useState<AuthMode>('signin')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const [loginForm, setLoginForm] = useState({
    username: '',
    password: '',
  })
  const [registerForm, setRegisterForm] = useState(initialRegisterForm)
  const [verifyToken, setVerifyToken] = useState('')

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

    if (!window.electronAPI?.startGoogleOAuth) {
      setError('Google OAuth is available only in desktop Electron runtime.')
      return
    }

    setLoading(true)
    try {
      if (window.electronAPI.startGoogleOAuthExternal) {
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

        if (externalResult.handoffToken) {
          await exchangeDesktopHandoffToken(externalResult.handoffToken)
        }
      } else {
        const popupResult = await window.electronAPI.startGoogleOAuth({
          apiBaseUrl,
        })
        if (!popupResult.success) {
          if (popupResult.cancelled) {
            setMessage('Google login cancelled.')
            return
          }
          throw new Error(popupResult.error || 'Google OAuth failed.')
        }
      }

      const profile = await fetchCurrentProfile()
      onAuthenticated(profile)
    } catch (err: any) {
      const rawMessage = String(err?.message ?? '')
      if (rawMessage.includes("No handler registered for 'auth:google-oauth'")) {
        setError('Desktop app needs restart to load Google OAuth bridge. Please close Electron and run `npm run dev` again.')
        return
      }
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

  const submitSignup = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setMessage('')
    if (registerForm.password !== registerForm.confirmPassword) {
      setError('Confirm password does not match.')
      return
    }

    setLoading(true)
    try {
      await registerAccount({
        name: registerForm.name,
        email: registerForm.email,
        username: registerForm.username,
        password: registerForm.password,
        cccd: registerForm.cccd,
        phonenumber: registerForm.phonenumber,
      })
      setMessage(
        'Register successful. Please verify your email before signing in.',
      )
      setMode('signin')
      setRegisterForm(initialRegisterForm)
    } catch (err: any) {
      setError(extractApiErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  const submitVerify = async () => {
    const token = verifyToken.trim()
    if (!token) {
      setError('Verify token is required.')
      return
    }
    setError('')
    setMessage('')
    setLoading(true)
    try {
      await confirmRegistration(token)
      setMessage('Account verification successful. You can sign in now.')
      setVerifyToken('')
      setMode('signin')
    } catch (err: any) {
      setError(extractApiErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-logo">TS</div>
          <div>
            <h1>TalkSpace Desktop</h1>
            <p>{runtimeVersion}</p>
          </div>
        </div>

        <div className="auth-tabs">
          <button
            className={`auth-tab ${mode === 'signin' ? 'active' : ''}`}
            onClick={() => setMode('signin')}
            type="button"
          >
            Sign in
          </button>
          <button
            className={`auth-tab ${mode === 'signup' ? 'active' : ''}`}
            onClick={() => setMode('signup')}
            type="button"
          >
            Sign up
          </button>
        </div>

        {mode === 'signin' ? (
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
              className="ghost-button"
              disabled={loading}
              onClick={() => void submitGoogleSignin()}
              type="button"
            >
              {loading ? 'Please wait...' : 'Continue with Google'}
            </button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={submitSignup}>
            <label>
              Name
              <input
                className="input"
                value={registerForm.name}
                onChange={(event) =>
                  setRegisterForm((prev) => ({ ...prev, name: event.target.value }))
                }
                required
              />
            </label>
            <label>
              Email
              <input
                className="input"
                type="email"
                value={registerForm.email}
                onChange={(event) =>
                  setRegisterForm((prev) => ({ ...prev, email: event.target.value }))
                }
                required
              />
            </label>
            <label>
              Username
              <input
                className="input"
                value={registerForm.username}
                onChange={(event) =>
                  setRegisterForm((prev) => ({
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
                value={registerForm.password}
                onChange={(event) =>
                  setRegisterForm((prev) => ({
                    ...prev,
                    password: event.target.value,
                  }))
                }
                required
                minLength={6}
              />
            </label>
            <label>
              Confirm password
              <input
                className="input"
                type="password"
                value={registerForm.confirmPassword}
                onChange={(event) =>
                  setRegisterForm((prev) => ({
                    ...prev,
                    confirmPassword: event.target.value,
                  }))
                }
                required
                minLength={6}
              />
            </label>
            <details className="auth-optional">
              <summary>Additional information</summary>
              <label>
                CCCD
                <input
                  className="input"
                  value={registerForm.cccd}
                  onChange={(event) =>
                    setRegisterForm((prev) => ({
                      ...prev,
                      cccd: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Phone number
                <input
                  className="input"
                  value={registerForm.phonenumber}
                  onChange={(event) =>
                    setRegisterForm((prev) => ({
                      ...prev,
                      phonenumber: event.target.value,
                    }))
                  }
                />
              </label>
            </details>
            <button className="primary-button" disabled={loading} type="submit">
              {loading ? 'Creating account...' : 'Sign up'}
            </button>
          </form>
        )}

        <div className="auth-verify">
          <strong>Verify registration token</strong>
          <div className="auth-verify-row">
            <input
              className="input"
              value={verifyToken}
              onChange={(event) => setVerifyToken(event.target.value)}
              placeholder="Paste verify token"
            />
            <button
              className="ghost-button"
              disabled={loading}
              type="button"
              onClick={submitVerify}
            >
              Verify
            </button>
          </div>
        </div>

        {error && <div className="error">{error}</div>}
        {message && <div className="notice">{message}</div>}
      </div>
    </div>
  )
}
