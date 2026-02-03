# Savorg Mission Control - macOS App

A native macOS app wrapper for Mission Control, providing a standalone window with Dock icon and strict navigation security.

## Requirements

- macOS 13.0 (Ventura) or later
- Xcode 15.0 or later
- Mission Control backend running at `http://127.0.0.1:3000`

## Quick Start

### Build & Run (Xcode)

1. Open `MissionControl.xcodeproj` in Xcode
2. Press `Cmd+R` to build and run

### Build & Run (Command Line)

```bash
cd apps/mission-control-mac

# Debug build
xcodebuild -project MissionControl.xcodeproj -scheme MissionControl -configuration Debug build

# Release build
xcodebuild -project MissionControl.xcodeproj -scheme MissionControl -configuration Release build
```

The built app will be in `build/Debug/MissionControl.app` or `build/Release/MissionControl.app`.

```bash
# Launch the built app
open build/Debug/MissionControl.app
```

## Starting Mission Control Backend

The app connects to Mission Control at `http://127.0.0.1:3000`. Start it with:

```bash
cd apps/mission-control
npm run start    # Production mode
# or
npm run dev      # Development mode
```

## Features

### Navigation Security

The app enforces strict navigation restrictions:

**Allowed:**
- `http://127.0.0.1:3000/*` - Main Mission Control UI
- `http://localhost:3000/*` - Alternative loopback address
- `blob:http://127.0.0.1:3000/*` - Blob URLs (for downloads)
- `data:` URLs - Inline content (images, etc.)
- `about:blank` - Empty frames

**Blocked (opens in default browser instead):**
- All `https://` URLs
- All `http://` URLs to other hosts
- `file://` URLs
- `javascript:` URLs

### Menu Items

- **Mission Control → Open in Browser** (`Cmd+Shift+O`) - Opens in Safari
- **View → Reload** (`Cmd+R`) - Reloads the WebView
- **View → Retry Connection** (`Cmd+Shift+R`) - Re-checks backend connectivity

### Backend Detection

When the backend is unavailable:
- Shows a friendly "Mission Control is not running" screen
- Provides a **Retry** button
- Displays startup instructions

The app polls the backend every:
- 10 seconds when connected
- 2 seconds when disconnected

## Project Structure

```
MissionControl/
├── MissionControlApp.swift      # App entry point, menu commands
├── ContentView.swift            # Main container with state routing
├── Views/
│   ├── WebViewContainer.swift   # WKWebView + navigation security
│   └── DisconnectedView.swift   # Error state UI
├── Services/
│   └── AppState.swift           # Connection state management
├── Extensions/
│   └── Notifications.swift      # Notification.Name extensions
└── Resources/
    ├── Assets.xcassets/         # App icon (placeholder)
    └── Info.plist               # App configuration
```

## Configuration

### Changing the Port/URL

To change the default URL, modify these files:

1. **`Services/AppState.swift`** - Health check URL:
   ```swift
   private let baseURL = URL(string: "http://127.0.0.1:3000/api/maintenance")!
   ```

2. **`Views/WebViewContainer.swift`** - Allowed hosts and port:
   ```swift
   static let allowedHosts = ["127.0.0.1", "localhost"]
   static let allowedPort = 3000
   static let baseURL = URL(string: "http://127.0.0.1:3000")!
   ```

3. **`Views/WebViewContainer.swift`** - Blob URL prefixes in `isAllowedURL()`:
   ```swift
   return blobString.hasPrefix("blob:http://127.0.0.1:YOUR_PORT/")
   ```

### App Transport Security

The app uses `NSAllowsLocalNetworking` in Info.plist, which:
- Allows HTTP to loopback addresses (127.0.0.1, localhost, ::1)
- Does NOT allow HTTP to LAN or internet addresses
- Is the most restrictive ATS option that works for local development

### Adding a Custom App Icon

1. Create icon images in these sizes:
   - 16x16, 32x32 (16pt @1x, @2x)
   - 32x32, 64x64 (32pt @1x, @2x)
   - 128x128, 256x256 (128pt @1x, @2x)
   - 256x256, 512x512 (256pt @1x, @2x)
   - 512x512, 1024x1024 (512pt @1x, @2x)

2. Add them to `Resources/Assets.xcassets/AppIcon.appiconset/`

3. Update `Contents.json` with filenames:
   ```json
   {
     "filename": "icon_16x16.png",
     "idiom": "mac",
     "scale": "1x",
     "size": "16x16"
   }
   ```

## Security Model

This app maintains the same security posture as Mission Control's web interface:

1. **Loopback-only** - Only connects to 127.0.0.1 or localhost
2. **No external navigation** - External links open in Safari
3. **No file access** - `file://` URLs are blocked
4. **No script injection** - `javascript:` URLs are blocked

The navigation allowlist is enforced at the WKWebView delegate level, preventing any circumvention from web content.

## Troubleshooting

### App shows "Mission Control is not running"

1. Verify the backend is running:
   ```bash
   curl http://127.0.0.1:3000/api/maintenance
   ```

2. Check the port isn't in use by another process:
   ```bash
   lsof -i :3000
   ```

3. Start the backend:
   ```bash
   cd apps/mission-control && npm run start
   ```

### External links not opening in browser

The app should automatically open external links in your default browser. If this isn't working:

1. Check Console.app for errors from MissionControl
2. Verify the URL scheme is `http://` or `https://`

### Build fails with signing errors

For local development without signing:

1. In Xcode, select the MissionControl target
2. Go to Signing & Capabilities
3. Set Team to "None" or your personal team
4. Uncheck "Automatically manage signing" if needed

## License

MIT License - see repository root LICENSE file.
