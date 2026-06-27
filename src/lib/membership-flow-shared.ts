/** Client-safe types and labels for the membership flow report (no db imports). */

export type MembershipFlowKind =
  | "new_member"
  | "plan_change"
  | "renewal"
  | "auto_renew_on"
  | "auto_renew_off";

export type MembershipFlowTab =
  | "all"
  | "monthly-recurring"
  | "monthly-non-recurring"
  | "day-pass"
  | "week-pass"
  | "pass-packs"
  | "auto-renew";

export type MembershipFlowMembershipKind =
  | "Monthly recurring"
  | "Monthly non-recurring"
  | "Day pass"
  | "Week pass"
  | "Pass packs"
  | "Auto-renew";

export type MembershipFlowRow = {
  id: string;
  happened_at: string;
  member_id: string;
  member_name: string;
  email: string | null;
  flow_kind: MembershipFlowKind;
  membership_kind: MembershipFlowMembershipKind;
  plan_name: string | null;
  previous_plan_name: string | null;
  auto_renew: number | null;
  amount: number | null;
  detail: string | null;
  sort_priority: number;
};

export const FLOW_KIND_LABELS: Record<MembershipFlowKind, string> = {
  new_member: "New member",
  plan_change: "Returning / plan change",
  renewal: "Renewal",
  auto_renew_on: "Auto-renew on",
  auto_renew_off: "Auto-renew off",
};

export const MEMBERSHIP_FLOW_TABS: { id: MembershipFlowTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "monthly-recurring", label: "Monthly recurring" },
  { id: "monthly-non-recurring", label: "Monthly non-recurring" },
  { id: "day-pass", label: "Day pass" },
  { id: "week-pass", label: "Week pass" },
  { id: "pass-packs", label: "Pass packs" },
  { id: "auto-renew", label: "Auto-renew" },
];
