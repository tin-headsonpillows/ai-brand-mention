import type { NextRequest } from "next/server";
import { blankArticle, listArticles, readArticle, saveArticles } from "@/lib/articles/store";
import { slugify } from "@/lib/articles/seo";
import type { Article, ArticleSource, PlanRow } from "@/lib/articles/types";
import { readDoc } from "@/lib/google/content";
import { imageSize } from "@/lib/images/imageSize";
import { libraryFileUrl, saveManyToLibrary } from "@/lib/images/library";
import { fetchPublicImage } from "@/lib/images/safeFetch";
import { resolveProject } from "@/lib/tracking/store";

export const maxDuration = 300;

const MAX_ITEMS = 10;

interface ImportItem extends Partial<PlanRow> {
  sheetId?: string;
  sheetTab?: string;
}

const text = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const list = (v: string) =>
  v
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

function parseDate(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/**
 * Creates articles from content-plan rows (and their linked Google Docs) or from a single Doc link. Images in a
 * Doc are copied into the project's image library, because Google's image links expire after ~30 minutes.
 * A row/Doc imported before is updated in place when `overwrite` is set, otherwise skipped.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { project?: unknown; items?: unknown; overwrite?: unknown } | null;
  const projectId = await resolveProject(typeof body?.project === "string" ? body.project : null);
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  const items = (Array.isArray(body?.items) ? body.items : []).slice(0, MAX_ITEMS) as ImportItem[];
  if (items.length === 0) return Response.json({ error: "Nothing to import" }, { status: 400 });
  const overwrite = body?.overwrite === true;

  const existing = await listArticles(projectId);
  const created: Article[] = [];
  const results: Array<{ title: string; status: "created" | "updated" | "skipped" | "failed"; id?: string; error?: string }> = [];

  for (const item of items) {
    const docUrl = text(item.docUrl, 2000);
    const sheetRow = Number(item.rowNumber) || undefined;
    const label = text(item.title) || docUrl || `Row ${sheetRow ?? "?"}`;
    try {
      const doc = docUrl ? await readDoc(docUrl) : null;
      const source: ArticleSource = {
        type: doc?.via === "sample" ? "sample" : item.sheetId ? "sheet" : doc ? "doc" : "manual",
        sheetId: text(item.sheetId, 200) || undefined,
        sheetTab: text(item.sheetTab, 200) || undefined,
        sheetRow,
        docId: doc?.docId,
        docUrl: docUrl || undefined,
        importedAt: new Date().toISOString(),
      };
      const match = existing.find(
        (a) =>
          (source.docId && a.source.docId === source.docId) ||
          (source.sheetId && a.source.sheetId === source.sheetId && a.source.sheetTab === source.sheetTab && a.source.sheetRow === sheetRow)
      );
      if (match && !overwrite) {
        results.push({ title: label, status: "skipped", id: match.id, error: "Already imported" });
        continue;
      }

      let html = doc?.html ?? "";
      if (doc?.images.length) html = await copyDocImages(projectId, html, doc.images, doc.title);

      const title = text(item.title) || doc?.title || "Untitled article";
      const focusKeyword = text(item.focusKeyword, 200);
      const base = match ? await readArticle(projectId, match.id) : null;
      const article: Article = {
        ...(base ?? blankArticle()),
        title,
        focusKeyword: focusKeyword || base?.focusKeyword || "",
        secondaryKeywords: item.secondaryKeywords ? list(text(item.secondaryKeywords, 1000)) : base?.secondaryKeywords ?? [],
        slug: text(item.slug, 200) ? slugify(text(item.slug, 200)) : base?.slug || slugify(focusKeyword || title),
        metaTitle: text(item.metaTitle, 300) || base?.metaTitle || "",
        metaDescription: text(item.metaDescription, 600) || base?.metaDescription || "",
        contentHtml: html || base?.contentHtml || "",
        categories: item.categories ? list(text(item.categories)) : base?.categories ?? [],
        tags: item.tags ? list(text(item.tags)) : base?.tags ?? [],
        publish: { mode: base?.publish.mode ?? "draft", date: parseDate(text(item.publishDate, 100)) ?? base?.publish.date },
        notes: text(item.status, 200) ? `Sheet status: ${text(item.status, 200)}` : base?.notes,
        source,
        updatedAt: new Date().toISOString(),
      };
      created.push(article);
      results.push({ title, status: match ? "updated" : "created", id: article.id });
    } catch (err) {
      results.push({ title: label, status: "failed", error: err instanceof Error ? err.message : "Import failed" });
    }
  }

  if (created.length) await saveArticles(projectId, created);
  return Response.json({ results });
}

async function copyDocImages(projectId: string, html: string, images: Array<{ src: string; alt: string }>, title: string): Promise<string> {
  const entries: Parameters<typeof saveManyToLibrary>[1] = [];
  const srcs: string[] = [];
  for (const image of images) {
    try {
      const { data, contentType } = await fetchPublicImage(image.src);
      const size = imageSize(data);
      entries.push({
        meta: { kind: "doc", title: image.alt || title, width: size?.width ?? 0, height: size?.height ?? 0, contentType, sourceUrl: undefined },
        data,
      });
      srcs.push(image.src);
    } catch {
      // Leave the original link; the editor flags images that can't load.
    }
  }
  const saved = await saveManyToLibrary(projectId, entries);
  let out = html;
  saved.forEach((item, i) => {
    const original = srcs[i];
    const escaped = original.replace(/&/g, "&amp;");
    out = out.split(`src="${escaped}"`).join(`src="${libraryFileUrl(projectId, item.id)}"`).split(`src="${original}"`).join(`src="${libraryFileUrl(projectId, item.id)}"`);
  });
  return out;
}
