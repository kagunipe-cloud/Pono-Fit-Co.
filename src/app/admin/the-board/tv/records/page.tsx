import { redirect } from "next/navigation";

/** Legacy URL → unified TV display (records + weekly goals). */
export default function GymRecordsTVRedirectPage() {
  redirect("/admin/the-board/tv");
}
