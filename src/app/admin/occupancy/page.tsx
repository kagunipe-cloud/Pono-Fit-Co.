import { redirect } from "next/navigation";

/** Coconut Count moved to admin home. Redirect for old links. */
export default function AdminOccupancyPage() {
  redirect("/");
}
