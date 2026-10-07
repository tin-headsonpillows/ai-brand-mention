import { deleteJson, readJson, writeJson } from "../blobJson";
import { analyzeSeo, wordCount } from "./seo";
import type { Article, ArticleSummary } from "./types";

/** Per-project articles: one index for the list plus one JSON file per article, in the private Blob store. */
const indexPath = (projectId: string) => `articles/${projectId}/index.json`;
const articlePath = (projectId: string, id: string) => `articles/${projectId}/items/${id}.json`;
const validId = (id: string) => /^[\w-]{1,80}$/.test(id);

interface ArticleIndex {
  items: ArticleSummary[];
}

export function summarize(article: Article): ArticleSummary {
  return {
    id: article.id,
    title: article.title,
    focusKeyword: article.focusKeyword,
    status: article.status,
    seoScore: analyzeSeo(article).score,
    wordCount: wordCount(article.contentHtml),
    source: article.source,
    wordpress: article.wordpress,
    publish: article.publish,
    updatedAt: article.updatedAt,
  };
}

export async function listArticles(projectId: string): Promise<ArticleSummary[]> {
  return (await readJson<ArticleIndex>(indexPath(projectId)))?.items ?? [];
}

export async function readArticle(projectId: string, id: string): Promise<Article | null> {
  if (!validId(id)) return null;
  return readJson<Article>(articlePath(projectId, id));
}

export function blankArticle(partial: Partial<Article> = {}): Article {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: "",
    slug: "",
    focusKeyword: "",
    secondaryKeywords: [],
    metaTitle: "",
    metaDescription: "",
    excerpt: "",
    contentHtml: "",
    categories: [],
    tags: [],
    status: "draft",
    publish: { mode: "draft" },
    source: { type: "manual" },
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

/** Saves articles and refreshes their rows in the index (one index write for the batch). */
export async function saveArticles(projectId: string, articles: Article[]): Promise<void> {
  for (const article of articles) await writeJson(articlePath(projectId, article.id), article);
  const index = await listArticles(projectId);
  const updated = new Map(articles.map((a) => [a.id, summarize(a)]));
  const kept = index.filter((s) => !updated.has(s.id));
  await writeJson(indexPath(projectId), { items: [...updated.values(), ...kept] } satisfies ArticleIndex);
}

export async function deleteArticle(projectId: string, id: string): Promise<void> {
  if (!validId(id)) return;
  const index = await listArticles(projectId);
  await writeJson(indexPath(projectId), { items: index.filter((s) => s.id !== id) } satisfies ArticleIndex);
  await deleteJson([articlePath(projectId, id)]).catch(() => {
    // Already out of the index.
  });
}
