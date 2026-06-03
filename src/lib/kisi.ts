/**
 * Kisi door access integration.
 * - findKisiUserByEmail: existing user lookup only (e.g. Glofox); does not create.
 * - ensureKisiUser: find user in Kisi by email, or create a managed user; returns Kisi user id.
 * - grantAccess: replace door access for this user — revokes existing role assignments for this Kisi user,
 *   then creates one assignment (avoids duplicate rows when unlock/renew/checkout run repeatedly).
 *
 * Required env: KISI_API_KEY, KISI_GROUP_ID
 * Optional: KISI_ROLE_ID (default group_basic)
 * Optional (migration grace parallel group): KISI_GRACE_GROUP_ID + KISI_GRACE_ROLE_ID — see migration-grant-kisi.
 *
 * API docs: https://docs.kisi.io/platform/apis/
 * Create API key: Kisi dashboard → My Account → API → Add API Key
 */

const KISI_API_BASE = "https://api.kisi.io";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Kisi returns 429 when requests come too fast (e.g. bulk migration). Retry with backoff
 * and honor Retry-After when the API sends it.
 */
async function fetchKisiWithRetry(url: string, init: RequestInit, options?: { maxAttempts?: number }): Promise<Response> {
  const maxAttempts = options?.maxAttempts ?? 8;
  let last: Response | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url, init);
    last = res;
    if (res.status !== 429 && res.status !== 503) {
      return res;
    }
    if (attempt >= maxAttempts) {
      break;
    }
    const retryAfter = res.headers.get("Retry-After");
    let waitMs = 0;
    if (retryAfter) {
      const sec = parseInt(retryAfter, 10);
      if (!Number.isNaN(sec)) waitMs = sec * 1000;
    }
    if (waitMs <= 0) {
      waitMs = Math.min(45_000, 750 * 2 ** (attempt - 1));
    }
    console.warn(`[Kisi] ${res.status} — retry ${attempt}/${maxAttempts} in ${waitMs}ms`);
    await sleep(waitMs);
  }
  return last!;
}

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
 * Look up an existing Kisi user by email (e.g. created in Glofox/Kisi). Does not create users.
 * Returns null if not found, no API key, or API error.
 */
