import type { Metadata } from "next";
import { Suspense } from "react";
import { ImagesTab } from "@/components/images/ImagesTab";

export const metadata: Metadata = { title: "Images · AI Brand Mention Tracker" };

export default function ImagesPage() {
  // Suspense: the tab reads its view from the URL query (useSearchParams).
  return (
    <Suspense>
      <ImagesTab />
    </Suspense>
  );
}
