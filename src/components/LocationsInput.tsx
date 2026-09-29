"use client";

import { useRef } from "react";
import { MAX_LOCATIONS } from "@/lib/locations";

interface LocationsInputProps {
  id: string;
  locations: string[];
  draft: string;
  onChange: (locations: string[]) => void;
  onDraftChange: (draft: string) => void;
  disabled?: boolean;
}

/** Adds the comma-separated parts of `text` to `current`, skipping blanks, duplicates and anything past the cap. */
export function addLocations(current: string[], text: string): string[] {
  const next = [...current];
  for (const part of text.split(",")) {
    const value = part.trim().replace(/\s+/g, " ");
    if (!value || next.length >= MAX_LOCATIONS) continue;
    if (next.some((l) => l.toLowerCase() === value.toLowerCase())) continue;
    next.push(value);
  }
  return next;
}

/** Chip-style list of locations: type a place and press Enter or comma; Backspace on an empty field removes the last. */
export function LocationsInput({ id, locations, draft, onChange, onDraftChange, disabled }: LocationsInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const full = locations.length >= MAX_LOCATIONS;

  function commit() {
    if (!draft.trim()) return;
    onChange(addLocations(locations, draft));
    onDraftChange("");
  }

  return (
    <div
      className="flex min-h-[42px] flex-wrap items-center gap-1.5 rounded border px-2 py-1.5"
      style={{ background: "var(--surface-1)", borderColor: "var(--border-hairline)", cursor: "text" }}
      onClick={() => inputRef.current?.focus()}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden style={{ color: "var(--text-muted)" }}>
        <path
          d="M8 14.5s4.5-4.2 4.5-8a4.5 4.5 0 1 0-9 0c0 3.8 4.5 8 4.5 8Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        />
        <circle cx="8" cy="6.5" r="1.6" fill="currentColor" />
      </svg>
      {locations.map((loc) => (
        <span
          key={loc}
          className="inline-flex items-center gap-1 rounded-full py-0.5 pl-2.5 pr-1 text-xs font-medium"
          style={{ background: "var(--gridline)", color: "var(--text-primary)" }}
        >
          {loc}
          <button
            type="button"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              onChange(locations.filter((l) => l !== loc));
            }}
            className="flex h-4 w-4 items-center justify-center rounded-full disabled:opacity-50"
            style={{ color: "var(--text-muted)" }}
            aria-label={`Remove ${loc}`}
          >
            <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden>
              <path d="M1 1l6 6M7 1 1 7" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        id={id}
        value={draft}
        disabled={disabled || full}
        onChange={(e) => {
          const value = e.target.value;
          // Typing or pasting a comma commits everything before it.
          if (value.includes(",")) {
            const lastComma = value.lastIndexOf(",");
            onChange(addLocations(locations, value.slice(0, lastComma)));
            onDraftChange(value.slice(lastComma + 1).trimStart());
          } else {
            onDraftChange(value);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && !draft && locations.length > 0) {
            onChange(locations.slice(0, -1));
          }
        }}
        onBlur={commit}
        placeholder={
          full ? `Up to ${MAX_LOCATIONS} locations` : locations.length ? "Add another location" : "e.g. Da Nang, Hoi An, Nha Trang"
        }
        className="min-w-[160px] flex-1 bg-transparent px-1 py-0.5 text-sm outline-none"
        style={{ color: "var(--text-primary)" }}
      />
    </div>
  );
}
