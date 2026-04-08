# Native shell (iOS & Android) — branch workflow & Capacitor

## Branches

| Branch        | Purpose |
|---------------|---------|
| `main`        | Shared work for **all** users (browser PWA + server). |
| `native-shell`| `main` **plus** Capacitor / Xcode / Android Studio / store-only files. |

Merge `main` → `native-shell` often: `git merge main` while on `native-shell`.

---

## What was added (Capacitor)

- **`capacitor.config.ts`** — app id `co.ponofit.app`, display name **Pono Fit**, **`webDir`: `www`**
- **`www/index.html`** — tiny fallback if remote URL is missing (normally the WebView loads your **deployed** site)
- **`ios/`** — Xcode project
- **`android/`** — Android Studio / Gradle project

Both load your **live Next.js deployment** in a WebView (`server.url`), so API routes and SQLite stay on the server — no static export of the whole app.

Run **`npm run cap:sync`** after changing Capacitor config, plugins, or `www/`.

### URL the app opens

Set one of these in **`.env.local`** (same as Next):

- **`NEXT_PUBLIC_APP_URL`** — e.g. `https://app.beponofitco.com` (used for Capacitor if set)
- or **`CAPACITOR_SERVER_URL`** — overrides for the native shell only (e.g. local dev)

Then run:

```bash
npm run cap:sync
```

`npx cap sync` reads `.env.local` via `dotenv` in `capacitor.config.ts` and writes native config under `ios/` and `android/` (some paths are gitignored — regenerate with `cap sync`).

**Local dev against your Mac:** use your LAN IP, e.g. `CAPACITOR_SERVER_URL=http://192.168.1.10:3000` and `npm run dev` with host `0.0.0.0` if needed; `cleartext` is enabled for `http:`.

---

## Commands

```bash
npm install
npm run cap:sync          # copy web assets + update native project
npm run cap:ios           # open Xcode
npm run cap:android       # open Android Studio
```

**iOS:** In Xcode: pick your team, set signing, choose a device or simulator, Run.

**Android:** In Android Studio: open the `android` folder, let Gradle sync, Run on an emulator or device (USB debugging). For Play Store you’ll use **Build → Generate Signed Bundle / APK** when ready.

---

## Push `native-shell` to GitHub (you’re on the branch)

```bash
git status
git add -A
git commit -m "Add Capacitor iOS + Android native shell"
git push -u origin native-shell    # first time only; after that: git push
```

If `native-shell` already exists on the remote, use `git push` (no `-u` needed after the first push).

To confirm which branch you’re on: `git branch --show-current`

---

## App Store (Apple)

1. Apple Developer Program (you have this).
2. In Xcode: **Signing & Capabilities** → your team, unique bundle ID if you change from `co.ponofit.app`.
3. **Archive** → **Distribute App** → App Store Connect.

---

## Google Play (Android)

1. [Google Play Console](https://play.google.com/console) developer account.
2. Create an app listing; use **App bundle** (AAB) from Android Studio.
3. Signing: create or use an upload key in Android Studio (**Build → Generate Signed Bundle**).

---

## Next: Kisi Tap-to-Unlock

Requires **native** iOS/Android code (Kisi SDK) to read the reader beacon and send `proximity_proof` to your existing `/api/kisi/unlock` — not in the WebView.

Git commands (switch vs create):

```bash
git switch native-shell
git switch main
# Create a branch once:
git switch -c branch-name
```
