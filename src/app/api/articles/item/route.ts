import type { NextRequest } from "next/server";
import { deleteArticle, readArticle, saveArticles } from "@/lib/articles/store";
import { slugify } from "@/lib/articles/seo";
import type { Article, ArticleImageRef, ArticleStatus, PublishMode } from "@/lib/articles/types";
import { cleanHtml } from "@/lib/google/content";
import { resolveProject } from "@/lib/tracking/store";

const STATUSES: ArticleStatus[] = ["draft", "ready", "published", "scheduled", "error"];
const MODES: PublishMode[] = ["draft", "publish", "future"];

async function target(req: NextRequest) {
  const projectId = await resolveProject(req.nextUrl.searchParams.get("project"));
  const id = req.nextUrl.searchParams.get("id") ?? "";
  return { projectId, id };
}

export async function GET(req: NextRequest) {
  const { projectId, id } = await target(req);
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  const article = await readArticle(projectId, id);
  return article ? Response.json({ article }) : Response.json({ error: "Article not found" }, { status: 404 });
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);
const strList = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, 100)).filter(Boolean).slice(0, 30) : undefined;

function imageRef(v: unknown): ArticleImageRef | undefined {
  const r = (v ?? {}) as Record<string, unknown>;
  const src = str(r.src, 2000);
  if (!src || !/^(https?:\/\/|\/api\/images\/)/.test(src)) return undefined;
  return { src, alt: str(r.alt, 300) ?? "", title: str(r.title, 300), caption: str(r.caption, 500) };
}

/** Saves the editor's fields. HTML is cleaned to article markup on the way in. */
export async function PUT(req: NextRequest) {
  const { projectId, id } = await target(req);
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  const current = await readArticle(projectId, id);
  if (!current) return Response.json({ error: "Article not found" }, { status: 404 });
  const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const publish = (b.publish ?? {}) as Record<string, unknown>;
  const next: Article = {
    ...current,
    title: str(b.title, 300)?.trim() ?? current.title,
    slug: b.slug !== undefined ? slugify(str(b.slug, 200) ?? "") : current.slug,
    focusKeyword: str(b.focusKeyword, 200)?.trim() ?? current.focusKeyword,
    secondaryKeywords: strList(b.secondaryKeywords) ?? current.secondaryKeywords,
    metaTitle: str(b.metaTitle, 300) ?? current.metaTitle,
    metaDescription: str(b.metaDescription, 600) ?? current.metaDescription,
    excerpt: str(b.excerpt, 1000) ?? current.excerpt,
    contentHtml: typeof b.contentHtml === "string" ? cleanHtml(b.contentHtml.slice(0, 1_000_000)) : current.contentHtml,
    featuredImage: b.featuredImage === null ? undefined : imageRef(b.featuredImage) ?? current.featuredImage,
    categories: strList(b.categories) ?? current.categories,
    tags: strList(b.tags) ?? current.tags,
    status: STATUSES.includes(b.status as ArticleStatus) ? (b.status as ArticleStatus) : current.status,
    publish: {
      mode: MODES.includes(publish.mode as PublishMode) ? (publish.mode as PublishMode) : current.publish.mode,
      date: typeof publish.date === "string" && !Number.isNaN(new Date(publish.date).getTime()) ? new Date(publish.date).toISOString() : publish.date === null ? undefined : current.publish.date,
    },
    notes: str(b.notes, 2000) ?? current.notes,
    updatedAt: new Date().toISOString(),
  };
  await saveArticles(projectId, [next]);
  return Response.json({ article: next });
}

export async function DELETE(req: NextRequest) {
  const { projectId, id } = await target(req);
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  await deleteArticle(projectId, id);
  return Response.json({ ok: true });
}
