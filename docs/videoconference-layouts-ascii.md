# Videoconference Layouts

This file uses plain ASCII diagrams to show the current layout shapes in the app.

## 1. Big Picture

```text
App shell
|
`-- Conference page
    |
    `-- conference-layout
        |
        `-- conference-main conference-main-meeting
            |
            `-- LiveVideoStage
                |-- GridLayout
                |-- FocusLayout
                |-- Screenshare focus variant
                |-- Control bar
                |-- Chat drawer
                `-- Settings drawer
```

## 2. Layout Types

### 2.1 Grid View

Used when there is no pinned/focused track.

```text
+---------------------------------------------------+
| livekit-grid-wrapper                              |
|  +---------------------------------------------+  |
|  | GridLayout                                  |  |
|  | +--------+ +--------+ +--------+            |  |
|  | | tile   | | tile   | | tile   |            |  |
|  | +--------+ +--------+ +--------+            |  |
|  | +--------+ +--------+ +--------+            |  |
|  | | tile   | | tile   | | tile   |            |  |
|  | +--------+ +--------+ +--------+            |  |
|  +---------------------------------------------+  |
+---------------------------------------------------+
```

Use case:

- Default meeting state
- No `focusTrack`

### 2.2 Focus View

Used when a track is pinned.

```text
+-------------------------------------------------------------+
| livekit-focus-wrapper                                        |
|  +-------------------+  +----------------------------------+ |
|  | CarouselLayout    |  | FocusLayout                      | |
|  | +-----+           |  |                                  | |
|  | |tile |           |  |  main pinned video               | |
|  | +-----+           |  |                                  | |
|  | +-----+           |  |                                  | |
|  | |tile |           |  |                                  | |
|  | +-----+           |  +----------------------------------+ |
|  +-------------------+                                       |
+-------------------------------------------------------------+
```

Use case:

- There is a `focusTrack`
- Usually a participant camera feed

### 2.3 Screenshare Focus View - Participant Top

Used when the pinned track is screen share and the participant strip is on top.

```text
+-------------------------------------------------------------+
| livekit-focus-wrapper--screenshare                          |
|  +-------------------------------------------------------+  |
|  | CarouselLayout                                        |  |
|  | +-------+ +-------+ +-------+                         |  |
|  | | tile  | | tile  | | tile  |                         |  |
|  | +-------+ +-------+ +-------+                         |  |
|  +-------------------------------------------------------+  |
|  +-------------------------------------------------------+  |
|  | FocusLayout                                          |  |
|  |                                                       |  |
|  |            SHARED SCREEN / PRESENTATION               |  |
|  |                                                       |  |
|  |                                                       |  |
|  +-------------------------------------------------------+  |
+-------------------------------------------------------------+
```

Use case:

- `focusTrack.publication.source === ScreenShare`

### 2.4 Screenshare Focus View - Host

Used when the host is driving the screen share and the participant strip stays pinned at the top.

```text
<-- 150px ---------------------------------------------------->
+-------------------------------------------------------------+
| livekit-focus-wrapper--screenshare                          |
|  +-------------------------------------------------------+  |
|  | CarouselLayout                                        |  |
|  | +-------+                                            |  |
|  | | tile  |                                            |  |
|  | +-------+                                            |  |
|  | +-------+                                            |  |
|  | | tile  |                                            |  |
|  | +-------+                                            |  |
|  +-------------------------------------------------------+  |
|  +-------------------------------------------------------+  |
|  | FocusLayout                                          |  |
|  |                                                       |  |
|  |               SHARED SCREEN / PRESENTATION            |  |
|  |                                                       |  |
|  |                                                       |  |
|  +-------------------------------------------------------+  |
+-------------------------------------------------------------+
```

Use case:

- Host is sharing their screen
- The participant strip stays in a short top row
- The shared screen keeps the main focus area

### 2.5 Control Bar

The bottom action bar in the meeting.

```text
+-------------------------------------------------------------+
| control-bar-shell                                           |
|  +-------------------------------------------------------+  |
|  | Mic | Cam | Share | Rec | Chat | Settings | Leave    |  |
|  +-------------------------------------------------------+  |
+-------------------------------------------------------------+
```

## 3. Overlay Layouts

### 3.1 Chat Drawer

Slides in from the right.

```text
+------------------------------+--------------------+
| meeting stage                | chat-panel-drawer  |
|                              |                    |
|                              | chat list          |
|                              |                    |
|                              | input + send       |
+------------------------------+--------------------+
```

Use case:

- `chatOpen === true`

### 3.2 Settings Drawer

Shows meeting devices and recording settings.

```text
+------------------------------+--------------------+
| meeting stage                | settings drawer    |
|                              | microphone         |
|                              | camera             |
|                              | recording mode     |
|                              | recording quality  |
+------------------------------+--------------------+
```

## 4. Container Layouts

### 4.1 Conference Page Shell

```text
conference-layout
|
`-- conference-main conference-main-meeting
    |
    `-- LiveVideoStage
```

### 4.2 Immersive Page Mode

```text
main-section.main-section-immersive
|
`-- conference-layout or detail-layout
```

### 4.3 Electron Window Mode

```text
conference-window-root
|
`-- conference-main
    |
    `-- LiveVideoStage
```

## 5. Quick Reference

| Layout | When it appears | Main pieces |
| --- | --- | --- |
| Grid view | No pinned track | `GridLayout` |
| Focus view | Pinned track exists | `FocusLayout` + `CarouselLayout` |
| Screenshare focus | Pinned track is screen share | `FocusLayout` + `CarouselLayout` |
| Control bar | Always in meeting | Mic / Cam / Share / Rec / Chat / Settings / Leave |
| Chat drawer | Chat open | `chat-panel-drawer` |
| Settings drawer | Settings open | `livekit-settings-drawer` |

## 6. Notes

- The old `Mini meeting` layout has been removed.
- Share screen now uses the normal stage and only changes the pinned/focused track.
- `livekit-share-control-layout` still exists in CSS, but it is not currently rendered by JSX.