export async function findKisiUserByEmail(email: string): Promise<string | null> {
  const headers = authHeaders();
  if (!headers.Authorization) {
    return null;
  }
  const emailTrim = email?.trim();
  if (!emailTrim) {
    return null;
  }

  const query = encodeURIComponent(emailTrim);
  const listRes = await fetchKisiWithRetry(`${KISI_API_BASE}/users?query=${query}`, {
    method: "GET",
    headers,
  });
  if (!listRes.ok) {
    const err = await listRes.text();
    console.error("[Kisi] findKisiUserByEmail failed:", listRes.status, err);
    return null;
  }
  const listData = (await listRes.json()) as { id?: number; email?: string }[] | { id?: number; email?: string };
  const users = Array.isArray(listData) ? listData : listData?.id != null ? [listData] : [];
  const existing = users.find((u) => (u.email ?? "").toLowerCase() === emailTrim.toLowerCase());
  return existing?.id != null ? String(existing.id) : null;
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

/**
 * Update a Kisi user's email and/or name. Use when member profile is edited.
 * Silently skips if Kisi is not configured.
 */
export async function updateKisiUser(
  kisiUserId: string,
  updates: { email?: string; name?: string }
): Promise<void> {
  const headers = authHeaders();
  if (!headers.Authorization) {
    console.log("[Kisi] KISI_API_KEY not set; skipping user update.");
    return;
  }
  const kisiId = kisiUserId?.trim();
  if (!kisiId) return;

  const user: { email?: string; name?: string } = {};
  if (updates.email?.trim()) user.email = updates.email.trim();
  if (updates.name !== undefined) user.name = (updates.name ?? "").trim() || undefined;
  if (Object.keys(user).length === 0) return;

  const res = await fetchKisiWithRetry(`${KISI_API_BASE}/users/${encodeURIComponent(kisiId)}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ user }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("[Kisi] update user failed:", res.status, err);
    const detail = err.trim().slice(0, 300);
    throw new Error(
      detail ? `Kisi user update failed: ${res.status} — ${detail}` : `Kisi user update failed: ${res.status}`
    );
  }
}

/**
 * Keep Kisi in sync when a member's email or name changes in the app.
 * Uses `members.kisi_id` when set; otherwise finds or creates the user by email.
 * Verifies the Kisi user's email after PATCH so typos (e.g. gmail.con) are caught if the API rejects the change.
 */
export async function syncMemberProfileToKisi(opts: {
  email: string;
  name?: string | null;
  kisiId?: string | null;
}): Promise<{ kisi_id: string }> {
  const emailTrim = opts.email?.trim();
  if (!emailTrim) {
    throw new Error("Email required to sync member to Kisi");
  }
  const name = opts.name !== undefined ? (opts.name ?? "").trim() || undefined : undefined;

  let kisiId = opts.kisiId?.trim() || null;
  if (kisiId) {
    let kisiUser = await getKisiUserById(kisiId);
    if (!kisiUser) {
      console.warn(`[Kisi] sync: stale kisi_id ${kisiId}; linking by email ${emailTrim}`);
      kisiId = await ensureKisiUser(emailTrim, name);
      return { kisi_id: kisiId };
    }

    const emailDiffers = kisiUser.email.toLowerCase() !== emailTrim.toLowerCase();
    const nameDiffers = name !== undefined && (kisiUser.name ?? "") !== (name ?? "");
    if (emailDiffers || nameDiffers) {
      if (emailDiffers) {
        console.log(`[Kisi] sync: updating user ${kisiId} email ${kisiUser.email} → ${emailTrim}`);
      }
      await updateKisiUser(kisiId, { email: emailTrim, name });
      kisiUser = await getKisiUserById(kisiId);
      if (kisiUser && kisiUser.email.toLowerCase() !== emailTrim.toLowerCase()) {
        throw new Error(
          `Kisi still has ${kisiUser.email} after update (app has ${emailTrim}). Update the email in the Kisi dashboard or contact Kisi support.`
        );
      }
    }
    return { kisi_id: kisiId };
  }

  kisiId = await ensureKisiUser(emailTrim, name);
  return { kisi_id: kisiId };
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

  // Kisi POST /role_assignments always creates a *new* row. Without this, every unlock / renewal / checkout
  // stacks duplicate "Door Access" lines for the same person in the dashboard.
  await revokeAccess(kisiId);

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

  const res = await fetchKisiWithRetry(`${KISI_API_BASE}/role_assignments`, {
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
    const detail = err.trim().slice(0, 400);
    throw new Error(
      detail ? `Kisi access grant failed: ${res.status} — ${detail}` : `Kisi access grant failed: ${res.status}`
    );
  }
}

/**
 * Revoke door access for a Kisi user by deleting role assignments for `KISI_GROUP_ID`
 * (when the list API returns `group_id` per assignment). Other groups are left intact.
 * Use when ACH payment fails or membership is cancelled.
 */
export async function revokeAccess(kisiUserId: string): Promise<void> {
  const key = process.env.KISI_API_KEY?.trim();
  if (!key) {
    console.log("[Kisi] KISI_API_KEY not set; skipping revoke.");
    return;
  }
  const kisiId = kisiUserId?.trim();
  if (!kisiId) return;

  const listRes = await fetchKisiWithRetry(
    `${KISI_API_BASE}/role_assignments?user_id=${encodeURIComponent(kisiId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `KISI-LOGIN ${key}`,
        "Content-Type": "application/json",
      },
    }
  );
  if (!listRes.ok) {
    const err = await listRes.text();
    console.error("[Kisi] list role_assignments failed:", listRes.status, err);
    return;
  }
  const assignments = (await listRes.json()) as { id: number; group_id?: number | string }[];
  const list = Array.isArray(assignments) ? assignments : [];
  const envGroup = process.env.KISI_GROUP_ID?.trim();
  const envGroupNorm = envGroup ? String(parseInt(envGroup, 10) || envGroup) : null;
  for (const a of list) {
    if (a?.id == null) continue;
    if (envGroupNorm && a.group_id != null && a.group_id !== undefined) {
      const gNorm = String(parseInt(String(a.group_id), 10) || a.group_id);
      if (gNorm !== envGroupNorm) continue;
    }
    const delRes = await fetchKisiWithRetry(`${KISI_API_BASE}/role_assignments/${a.id}`, {
      method: "DELETE",
      headers: { Authorization: `KISI-LOGIN ${key}` },
    });
    if (!delRes.ok) {
      console.error("[Kisi] delete role_assignment failed:", a.id, delRes.status);
    }
  }
}

/**
 * Revoke role assignments for this user in a specific group only (other groups untouched).
 */
export async function revokeAccessForGroup(kisiUserId: string, groupId: string): Promise<void> {
  const key = process.env.KISI_API_KEY?.trim();
  if (!key) {
    console.log("[Kisi] KISI_API_KEY not set; skipping revoke.");
    return;
  }
  const kisiId = kisiUserId?.trim();
  const gid = groupId?.trim();
  if (!kisiId || !gid) return;

  const targetNorm = String(parseInt(gid, 10) || gid);

  const listRes = await fetchKisiWithRetry(
    `${KISI_API_BASE}/role_assignments?user_id=${encodeURIComponent(kisiId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `KISI-LOGIN ${key}`,
        "Content-Type": "application/json",
      },
    }
  );
  if (!listRes.ok) {
    const err = await listRes.text();
    console.error("[Kisi] list role_assignments failed:", listRes.status, err);
    return;
  }
  const assignments = (await listRes.json()) as { id: number; group_id?: number | string }[];
  const list = Array.isArray(assignments) ? assignments : [];
  for (const a of list) {
    if (a?.id == null) continue;
    if (a.group_id == null || a.group_id === undefined) continue;
    const gNorm = String(parseInt(String(a.group_id), 10) || a.group_id);
    if (gNorm !== targetNorm) continue;
    const delRes = await fetchKisiWithRetry(`${KISI_API_BASE}/role_assignments/${a.id}`, {
      method: "DELETE",
      headers: { Authorization: `KISI-LOGIN ${key}` },
    });
    if (!delRes.ok) {
      console.error("[Kisi] delete role_assignment failed:", a.id, delRes.status);
    }
  }
}

/**
 * Replace access for a single group (revoke assignments in that group, then POST one assignment).
 * Use for a parallel “grace” Kisi group separate from KISI_GROUP_ID.
 */
export async function grantAccessForGroup(
  kisiUserId: string,
  validUntil: Date,
  opts: { groupId: string; roleId?: string }
): Promise<void> {
  const key = process.env.KISI_API_KEY?.trim();
  const groupId = opts.groupId?.trim();
  if (!key || !groupId) {
    console.log("[Kisi] grantAccessForGroup: KISI_API_KEY or groupId missing; skipping.");
    return;
  }
  const kisiId = kisiUserId?.trim();
  if (!kisiId) {
    console.log("[Kisi] grantAccessForGroup: no kisi user id; skipping.");
    return;
  }

  await revokeAccessForGroup(kisiId, groupId);

  const roleId = opts.roleId?.trim() || "group_basic";
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

  const res = await fetchKisiWithRetry(`${KISI_API_BASE}/role_assignments`, {
    method: "POST",
    headers: {
      Authorization: `KISI-LOGIN ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("[Kisi] grantAccessForGroup role_assignments failed:", res.status, err);
    const detail = err.trim().slice(0, 400);
    throw new Error(
      detail
        ? `Kisi grace group grant failed: ${res.status} — ${detail}`
        : `Kisi grace group grant failed: ${res.status}`
    );
  }
}

/** Fetch a Kisi user by id. Returns null if the user was deleted (stale `members.kisi_id`). */
export async function getKisiUserById(
  kisiUserId: string
): Promise<{ id: string; email: string; name: string | null } | null> {
  const headers = authHeaders();
  if (!headers.Authorization) {
    throw new Error("KISI_API_KEY not set");
  }
  const id = kisiUserId?.trim();
  if (!id) return null;

  const res = await fetchKisiWithRetry(`${KISI_API_BASE}/users/${encodeURIComponent(id)}`, {
    method: "GET",
    headers,
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Kisi fetch user failed: ${res.status} ${err}`);
  }
  const data = (await res.json()) as { id?: number; email?: string; name?: string };
  if (data?.id == null || !String(data.email ?? "").trim()) return null;
  return {
    id: String(data.id),
    email: String(data.email).trim(),
    name: (data.name ?? "").trim() || null,
  };
}

async function postCreateLogin(emailTrim: string): Promise<string> {
  const headers = authHeaders();
  if (!headers.Authorization) {
    throw new Error("KISI_API_KEY not set");
  }

  const res = await fetchKisiWithRetry(`${KISI_API_BASE}/logins`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      login: {
        type: "device",
        device_brand: "Web",
        device_model: "Browser",
        os_name: "Web",
        email: emailTrim,
        expire: false,
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
 * Create a short-lived login for a managed user so we can make API calls as them (e.g. unlock).
 * Returns the user's secret (API key) for that login.
 *
 * When `kisiUserId` is set, uses the email on that Kisi user (not only the app profile email).
 * Fixes 404 when the member has door access in Kisi but the app email was changed or never matched.
 */
export async function createLoginForUser(email: string, kisiUserId?: string | null): Promise<string> {
  const appEmail = email?.trim();
  if (!appEmail && !kisiUserId?.trim()) {
    throw new Error("Email required to create Kisi login");
  }

  let loginEmail = appEmail;
  if (kisiUserId?.trim()) {
    const kisiUser = await getKisiUserById(kisiUserId.trim());
    if (kisiUser?.email) {
      loginEmail = kisiUser.email;
      if (appEmail && loginEmail.toLowerCase() !== appEmail.toLowerCase()) {
        console.warn(
          `[Kisi] create login: using Kisi user email (${loginEmail}); app profile has ${appEmail} (kisi_id ${kisiUserId})`
        );
      }
    }
  }
  if (!loginEmail) {
    throw new Error("Email required to create Kisi login");
  }

  try {
    return await postCreateLogin(loginEmail);
  } catch (firstErr) {
    if (appEmail && loginEmail.toLowerCase() !== appEmail.toLowerCase()) {
      try {
        return await postCreateLogin(appEmail);
      } catch {
        /* fall through */
      }
    }
    throw firstErr;
  }
}

/** Optional data for Kisi unlock — use proximity + OTP when group/door has reader or geofence restrictions. */
export type UnlockWithUserSecretOptions = {
  /** Lock to open (overrides `KISI_LOCK_ID` for this request). */
  lockId?: string;
  /**
   * Reader OTP from Kisi iBeacon (Tap-to-Unlock / proximity_proof). Required when
   * [Reader proximity restriction](https://docs.kisi.io/dashboard/groups/restrictions#reader-proximity-restriction) applies.
   */
  proximityProof?: string;
  /** GPS coordinates for geofence-restricted unlocks (browser/device must supply). */
  latitude?: number;
  longitude?: number;
};

function buildUnlockRequestBody(opts: UnlockWithUserSecretOptions | undefined): string | undefined {
  if (!opts) return undefined;
  const payload: {
    context?: { location: { latitude: number; longitude: number } };
    lock?: { proximity_proof: string };
  } = {};
  const proof = opts.proximityProof?.trim();
  if (proof) {
    payload.lock = { proximity_proof: proof };
  }
  if (
    opts.latitude != null &&
    opts.longitude != null &&
    Number.isFinite(opts.latitude) &&
    Number.isFinite(opts.longitude)
  ) {
    payload.context = {
      location: { latitude: opts.latitude, longitude: opts.longitude },
    };
  }
  if (!payload.lock && !payload.context) return undefined;
  return JSON.stringify(payload);
}

/**
 * Unlock a door on behalf of a user using their secret (from createLoginForUser).
 * If `KISI_LOCK_ID` is set (or `options.lockId`), unlocks that lock; otherwise unlocks the first lock the user can access.
 *
 * For **reader proximity** or **geofence** restrictions, pass `proximityProof` (and optionally GPS) so Kisi can
 * validate the same way the official app does — otherwise the door may still open remotely while the **reader LED**
 * does not show the same “success” animation as a tap at the reader.
 */
export async function unlockWithUserSecret(secret: string, options?: UnlockWithUserSecretOptions): Promise<void> {
  const envLock = process.env.KISI_LOCK_ID?.trim();
  const lockId = options?.lockId?.trim() || envLock;
  const body = buildUnlockRequestBody(options);
  const baseHeaders: Record<string, string> = {
    Authorization: `KISI-LOGIN ${secret}`,
    Accept: "application/json",
  };
  const postHeaders: Record<string, string> = {
    ...baseHeaders,
    ...(body ? { "Content-Type": "application/json" } : {}),
  };

  async function postUnlock(id: string | number): Promise<void> {
    const res = await fetchKisiWithRetry(`${KISI_API_BASE}/locks/${id}/unlock`, {
      method: "POST",
      headers: postHeaders,
      body: body ?? undefined,
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Kisi unlock failed: ${res.status} ${err}`);
    }
  }

  if (lockId) {
    await postUnlock(lockId);
    return;
  }

  const listRes = await fetchKisiWithRetry(`${KISI_API_BASE}/locks`, {
    method: "GET",
    headers: { ...baseHeaders, "Content-Type": "application/json" },
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
  await postUnlock(first.id);
}

/** Revoke door access, then delete the Kisi user (best effort). Used when a member account is removed. */
export async function deleteKisiUserBestEffort(kisiUserId: string): Promise<void> {
  const kisiId = kisiUserId?.trim();
  if (!kisiId) return;
  await revokeAccess(kisiId);
  const headers = authHeaders();
  if (!headers.Authorization) {
    console.log("[Kisi] KISI_API_KEY not set; skipping user delete.");
    return;
  }
  const res = await fetchKisiWithRetry(`${KISI_API_BASE}/users/${encodeURIComponent(kisiId)}`, {
    method: "DELETE",
    headers: { Authorization: headers.Authorization, Accept: "application/json" },
  });
  if (!res.ok && res.status !== 404) {
    const err = await res.text();
    console.error("[Kisi] delete user failed:", res.status, err.slice(0, 300));
  }
}
