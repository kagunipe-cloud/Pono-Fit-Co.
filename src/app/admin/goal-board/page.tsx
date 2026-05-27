import { redirect } from "next/navigation";

/** Legacy URL → unified The Board tab. */
export default function AdminGoalBoardRedirectPage() {
  redirect("/admin/the-board?tab=goals");
}
