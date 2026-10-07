import { hasServerApiKeys } from "../serpKeyPool";
import { serpRequest } from "../serpRequest";
import type { ImageHit, InstagramProfile } from "./types";

type Json = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Json[]) : []);

export function isImagesMock(): boolean {
  return !hasServerApiKeys();
}

export interface GoogleImageFilters {
  /** Creative Commons licences only (Google's usage-rights filter). */
  creativeCommons?: boolean;
  photosOnly?: boolean;
  largeOnly?: boolean;
}

/** One page (~100 images) of Google Images results. Each page is one SerpApi search. */
export async function searchGoogleImages(
  query: string,
  page: number,
  filters: GoogleImageFilters
): Promise<{ hits: ImageHit[]; hasMore: boolean }> {
  if (isImagesMock()) return mockGoogle(query, page);
  const tbs = [filters.photosOnly ? "itp:photos" : "", filters.largeOnly ? "isz:l" : "", filters.creativeCommons ? "il:cl" : ""]
    .filter(Boolean)
    .join(",");
  const data = await serpRequest({
    engine: "google_images",
    q: query,
    ijn: String(page),
    hl: "en",
    gl: "us",
    ...(tbs ? { tbs } : {}),
  });
  const hits = arr(data.images_results)
    .map((r, i): ImageHit | null => {
      const full = str(r.original);
      const thumbnail = str(r.thumbnail) ?? full;
      if (!full || !thumbnail) return null;
      return {
        id: `g-${page}-${num(r.position) ?? i}`,
        kind: "google",
        thumbnail,
        full,
        width: num(r.original_width),
        height: num(r.original_height),
        title: str(r.title) ?? "",
        source: str(r.source),
        pageUrl: str(r.link),
      };
    })
    .filter((h): h is ImageHit => h !== null);
  return { hits, hasMore: hits.length >= 50 };
}

/** Pulls a username out of "@name", "name" or an instagram.com profile link. */
export function parseInstagramUsername(input: string): string | null {
  const value = input.trim();
  const fromUrl = value.match(/instagram\.com\/([A-Za-z0-9._]+)/i)?.[1];
  const name = (fromUrl ?? value).replace(/^@/, "").replace(/\/.*$/, "");
  return /^[A-Za-z0-9._]{1,30}$/.test(name) ? name : null;
}

/** A profile's recent posts, one SerpApi search per page. */
export async function fetchInstagramProfile(
  username: string,
  pageToken: string | null
): Promise<{ profile: InstagramProfile | null; hits: ImageHit[]; nextPageToken: string | null }> {
  if (isImagesMock()) return mockInstagram(username, pageToken);
  const data = await serpRequest({
    engine: "instagram_profile",
    ...(pageToken ? { next_page_token: pageToken } : { profile_id: username }),
  });
  // Profile details and posts live under profile_results; later pages may return posts at the top level.
  const info = obj(data.profile_results);
  const posts = arr(info.posts ?? data.posts ?? obj(data.posts).posts);
  const profile: InstagramProfile | null = pageToken
    ? null
    : {
        username: str(info.username) ?? username,
        fullName: str(info.full_name),
        picture: str(info.serpapi_profile_pic_url) ?? str(info.profile_pic_url),
        followers: num(info.followers),
        postsCount: num(info.posts_count) ?? num(info.media_count),
        isPrivate: info.is_private === true,
      };
  const hits = posts
    .map((p, i): ImageHit | null => {
      const full = str(p.serpapi_display_url) ?? str(p.display_url);
      if (!full) return null;
      const caption = Array.isArray(p.media_captions) ? String(p.media_captions[0] ?? "").trim() : "";
      const shortcode = str(p.shortcode);
      return {
        id: `ig-${str(p.id) ?? i}`,
        kind: "instagram",
        thumbnail: str(p.serpapi_thumbnail_src) ?? str(p.thumbnail_src) ?? full,
        full,
        title: (caption || str(p.accessibility_caption) || `@${username} post`).slice(0, 200),
        source: `@${username}`,
        pageUrl: shortcode ? `https://www.instagram.com/p/${shortcode}/` : undefined,
        isVideo: p.is_video === true,
      };
    })
    .filter((h): h is ImageHit => h !== null);
  return { profile, hits, nextPageToken: str(obj(data.serpapi_pagination).next_page_token) ?? null };
}

// --- Mock data (no SerpApi keys) ------------------------------------------------------------------

const MOCK_SIZES: Array<[number, number]> = [
  [1600, 1067],
  [1200, 1600],
  [2000, 2000],
  [1920, 1080],
  [1080, 1350],
];

function mockUrl(seed: string, w: number, h: number, label: string): string {
  return `/api/images/mock?${new URLSearchParams({ seed, w: String(w), h: String(h), label })}`;
}

function mockGoogle(query: string, page: number): { hits: ImageHit[]; hasMore: boolean } {
  const hits = Array.from({ length: 24 }, (_, i) => {
    const [w, h] = MOCK_SIZES[(i + page) % MOCK_SIZES.length];
    const seed = `${query}-${page}-${i}`;
    return {
      id: `g-${page}-${i}`,
      kind: "google" as const,
      thumbnail: mockUrl(seed, Math.round(w / 5), Math.round(h / 5), query),
      full: mockUrl(seed, w, h, query),
      width: w,
      height: h,
      title: `${query} - example ${page * 24 + i + 1}`,
      source: ["example.com", "travel-blog.net", "photos.org"][i % 3],
      pageUrl: "https://example.com/",
    };
  });
  return { hits, hasMore: page < 2 };
}

function mockInstagram(username: string, pageToken: string | null) {
  const page = pageToken ? Number(pageToken) : 0;
  const hits: ImageHit[] = Array.from({ length: 12 }, (_, i) => {
    const seed = `${username}-${page}-${i}`;
    return {
      id: `ig-${page}-${i}`,
      kind: "instagram",
      thumbnail: mockUrl(seed, 216, 216, `@${username}`),
      full: mockUrl(seed, 1080, i % 3 === 0 ? 1350 : 1080, `@${username}`),
      title: `@${username} post ${page * 12 + i + 1}`,
      source: `@${username}`,
      pageUrl: `https://www.instagram.com/${username}/`,
    };
  });
  return {
    profile: page === 0 ? { username, fullName: username.replace(/[._]/g, " "), followers: 12800, postsCount: 36 } : null,
    hits,
    nextPageToken: page < 2 ? String(page + 1) : null,
  };
}
