# SpiritHUB Workspaces

A class collaboration space organized as **workspaces → semesters → subject channels**, with chat, PDF and screenshot sharing, invite links, and optional study tools.

- **Admins** create the workspace with its academic year, add semesters (Sem 1, Sem 2…) and subject channels with course codes, reset the invite, make other admins, and remove people.
- **Every member** can copy the invite link or code, join more workspaces with **↗**, and see the 100 MB storage meter. It turns amber at 80%, and admins get a **Free up space** link.
- **In chat**, everyone can reply to a message, react with 👍 ❤️ 😂 🔥 🎉, add emoji, send one of six stickers, share GIFs up to 5 MB, and **@mention** classmates (type @ or tap the @ button); the people you mention get a notification. Each workspace has a **📷 Memories** photo gallery. Photos and screenshots over 1 MB are shrunk before upload.
- **Notifications**: the 🔔 bell lists new messages from other channels and classmates' birthdays (only the day and month are stored). Browser pop-ups can be turned on while SpiritHUB is open.
- **Ask AI**: each channel has an Ask AI tab for chatting with the model on your own laptop about that channel's files. Saved summaries are included automatically, and you can tap up to two files to have it read them in full. The chat is private and stays in your browser; **Share in #channel** posts an answer for everyone.
- **Spirit AI (online)**: a workspace assistant in the left navigation above Memories. Every signed-in member can use it, with a separate chat for each member and workspace. Only that member can view their Spirit AI history on that device; it is not shared with the room. It answers questions and reads a PDF or screenshot you attach, does not use Ollama, and uses Gemini’s free API tier. Quota limits can pause it, and Google may use free-tier requests to improve its products.
- **Backup on every device**: each phone or laptop keeps a copy of the workspaces it opens (messages, files and Memories photos) in the browser, updated every few minutes while SpiritHUB is open. The line under the storage meter shows when it last updated; tap it for details. Signing out can also delete it, for shared computers.
- **Phones**: the chat, tabs and message box are laid out for small screens.
- **Photos**: admins give each workspace a photo (shown in the left bar instead of its initials) and a chat background in **▾ → Workspace settings**. Everyone adds their own profile photo by clicking their name in the bottom corner; classmates see it next to their messages.
- **Admin panel** (▾ → Admin panel, admins only): everything the workspace keeps in Supabase, including storage per channel, each channel's messages and files, each member's activity, and every file with Open and Delete. **Free up space** moves older files off Supabase: they're saved on the admin's device first, stay on every device that backed them up, and keep their names and AI summaries in the chat. Sign-in emails are never shown.
- **Everyone** signs in with email and password from any device, chats, uploads PDFs and images (up to 50 MB each), and can summarize any file with their local AI. Saved summaries show up for the whole channel.

## 1. Set up Supabase (once, free plan)

1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor → New query**: paste all of `hub/schema.sql` and click **Run**.
3. **Authentication → Sign In / Providers → Email**: turn off **Confirm email**. Otherwise every new account waits for a confirmation email, and Supabase's built-in mailer only sends a few per hour. With it off, Supabase sends no email at all.
4. **Project Settings → API**: copy the **Project URL** and the **anon public** key into `hub/config.js`. That key is meant to be public; never put the `service_role` key in this app.

The tables are prefixed `hub_`, so this can share a Supabase project with the main SpiritHUB app.

**Set up before these features were added?** Run the files in `hub/updates/` that your project hasn't had yet, in order, once each in the SQL Editor:

- `001-admin-options.sql`: academic year, course codes, invite codes every member can copy, and the 100 MB storage limit.
- `002-member-features.sql`: replies, reactions and stickers in chat, the Memories gallery, birthdays, and notifications.
- `003-fix-replies.sql`: lets replies to earlier messages send.
- `004-free-up-space-and-mentions.sql`: Free up space, a guard that stops uploads before the project's 1 GB of file storage fills up, and @mention notifications.
- `005-photos.sql`: workspace photos, chat backgrounds and profile photos.
- `006-custom-invite-codes.sql`: lets admins set a stable custom invite code.
- `007-secure-helpers-and-index-foreign-keys.sql`: restricts membership helper functions to signed-in users and adds indexes for foreign keys.
- `008-cache-auth-in-rls-policies.sql`: evaluates the signed-in user ID once per statement in row access policies.

