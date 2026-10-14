"use client";

import type { SeSnapshot } from "@/lib/seranking/types";
import { Headline, Panel } from "@/components/tracking/ui";
import { BarList, SectionError, Th, fmtInt } from "./shared";

export function CompetitorsSection({ snap }: { snap: SeSnapshot }) {
  const b = snap.backlinks;
  return (
    <div className="flex flex-col gap-4">
      <SectionError message={snap.errors.serp ?? snap.errors.competitors} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Who owns the top 10" subtitle={`share of visibility across the tracked keywords, ${snap.engines[0]?.name ?? "main engine"}, latest check`}>
          {snap.serpDomains.length ? (
            <BarList
              format={(v) => fmtInt(v)}
              rows={snap.serpDomains.map((d) => ({
                key: d.domain,
                label: (
                  <span style={{ fontWeight: d.isOwn ? 600 : undefined, color: d.isOwn ? "var(--text-primary)" : undefined }}>
                    {d.domain}
                    {d.isOwn ? " (you)" : d.isCompetitor ? " (competitor)" : ""}
                  </span>
                ),
                value: d.visibility,
                title: `${fmtInt(d.refDomains)} referring domains · ${fmtInt(d.backlinks)} backlinks`,
              }))}
            />
          ) : (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              No top-10 data for the latest check (SE Ranking keeps it for 14 days).
            </p>
          )}
        </Panel>
        <Panel title="Tracked competitors" subtitle="competitors added to this SE Ranking project">
          {snap.competitors.length ? (
            <table className="w-full text-xs">
              <thead>
                <tr style={{ color: "var(--text-muted)" }}>
                  <Th>Competitor</Th>
                  <Th align="right">Domain Trust</Th>
                </tr>
              </thead>
              <tbody>
                {snap.competitors.map((c) => (
                  <tr key={c.id} className="border-t" style={{ borderColor: "var(--gridline)" }}>
                    <td className="py-1.5 pr-3" style={{ color: "var(--text-primary)" }}>
                      {c.url ? (
                        <a href={c.url} target="_blank" rel="noreferrer" className="hover:underline">
                          {c.name}
                        </a>
                      ) : (
                        c.name
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular" style={{ color: "var(--text-primary)" }}>
                      {fmtInt(c.domainTrust)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              No competitors added to this project in SE Ranking.
            </p>
          )}
        </Panel>
      </div>
      <SectionError message={snap.errors.backlinks} />
      <Panel title="Backlink monitor" subtitle="links tracked in SE Ranking's Backlink Monitor for this project">
        {b && b.total > 0 ? (
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-6">
            <Headline label="Backlinks" value={fmtInt(b.total)} />
            <Headline label="Referring domains" value={fmtInt(b.domains)} />
            <Headline label="Dofollow" value={fmtInt(b.dofollow)} />
            <Headline label="Nofollow" value={fmtInt(b.nofollow)} />
            <Headline label="Anchors" value={fmtInt(b.anchors)} />
            <Headline label="IP addresses" value={fmtInt(b.ip)} />
          </div>
        ) : (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            No backlinks monitored for this project. Domain-level link counts from the site audit: {fmtInt(snap.audit?.domain.backlinks)} backlinks from {fmtInt(snap.audit?.domain.refDomains)} referring domains.
          </p>
        )}
      </Panel>
    </div>
  );
}
