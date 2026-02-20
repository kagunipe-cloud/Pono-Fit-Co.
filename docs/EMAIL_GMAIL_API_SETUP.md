# Sending email via Gmail API (when SMTP is blocked)

If your host (e.g. Railway) blocks outbound SMTP (port 587), use the **Gmail API** instead. It uses HTTPS (port 443) so it isn’t blocked.

## 1. Google Cloud project

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project or select one.
3. **Enable the Gmail API**: APIs & Services → Enable APIs and Services → search “Gmail API” → Enable.

## 2. OAuth credentials

1. APIs & Services → **Credentials** → **Create credentials** → **OAuth client ID**.
2. If asked, configure the **OAuth consent screen**: choose “External” (or “Internal” for Workspace), add your email, save.
3. Application type: **Web application** (required for the Playground).
4. Under **Authorized redirect URIs**, click **Add URI** and add exactly: `https://developers.google.com/oauthplayground`
5. Create. Copy the **Client ID** and **Client secret**.

## 3. Get a refresh token

1. Open [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/).
2. Click the gear (⚙️) and check **“Use your own OAuth credentials”**. Enter your Client ID and Client secret.
3. In “Step 1”, find **Gmail API v1** and select **`https://www.googleapis.com/auth/gmail.send`**. Click **Authorize APIs**.
4. Sign in with the Gmail account that should send the emails. Allow access.
5. In “Step 2”, click **Exchange authorization code for tokens**.
6. Copy the **Refresh token** (long string).

## 4. Set environment variables

In Railway (or your host) add:

| Variable | Value |
|----------|--------|
| `GMAIL_OAUTH_CLIENT_ID` | Your OAuth Client ID |
| `GMAIL_OAUTH_CLIENT_SECRET` | Your OAuth Client secret |
| `GMAIL_OAUTH_REFRESH_TOKEN` | The refresh token from the Playground |
| `GMAIL_FROM_EMAIL` | The Gmail address that will send (same account you authorized) |

Redeploy. The app will send all member emails via the Gmail API over HTTPS.

## Notes

- You can remove SMTP variables (`SMTP_HOST`, etc.) if you use Gmail API only.
- If both SMTP and Gmail API are set, **Gmail API is used** (so it works on hosts that block SMTP).
