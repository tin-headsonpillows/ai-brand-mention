/** Project roles (safe to import in the browser). */
export type Role = "owner" | "editor" | "reviewer" | "viewer";

export const ROLES: Array<{ id: Role; label: string; can: string }> = [
  { id: "owner", label: "Owner", can: "everything, including members and WordPress settings" },
  { id: "editor", label: "Editor", can: "edit, import, translate, create Docs, publish, move cards" },
  { id: "reviewer", label: "Reviewer", can: "read, and comment on / reply to Doc comments" },
  { id: "viewer", label: "Viewer", can: "read only" },
];

const RANK: Record<Role, number> = { viewer: 0, reviewer: 1, editor: 2, owner: 3 };
export const atLeast = (role: Role | null, need: Role) => role !== null && RANK[role] >= RANK[need];

export interface Member {
  email: string;
  role: Role;
  addedAt: string;
  addedBy?: string;
}
