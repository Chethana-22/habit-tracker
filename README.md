# 100 Days of Code(Me) — Habit Tracker

A code-editor-styled 100-day habit tracker for 10 habits, with cloud sync, login, version history and offline support.
Hosting: **GitHub Pages** (free) · Database + login: **Supabase** (free plan).

```
index.html                       page layout
styles.css                       theme (light/dark, print, mobile)
app.js                           tracker logic + Supabase sync
config.js                        ← put your Supabase URL + anon key here
supabase/schema.sql              tables, Row Level Security, history trigger, ping()
.github/workflows/keepalive.yml  pings Supabase every 3 days (prevents free-plan pausing)
.nojekyll                        tells GitHub Pages to serve files as-is
```

## How your data is protected
| Layer | What it does |
|---|---|
| Supabase Postgres | Main copy, tied to your login, same on every device |
| Row Level Security | Only your account can read/write your row (anon key is safe to publish) |
| `tracker_history` | Automatic snapshot of the previous version every ~6h of changes (last 200 kept) → **History** button |
| Browser cache | Every click is saved locally first; if offline it syncs automatically when you're back online |
| **Backup** button | Downloads a `.json` file — keep one in OneDrive/Google Drive monthly |

---

## Setup (≈20 minutes, one time)

### 1. Create the Supabase project
1. Go to https://supabase.com → sign up → **New project** (choose a region near you, e.g. Mumbai). Save the DB password somewhere safe.
2. Open **SQL Editor → New query**, paste everything from `supabase/schema.sql`, click **Run**. You should see "Success".
3. Open **Project Settings → API** (or **API Keys**) and copy:
   - **Project URL** → `https://xxxx.supabase.co`
   - **anon / publishable key** (NOT the `service_role` / secret key — never put that in the website)

### 2. Configure the site
Edit `config.js`:
```js
export const SUPABASE_URL = "https://xxxx.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOi...";   // or sb_publishable_...
```

### 3. Publish on GitHub Pages
```bash
git init
git add .
git commit -m "100 days of code(me)"
git branch -M main
git remote add origin https://github.com/<your-username>/habit-tracker.git
git push -u origin main
```
Then on GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch → `main` / `(root)` → Save**.
After ~1 minute the site is live at `https://<your-username>.github.io/habit-tracker/`.

### 4. Point Supabase login at your site
Supabase → **Authentication → URL Configuration**:
- **Site URL**: `https://<your-username>.github.io/habit-tracker/`
- **Redirect URLs**: add the same URL

(This makes the email-confirmation and password-reset links open your tracker.)

### 5. Turn on the keep-alive (recommended)
Free Supabase projects pause after ~7 days with little activity (data is kept; you'd have to click "Resume"). Daily use prevents this, but to be safe:
GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**:
- `SUPABASE_URL` = your project URL
- `SUPABASE_ANON_KEY` = your anon key

Then **Actions → supabase-keepalive → Run workflow** once to test (should print `HTTP 200`).
Note: GitHub disables scheduled workflows in repos with no commits for 60 days — if that happens, just re-enable it in the Actions tab.

### 6. Use it
1. Open your site → **Create account** → confirm the email → **Sign in**.
2. Set `start =` to your Day 1, type your 10 habits.
3. Daily: click squares (1 → 4 intensity, 5th click clears; right-click / long-press = clear).
4. Phone: open the site in Chrome/Safari → **Add to Home screen** — it behaves like an app.
5. Finished 100 days? **+ New run** starts the next 100 (optionally keeping habit names). Old runs stay in the `# run` dropdown; `all-time` counts every run.

---

## Run locally / local-only mode
Leave `config.js` empty → data stays in the browser only (no login). To preview locally:
```bash
python -m http.server 8000     # then open http://localhost:8000
```
(Opening `index.html` by double-click won't work — ES modules need a web server.)

## Moving data from the earlier single-file tracker
Click **Backup** in the old HTML file → open the new site → **Restore** → pick that `.json`.

## Troubleshooting
| Symptom | Fix |
|---|---|
| Status bar says `local mode` | `config.js` is empty or not deployed — check values and push again |
| "Email not confirmed" | Click the link in the confirmation email (check spam). Or Supabase → Authentication → Providers → Email → turn off "Confirm email" |
| Confirmation link opens localhost | Fix Site URL in step 4 |
| `sync failed · retrying` | Project paused → Supabase dashboard → **Resume project**. Your clicks are safe in the browser and upload automatically |
| `new row violates row-level security` | Re-run `schema.sql` |
| Page blank on GitHub Pages | Hard refresh (Ctrl+F5); check browser console; make sure `index.html` is at repo root |

## Optional: export a raw DB backup
Supabase → **Table Editor → trackers → Export → CSV**, or SQL:
```sql
select updated_at, data from public.trackers;
```
