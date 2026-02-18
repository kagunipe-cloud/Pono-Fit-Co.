# Kisi door access

When a member buys a **membership** (and when a monthly membership renews), the app grants them door access in Kisi for the right period:

- **Daily** membership → access for 1 day (or your plan’s length)
- **Weekly** membership → access for 1 week (7 days, or length × 7)
- **Monthly** membership → access for 1 month (renewal extends it when the auto-charge runs)

## Automatic Kisi user and key

You **do not** add Kisi IDs manually. On purchase:

1. The app looks up the member by **email** in Kisi.
2. If no user exists, the app **creates a managed user** in Kisi (no Kisi sign-up email).
3. Kisi returns the user **id**; we store it in `members.kisi_id`.
4. We then create a **role assignment** so that user has access until the membership end date.

So: **purchase in the app → Kisi user created (or found) → key (user id) stored in the app → access granted.** The member must have an **email** on their profile so we can find or create them in Kisi.

## Do you need an API key?

**Yes.** To create users and grant access from the app you need:

1. **Kisi API key**  
   In Kisi: **My Account** → **API** → **Add API Key** (org admin/owner).  
   [Docs: Generate an API key](https://docs.kisi.io/dashboard/account/generate_api_key/)

2. **Group ID**  
   The Kisi **group** (e.g. your gym/location) these members should get access to. You get this from the Kisi dashboard or API.

## Env vars (in `.env.local`)

```bash
KISI_API_KEY=your_kisi_api_key
KISI_GROUP_ID=your_kisi_group_id
```

Optional:

```bash
KISI_ROLE_ID=group_basic
KISI_LOCK_ID=12345
```

- Default role is `group_basic`; override if you use a different role in Kisi.
- **KISI_LOCK_ID**: If you have multiple locks and want "Unlock door" to open a specific one, set this to that lock’s id. Otherwise the app unlocks the first lock the user has access to.

## Member email required

Each member who gets door access must have an **email** in your app. We use it to find or create their Kisi user and to store the returned Kisi user id (`kisi_id`) for renewals. If a member has no email, we still complete the sale and create the subscription but skip the Kisi step.
