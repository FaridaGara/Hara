# HARA Android

The Android app is a Capacitor 8 shell with application ID `today.hara.app`.
It loads the production HARA web application from `https://www.hara.today` and
keeps the native status and navigation bars visible over the web view.

## Requirements

- JDK 21 and Android SDK 36, installed locally by the project helper
- Android 7 (API 24) or newer device/emulator

Install the command-line toolchain without administrator access:

```bash
npm run android:install-tools
```

## Sync and open

```bash
npm install
npm run android:sync
```

Internet access is required because the current shell loads the deployed HARA
application. A local fallback page is displayed when it cannot be reached.

## Edge-to-edge behavior

- `MainActivity` calls `WindowCompat.enableEdgeToEdge()` during native startup.
- Capacitor `SystemBars` keeps system bars visible and injects
  `--safe-area-inset-*` CSS variables.
- The Next.js viewport uses `viewport-fit=cover`.
- HARA controls and navigation consume the real safe-area insets; no fake status
  bar or gesture indicator is rendered by the website.

## Build

Build a debug APK with the locally installed toolchain:

```bash
npm run android:build
```

A signed Google Play release additionally requires a private keystore and
release signing configuration. Never commit keystores or their passwords.
