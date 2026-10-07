"use client";

import type { SerpUsage } from "@/lib/tracking/types";

/** "SerpApi 9 searches left · key 2/8" - remaining searches on the key the failover pool is using now. */
export function SerpUsageBadge({ usage }: { usage: SerpUsage | null }) {
  const searchesLeft = usage?.totalSearchesLeft ?? usage?.planSearchesLeft ?? null;
  const keyLabel = usage && usage.keyPoolSize > 1 ? `key ${(usage.activeKeyIndex ?? 0) + 1}/${usage.keyPoolSize}` : null;
  return (
    <span
      className="rounded-lg border px-2.5 py-1.5 text-xs whitespace-nowrap"
      style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)", background: "var(--surface-1)" }}
      title={
        usage && !usage.mock
          ? `${usage.thisMonthUsage ?? "?"} used of ${usage.searchesPerMonth ?? "?"} this month on the active key${
              usage.keyPoolSize > 1 ? ` (key ${(usage.activeKeyIndex ?? 0) + 1} of ${usage.keyPoolSize}; the next key takes over when it runs out)` : ""
            }`
          : "Mock data - no SerpApi key configured"
      }
    >
      SerpApi{" "}
      <strong className="tabular" style={{ color: "var(--text-primary)" }}>
        {searchesLeft != null ? searchesLeft.toLocaleString("en-US") : "–"}
      </strong>{" "}
      searches left
      {keyLabel ? ` · ${keyLabel}` : ""}
      {usage?.mock ? " · mock" : ""}
    </span>
  );
}
