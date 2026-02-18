/**
 * Kisi door access integration.
 * - ensureKisiUser: find user in Kisi by email, or create a managed user; returns Kisi user id.
 * - grantAccess: create a role assignment so the user has access until valid_until.
 *
 * Required env: KISI_API_KEY, KISI_GROUP_ID
 * Optional: KISI_ROLE_ID (default group_basic)
 *
 * API docs: https://docs.kisi.io/platform/apis/
 * Create API key: Kisi dashboard → My Account → API → Add API Key
 */

const KISI_API_BASE = "https://api.kisi.io";

function toISO(d: Date): string {
  return d.toISOString();
}

function authHeaders(): Record<string, string> {
  const key = process.env.KISI_API_KEY?.trim();
  if (!key) return {};
  return {
    Authorization: `KISI-LOGIN ${key}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

/**
 * Find a Kisi user by email, or create a managed user. Returns the Kisi user id (string).
 * Use this on purchase so we can store kisi_id in the app without manual entry.
 */
export async function ensureKisiUser(email: string, name?: string | null): Promise<string> {
  const headers = authHeaders();
  if (!headers.Authorization) {
    throw new Error("KISI_API_KEY not set");
  }
  const emailTrim = email?.trim();
  if (!emailTrim) {
    throw new Error("Email required to ensure Kisi user");
  }

  const query = encodeURIComponent(emailTrim);
  const listRes = await fetch(`${KISI_API_BASE}/users?query=${query}`, {
    method: "GET",
    headers,
  });
  if (!listRes.ok) {
    const err = await listRes.text();
    throw new Error(`Kisi users list failed: ${listRes.status} ${err}`);
  }
  const listData = (await listRes.json()) as { id?: number; email?: string }[] | { id?: number; email?: string };
  const users = Array.isArray(listData) ? listData : listData?.id != null ? [listData] : [];
  const existing = users.find((u) => (u.email ?? "").toLowerCase() === emailTrim.toLowerCase());
  if (existing?.id != null) {
    return String(existing.id);
  }

  const createRes = await fetch(`${KISI_API_BASE}/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      user: {
        email: emailTrim,
        name: (name ?? "").trim() || undefined,
        send_emails: false,
        confirm: true,
      },
    }),
  });
  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Kisi create user failed: ${createRes.status} ${err}`);
  }
  const created = (await createRes.json()) as { id?: number };
  if (created?.id == null) {
    throw new Error("Kisi create user returned no id");
  }
  return String(created.id);
}

export async function grantAccess(kisiUserId: string, validUntil: Date): Promise<void> {
  const key = process.env.KISI_API_KEY?.trim();
  const groupId = process.env.KISI_GROUP_ID?.trim();
  if (!key || !groupId) {
    console.log("[Kisi] KISI_API_KEY or KISI_GROUP_ID not set; skipping door access.");
    return;
  }
  const kisiId = kisiUserId?.trim();
  if (!kisiId) {
    console.log("[Kisi] Member has no kisi_id; skipping door access.");
    return;
  }

  const roleId = process.env.KISI_ROLE_ID?.trim() || "group_basic";
  const validFrom = new Date();
  const body = {
    role_assignment: {
      user_id: parseInt(kisiId, 10) || kisiId,
      role_id: roleId,
      group_id: parseInt(groupId, 10) || groupId,
      valid_from: toISO(validFrom),
      valid_until: toISO(validUntil),
    },
  };

  const res = await fetch(`${KISI_API_BASE}/role_assignments`, {
    method: "POST",
    headers: {
      Authorization: `KISI-LOGIN ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("[Kisi] role_assignments failed:", res.status, err);
    throw new Error(`Kisi access grant failed: ${res.status}`);
  }
}

/**
 * Create a short-lived login for a managed user so we can make API calls as them (e.g. unlock).
 * Returns the user's secret (API key) for that login.
 */
export async function createLoginForUser(email: string): Promise<string> {
  const headers = authHeaders();
  if (!headers.Authorization) {
    throw new Error("KISI_API_KEY not set");
  }
  const emailTrim = email?.trim();
  if (!emailTrim) {
    throw new Error("Email required to create Kisi login");
  }

  const res = await fetch(`${KISI_API_BASE}/logins`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      login: {
        type: "device",
        device_brand: "Web",
        device_model: "Browser",
        os_name: "Web",
        email: emailTrim,
        expire: "false",
      },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Kisi create login failed: ${res.status} ${err}`);
  }
  const data = (await res.json()) as { secret?: string };
  if (!data?.secret) {
    throw new Error("Kisi create login returned no secret");
  }
  return data.secret;
}

/**
 * Unlock a door on behalf of a user using their secret (from createLoginForUser).
 * If KISI_LOCK_ID is set, unlocks that lock; otherwise unlocks the first lock the user can access.
 */
export async function unlockWithUserSecret(secret: string): Promise<void> {
  const lockId = process.env.KISI_LOCK_ID?.trim();
  const headers = {
    Authorization: `KISI-LOGIN ${secret}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (lockId) {
    const res = await fetch(`${KISI_API_BASE}/locks/${lockId}/unlock`, {
      method: "POST",
      headers,
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Kisi unlock failed: ${res.status} ${err}`);
    }
    return;
  }

  const listRes = await fetch(`${KISI_API_BASE}/locks`, {
    method: "GET",
    headers,
  });
  if (!listRes.ok) {
    const err = await listRes.text();
    throw new Error(`Kisi fetch locks failed: ${listRes.status} ${err}`);
  }
  const locks = (await listRes.json()) as { id?: number }[];
  const ids = Array.isArray(locks) ? locks : [];
  const first = ids[0];
  if (!first?.id) {
    throw new Error("No locks found for this user");
  }
  const unlockRes = await fetch(`${KISI_API_BASE}/locks/${first.id}/unlock`, {
    method: "POST",
    headers,
  });
  if (!unlockRes.ok) {
    const err = await unlockRes.text();
    throw new Error(`Kisi unlock failed: ${unlockRes.status} ${err}`);
  }
}
