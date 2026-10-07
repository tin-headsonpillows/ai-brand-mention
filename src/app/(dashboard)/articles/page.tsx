import type { Metadata } from "next";
import { Suspense } from "react";
import { ArticlesTab } from "@/components/articles/ArticlesTab";

export const metadata: Metadata = { title: "Articles · AI Brand Mention Tracker" };

export default function ArticlesPage() {
  // Suspense: the tab reads its view from the URL query (useSearchParams).
  return (
    <Suspense>
      <ArticlesTab />
    </Suspense>
  );
}
