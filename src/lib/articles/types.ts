/** Where the app is in an article's life; WordPress has its own status (wordpress.status). */
export type ArticleStatus = "draft" | "ready" | "published" | "scheduled" | "error";
export type PublishMode = "draft" | "publish" | "future";

export interface ArticleImageRef {
  /** Library file URL (/api/images/library/file?...), or an external image URL. */
  src: string;
  alt: string;
  title?: string;
  caption?: string;
}

export interface ArticleSource {
  type: "sheet" | "doc" | "manual" | "sample";
  sheetId?: string;
  sheetTab?: string;
  sheetRow?: number;
  docId?: string;
  docUrl?: string;
  importedAt?: string;
}

export interface WordPressLink {
  siteUrl: string;
  postId: number;
  link?: string;
  /** WordPress post status after the last publish: draft, publish, future... */
  status: string;
  publishedAt: string;
}

export interface Article {
  id: string;
  /** Post title (the page's H1). */
  title: string;
  slug: string;
  focusKeyword: string;
  secondaryKeywords: string[];
  metaTitle: string;
  metaDescription: string;
  excerpt: string;
  /** Body HTML (no H1; headings start at H2). */
  contentHtml: string;
  featuredImage?: ArticleImageRef;
  categories: string[];
  tags: string[];
  status: ArticleStatus;
  publish: { mode: PublishMode; date?: string };
  source: ArticleSource;
  wordpress?: WordPressLink;
  /** Images already uploaded to WordPress, by our src, so republishing doesn't duplicate them. */
  wpMedia?: Record<string, { id: number; url: string; siteUrl: string }>;
  lastError?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/** What the article list needs, kept in the project's index. */
export interface ArticleSummary {
  id: string;
  title: string;
  focusKeyword: string;
  status: ArticleStatus;
  seoScore: number;
  wordCount: number;
  source: ArticleSource;
  wordpress?: WordPressLink;
  publish: Article["publish"];
  updatedAt: string;
}

/** One row of a content-plan sheet, mapped to article fields. */
export interface PlanRow {
  rowNumber: number;
  title: string;
  focusKeyword: string;
  docUrl: string;
  slug: string;
  metaTitle: string;
  metaDescription: string;
  categories: string;
  tags: string;
  publishDate: string;
  secondaryKeywords: string;
  status: string;
}

export type PlanField = Exclude<keyof PlanRow, "rowNumber">;

export interface SheetPreview {
  spreadsheetId: string;
  title: string;
  tabs: Array<{ title: string; gid: number }>;
  tab: string;
  headers: string[];
  /** Cell text per row (after the header row), with the link behind each cell when there is one. */
  rows: Array<{ rowNumber: number; cells: string[]; links: Array<string | null> }>;
  /** Column index per field, as detected from the headers (-1 = not found). */
  mapping: Record<PlanField, number>;
  via: "google" | "public" | "sample";
}

export interface ArticleSuggestions {
  metaTitles: string[];
  metaDescriptions: string[];
  slug: string;
  focusKeyword: string;
  secondaryKeywords: string[];
  excerpt: string;
  headings: string[];
  altTexts: Array<{ src: string; alt: string }>;
  categories: string[];
  tags: string[];
  improvements: string[];
  model: string;
}
