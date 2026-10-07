"use client";

import { useState } from "react";
import { ChatGptTab } from "@/components/ChatGptTab";
import { TrackingTab } from "@/components/tracking/TrackingTab";
import { ReviewsTab } from "@/components/reviews/ReviewsTab";

type Tab = "chatgpt" | "tracking" | "reviews";

const TABS: Array<{ value: Tab; label: string }> = [
  { value: "tracking", label: "Google Search Tracking" },
  { value: "chatgpt", label: "ChatGPT Mentions" },
  { value: "reviews", label: "Reviews" },
];

export default function Home() {
  const [tab, setTab] = useState<Tab>("tracking");

  return (
    <div
      className={`mx-auto flex w-full flex-1 flex-col gap-6 px-4 py-10 sm:px-6 ${tab === "chatgpt" ? "max-w-6xl" : "max-w-[1440px]"}`}
    >
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
          AI Brand Mention Tracker
        </h1>
        <div className="flex gap-1 border-b" style={{ borderColor: "var(--gridline)" }}>
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value)}
              className="border-b-2 px-3 py-2 text-sm font-medium"
              style={{
                borderColor: tab === t.value ? "var(--series-1)" : "transparent",
                color: tab === t.value ? "var(--text-primary)" : "var(--text-muted)",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      {tab === "chatgpt" ? <ChatGptTab /> : tab === "reviews" ? <ReviewsTab /> : <TrackingTab />}
    </div>
  );
}
