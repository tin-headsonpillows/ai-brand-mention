import type { Metadata } from "next";
import { Suspense } from "react";
import { KnowledgeBaseTab } from "@/components/knowledge/KnowledgeBaseTab";

export const metadata: Metadata = { title: "Brand Knowledge Base · AI Brand Mention Tracker" };

export default function KnowledgeBasePage() {
  // Suspense: the tab reads its project from the URL query (useSearchParams).
  return (
    <Suspense>
      <KnowledgeBaseTab />
    </Suspense>
  );
}
