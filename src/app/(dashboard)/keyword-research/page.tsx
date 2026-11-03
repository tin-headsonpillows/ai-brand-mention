import type { Metadata } from "next";
import { Suspense } from "react";
import { KeywordResearchTab } from "@/components/keywords/KeywordResearchTab";

export const metadata: Metadata = { title: "Keyword Research · AI Brand Mention Tracker" };

export default function KeywordResearchPage() {
  // Suspense: the tab reads its project from the URL query (useSearchParams).
  return (
    <Suspense>
      <KeywordResearchTab />
    </Suspense>
  );
}
