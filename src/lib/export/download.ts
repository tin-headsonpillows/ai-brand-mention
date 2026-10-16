import { fileBase, type ExportDoc, type ExportFormat } from "./types";

export const FORMAT_LABEL: Record<ExportFormat, string> = { xlsx: "Excel (.xlsx)", pdf: "PDF (.pdf)", pptx: "PowerPoint (.pptx)" };

/** Builds the file in the browser (each writer loads only when used) and starts the download. */
export async function downloadExport(doc: ExportDoc, format: ExportFormat, name: string): Promise<void> {
  const blob =
    format === "xlsx"
      ? await (await import("./xlsx")).toXlsx(doc)
      : format === "pdf"
        ? await (await import("./pdf")).toPdf(doc)
        : await (await import("./pptx")).toPptx(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${fileBase(name) || "export"}.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
