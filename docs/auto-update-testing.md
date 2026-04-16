# Hướng dẫn test Auto-Update

## Cách 1: Test UI nhanh (không cần build)

Thêm tạm đoạn này vào `electron/main.cjs` bên trong `app.whenReady()`, ngay sau `createMainWindow()`:

```js
// TEST ONLY — xóa sau khi test xong
if (isDev && mainWindow) {
  setTimeout(() => mainWindow.webContents.send('updater:update-available', { version: '1.2.0' }), 4000)
  setTimeout(() => mainWindow.webContents.send('updater:download-progress', { percent: 30 }), 7000)
  setTimeout(() => mainWindow.webContents.send('updater:download-progress', { percent: 75 }), 9000)
  setTimeout(() => mainWindow.webContents.send('updater:update-downloaded', { version: '1.2.0' }), 12000)
}
```

Chạy `npm run dev` → sau 4 giây banner sẽ xuất hiện trong sidebar, tự chạy qua các phase:
- `available` → `downloading 30%` → `downloading 75%` → `ready`

---

## Cách 2: Test full flow với update server thật

### Bước 1 — Tạo `dev-app-update.yml` ở root project

```yaml
provider: generic
url: http://localhost:8080
updaterCacheDirName: talkspace-desktop-updater
```

### Bước 2 — Sửa tạm `electron/main.cjs`

Bỏ guard `isDev` để autoUpdater chạy trong dev:

```js
// Đổi từ:
if (!isDev && mainWindow) {

// Thành:
if (mainWindow) {
```

Thêm `forceDevUpdateConfig` trong `setupAutoUpdater`:

```js
const setupAutoUpdater = (win) => {
  if (isDev) {
    autoUpdater.forceDevUpdateConfig = true  // đọc dev-app-update.yml
  }
  autoUpdater.autoDownload = true
  // ...
}
```

### Bước 3 — Build v0.1.0 (version hiện tại)

```bash
npm run pack:win
```

### Bước 4 — Tăng version, build v0.2.0

Sửa `package.json`:
```json
"version": "0.2.0"
```

Build lại:
```bash
npm run pack:win
```

### Bước 5 — Serve thư mục `release/` trên cổng 8080

```bash
# Dùng serve (npx)
npx serve release --listen 8080

# Hoặc Python
python -m http.server 8080 --directory release
```

### Bước 6 — Cài và chạy

1. Cài app từ installer v0.1.0 (`release/TalkSpace-Setup-0.1.0.exe`)
2. Chạy app lên
3. Sau ~5 giây app tự detect v0.2.0 từ `http://localhost:8080`
4. Banner "Có phiên bản mới v0.2.0" xuất hiện trong sidebar
5. Click **Cập nhật** → download ngầm → Click **Khởi động lại** → cài xong

---

## Dọn dẹp sau khi test

Nhớ revert trước khi commit:

- [ ] Xóa đoạn test fake events trong `main.cjs`
- [ ] Khôi phục guard `if (!isDev && mainWindow)`
- [ ] Xóa `autoUpdater.forceDevUpdateConfig = true`
- [ ] Xóa file `dev-app-update.yml` ở root (hoặc thêm vào `.gitignore`)
- [ ] Revert `version` về `0.1.0` trong `package.json` nếu chưa sẵn sàng release

---

## Cấu hình publish khi release thật

Mở `electron-builder.yml`, uncomment một trong hai provider:

```yaml
# GitHub Releases:
publish:
  provider: github
  owner: your-org
  repo: talkspace-desktop

# Custom / S3-compatible server:
publish:
  provider: generic
  url: https://your-server/releases/
```

Build và publish:
```bash
GH_TOKEN=your_token npm run pack:win
```
