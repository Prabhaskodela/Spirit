# SpiritHUB Android app

This is an installable Android application built with Capacitor. It packages the current main-branch SpiritHUB interface in an Android WebView and adds system-browser Google sign-in, deep-link return, and native PDF handoff. It launches from Android's app drawer and is not a Chrome shortcut.

## Build a debug APK

Requirements: Node.js 22+, Android Studio, Android SDK Platform 36, and Android SDK Build Tools 36.0.0.

From this folder:

```sh
npm ci
npm run build:debug
```

The APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`. It can be sideloaded for testing. Play Store distribution needs a release signing key and an Android App Bundle.

## Google sign-in setup

The Android app uses PKCE through the system browser, then returns to `spirithub://auth/callback`. That URL must be present in Supabase Authentication's allowed redirect URLs.

## Build notes

- `npm run build:web` copies the repository's main-branch SpiritHUB interface and public Supabase config into `www/`.
- `npx cap sync android` updates the Android assets and plugins.
- Android packages use the same public Supabase project as the website.