New projects don't need these updates: `hub/schema.sql` includes all eight.

## 2. Run it

On your own computer, from the repo folder:

```bash
python3 -m http.server 8790 --bind 127.0.0.1 --directory hub
```

Then open http://localhost:8790/.

For classmates on other devices, publish the repo with GitHub Pages (repo **Settings → Pages**, which only the repo owner can change). The app is then at `https://<owner>.github.io/Spirit/hub/`. Invite links use the address you copy them from, so copy them from the published site.

## 3. Local AI on each laptop

One command per laptop installs Ollama if needed, lets the SpiritHUB website use it (kept after restarts), and downloads the `qwen3.5:4b` model (about 3.4 GB):

- **Mac**, in Terminal: `curl -fsSL https://prabhaskodela.github.io/Spirit/hub/setup/mac.sh | bash`
- **Windows**, in Command Prompt or PowerShell: `powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object Net.WebClient).DownloadString('https://prabhaskodela.github.io/Spirit/hub/setup/windows.ps1'))"`

Then in SpiritHUB click **⚙** next to your name → **Test connection** → **Save**. The ⚙ dialog shows these commands with a Copy button whenever it can't reach Ollama. Chrome may ask to let the site reach devices on your local network; allow it. The scripts are in `hub/setup/`; set `SPIRITHUB_SITE` to allow a different address.

The file goes from Supabase to your browser and to the model on your laptop. It isn't sent anywhere else.

## 4. Spirit AI (online, free tier)

Spirit AI is independent from Local AI (Ollama). Open it from the workspace navigation, above Memories. Each workspace has its own Spirit AI chat. It sends the signed-in user's question and optional PDF/image to a Supabase Edge Function, which checks workspace membership and calls Gemini. Conversations are kept in that browser; uploads are sent for inference and are not saved as Spirit AI chat attachments.

To enable it without a local model:

1. In Google AI Studio, create an API key using a free-tier project/model. **Do not link a billing account** if you want Google requests to stop at free limits instead of becoming billable. Free-tier eligibility and quotas can vary by account and change over time.
2. In Supabase **Project Settings → Edge Functions → Secrets**, add `GEMINI_API_KEY` with that key. Never put the key in `config.js`, GitHub, or a chat message.
3. From a terminal with the Supabase CLI installed, run these commands from the repository:
   ```sh
   cd hub
   supabase login
   supabase link --project-ref YOUR_SUPABASE_PROJECT_REF
   supabase functions deploy spirit-ai
   ```
4. Spirit AI is available from the workspace navigation above **Memories**, whether or not a chat room is selected. It accepts one PDF, PNG, JPEG, or WebP attachment up to 4 MB with a question. If Gemini's free quota is exhausted or unavailable, it shows a limit/setup message and does not choose a paid model.

Supabase's Free plan currently includes 500,000 Edge Function calls monthly. Keep the Supabase project on the Free plan for the no-cost setup; usage caps can pause the feature. Google states that free-tier requests may be used to improve its products, so don't upload private or sensitive material.

## Free-plan limits

500 MB database, 1 GB of file storage shared by every workspace, and 50 MB per file. Uploads stop at 950 MB for the whole project, so it never gets stuck full; admins then free up space. Supabase pauses free projects after a week without activity; open the dashboard to wake it up.

## How access works

- Row-level security lets people see only the workspaces they belong to.
- Only admins can see or reset the invite code. Resetting it makes old links stop working.
- Files are in a private storage bucket and open through short-lived signed links.
- The workspace owner can't be removed or demoted, and only the owner can delete the workspace.
