import { NextRequest } from "next/server";
import { getAdminMemberId, getTrainerMemberId } from "@/lib/admin";

/** Trainer or admin — may create/edit/send training programs. */
export async function getProgramEditorMemberId(request?: NextRequest): Promise<string | null> {
  const trainer = await getTrainerMemberId(request);
  if (trainer) return trainer;
  return getAdminMemberId(request);
}