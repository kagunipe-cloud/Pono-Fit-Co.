import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

const SALT_LEN = 16;
const KEY_LEN = 64;
const COST = 16384;

/** Hash a password for storage. Returns string in format salt:hash (both hex). */
export function hashPassword(plain: string): string {
  const salt = randomBytes(SALT_LEN);
  const hash = scryptSync(plain, salt, KEY_LEN, { N: COST });
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

/** Verify plain password against stored salt:hash. */
export function verifyPassword(plain: string, stored: string): boolean {
  try {
    const [saltHex, hashHex] = stored.split(":");
    if (!saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, "hex");
    const hash = Buffer.from(hashHex, "hex");
    const computed = scryptSync(plain, salt, KEY_LEN, { N: COST });
    return timingSafeEqual(computed, hash);
  } catch {
    return false;
  }
}
