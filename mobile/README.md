# Spirited Workspace Android app

This is an installable Android application built with Capacitor. It packages Spirited Workspace inside an Android WebView and adds Android app links, system-browser Google sign-in, and native PDF handoff. App screens launch from the Android app drawer and do not depend on a Chrome home-screen shortcut.

## Build a debug APK

Requirements: Node.js 22+, Android Studio, Android SDK Platform 36, and the Android SDK Build Tools installed through Android Studio.

From this folder:

```sh
npm ci
npm run build:debug
```

The APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`. It can be sideloaded for testing. A Play Store release needs a release signing key and an Android App Bundle; do not publish a debug APK as a store release.

## Google sign-in setup

The Android app uses the system browser and PKCE, then returns to `spirithub://auth/callback`. Add that exact URI to Supabase Authentication's redirect URL allow-list. Google continues to redirect to Supabase's existing callback URL, so no Google OAuth client secret is placed in the Android app and no Google Cloud authorized redirect URI changes are needed.

## Build notes

- `npm run build:web` copies the repository-root Spirited Workspace app and `assets/` into `www/`, then bundles the native Capacitor bridges.
- `npx cap sync android` updates Android's packaged web assets and plugin registrations.
- The hosted GitHub Pages app remains a normal web app; native plugins load only