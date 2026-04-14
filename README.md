# TalkSpace Desktop (Electron + React)

Desktop app for TalkSpace features, wired to the same backend API flow as web.

## Run local

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Run Electron from built renderer

```bash
npm run electron
```

## Environment variables

Copy `.env.example` to `.env.local` (or `.env`) and update values.

```bash
cp .env.example .env.local
```

### Main variables

- `VITE_API_BASE_URL`: API origin used by axios in renderer.
  - Example: `https://v-xs.com`
  - If empty, renderer uses relative `/` and calls `/api/...` on same origin.
- `VITE_API_PROXY_TARGET`: dev-only proxy target for Vite `/api` proxy.
  - Example: `https://v-xs.com`
  - Recommended in dev when backend is another origin.
- Can also be used by desktop Google OAuth when `VITE_API_BASE_URL` is empty.

Google OAuth in desktop requires one of the two values above to be an absolute `http(s)` URL.

### Use frontend env directly

Desktop now supports frontend-style env keys too:
- `NEXT_PUBLIC_BASE_URL`
- `NEXT_PUBLIC_DOMAIN_AUTH`
- `NEXT_PUBLIC_DOMAIN`

If `VITE_API_BASE_URL` is empty, desktop will fallback to these keys.
Recommended: copy `NEXT_PUBLIC_BASE_URL` from `D:\vxspace\frontend\.env` into desktop `.env.local`.

### OAuth cert error in dev

If Google popup shows `ERR_CERT_AUTHORITY_INVALID`, enable temporary dev bypass:

```env
ELECTRON_ALLOW_INSECURE_CERT=1
```

Then restart `npm run dev`.
Use this only for local/dev. Keep it `0` in production.
Electron main process reads `.env.local` / `.env` at startup for this flag.

## Current integrated API features

- Auth: sign in, sign up, verify token, sign out.
- Auth: Google OAuth sign in (Electron popup flow).
- Auth: Google OAuth via system browser + desktop handoff token (`talkspace-desktop://oauth-callback`).
- Rooms: list rooms, list my rooms, create, open, close, delete.
- Join/leave: prejoin, token/guest-token, leave room.
- Participants: list users in room, assign member/co-host, demote to audience.
- Favorites: favorite/unfavorite room.
- Profile settings: update name/username.
- Programs: submit host request.
- Conference: submit speaker request (audience side).
