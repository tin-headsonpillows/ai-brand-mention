import type { Metadata } from "next";
import { Suspense } from "react";
import { SeRankingTab } from "@/components/seranking/SeRankingTab";

export const metadata: Metadata = { title: "SE Ranking · AI Brand Mention Tracker" };

export default function SeRankingPage() {
  // Suspense: the tab reads its project and section from the URL query (useSearchParams).
  return (
    <Suspense>
      <SeRankingTab />
    </Suspense>
  );
}
