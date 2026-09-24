"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { COUNTRIES, LANGUAGES, searchSetupLabel } from "@/lib/tracking/locales";
import type { ProjectSummary, TrackingSettings } from "@/lib/tracking/types";
import { Favicon } from "./Favicon";
import { inputStyle } from "./ui";

export interface NewProjectInput {
  name: string;
  website: string;
  language: string;
  country: string;
  device: TrackingSettings["device"];
}

interface ProjectBarProps {
  projects: ProjectSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: (input: NewProjectInput) => Promise<void>;
}

export function ProjectBar({ projects, activeId, onSelect, onCreate }: ProjectBarProps) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const active = projects.find((p) => p.id === activeId) ?? null;

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div ref={menuRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="flex min-w-64 items-center gap-2.5 rounded-lg border px-3 py-2 text-left"
          style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}
        >
          <Favicon domain={active?.website ?? ""} label={active?.name} size={22} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              {active?.name ?? "Select a project"}
            </span>
            <span className="truncate text-[11px]" style={{ color: "var(--text-muted)" }}>
              {active ? searchSetupLabel(active.settings) : `${projects.length} projects`}
            </span>
          </span>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden style={{ color: "var(--text-secondary)" }}>
            <path d="M2 3.5L5 6.5L8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </button>

        {open ? (
          <ul
            role="listbox"
            aria-label="Projects"
            className="absolute left-0 top-full z-30 mt-1 flex max-h-96 w-80 flex-col overflow-y-auto rounded-lg border p-1 shadow-lg"
            style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}
          >
            {projects.map((p) => {
              const selected = p.id === activeId;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      onSelect(p.id);
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-[var(--page-plane)]"
                    style={{ background: selected ? "color-mix(in srgb, var(--series-1) 10%, transparent)" : undefined }}
                  >
                    <Favicon domain={p.website} label={p.name} size={18} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                        {p.name}
                      </span>
                      <span className="truncate text-[11px]" style={{ color: "var(--text-muted)" }}>
                        {p.website || "no website"} · {searchSetupLabel(p.settings)} · {p.keywordCount} keyword{p.keywordCount === 1 ? "" : "s"}
                      </span>
                    </span>
                    {selected ? (
                      <span aria-hidden className="text-sm font-bold" style={{ color: "var(--series-1)" }}>
                        ✓
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => setAdding(true)}
        className="rounded-lg px-3 py-2 text-xs font-semibold"
        style={{ color: "var(--series-1)" }}
      >
        + Add project
      </button>

      {adding ? (
        <AddProjectDialog
          defaults={active?.settings ?? null}
          onCancel={() => setAdding(false)}
          onCreate={async (input) => {
            await onCreate(input);
            setAdding(false);
          }}
        />
      ) : null}
    </div>
  );
}

function AddProjectDialog({
  defaults,
  onCancel,
  onCreate,
}: {
  defaults: TrackingSettings | null;
  onCancel: () => void;
  onCreate: (input: NewProjectInput) => Promise<void>;
}) {
  const [form, setForm] = useState<NewProjectInput>({
    name: "",
    website: "",
    language: defaults?.language ?? "en",
    country: defaults?.country ?? "us",
    device: defaults?.device ?? "mobile",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() && !form.website.trim()) {
      setError("Enter a brand name or website.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCreate(form);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the project");
      setBusy(false);
    }
  };

  const field = "flex flex-col gap-1 text-xs";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(11, 11, 11, 0.45)" }} onClick={onCancel} role="presentation">
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Add project"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="flex w-full max-w-md flex-col gap-4 rounded-xl border p-5 shadow-2xl"
        style={{ background: "var(--surface-1)", borderColor: "var(--border-hairline)" }}
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
            Add project
          </h2>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Each project tracks one brand with its own keywords, competitors and history, and runs in the daily update.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Favicon domain={form.website} label={form.name} size={28} />
          <div className="grid flex-1 grid-cols-1 gap-3">
            <label className={field} style={{ color: "var(--text-secondary)" }}>
              Brand name
              <input
                autoFocus
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Bhaya Cruises"
                className="rounded-lg border px-2.5 py-2 text-sm"
                style={inputStyle}
              />
            </label>
            <label className={field} style={{ color: "var(--text-secondary)" }}>
              Website
              <input
                value={form.website}
                onChange={(e) => setForm({ ...form, website: e.target.value })}
                placeholder="bhayacruises.com"
                className="rounded-lg border px-2.5 py-2 text-sm"
                style={inputStyle}
              />
            </label>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <label className={field} style={{ color: "var(--text-secondary)" }}>
            Country
            <select value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} className="rounded-lg border px-2 py-2 text-sm" style={inputStyle}>
              {COUNTRIES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className={field} style={{ color: "var(--text-secondary)" }}>
            Language
            <select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} className="rounded-lg border px-2 py-2 text-sm" style={inputStyle}>
              {LANGUAGES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className={field} style={{ color: "var(--text-secondary)" }}>
            Device
            <select
              value={form.device}
              onChange={(e) => setForm({ ...form, device: e.target.value as NewProjectInput["device"] })}
              className="rounded-lg border px-2 py-2 text-sm"
              style={inputStyle}
            >
              <option value="mobile">Mobile</option>
              <option value="desktop">Desktop</option>
              <option value="tablet">Tablet</option>
            </select>
          </label>
        </div>
        {error ? (
          <p className="text-xs" style={{ color: "var(--status-critical)" }} role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            style={{ background: "var(--series-1)" }}
          >
            {busy ? "Creating…" : "Create project"}
          </button>
        </div>
      </form>
    </div>
  );
}
