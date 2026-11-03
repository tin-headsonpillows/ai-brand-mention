/** Keyword research, following the SEO workflow: taxonomy -> live SERP intent -> volume -> clustering -> URL mapping -> priority. */

export type Intent = "transactional" | "commercial" | "local" | "informational" | "navigational";
export type VolumeStatus = "validated" | "zero volume" | "no volume data";
export type UrlStatus = "ranking page" | "existing page" | "new page";
export type Priority = "P1" | "P2" | "P3";

export interface TaxonomySub {
  name: string;
  offering: string;
  seeds: string[];
}

export interface KwSerp {
  checkedAt: string;
  features: string[];
  urls: string[];
  titles: string[];
  error?: string;
}

export interface ResearchKeyword {
  keyword: string;
  subcategory: string;
  offering: string;
  volume: number | null;
  kd: number | null;
  cpc: number | null;
  /** Intent codes from the volume source (SE Ranking: I, C, T, L, N), when it has them. */
  sourceIntents: string[];
  volumeStatus: VolumeStatus;
  serp: KwSerp | null;
  intent: Intent;
  aiOverview: boolean;
  brandRank: number | null;
  brandUrl: string;
  competitorRanks: Record<string, number>;
  topDomains: string[];
  clusterId: number;
}

export interface KeywordCluster {
  id: number;
  name: string;
  subcategory: string;
  keywords: string[];
  totalVolume: number;
  intent: Intent;
  aiOverviewShare: number;
  bestBrandRank: number | null;
  targetUrl: string;
  urlStatus: UrlStatus;
  score: number;
  priority: Priority;
}

export interface KeywordResearch {
  projectId: string;
  updatedAt: string | null;
  category: string;
  taxonomy: TaxonomySub[];
  keywords: ResearchKeyword[];
  clusters: KeywordCluster[];
  volumeSource: string;
  mock: { taxonomy: boolean; volume: boolean; serp: boolean };
  costUsd: number;
}

export const KEYWORD_STEPS = ["taxonomy", "volume", "serp", "finish"] as const;
export type KeywordStep = (typeof KEYWORD_STEPS)[number];
