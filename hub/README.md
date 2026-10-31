# SpiritHUB Workspaces

Discord-style class spaces: **workspaces → semesters → subject channels**, with chat, PDF and screenshot sharing, invite links, and AI summaries made on each student's own laptop.

- **Admins** create the workspace with its academic year, add semesters (Sem 1, Sem 2…) and subject channels with course codes, reset the invite, make other admins, and remove people.
- **Every member** can copy the invite link or code, join more workspaces with **↗**, download a ZIP backup of everything, and see the 100 MB storage meter.
- **In chat**, everyone can reply to a message, react with 👍 ❤️ 😂 🔥 🎉, add emoji, send one of six stickers, and share GIFs up to 5 MB. Each workspace has a **📷 Memories** photo gallery.
- **Notifications**: the 🔔 bell lists new messages from other channels and classmates' birthdays (only the day and month are stored). Browser pop-ups can be turned on while SpiritHUB is open.
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

New projects don't need them, because `hub/schema.sql` already includes both.

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
- **Windows**, in PowerShell: `irm https://prabhaskodela.github.io/Spirit/hub/setup/windows.ps1 | iex`

Then in SpiritHUB click **⚙** next to your name → **Test connection** → **Save**. The ⚙ dialog shows these commands with a Copy button whenever it can't reach Ollama. Chrome may ask to let the site reach devices on your local network; allow it. The scripts are in `hub/setup/`; set `SPIRITHUB_SITE` to allow a different address.

The file goes from Supabase to your browser and to the model on your laptop. It isn't sent anywhere else.

## Free-plan limits

500 MB database, 1 GB of file storage shared by every workspace, and 50 MB per file. Supabase pauses free projects after a week without activity; open the dashboard to wake it up.

## How access works

- Row-level security lets people see only the workspaces they belong to.
- Only admins can see or reset the invite code. Resetting it makes old links stop working.
- Files are in a private storage bucket and open through short-lived signed links.
- The workspace owner can't be removed or demoted, and only the owner can delete the workspace.
