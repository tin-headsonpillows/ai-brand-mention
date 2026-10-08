"use client";

import { useState } from "react";
import type { Review, TripadvisorProfile } from "@/lib/reviews/types";
import { Panel } from "@/components/tracking/ui";

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** The Tripadvisor listing's own data: ranking, rating spread, category scores, AI summary and highlights. */
export function TripadvisorProfilePanel({ profile }: { profile: TripadvisorProfile }) {
  const [showAmenities, setShowAmenities] = useState(false);
  const distTotal = profile.distribution.reduce((s, d) => s + d.count, 0);
  const distMax = Math.max(1, ...profile.distribution.map((d) => d.count));
  return (
    <Panel
      title="Tripadvisor listing"
      subtitle={`as shown on Tripadvisor · updated ${fmtDate(profile.fetchedAt)}`}
      actions={
        profile.link ? (
          <a href={profile.link} target="_blank" rel="noreferrer" className="text-xs font-medium hover:underline" style={{ color: "var(--series-1)" }}>
            Open on Tripadvisor
          </a>
        ) : undefined
      }
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline gap-2">
            <span className="tabular text-3xl font-semibold" style={{ color: "var(--text-primary)" }}>
              {profile.rating?.toFixed(1) ?? "–"}
            </span>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              of 5 · {profile.reviews?.toLocaleString() ?? "?"} reviews
            </span>
          </div>
          {profile.ranking ? (
            <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              {profile.ranking}
            </span>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            {profile.award ? (
              <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: "color-mix(in srgb, var(--sentiment-positive) 14%, transparent)", color: "var(--text-primary)" }}>
                {profile.award.type}
                {profile.award.year ? ` ${profile.award.year}` : ""}
              </span>
            ) : null}
            {[profile.stars, profile.priceLevel].filter(Boolean).map((t) => (
              <span key={t} className="rounded-full border px-2.5 py-0.5 text-xs" style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)" }}>
                {t}
              </span>
            ))}
            {profile.styles.map((s) => (
              <span key={s.tag} className="rounded-full border px-2.5 py-0.5 text-xs" style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)" }} title={`Tripadvisor's ranking for ${s.tag} stays`}>
                {s.ranking ? `#${s.ranking} ` : ""}
                {s.tag}
              </span>
            ))}
          </div>
          {profile.distribution.length ? (
            <div className="flex flex-col gap-1.5" role="img" aria-label="Tripadvisor rating distribution">
              {profile.distribution.map((d) => (
                <div key={d.label} className="grid grid-cols-[5rem_minmax(0,1fr)_3rem] items-center gap-2 text-xs">
                  <span style={{ color: "var(--text-secondary)" }}>{d.label}</span>
                  <span className="h-2.5 rounded" style={{ background: "var(--page-plane)" }}>
                    <span className="block h-2.5 rounded" style={{ width: `${(d.count / distMax) * 100}%`, background: "var(--rating-star)", minWidth: d.count ? 3 : 0 }} />
                  </span>
                  <span className="text-right tabular" style={{ color: "var(--text-primary)" }} title={distTotal ? `${Math.round((d.count / distTotal) * 100)}%` : undefined}>
                    {d.count.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
            Category scores
          </span>
          {profile.subratings.length ? (
            profile.subratings.map((s) => (
              <div key={s.category} className="grid grid-cols-[minmax(0,1fr)_5rem_2.5rem] items-center gap-2 text-xs">
                <span className="truncate" style={{ color: "var(--text-secondary)" }}>
                  {s.category}
                </span>
                <span className="h-2 rounded" style={{ background: "var(--meter-track)" }}>
                  <span className="block h-2 rounded" style={{ width: `${(s.score / 5) * 100}%`, background: "var(--series-1)" }} />
                </span>
                <span className="text-right tabular font-medium" style={{ color: "var(--text-primary)" }}>
                  {s.score.toFixed(1)}
                </span>
              </div>
            ))
          ) : (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Tripadvisor shows no category scores for this listing.
            </p>
          )}
          {profile.amenities.length ? (
            <div className="mt-2 flex flex-col gap-1.5">
              <button type="button" onClick={() => setShowAmenities((v) => !v)} className="self-start text-xs font-medium" style={{ color: "var(--series-1)" }}>
                {showAmenities ? "Hide" : "Show"} amenities ({profile.amenities.length})
              </button>
              {showAmenities ? (
                <div className="flex flex-wrap gap-1">
                  {profile.amenities.map((a) => (
                    <span key={a} className="rounded px-1.5 py-0.5 text-[11px]" style={{ background: "var(--page-plane)", color: "var(--text-secondary)" }}>
                      {a}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          {profile.summary ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
                Tripadvisor&apos;s summary of reviews
              </span>
              <p className="text-sm" style={{ color: "var(--text-primary)" }}>
                {profile.summary}
              </p>
            </div>
          ) : null}
          {profile.highlights.length ? (
            <ul className="flex flex-col gap-2.5">
              {profile.highlights.slice(0, 6).map((h) => (
                <li key={`${h.category}-${h.value ?? ""}`} className="flex flex-col gap-0.5">
                  <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                    {h.category}
                    {h.value ? <span style={{ color: "var(--text-muted)" }}> · {h.value}</span> : null}
                  </span>
                  <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    {h.summary}
                  </span>
                  {h.quotes[0] ? (
                    <span className="truncate pl-2 text-xs italic" style={{ color: "var(--text-muted)", borderLeft: "2px solid var(--gridline)" }} title={h.quotes[0]}>
                      &ldquo;{h.quotes[0]}&rdquo;
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : !profile.summary ? (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Tripadvisor has no AI summary or highlights for this listing yet.
            </p>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

/** Reviews by who travelled (Tripadvisor's trip type): how many, average rating and share of positive reviews. */
export function TripTypePanel({ reviews }: { reviews: Review[] }) {
  const rows = new Map<string, { count: number; ratingSum: number; rated: number; positive: number; analysed: number }>();
  for (const r of reviews) {
    if (!r.tripType) continue;
    const row = rows.get(r.tripType) ?? { count: 0, ratingSum: 0, rated: 0, positive: 0, analysed: 0 };
    row.count++;
    if (r.rating !== null) {
      row.ratingSum += r.rating;
      row.rated++;
    }
    if (r.analysis) {
      row.analysed++;
      if (r.analysis.sentiment === "positive") row.positive++;
    }
    rows.set(r.tripType, row);
  }
  const list = [...rows.entries()].sort((a, b) => b[1].count - a[1].count);
  if (list.length === 0) return null;
  const max = Math.max(...list.map(([, r]) => r.count));
  return (
    <Panel title="Who stays and how they rate it" subtitle="reviews by trip type in this period (Tripadvisor)">
      <table className="w-full text-xs">
        <thead>
          <tr style={{ color: "var(--text-muted)" }}>
            <th className="py-1 text-left font-medium">Trip type</th>
            <th className="py-1 text-left font-medium">Reviews</th>
            <th className="py-1 text-right font-medium">Avg rating</th>
            <th className="py-1 text-right font-medium">Positive</th>
          </tr>
        </thead>
        <tbody>
          {list.map(([type, r]) => (
            <tr key={type} className="border-t" style={{ borderColor: "var(--gridline)" }}>
              <td className="py-1.5 font-medium" style={{ color: "var(--text-primary)" }}>
                {type}
              </td>
              <td className="py-1.5">
                <span className="flex items-center gap-2">
                  <span className="h-2 w-24 rounded" style={{ background: "var(--page-plane)" }}>
                    <span className="block h-2 rounded" style={{ width: `${(r.count / max) * 100}%`, background: "var(--series-1)" }} />
                  </span>
                  <span className="tabular" style={{ color: "var(--text-secondary)" }}>
                    {r.count}
                  </span>
                </span>
              </td>
              <td className="py-1.5 text-right tabular" style={{ color: "var(--text-primary)" }}>
                {r.rated ? (r.ratingSum / r.rated).toFixed(2) : "–"}
              </td>
              <td className="py-1.5 text-right tabular" style={{ color: "var(--text-primary)" }}>
                {r.analysed ? `${Math.round((r.positive / r.analysed) * 100)}%` : "–"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
