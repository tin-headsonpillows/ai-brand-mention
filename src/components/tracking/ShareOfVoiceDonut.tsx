"use client";

import type { RankedSubject } from "@/lib/tracking/types";

const SIZE = 160;
const STROKE = 24;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

interface Segment {
  key: string;
  label: string;
  share: number;
  color: string;
}

// A donut is an all-pairs comparison (any two wedges can be read against each other), which the
// palette only validates for its first 3 hues together - so only your brand plus the top 2
// competitors by volume get distinct colors; the rest fold into one neutral "Other" wedge.
export function ShareOfVoiceDonut({ subjects }: { subjects: RankedSubject[] }) {
  const you = subjects.find((s) => s.isYourBrand);
  const competitors = subjects.filter((s) => !s.isYourBrand).sort((a, b) => b.matchedDays - a.matchedDays);
  const total = subjects.reduce((sum, s) => sum + s.matchedDays, 0);

  if (!you || subjects.length <= 1 || total === 0) {
    return (
      <div
        className="rounded-lg border p-4 text-sm"
        style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)", color: "var(--text-muted)" }}
      >
        Add competitors and run tracking to see share of voice.
      </div>
    );
  }

  const top2 = competitors.slice(0, 2);
  const rest = competitors.slice(2);
  const restShare = rest.reduce((sum, s) => sum + s.matchedDays, 0) / total;

  const segments: Segment[] = [
    { key: you.id, label: you.name, share: you.matchedDays / total, color: "var(--series-1)" },
    ...top2.map((s, i) => ({ key: s.id, label: s.name, share: s.matchedDays / total, color: `var(--series-${i + 2})` })),
    ...(restShare > 0 ? [{ key: "other", label: `Other (${rest.length})`, share: restShare, color: "var(--de-emphasis)" }] : []),
  ].filter((s) => s.share > 0);

  let offset = 0;
  const arcs = segments.map((s) => {
    const dash = s.share * CIRCUMFERENCE;
    const arc = { ...s, dashArray: `${dash} ${CIRCUMFERENCE - dash}`, dashOffset: -offset };
    offset += dash;
    return arc;
  });

  const yourShare = Math.round((you.matchedDays / total) * 100);

  return (
    <div
      className="flex flex-col gap-4 rounded-lg border p-4"
      style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          Share of voice
        </h3>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Your share of total tracked-brand appearances across all keywords.
        </p>
      </div>

      <div className="flex items-center gap-6">
        <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
          <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} role="img" aria-label="Share of voice">
            <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="var(--gridline)" strokeWidth={STROKE} />
            {arcs.map((a) => (
              <circle
                key={a.key}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                fill="none"
                stroke={a.color}
                strokeWidth={STROKE}
                strokeDasharray={a.dashArray}
                strokeDashoffset={a.dashOffset}
                transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
              />
            ))}
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-semibold tabular" style={{ color: "var(--text-primary)" }}>
              {yourShare}%
            </span>
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              you
            </span>
          </div>
        </div>

        <ul className="flex flex-1 flex-col gap-1.5 text-xs">
          {segments.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
              <span className="truncate" style={{ color: "var(--text-primary)" }}>
                {s.label}
              </span>
              <span className="ml-auto tabular" style={{ color: "var(--text-secondary)" }}>
                {Math.round(s.share * 100)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
