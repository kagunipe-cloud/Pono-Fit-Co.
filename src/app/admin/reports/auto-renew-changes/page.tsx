import { redirect } from "next/navigation";

/** Legacy URL — Membership flow report replaced auto-renew-only view. */
export default function AutoRenewChangesRedirectPage() {
  redirect("/admin/reports/membership-flow");
}
