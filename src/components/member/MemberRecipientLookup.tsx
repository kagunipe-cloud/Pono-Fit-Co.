"use client";

import { useEffect, useState } from "react";

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

export default function MemberRecipientLookup({
  value,
  selected,
  onChange,
  placeholder = "Name or email",
  className = "",
  onEnter,
  scope = "all",
}: MemberRecipientLookupProps) {
  const [hits, setHits] = useState<MemberLookupHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (selected) {
      setHits([]);
      setOpen(false);
      return;
    }
    const term = value.trim();
    if (term.length < 2) {
      setHits([]);
      setOpen(false);
      return;
    }

    const t = setTimeout(() => {
      setLoading(true);
      fetch(
        `/api/member/member-lookup?q=${encodeURIComponent(term)}${scope === "clients" ? "&scope=clients" : ""}`
      )
        .then((r) => (r.ok ? r.json() : []))
        .then((rows) => {
          const list = Array.isArray(rows) ? (rows as MemberLookupHit[]) : [];
          setHits(list);
          setOpen(list.length > 0);
        })
        .catch(() => {
          setHits([]);
          setOpen(false);
        })
        .finally(() => setLoading(false));
    }, 300);

    return () => clearTimeout(t);
  }, [value, selected, scope]);

  return (
    <div className={`relative min-w-[12rem] ${className}`}>
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value, null);
          setOpen(true);
        }}
        onFocus={() => {
          if (!selected && hits.length > 0) setOpen(true);
        }}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onEnter?.();
          }
        }}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm"
        autoComplete="off"
      />
      {selected ? (
        <p className="mt-1 text-xs text-stone-500 truncate">{selected.email}</p>
      ) : loading ? (
        <p className="mt-1 text-xs text-stone-400">Searching…</p>
      ) : null}
      {open && !selected && hits.length > 0 ? (
        <ul className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-stone-200 bg-white shadow-lg text-sm">
          {hits.map((hit) => (
            <li key={hit.member_id}>
              <button
                type="button"
                className="w-full text-left px-3 py-2 hover:bg-brand-50 border-b border-stone-100 last:border-b-0"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(hit.display_name, hit);
                  setOpen(false);
                }}
              >
                <span className="font-medium text-stone-800">{hit.display_name}</span>
                <span className="block text-xs text-stone-500 truncate">{hit.email}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
