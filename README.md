# SpiritHUB

SpiritHUB is a semester-based class space for course files, room chat, and shared memories. It uses the PixelPulse dark, gradient-led visual style and is designed as a static web app backed by Supabase.

The layout adapts to desktop, tablet, and phone screens. The web manifest and service worker support installing SpiritHUB to a device home screen and caching the app shell. Sign-in, messages, uploads, and shared room data require an internet connection; the app shell alone is not an offline copy of class content.

## Free-tier shape

- Front end: static HTML, CSS, and JavaScript; suitable for free GitHub Pages hosting (the repository must be public on GitHub Free).
- Backend: Supabase Google Auth, Postgres, Realtime chat, and private Storage.
- Current Supabase Free limits include 1 GB Storage, a maximum 50 MB per uploaded file, and a possible pause after seven days with low database activity. These are shared project quotas, not per-room allowances. For a zero-cost class project, SpiritHUB should enforce conservative upload caps and show storage guidance. A larger or continuously available service may eventually need a paid plan.
- Google OAuth needs a Google Cloud OAuth client and the Supabase callback URL configured. Do not put the Google client secret or Supabase service-role key in this static app.

## Setup outline

1. Create a Supabase project on the Free plan.
2. Run `schema.sql` in Supabase SQL Editor.
3. Enable Google in Supabase Authentication and configure the OAuth client using Supabase's Google sign-in guide.
4. Add the production site URL and local development URL to Supabase's allowed redirect URLs.
5. Copy the project URL and public anon/publishable key into `app-config.js`.
6. Serve this folder over HTTP (for example, `npx serve .` or VS Code Live Server) while developing. OAuth and browser module imports do not work reliably from a `file://` URL.
7. Publish the folder through GitHub Pages and add that exact URL to the OAuth and Supabase redirect allowlists.

## Initial feature scope

- Google sign-in and a user-selected display name.
- Room creation with an 8-character invite ID, joining by ID, member list, removal controls, and ID rotation.
- Semesters and subjects within each room.
- Admin controls to rename or delete semesters and subjects; deleting also removes their files and subject chat.
- Private subject PDF/image uploads and downloads, both in a shared library and that subject's own chat.
- Room-wide and subject-specific real-time chats with reply context, quick emoji reactions, Unicode emoji, a built-in sticker set, and GIF uploads in the room chat.
- In-app notifications for room messages and birthdays (only month and day are stored; birthday reminders are room-scoped).
- Optional browser notifications while SpiritHUB is open, after each user enables them in the browser.
- A private room memories gallery for images only; videos are not accepted.
- Room storage meter, a 100 MB per-room quota, and ZIP export of room records and media.
- Admin permissions for room organization; row-level security checks room membership in the database.

Files are private to signed-in room members. The browser only contains the public Supabase key; database and Storage row-level security policies enforce room access. Google OAuth is enabled at the provider level, so the login button uses Google accounts and does not ask SpiritHUB users for a separate password. If you mean consumer `@gmail.com` addresses only (excluding Google Workspace accounts), an additional server-side email-domain check will be needed. Birthdays are optional and store only month and day, not the birth year.

Message and birthday alerts appear in the in-app notification center. Browser notifications work while SpiritHUB is open and has permission. Notifications delivered while the app is fully closed need a web-push service worker plus push credentials/server setup; that is a later upgrade and should be configured only after the core app is live.

SpiritHUB includes a fixed six-sticker set and accepts GIF uploads in chat (up to 5 MB). Subject files and photo/video memories allow up to 50 MB per file. Because the 1 GB storage allowance is shared by the whole Supabase project, these limits should be reduced for a large class or video-heavy use. Add an admin storage meter, per-room quota, and image/video compression before inviting a large group.

The shared back end requires the Supabase setup above. Keep the Supabase service-role key private; the browser app uses only the public anon/publishable key and relies on the included database/storage policies.

