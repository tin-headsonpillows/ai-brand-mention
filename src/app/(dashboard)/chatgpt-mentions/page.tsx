import type { Metadata } from "next";
import { Suspense } from "react";
import { ChatGptTab } from "@/components/ChatGptTab";

export const metadata: Metadata = { title: "ChatGPT Mentions · AI Brand Mention Tracker" };

export default function ChatGptMentionsPage() {
  // Suspense: the tab reads its view from the URL query (useSearchParams).
  return (
    <Suspense>
      <ChatGptTab />
    </Suspense>
  );
}
