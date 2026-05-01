# Waiver Agreement Data Storage

For legal/audit purposes (e.g. in case of a lawsuit), here is where waiver agreement data is stored.

## Liability Waiver (members table)

**Table:** `members`  
**Column:** `waiver_signed_at` (TEXT, ISO 8601 timestamp)

When a member completes the waiver flow (typically via an emailed link to **`/sign-waiver`** with token/query params), we record:
- **member_id** – identifies who signed
- **waiver_signed_at** – timestamp of when they agreed (e.g. `2025-03-01T14:32:00.000Z`)

The checkbox on the waiver page confirms agreement to:
1. The liability waiver (PDF)
2. Privacy Policy
3. Terms of Service

## What this proves

- **Who** signed: `member_id` links to the member record (name, email)
- **When** they signed: `waiver_signed_at` timestamp
- **What** they agreed to: the waiver PDF, Privacy Policy, and Terms of Service as of the date shown on those documents

## Database location

The data lives in your SQLite database (default path **`data/the-fox-says.db`**). To query:

```sql
SELECT member_id, first_name, last_name, email, waiver_signed_at 
FROM members 
WHERE waiver_signed_at IS NOT NULL 
ORDER BY waiver_signed_at DESC;
```

## Door access without a signed waiver (admin exception)

Separate from the liability waiver timestamp: **`members.door_access_waiver_exempt`** (`INTEGER`, `1` = exempt).

- Used for rare **legacy/admin** cases where door access (e.g. Kisi) should be allowed without **`waiver_signed_at`**.
- Normal members get access after signing; staff can clear an exemption from the **member profile** when **`door_access_waiver_exempt`** is set.

Logic also lives in **`src/lib/waiver.ts`** (combined with **`waiver_signed_at`** for door-access checks).

## Backup

Ensure your database is backed up regularly. The waiver timestamp is part of your standard backup.
