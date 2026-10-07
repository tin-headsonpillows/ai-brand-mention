import type { Metadata } from "next";
import { Suspense } from "react";
import { ReviewsTab } from "@/components/reviews/ReviewsTab";

export const metadata: Metadata = { title: "Google Maps Reviews · AI Brand Mention Tracker" };

export default function GoogleMapsReviewsPage() {
  // Suspense: the tab reads its view from the URL query (useSearchParams).
  return (
    <Suspense>
      <ReviewsTab />
    </Suspense>
  );
}
