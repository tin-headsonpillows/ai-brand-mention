"use client";

import { ProjectScopedTab } from "@/components/ProjectScopedTab";
import { KnowledgeBaseView } from "./KnowledgeBaseView";

export function KnowledgeBaseTab() {
  return (
    <ProjectScopedTab intro="Everything the team knows about the brand before writing prompts: website AI readiness, Google presence, offerings with proof, personas, competitors and client answers">
      {({ projectId, openSettings, refreshUsage }) => <KnowledgeBaseView projectId={projectId} onOpenSettings={openSettings} onRunFinished={refreshUsage} />}
    </ProjectScopedTab>
  );
}
