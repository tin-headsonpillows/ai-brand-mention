import type { Metadata } from "next";
import { Suspense } from "react";
import { BrandMentionsTab } from "@/components/brand/BrandMentionsTab";

export const metadata: Metadata = { title: "Brand Mentions · AI Brand Mention Tracker" };

export default function BrandMentionsPage() {
  // Suspense: the tab reads its project and section from the URL query (useSearchParams).
  return (
    <Suspense>
      <BrandMentionsTab />
    </Suspense>
  );
}
