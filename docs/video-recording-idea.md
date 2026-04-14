# Video Call Recording Idea (TalkSpace Desktop)

## Goal

Record video call sessions in a production-safe way, with predictable quality and storage cost.

## Recommended architecture (hybrid)

1. Server-side recording for official room archives.
2. Optional local client recording for host convenience.

Why hybrid:
- Server-side gives stable output and centralized retention.
- Local recording gives instant host export when needed.

## Server-side recording flow

1. Host clicks `Start recording`.
2. Backend validates room role (host/co-host only).
3. Backend starts egress/composite recording in media infrastructure (LiveKit egress style).
4. Media file is written to object storage (S3 compatible).
5. Backend tracks record session state in DB:
   - `id`, `roomId`, `startedBy`, `startedAt`, `endedAt`, `status`, `fileUrl`, `durationSec`, `sizeBytes`.
6. Host clicks `Stop recording` (or auto-stop when room ends).
7. Backend finalizes metadata and emits notification/event to clients.

## Security and compliance

- Require explicit recording consent banner for all participants.
- Log consent event with timestamp and user id.
- Encrypt storage at rest.
- Use signed URLs (short TTL) for playback/download.
- Add retention policy (for example 30/90/180 days).
- Add delete endpoint for host/admin and hard-delete worker for expired files.

## Suggested API additions

- `POST /api/v1/rooms/:id/recordings/start`
- `POST /api/v1/rooms/:id/recordings/stop`
- `GET /api/v1/rooms/:id/recordings`
- `GET /api/v1/recordings/:recordingId`
- `DELETE /api/v1/recordings/:recordingId`

## Minimal DB model

- `RoomRecording`
  - `id` (uuid)
  - `roomId`
  - `startedByUserId`
  - `status` (`recording | processing | ready | failed`)
  - `storageProvider` (`s3`)
  - `storageKey`
  - `durationSec`
  - `sizeBytes`
  - `startedAt`, `endedAt`
  - `errorMessage` (nullable)

## Rollout plan

1. Phase 1: host-only start/stop, server-side recording, basic list/download.
2. Phase 2: consent tracking + retention + signed URL security hardening.
3. Phase 3: recording transcription, chapter markers, search in transcript.

