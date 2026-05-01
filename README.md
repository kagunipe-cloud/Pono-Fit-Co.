# The Fox Says (Pono Fit Co.)

Next.js gym operations app: member directory, bookings, Stripe checkout, subscriptions and renewals, optional **Kisi** door access, liability waivers, optional AI macro calculator, and a Capacitor-ready native shell. Persistent data lives in **SQLite** at `data/the-fox-says.db` (created on first use).

## Quick start

1. **Install**

   ```bash
   npm install
   ```

2. **Environment** — Create `.env.local` in the project root with the variables your deployment needs (Stripe, Kisi, session secret, email, etc.). See **`DEPLOY.md`** for hosting env vars and **`MEMBER-LOGIN.md`** for member login and optional SMTP.

3. **Import CSV (optional)** — One-time or supplemental member import:

   ```bash
   npm run import
   ```

   By default the script reads `The Fox Says - Members.csv` in the project root. Override with `CSV_PATH=YourFile.csv npm run import`.

4. **Development**

   ```bash
   npm run dev
   ```

   Open [http://127.0.0.1:3000](http://127.0.0.1:3000). If the dev server misbehaves with the default bundler, try **`npm run dev:webpack`**.

## Scripts

| Command | Purpose |
|--------|---------|
| `npm run dev` | Next.js dev server (`127.0.0.1:3000`) |
| `npm run dev:webpack` | Same host/port, webpack bundler |
| `npm run build` | Production build |
| `npm run start` | Production server |
| `npm run lint` | ESLint (`--max-warnings 0`) |
| `npm run import` | Import member CSV → SQLite |
| `npm run cap:sync` | Sync Capacitor native projects |
| `npm run cap:ios` / `npm run cap:android` | Open Xcode / Android Studio |

## Documentation

| Doc | Contents |
|-----|----------|
| **`LOADING-CHECKLIST.md`** | Local dev won’t start / blank page troubleshooting |
| **`MEMBER-LOGIN.md`** | Member login, passwords, PWA icons, post-purchase email |
| **`DEPLOY.md`** | Railway / Render / Vercel caveats, SQLite volume, env checklist |
| **`CRON-RENEWALS.md`** | Renewal cron (in-process `src/instrumentation.ts` vs `vercel.json`) |
| **`KISI.md`** | Door access, API keys, unlock webhook |
| **`BRANDING.md`** | Colors, PWA icons |
| **`docs/`** | Stripe webhook, occupancy, Gmail API email, multi-tenant notes, usage tracking, App Store notes, etc. |

Staff tools after admin login include **Members**, reports, **Email members** (`/admin/email-members`), onboarding import (`/admin/import-onboarding`), and settings — see the sidebar in-app.
