"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export const TABS = [
  { href: "/google-search-tracking", label: "Google Search Tracking", wide: true },
  { href: "/chatgpt-mentions", label: "ChatGPT Mentions", wide: false },
  { href: "/google-maps-reviews", label: "Google Maps Reviews", wide: true },
  { href: "/images", label: "Images", wide: true },
  { href: "/articles", label: "Articles", wide: true },
] as const;

/** Header + tab bar shared by every section; each tab is its own URL so it can be bookmarked. */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const active = TABS.find((t) => pathname.startsWith(t.href)) ?? TABS[0];

  return (
    <div className={`mx-auto flex w-full flex-1 flex-col gap-6 px-4 py-10 sm:px-6 ${active.wide ? "max-w-[1440px]" : "max-w-6xl"}`}>
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
          AI Brand Mention Tracker
        </h1>
        <nav className="flex gap-1 overflow-x-auto border-b" style={{ borderColor: "var(--gridline)" }} aria-label="Sections">
          {TABS.map((t) => {
            const current = t.href === active.href;
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={current ? "page" : undefined}
                className="border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap"
                style={{
                  borderColor: current ? "var(--series-1)" : "transparent",
                  color: current ? "var(--text-primary)" : "var(--text-muted)",
                }}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
      </header>
      {children}
    </div>
  );
}
