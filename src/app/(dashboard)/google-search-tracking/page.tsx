import type { Metadata } from "next";
import { Suspense } from "react";
import { TrackingTab } from "@/components/tracking/TrackingTab";

export const metadata: Metadata = { title: "Google Search Tracking · AI Brand Mention Tracker" };

export default function GoogleSearchTrackingPage() {
  // Suspense: the tab reads its view from the URL query (useSearchParams).
  return (
    <Suspense>
      <TrackingTab />
    </Suspense>
  );
}
