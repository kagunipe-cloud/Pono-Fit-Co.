# Waiver Agreement Data Storage

For legal/audit purposes (e.g. in case of a lawsuit), here is where waiver agreement data is stored.

## Liability Waiver (members table)

**Table:** `members`  
**Column:** `waiver_signed_at` (TEXT, ISO 8601 timestamp)

When a member signs the waiver (via the email link at `/sign-waiver`), we record:
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

The data lives in your SQLite database (e.g. `data/production.db`). To query:

```sql
SELECT member_id, first_name, last_name, email, waiver_signed_at 
FROM members 
WHERE waiver_signed_at IS NOT NULL 
ORDER BY waiver_signed_at DESC;
```

## Backup

Ensure your database is backed up regularly. The waiver timestamp is part of your standard backup.
