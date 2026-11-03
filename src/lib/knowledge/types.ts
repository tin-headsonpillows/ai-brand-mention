/** Brand knowledge base: everything the team learns about a project's brand before writing prompts. */

export interface PageSnap {
  url: string;
  status: number;
  title: string;
  description: string;
  h1: string[];
  headings: string[];
  text: string;
  jsonLd: Array<Record<string, unknown>>;
  lang: string;
}

export type CheckStatus = "pass" | "warn" | "fail" | "info";

export interface ReadinessCheck {
  id: string;
  group: "Access" | "Structured data" | "Content";
  check: string;
  status: CheckStatus;
  detail: string;
}

export interface BotAccess {
  bot: string;
  operator: string;
  purpose: "search" | "user" | "training";
  what: string;
  allowed: boolean;
  note: string;
}

export interface EntitySignal {
  kind: "schema_type" | "same_as";
  value: string;
}

export interface SiteResearch {
  fetchedAt: string;
  baseUrl: string;
  pages: PageSnap[];
  robotsTxt: string | null;
  llmsTxt: string | null;
  sitemapUrls: number;
  warnings: string[];
  checks: ReadinessCheck[];
  bots: BotAccess[];
  entity: EntitySignal[];
}

export type SerpResultType = "own site" | "competitor" | "review / directory" | "social" | "community" | "other";

export interface SerpOrganic {
  position: number;
  title: string;
  link: string;
  domain: string;
  type: SerpResultType;
}

export interface SerpPass {
  query: string;
  kind: "brand" | "site" | "reviews" | "demand" | "autocomplete";
  organic: SerpOrganic[];
  questions: string[];
  related: string[];
  suggestions: string[];
  knowledgeGraph: Record<string, string>;
  totalResults: number | null;
  error?: string;
}

export interface CommonQuery {
  query: string;
  source: "People also ask" | "Related searches" | "Autocomplete";
  seed: string;
}

export interface SerpResearch {
  fetchedAt: string;
  brand: SerpPass[];
  demand: SerpPass[];
  mock: boolean;
}

export interface Offering {
  name: string;
  description: string;
  productNames: string[];
  proofPoints: string[];
  sourceUrl: string;
}

export interface Persona {
  name: string;
  description: string;
  painPoints: string[];
  decisionCriteria: string[];
  typicalQuestions: string[];
}

export interface Differentiator {
  claim: string;
  evidence: string;
  evidenceType: "explicit" | "self_claimed";
  sourceUrl: string;
}

export type CompetitorType = "direct" | "category_leader" | "marketplace" | "alternative";

export interface KbCompetitor {
  name: string;
  domain: string;
  aliases: string[];
  type: CompetitorType;
  why: string;
}

export interface FactToVerify {
  question: string;
  why: string;
  /** Filled in by the team after asking the client. */
  answer?: string;
  answeredAt?: string;
}

export interface BrandProfile {
  brandName: string;
  aliases: string[];
  category: string;
  oneLiner: string;
  businessModel: string;
  pricePositioning: string;
  markets: string[];
  languages: string[];
  offerings: Offering[];
  personas: Persona[];
  differentiators: Differentiator[];
  competitors: KbCompetitor[];
  factsToVerify: FactToVerify[];
  researchNotes: string;
}

export interface KbNote {
  id: string;
  at: string;
  author: string;
  note: string;
}

export interface KnowledgeBase {
  projectId: string;
  updatedAt: string | null;
  site: SiteResearch | null;
  serp: SerpResearch | null;
  profile: (BrandProfile & { generatedAt: string; model: string; mock: boolean }) | null;
  notes: KbNote[];
  costUsd: number;
}

export const RESEARCH_STEPS = ["site", "serp", "profile", "demand"] as const;
export type ResearchStep = (typeof RESEARCH_STEPS)[number];
