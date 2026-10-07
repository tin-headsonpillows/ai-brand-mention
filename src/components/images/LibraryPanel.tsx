"use client";

import type { LibraryItem } from "@/lib/images/types";
import { EmptyState } from "@/components/tracking/ui";
import { ImageGrid } from "./ImageGrid";
import { libraryFileUrl, type SelectedImage } from "./imageClient";
import { libraryItemToSelected } from "./GeneratePanel";
import { formatUsd, imageModel } from "@/lib/images/models";

const EXTENSION: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg" };

const KIND_LABEL: Record<LibraryItem["kind"], string> = {
  google: "Google Images",
  instagram: "Instagram",
  generated: "AI generated",
  upload: "Upload",
  doc: "Google Doc",
  web: "Web link",
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
    return <EmptyState title="No saved images yet" body="Generated images, images you save from Google or Instagram, and the JPGs you download are kept here, per project." />;
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
          <span className="flex flex-wrap items-center justify-between gap-x-2">
            <span>
              {KIND_LABEL[item.kind]} · {new Date(item.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              {item.model ? ` · ${imageModel(item.model)?.label ?? item.model}` : ""}
              {item.costUsd ? ` · ${formatUsd(item.costUsd)}` : ""}
            </span>
            <span className="flex gap-2">
              <a
                href={libraryFileUrl(projectId, item.id)}
                download={`${item.title.slice(0, 40).replace(/[^\w-]+/g, "-") || "image"}.${EXTENSION[item.contentType] ?? "jpg"}`}
                title="Download the saved file as it is (use Crop & download for an exact size JPG)"
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
