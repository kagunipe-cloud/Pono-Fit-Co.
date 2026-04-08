# Native shell (iOS / App Store) — branch workflow

This repo may add a **native wrapper** (e.g. Capacitor) for App Store distribution and Kisi Tap-to-Unlock. The **PWA and production site** stay the primary path; the shell branch carries **extra** iOS/Android project files on top of the same app.

## Branches

| Branch        | Purpose |
|---------------|---------|
| `main`        | Source of truth for **shared** work: API, UI, fixes, anything that should ship for **all** users (browser + future app). |
| `native-shell`| `main` **plus** native-only additions (Xcode project, Capacitor config, Kisi SDK integration, etc.). |

Each branch still contains the **full codebase**; we organize **which commits** land where, not separate “partial” repos.

## Day-to-day

1. **Shared change** (should go to production for everyone): commit on **`main`**, push `main`.
2. **Update the app branch** so it doesn’t fall behind:
   ```bash
   git switch native-shell
   git merge main
   ```
3. **Native-only change**: on **`native-shell`**, commit and push `native-shell`.

## Git commands

**Switch to an existing branch** (no `-c`):

```bash
git switch native-shell
git switch main
```

**Create a branch** (only once):

```bash
git switch -c branch-name
```

If you see `fatal: a branch named 'native-shell' already exists`, use `git switch native-shell` instead.

**Push the app branch** (first time sets upstream):

```bash
git push -u origin native-shell
```

## Tag before big migrations

Optional but recommended: tag `main` before large native work (e.g. `pre-native-shell`) so you can always compare or branch from that point.
