"use client";

import MemberSearchField, { type MemberSearchHit } from "@/components/MemberSearchField";
import { memberDisplayName } from "@/lib/member-search-match";

export type MemberLookupHit = {
  member_id: string;
  display_name: string;
  email: string;
};

type MemberRecipientLookupProps = {
  value: string;
  selected: MemberLookupHit | null;
  onChange: (value: string, selected: MemberLookupHit | null) => void;
  placeholder?: string;
  className?: string;
  onEnter?: () => void;
  /** When "clients", trainers only see their PT clients (admins still see everyone). */
  scope?: "clients" | "all";
};

export function resolveMemberRecipient(
  input: string,
  selected: MemberLookupHit | null
): { recipient_email?: string; recipient_member_id?: string } | null {
  if (selected?.member_id) {
    return {
      recipient_member_id: selected.member_id,
      recipient_email: selected.email,
    };
  }
  const trimmed = input.trim().toLowerCase();
  if (trimmed.includes("@")) {
    return { recipient_email: trimmed };
  }
  return null;
}

function hitToLookup(hit: MemberSearchHit): MemberLookupHit {
  return {
    member_id: hit.member_id,
    display_name: memberDisplayName(hit),
    email: String(hit.email ?? "").trim(),
  };
}

/** Same typeahead as staff member search; optional raw email when not picking from the list. */
export default function MemberRecipientLookup({
  value,
  selected,
  onChange,
  placeholder = "Name or email",
  className = "",
  onEnter,
  scope = "all",
}: MemberRecipientLookupProps) {
  return (
    <div className={className}>
      <MemberSearchField
        searchApi="member"
        scope={scope}
        memberId={selected?.member_id ?? ""}
        onMemberIdChange={(id) => {
          if (!id) onChange(value, null);
        }}
        onMemberSelect={(hit) => {
          if (hit) onChange("", hitToLookup(hit));
        }}
        placeholder={placeholder}
        className="min-w-[12rem]"
      />
      {!selected ? (
        <div className="mt-2">
          <label className="block text-xs text-stone-500 mb-1">Or type an email address</label>
          <input
            type="email"
            value={value}
            onChange={(e) => onChange(e.target.value, null)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onEnter?.();
              }
            }}
            placeholder="friend@example.com"
            autoComplete="off"
            className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm"
          />
        </div>
      ) : null}
    </div>
  );
}
