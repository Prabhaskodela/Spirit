# Spirited Workspace for Android

This is a separate Kotlin/Jetpack Compose Android app in the `android-native` development branch. It does not replace the website or its Capacitor project.

## Architecture

- Single-activity Android application with Jetpack Compose UI and Android system navigation.
- Supabase Kotlin client for Auth, PostgREST, Realtime, and Storage.
- Existing `config.js` supplies the public Supabase URL and anon/publishable key at build time. No service-role key is used.
- Auth session data is stored using the Android Keystore-backed session manager.
- Existing public tables and the private `hub-files` bucket are used under their current RLS policies. This app adds no database migrations.
- Native Android document pickers handle uploads and downloads. PDF pages are rendered with `PdfRenderer` and images are previewed in-app.
- The artwork and timing of the existing website boot animation are carried into the app launch experience.

## Build

Open `native-android` in Android Studio with JDK 17 and Android SDK 36. The project uses Gradle 8.14.3.

```powershell
.
\gradlew.bat :app:assembleDebug
```

The debug APK is written to `app/build/outputs/apk/debug/app-debug.apk`. Debug builds use the Android debug signing key and are for installation/testing, not Play Store distribution.

## Google OAuth

The Supabase project reports Google Auth enabled, and a read-only authorization endpoint check accepted this callback URI. Keep it registered in the Supabase Auth URL allow list and in the Google/Supabase OAuth configuration:

```text
spirithubnative://auth/callback
```

The app uses the Supabase PKCE OAuth flow. A real Google sign-in still needs to be completed on an Android device or emulator.

## Release signing

Do not commit a keystore or passwords. In Android Studio, configure a private release keystore using the signing wizard, or supply signing values through a local, untracked Gradle properties file. Keep the keystore and credentials outside Git. Build the release APK/AAB only after signing is configured and verified.

## Current verification boundary

The debug APK compiles and packages. The unit-test task currently has no tests. No Android device or emulator was attached during this build, so UI behavior, OAuth handoff, file picker behavior, PDF gestures, and runtime performance have not been device-verified. Website parity features such as workspace administration, settings, reactions, notifications, AI tools, and full profile management still require native implementation before this can be called a complete production migration.
