# Videoconference Layout Map

Tài liệu này mô tả các layout hiện có của màn hình Videoconference trong code hiện tại.

## 1. Tổng quan

Luồng chính:

```text
App shell
└── Conference page
    └── conference-layout
        └── conference-main conference-main-meeting
            └── LiveVideoStage
                ├── GridLayout
                ├── FocusLayout
                ├── FocusLayout + screenshare variant
                ├── Control bar
                ├── Chat drawer
                └── Settings drawer
```

## 2. Các layout chính

### 2.1 Conference shell

Đây là khung bao ngoài của trang meeting.

```text
conference-layout
└── conference-main conference-main-meeting
    └── LiveVideoStage
```

Vai trò:

- Giữ toàn bộ meeting trong một vùng riêng.
- Tạo nền cho layout meeting.
- Điều khiển chia cột/khoảng cách giữa stage và drawers.

### 2.2 Grid layout

Khi chưa có track được pin/focus, stage dùng layout lưới.

```text
LiveVideoStage
└── livekit-grid-wrapper
    └── GridLayout
        └── ParticipantTile
```

Khi nào xuất hiện:

- Không có `focusTrack`.
- Thường là trạng thái mặc định của meeting room.

Ý nghĩa:

- Hiển thị nhiều participant theo kiểu grid.
- Phù hợp cho cuộc họp nhiều người.

### 2.3 Focus layout

Khi có một track được pin, stage chuyển sang layout focus.

```text
LiveVideoStage
└── livekit-focus-wrapper
    └── FocusLayoutContainer
        ├── CarouselLayout
        └── FocusLayout
```

Khi nào xuất hiện:

- Có `focusTrack`.
- Track đang pin là camera của một participant hoặc track khác được LiveKit chọn.

Ý nghĩa:

- Một track lớn ở vùng chính.
- Một hàng carousel cho các track còn lại.

### 2.4 Screenshare focus layout

Đây là biến thể của focus layout khi track đang pin là screen share.

```text
LiveVideoStage
└── livekit-focus-wrapper livekit-focus-wrapper--screenshare
    └── FocusLayoutContainer
        ├── FocusLayout   (screen share)
        └── CarouselLayout (participants)
```

Khi nào xuất hiện:

- `focusTrack.publication.source === ScreenShare`

Ý nghĩa:

- Nội dung share là vùng chính.
- Participant carousel nằm cạnh bên.

### 2.5 Control bar

Thanh điều khiển nằm ở đáy stage.

```text
LiveVideoStage
└── control-bar-shell
    └── lk-control-bar lk-control-bar--custom
        ├── Mic
        ├── Camera
        ├── Share screen
        ├── Record
        ├── Chat
        ├── Settings
        └── Leave
```

Ý nghĩa:

- Điều khiển audio/video.
- Chia sẻ màn hình.
- Ghi hình.
- Mở chat và settings.

## 3. Overlay panels

### 3.1 Chat drawer

```text
conference-layout
└── chat-panel chat-panel-drawer
```

Khi nào xuất hiện:

- `chatOpen === true`

Ý nghĩa:

- Trượt ra từ bên phải.
- Có backdrop để focus vào chat.

### 3.2 Settings drawer

```text
LiveVideoStage
└── livekit-settings-drawer
```

Khi nào xuất hiện:

- User mở settings panel trong meeting.

Ý nghĩa:

- Chọn microphone, camera, recording mode, recording quality.

## 4. Layout bao ngoài theo context

### 4.1 Main immersive page

```text
main-section.main-section-immersive
└── conference-layout or detail-layout
```

Khi nào dùng:

- Khi đang ở trang detail hoặc conference cần chiếm toàn bộ chiều cao.

### 4.2 Conference window root

```text
conference-window-root
└── conference-main
    └── LiveVideoStage
```

Khi nào dùng:

- Khi meeting được mở trong cửa sổ Electron riêng.

Ý nghĩa:

- Đồng bộ palette và spacing riêng cho window conference.

## 5. Bảng phân loại nhanh

| Layout | Khi nào hiện | Thành phần chính |
| --- | --- | --- |
| Grid view | Không có focus track | `GridLayout` |
| Focus view | Có track pin | `FocusLayout` + `CarouselLayout` |
| Screenshare focus | Focus track là screen share | `FocusLayout` + `CarouselLayout` |
| Control bar | Luôn có trong meeting | Nút mic/cam/share/record/chat/settings/leave |
| Chat drawer | `chatOpen = true` | `chat-panel-drawer` |
| Settings drawer | User mở settings | `livekit-settings-drawer` |

## 6. Luong render trong code

```text
App.tsx
└── ConferenceView
    └── LiveVideoStage
        ├── useTracks()
        ├── usePinnedTracks()
        ├── GridLayout
        └── FocusLayout
```

## 7. Ghi chu

- `livekit-share-control-layout` vẫn còn trong CSS, nhưng hiện không còn được render trong JSX.
- `Mini meeting` layout đã bị bỏ.
- Share screen hiện dùng cùng stage bình thường, chỉ thay đổi track pin/focus.

