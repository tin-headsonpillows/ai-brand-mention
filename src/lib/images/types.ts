export type ImageKind = "google" | "instagram" | "generated" | "upload" | "doc" | "web";

/** One image found by a search (Google Images or an Instagram profile). */
export interface ImageHit {
  id: string;
  kind: "google" | "instagram";
  thumbnail: string;
  /** Full-size image URL (Google's original; Instagram's display image). */
  full: string;
  width?: number;
  height?: number;
  title: string;
  /** Site name / account the image comes from. */
  source?: string;
  /** Page the image appears on. */
  pageUrl?: string;
  isVideo?: boolean;
}

export interface InstagramProfile {
  username: string;
  fullName?: string;
  picture?: string;
  followers?: number;
  postsCount?: number;
  isPrivate?: boolean;
}

/** An image kept in a project's library (generated images and downloaded crops). */
export interface LibraryItem {
  id: string;
  kind: ImageKind;
  title: string;
  width: number;
  height: number;
  bytes: number;
  contentType: string;
  createdAt: string;
  /** Where the image came from (original image URL), for re-cropping later. */
  sourceUrl?: string;
  pageUrl?: string;
  prompt?: string;
  /** Generated images: the OpenAI model and this image's share of the request cost (USD). */
  model?: string;
  costUsd?: number;
}

export type GenerateQuality = "low" | "medium" | "high";
