# Deploying The Fox Says (Pono Fit Co.) for testing

Your app is **Next.js** with **SQLite** (file at `data/the-fox-says.db`) and **in-process cron** (subscription renewal, expiry reminders, PT session processing). For that stack you need:

1. A host that can run a **long-running Node process** (so the DB file and cron work).
2. **Persistent storage** for the `data/` folder (so the SQLite DB isn’t wiped on redeploy).
3. All **env vars** from `.env.local` set in the host’s dashboard (never commit real secrets).

---

## Option A: Railway (good for testing)

Railway gives you a persistent volume and runs `next start` so SQLite and cron both work.

### 1. Push your code

- Create a repo on GitHub (if you don’t have one) and push your project.
- **Do not** commit `.env.local`. Use Railway’s environment variables instead.

### 2. Create a Railway project

1. Go to [railway.app](https://railway.app) and sign in (e.g. with GitHub).
2. **New Project** → **Deploy from GitHub repo** → choose your repo.
3. Railway will detect Next.js and set **Build Command**: `npm run build`, **Start Command**: `npm start` (or `npx next start`). You can leave these as-is.

### 3. Add persistent storage for SQLite

1. In your Railway project, open your service.
2. Go to **Variables** or **Settings** and add a **Volume**.
3. Mount the volume at path: **`/app/data`** (or `/app` if Railway uses that as app root; check the docs for the exact app path).
4. Your app uses `process.cwd()` and `data/the-fox-says.db`, so the DB path is `{cwd}/data/the-fox-says.db`. The volume must cover that `data` directory. Typically the app runs with cwd = `/app`, so mounting at **`/app/data`** is correct. If your app root is different, mount so that `data/` is inside the mounted path.

### 4. Set environment variables

In Railway → your service → **Variables**, add every variable from `.env.local` (copy the **names** and **values** from your local file; use **test** Stripe keys for testing):

- `STRIPE_SECRET_KEY`
- `KISI_API_KEY`
- `KISI_GROUP_ID`
- `SESSION_SECRET` (use a long random string; e.g. `openssl rand -base64 32`)
- `EMAIL_SMTP_USER`
- `EMAIL_SMTP_PASS`
- `EMAIL_FROM`
- `BRAND_NAME`
- `ADMIN_EMAIL`
- `FDC_API_KEY`
- `GEMINI_API_KEY` (if you use it)
- `NEXT_PUBLIC_APP_URL` → set to your Railway URL, e.g. `https://your-app.up.railway.app`
- `CRON_SECRET` (optional; same secret you’d use if you ever call cron APIs from outside; e.g. `openssl rand -hex 24`)

Do **not** commit these values; only set them in Railway.

### 5. Deploy

- Push to the branch Railway watches; it will build and deploy.
- After deploy, open the URL Railway gives you (e.g. **Settings → Domains**). The app will create `data/the-fox-says.db` on first run if the volume is mounted correctly.

### 6. Cron

- Your `instrumentation.ts` only runs when **not** on Vercel (`VERCEL !== "1"`). On Railway it will run, so the in-process cron (daily renewal, expiry reminders, hourly PT processing) will run as long as the service is up.
- For production you can later add an external cron (e.g. cron-job.org) that calls your API with `x-cron-secret` / `CRON_SECRET` if you want a backup or move off in-process cron.

---

## Option B: Render

1. [render.com](https://render.com) → **New** → **Web Service** → connect your GitHub repo.
2. **Build**: `npm install && npm run build`
3. **Start**: `npm start`
4. Add a **Disk** (persistent storage) and mount it so that your app’s `data/` directory is on that disk (Render docs show the mount path, e.g. `/opt/render/project/data`). You may need to set an env var or change `db.ts` to use a path on that disk (e.g. `process.env.DATA_PATH || "data"`).
5. Set all the same env vars as in Option A; set `NEXT_PUBLIC_APP_URL` to your Render URL.
6. Deploy. Cron in `instrumentation.ts` will run on Render because it’s not Vercel.

---

## Option C: Vercel (only if you change the database)

- **Vercel** does **not** keep a writable filesystem between requests, so **SQLite in `data/` will not persist** (and can fail in serverless).
- To use Vercel you’d need to:
  - Move to a hosted DB (e.g. **Turso** for SQLite, or Postgres), and
  - Use **Vercel Cron** (or an external cron) to call your cron API routes with `CRON_SECRET`.
- For “testing” as-is with SQLite, use **Railway or Render** (Option A or B).

---

## Checklist before going live

- [ ] All env vars set on the host (no `.env.local` in the repo).
- [ ] `NEXT_PUBLIC_APP_URL` = your real app URL (for Stripe redirects, emails, etc.).
- [ ] Stripe: use **test** keys for testing; switch to **live** keys when you’re ready for real payments.
- [ ] `SESSION_SECRET` is a long random string (different from local).
- [ ] Persistent volume/disk attached so `data/the-fox-says.db` is not lost on redeploy.
- [ ] After first deploy, open the app and log in once so the DB initializes; then check admin and member flows.

---

## Quick test after deploy

1. Open `NEXT_PUBLIC_APP_URL` in the browser.
2. Log in as admin (or create an admin user if you have a seed path).
3. Confirm you see the dashboard and that the DB is being used (e.g. members list or schedule).
4. (Optional) Call a cron endpoint manually with `CRON_SECRET` in the header to confirm cron APIs respond.

If you tell me which host you prefer (Railway vs Render), I can narrow the steps to that one and add any project-specific path or env details.
