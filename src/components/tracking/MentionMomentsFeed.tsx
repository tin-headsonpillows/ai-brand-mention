"use client";

import type { MentionMoment } from "@/lib/tracking/types";

const SURFACE_LABEL: Record<MentionMoment["surface"], string> = {
  organic: "Organic",
  aiOverview: "AI Overview",
  aiMode: "AI Mode",
};

const SURFACE_COLOR: Record<MentionMoment["surface"], string> = {
  organic: "var(--series-1)",
  aiOverview: "#eb6834",
  aiMode: "#1baf7a",
};

export function MentionMomentsFeed({ moments }: { moments: MentionMoment[] }) {
  if (moments.length === 0) {
    return (
      <div
        className="rounded-lg border p-4 text-sm"
        style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)", color: "var(--text-muted)" }}
      >
        No brand mentions captured yet - once tracking finds your brand in a result, the context will show up here.
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-4 rounded-lg border p-4"
      style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          How your brand is being discussed
        </h3>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Recent moments your brand appeared, with the surrounding text - most recent first.
        </p>
      </div>
      <ul className="flex flex-col divide-y" style={{ borderColor: "var(--gridline)" }}>
        {moments.map((m, i) => (
          <li key={`${m.date}-${m.keyword}-${m.surface}-${i}`} className="flex flex-col gap-1 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white"
                style={{ background: SURFACE_COLOR[m.surface] }}
              >
                {SURFACE_LABEL[m.surface]}
              </span>
              <span className="text-xs tabular" style={{ color: "var(--text-muted)" }}>
                {m.date}
              </span>
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                &ldquo;{m.keyword}&rdquo;
              </span>
            </div>
            <p style={{ color: "var(--text-primary)" }}>{m.excerpt}</p>
            {m.link ? (
              <a
                href={m.link}
                target="_blank"
                rel="noreferrer"
                className="truncate text-xs underline"
                style={{ color: "var(--series-1)" }}
              >
                {m.domain ?? m.link}
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
