# Spirited Workspace Android app

This is an installable Android application built with Capacitor. It packages Spirited Workspace inside an Android WebView and adds Android app links, native Google Credential Manager sign-in, and native PDF handoff. App screens launch from the Android app drawer and do not depend on a Chrome home-screen shortcut.

## Build a debug APK

Requirements: Node.js 22+, Android Studio, Android SDK Platform 36, and the Android SDK Build Tools installed through Android Studio.

From this folder:

```sh
npm ci
npm run build:debug
```

The APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`. It can be sideloaded for testing. A Play Store release needs a release signing key and an Android App Bundle; do not publish a debug APK as a store release.

## Google sign-in setup

Native Google sign-in uses Android Credential Manager and sends the returned ID token to Supabase Auth. Set `GOOGLE_WEB_CLIENT_ID` in `mobile/native-google-auth-config.js` to the Web application OAuth client ID (`...apps.googleusercontent.com`). The same Web client ID must be enabled in the Supabase Google provider settings. The Web client ID is public app configuration; never put its client secret in the app.

In Google Cloud Console, create an Android OAuth client in the same project using package name `com.prabhaskodela.spirithub` and the SHA-1 certificate fingerprint for the APK users install. The debug APK's fingerprint can be read with `keytool -printcert -jarfile app-debug.apk`. For a Play Store app, also register its Play App Signing certificate. The Google consent screen must allow the account being used (add it as a test user while the app is in Testing).

The browser based Google OAuth flow remains in place on the website. Android uses Credential Manager directly and does not open the browser.

## Build notes

- `npm run build:web` copies the repository-root Spirited Workspace app and `assets/` into `www/`, then bundles the native Capacitor bridges.
- `npx cap sync android` updates Android's packaged web assets and plugin registrations.
- The hosted GitHub Pages app remains a normal web app; native plugins load only
