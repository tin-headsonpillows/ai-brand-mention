"use client";

import { useState } from "react";
import { ChatGptTab } from "@/components/ChatGptTab";
import { TrackingTab } from "@/components/tracking/TrackingTab";

type Tab = "chatgpt" | "tracking";

export default function Home() {
  const [tab, setTab] = useState<Tab>("chatgpt");

  return (
    <div
      className={`mx-auto flex w-full flex-1 flex-col gap-6 px-4 py-10 sm:px-6 ${tab === "tracking" ? "max-w-[1440px]" : "max-w-4xl"}`}
    >
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
          AI Brand Mention Tracker
        </h1>
        <div className="flex gap-1 border-b" style={{ borderColor: "var(--gridline)" }}>
          <button
            type="button"
            onClick={() => setTab("chatgpt")}
            className="border-b-2 px-3 py-2 text-sm font-medium"
            style={{
              borderColor: tab === "chatgpt" ? "var(--series-1)" : "transparent",
              color: tab === "chatgpt" ? "var(--text-primary)" : "var(--text-muted)",
            }}
          >
            ChatGPT Mentions
          </button>
          <button
            type="button"
            onClick={() => setTab("tracking")}
            className="border-b-2 px-3 py-2 text-sm font-medium"
            style={{
              borderColor: tab === "tracking" ? "var(--series-1)" : "transparent",
              color: tab === "tracking" ? "var(--text-primary)" : "var(--text-muted)",
            }}
          >
            Google Search Tracking
          </button>
        </div>
      </header>

      {tab === "chatgpt" ? <ChatGptTab /> : <TrackingTab />}
    </div>
  );
}
