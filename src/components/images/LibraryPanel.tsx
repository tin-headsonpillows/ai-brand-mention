"use client";

import type { LibraryItem } from "@/lib/images/types";
import { EmptyState } from "@/components/tracking/ui";
import { ImageGrid } from "./ImageGrid";
import { libraryFileUrl, type SelectedImage } from "./imageClient";
import { libraryItemToSelected } from "./GeneratePanel";

const KIND_LABEL: Record<LibraryItem["kind"], string> = {
  google: "Google Images",
  instagram: "Instagram",
  generated: "AI generated",
  upload: "Upload",
};

/** The project's saved images: re-download, re-crop (select), or delete. */
export function LibraryPanel({
  projectId,
  items,
  selected,
  onToggle,
  onDelete,
}: {
  projectId: string;
  items: LibraryItem[] | null;
  selected: Set<string>;
  onToggle: (image: SelectedImage) => void;
  onDelete: (id: string) => void;
}) {
  if (items === null) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Loading library...
      </p>
    );
  }
  if (items.length === 0) {
    return <EmptyState title="No saved images yet" body="Generated images and the JPGs you download from searches are kept here, per project." />;
  }
  const byId = new Map(items.map((i) => [i.id, i]));
  return (
    <ImageGrid
      images={items.map((item) => libraryItemToSelected(projectId, item))}
      selected={selected}
      onToggle={onToggle}
      extra={(image) => {
        const item = image.libraryId ? byId.get(image.libraryId) : undefined;
        if (!item) return null;
        return (
          <span className="flex items-center justify-between gap-2">
            <span>
              {KIND_LABEL[item.kind]} · {new Date(item.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </span>
            <span className="flex gap-2">
              <a
                href={libraryFileUrl(projectId, item.id)}
                download={`${item.title.slice(0, 40).replace(/[^\w-]+/g, "-") || "image"}.${item.contentType === "image/svg+xml" ? "svg" : "jpg"}`}
                className="hover:underline"
                style={{ color: "var(--series-1)" }}
              >
                Download
              </a>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm("Delete this image from the library?")) onDelete(item.id);
                }}
                className="hover:underline"
                style={{ color: "var(--text-muted)" }}
              >
                Delete
              </button>
            </span>
          </span>
        );
      }}
    />
  );
}
