"use client";

import { useRouter } from "next/navigation";
import { ProjectScopedTab } from "@/components/ProjectScopedTab";
import { KeywordResearchView } from "./KeywordResearchView";

export function KeywordResearchTab() {
  const router = useRouter();
  return (
    <ProjectScopedTab intro="Taxonomy, live Google intent, country volume, clusters, target pages and priorities, built from the project's knowledge base">
      {({ projectId, refreshUsage }) => (
        <KeywordResearchView projectId={projectId} onRunFinished={refreshUsage} onOpenKnowledgeBase={() => router.push(`/knowledge-base?project=${encodeURIComponent(projectId)}`)} />
      )}
    </ProjectScopedTab>
  );
}
