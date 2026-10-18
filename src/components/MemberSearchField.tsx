"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { memberDisplayName, type MemberSearchRow } from "@/lib/member-search-match";

export type MemberSearchHit = MemberSearchRow & { member_id: string };

export type MemberSearchFieldProps = {
  memberId: string;
  onMemberIdChange: (memberId: string) => void;
  /** Called when user picks or clears a member (includes email on hit). */
  onMemberSelect?: (hit: MemberSearchHit | null) => void;
  label?: string;
  placeholder?: string;
  className?: string;
  id?: string;
  /** Default `staff` → GET /api/members?q=. `member` → GET /api/member/member-lookup (logged-in member/trainer). */
  searchApi?: "staff" | "member";
  scope?: "clients" | "all";
  /** Hide members without an email on file (e.g. email blast to one person). */
  requireEmail?: boolean;
};

function mapStaffApiRow(m: Record<string, unknown>): MemberSearchHit | null {
  const member_id = String(m.member_id ?? "").trim();
  if (!member_id) return null;
  return {
    member_id,
    first_name: m.first_name != null ? String(m.first_name) : null,
    last_name: m.last_name != null ? String(m.last_name) : null,
    preferred_name: m.preferred_name != null ? String(m.preferred_name) : null,
    email: m.email != null ? String(m.email) : null,
  };
}

function mapMemberLookupRow(m: Record<string, unknown>): MemberSearchHit | null {
  const member_id = String(m.member_id ?? "").trim();
  if (!member_id) return null;
  const display = String(m.display_name ?? "").trim();
  return {
    member_id,
    preferred_name: display || null,
    first_name: null,
    last_name: null,
    email: m.email != null ? String(m.email) : null,
  };
}

function filterHits(hits: MemberSearchHit[], requireEmail: boolean): MemberSearchHit[] {
  if (!requireEmail) return hits;
  return hits.filter((h) => String(h.email ?? "").trim() !== "");
}

/** Typeahead member search — keeps typing in one field; pick from a dropdown (no native select pinning). */
export default function MemberSearchField({
  memberId,
  onMemberIdChange,
  onMemberSelect,
  label,
  placeholder = "Name, email, or member ID (type to refine)",
  className = "",
  id,
  searchApi = "staff",
  scope = "all",
  requireEmail = false,
}: MemberSearchFieldProps) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<MemberSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState<MemberSearchHit | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadSelectedLabel = useCallback(
    async (mid: string) => {
      if (!mid.trim()) {
        setSelectedLabel(null);
        return;
      }
      try {
        const res = await fetch(`/api/members?q=${encodeURIComponent(mid.trim())}`);
        if (!res.ok) return;
        const rows = (await res.json()) as Record<string, unknown>[];
        const list = Array.isArray(rows) ? rows.map(mapStaffApiRow).filter(Boolean) as MemberSearchHit[] : [];
        const exact = list.find((m) => m.member_id === mid) ?? list[0] ?? null;
        setSelectedLabel(exact);
      } catch {
        setSelectedLabel(null);
      }
    },
    []
  );

  useEffect(() => {
    if (!memberId) {
      setSelectedLabel(null);
      return;
    }
    if (selectedLabel?.member_id === memberId) return;
    void loadSelectedLabel(memberId);
  }, [memberId, loadSelectedLabel, selectedLabel?.member_id]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setHits([]);
      setOpen(false);
      return;
    }

    const url =
      searchApi === "member"
        ? `/api/member/member-lookup?q=${encodeURIComponent(term)}${scope === "clients" ? "&scope=clients" : ""}`
        : `/api/members?q=${encodeURIComponent(term)}`;

    const t = setTimeout(() => {
      setLoading(true);
      fetch(url)
        .then((r) => (r.ok ? r.json() : []))
        .then((rows) => {
          const raw = Array.isArray(rows) ? rows : [];
          const list = (
            searchApi === "member"
              ? raw.map(mapMemberLookupRow).filter(Boolean)
              : raw.map(mapStaffApiRow).filter(Boolean)
          ) as MemberSearchHit[];
          const filtered = filterHits(list, requireEmail);
          setHits(filtered);
          setOpen(filtered.length > 0);
        })
        .catch(() => {
          setHits([]);
          setOpen(false);
        })
        .finally(() => setLoading(false));
    }, 280);

    return () => clearTimeout(t);
  }, [query, searchApi, scope, requireEmail]);

  function clearSelection() {
    onMemberIdChange("");
    onMemberSelect?.(null);
    setSelectedLabel(null);
    setQuery("");
    setHits([]);
    setOpen(false);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function pick(hit: MemberSearchHit) {
    setSelectedLabel(hit);
    onMemberIdChange(hit.member_id);
    onMemberSelect?.(hit);
    setQuery("");
    setHits([]);
    setOpen(false);
  }

  const showDropdown = open && !memberId && hits.length > 0;

  return (
    <div className={className}>
      {label ? (
        <label htmlFor={id} className="block text-sm font-medium text-stone-700 mb-1">
          {label}
        </label>
      ) : null}

      {memberId && selectedLabel ? (
        <div className="flex flex-wrap items-center gap-2 mb-2 p-2.5 rounded-lg border border-brand-200 bg-brand-50/60 text-sm">
          <span className="font-medium text-stone-800">{memberDisplayName(selectedLabel)}</span>
          <span className="text-stone-500 text-xs">({selectedLabel.member_id})</span>
          {selectedLabel.email ? (
            <span className="text-stone-500 text-xs truncate max-w-[14rem]">{selectedLabel.email}</span>
          ) : null}
          <button
            type="button"
            onClick={clearSelection}
            className="ml-auto text-brand-700 hover:underline text-xs font-medium shrink-0"
          >
            Change
          </button>
        </div>
      ) : null}

      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (hits.length > 0 && !memberId) setOpen(true);
          }}
          onBlur={() => {
            window.setTimeout(() => setOpen(false), 150);
          }}
          placeholder={memberId ? "Change member above to search again" : placeholder}
          disabled={!!memberId}
          autoComplete="off"
          className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm disabled:bg-stone-50 disabled:text-stone-400"
        />
        {loading && !memberId ? <p className="mt-1 text-xs text-stone-400">Searching…</p> : null}
        {!loading && !memberId && query.trim().length >= 2 && hits.length === 0 ? (
          <p className="mt-1 text-xs text-stone-500">No matches — keep typing to refine (e.g. first and last name).</p>
        ) : null}
        {showDropdown ? (
          <ul className="absolute z-30 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-stone-200 bg-white shadow-lg text-sm">
            {hits.map((hit) => (
              <li key={hit.member_id}>
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 hover:bg-brand-50 border-b border-stone-100 last:border-b-0"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(hit)}
                >
                  <span className="font-medium text-stone-800">{memberDisplayName(hit)}</span>
                  <span className="text-stone-500 text-xs ml-1">({hit.member_id})</span>
                  {hit.email ? <span className="block text-xs text-stone-500 truncate">{hit.email}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
