/** Same-origin URL the app serves a library image from (also used inside article HTML). */
export const libraryFileUrl = (projectId: string, id: string): string =>
  `/api/images/library/file?project=${encodeURIComponent(projectId)}&id=${encodeURIComponent(id)}`;

/** The library item a libraryFileUrl points at, if it is one. */
export function parseLibraryFileUrl(src: string): { projectId: string; id: string } | null {
  if (!src.startsWith("/api/images/library/file?")) return null;
  const p = new URLSearchParams(src.split("?")[1].replace(/&amp;/g, "&"));
  const projectId = p.get("project");
  const id = p.get("id");
  return projectId && id ? { projectId, id } : null;
}
