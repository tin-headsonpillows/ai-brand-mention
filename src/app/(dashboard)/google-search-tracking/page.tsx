import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { TrackingTab } from "@/components/tracking/TrackingTab";

export const metadata: Metadata = { title: "Google Search Tracking · AI Brand Mention Tracker" };

export default async function GoogleSearchTrackingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Brand Mentions used to be a view of this tab; old bookmarks land on its own dashboard.
  const params = await searchParams;
  if (params.view === "brand-mentions") {
    const next = new URLSearchParams();
    for (const key of ["project", "bm"]) {
      const value = params[key];
      if (typeof value === "string" && value) next.set(key, value);
    }
    redirect(`/brand-mentions${next.size ? `?${next}` : ""}`);
  }
  // Suspense: the tab reads its view from the URL query (useSearchParams).
  return (
    <Suspense>
      <TrackingTab />
    </Suspense>
  );
}
