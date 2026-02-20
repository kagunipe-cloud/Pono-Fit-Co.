# Member login and PWA

## How member login works

- **Sign in:** Members use **email + password** on `/login`.
- **First-time setup:** Each member sets a password **once** on `/set-password`, then signs in with email + password only.
- **Member ID not required for first-time login:** If a member goes to **Sign in**, enters their **email** and any password, and they haven’t set a password yet, they are redirected to `/set-password` with both Member ID and email prefilled in the link. So they never need to know their Member ID if they use Sign in first.
- If they open `/set-password` directly (e.g. from an old link), they must enter Member ID + email. You can send everyone their Member ID from Admin → Email all members → **Send everyone their Member ID**.

## SESSION_SECRET (required for member login)

Member login uses a signed cookie. Add to `.env.local`:

```bash
SESSION_SECRET=your-random-secret-at-least-16-chars
```

Use a long random string (e.g. 32 characters). Without it, member login will fail.

**One-time setup:** Set it once and leave it. If you change it, all existing member sessions are invalid and everyone must sign in again.

## Post-purchase email (optional)

After a successful purchase, the app can email the member their **member number** and a link to set a password so they can get access without coming in.

### Using Gmail

1. Use a Gmail account (e.g. your gym address). For security, use an **App Password**, not your normal password:
   - Go to [Google Account → Security](https://myaccount.google.com/security) and turn on **2-Step Verification** if it’s not already on.
   - Then open [App passwords](https://myaccount.google.com/apppasswords), create a new app password for “Mail”, and copy the 16-character password.
2. Add to `.env.local`:
   ```bash
   EMAIL_SMTP_USER=your@gmail.com
   EMAIL_SMTP_PASS=xxxx-xxxx-xxxx-xxxx
   ```
   (No spaces in the app password.)
3. (Optional) Set the “from” name: `EMAIL_FROM=Pono Fit Co. <your@gmail.com>`. If unset, it uses “Pono Fit Co.” with your `EMAIL_SMTP_USER` address.
4. (Optional) Set `NEXT_PUBLIC_APP_URL=https://yourdomain.com` so the “Set your password” link in the email uses your real site URL.

If `EMAIL_SMTP_USER` and `EMAIL_SMTP_PASS` are not set, the purchase still completes; no email is sent.

### Other SMTP providers

You can use any SMTP server by setting:

- `EMAIL_SMTP_HOST` (default: `smtp.gmail.com`)
- `EMAIL_SMTP_PORT` (default: `587`)
- `EMAIL_SMTP_USER` and `EMAIL_SMTP_PASS`
- `EMAIL_FROM` (optional)

## PWA icons

The app manifest references `/icon-192.png` and `/icon-512.png`. To get a proper “Add to Home Screen” icon:

1. Add two PNG files to the **`public/`** folder:
   - **icon-192.png** — 192×192 pixels
   - **icon-512.png** — 512×512 pixels

2. You can use **`public/icon.svg`** as a reference (amber square with fox) and export PNGs from it, or use any image editor / [realfavicongenerator.net](https://realfavicongenerator.net/) / [favicon.io](https://favicon.io/) to generate 192 and 512 PNGs.

If the icon files are missing, the app is still installable; the browser may use a default icon.
