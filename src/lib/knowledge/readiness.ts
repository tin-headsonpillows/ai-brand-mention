import type { BotAccess, EntitySignal, PageSnap, ReadinessCheck } from "./types";

/** Rule-based AI-readiness checks on a crawl: can AI assistants reach the site, and does it state clear facts? */

export const AI_BOTS: Array<Omit<BotAccess, "allowed" | "note">> = [
  { bot: "OAI-SearchBot", operator: "OpenAI", purpose: "search", what: "ChatGPT search results" },
  { bot: "ChatGPT-User", operator: "OpenAI", purpose: "user", what: "Pages ChatGPT opens for a user" },
  { bot: "GPTBot", operator: "OpenAI", purpose: "training", what: "Training OpenAI models" },
  { bot: "PerplexityBot", operator: "Perplexity", purpose: "search", what: "Perplexity answers" },
  { bot: "Perplexity-User", operator: "Perplexity", purpose: "user", what: "Pages Perplexity opens for a user" },
  { bot: "Claude-SearchBot", operator: "Anthropic", purpose: "search", what: "Claude search results" },
  { bot: "Claude-User", operator: "Anthropic", purpose: "user", what: "Pages Claude opens for a user" },
  { bot: "ClaudeBot", operator: "Anthropic", purpose: "training", what: "Training Claude models" },
  { bot: "Googlebot", operator: "Google", purpose: "search", what: "Google Search and AI Overviews" },
  { bot: "Google-Extended", operator: "Google", purpose: "training", what: "Gemini training and grounding" },
  { bot: "Bingbot", operator: "Microsoft", purpose: "search", what: "Bing and Copilot answers" },
  { bot: "Applebot-Extended", operator: "Apple", purpose: "training", what: "Apple Intelligence training" },
  { bot: "CCBot", operator: "Common Crawl", purpose: "training", what: "Open datasets many models train on" },
];

const ORG_TYPES = new Set(["Organization", "Corporation", "LocalBusiness", "Hotel", "Restaurant", "Store", "OnlineStore", "ProfessionalService", "LodgingBusiness", "TravelAgency", "EducationalOrganization", "MedicalBusiness", "DaySpa", "HealthAndBeautyBusiness", "SoftwareApplication", "Brand", "NGO", "Resort"]);
const OFFER_TYPES = new Set(["Product", "Service", "Offer", "AggregateOffer", "SoftwareApplication", "Course", "Event", "HotelRoom", "Menu", "TouristTrip", "FAQPage", "Review", "AggregateRating"]);

interface RobotsGroup {
  agents: string[];
  rules: Array<{ allow: boolean; path: string }>;
}

function parseRobots(txt: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === "allow" || field === "disallow") && current) {
      current.rules.push({ allow: field === "allow", path: value });
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

/** Whether `agent` may fetch `path`, per RFC 9309: the most specific matching group, then the longest matching rule. */
export function robotsAllows(txt: string | null, agent: string, path = "/"): boolean {
  if (txt === null) return true;
  const groups = parseRobots(txt);
  const a = agent.toLowerCase();
  let matched = groups.filter((g) => g.agents.some((ua) => ua !== "*" && a.includes(ua)));
  if (!matched.length) matched = groups.filter((g) => g.agents.includes("*"));
  const rules = matched.flatMap((g) => g.rules).filter((r) => r.path !== "" && path.startsWith(r.path.replace(/\*.*$/, "").replace(/\$$/, "")));
  if (!rules.length) return true;
  const best = Math.max(...rules.map((r) => r.path.length));
  const top = rules.filter((r) => r.path.length === best);
  return top.some((r) => r.allow);
}

const typesOf = (ld: Record<string, unknown>): string[] => {
  const t = ld["@type"];
  return Array.isArray(t) ? t.map(String) : t ? [String(t)] : [];
};

export function checkSite(input: { baseUrl: string; pages: PageSnap[]; robotsTxt: string | null; llmsTxt: string | null; sitemapUrls: number }): {
  checks: ReadinessCheck[];
  bots: BotAccess[];
  entity: EntitySignal[];
} {
  const { baseUrl, pages, robotsTxt, llmsTxt, sitemapUrls } = input;
  const bots: BotAccess[] = AI_BOTS.map((b) => {
    const allowed = robotsAllows(robotsTxt, b.bot);
    return { ...b, allowed, note: robotsTxt === null ? "No robots.txt: allowed by default" : allowed ? "Allowed" : "Blocked in robots.txt" };
  });
  const checks: ReadinessCheck[] = [];
  const add = (id: string, group: ReadinessCheck["group"], check: string, status: ReadinessCheck["status"], detail: string) =>
    checks.push({ id, group, check, status, detail });

  const blockedSearch = bots.filter((b) => b.purpose !== "training" && !b.allowed).map((b) => b.bot);
  add("ai_search_access", "Access", "AI search crawlers can read the site", blockedSearch.length ? "fail" : "pass",
    blockedSearch.length ? `Blocked: ${blockedSearch.join(", ")}` : "Every AI search and user-fetch crawler checked is allowed");
  const blockedTrain = bots.filter((b) => b.purpose === "training" && !b.allowed).map((b) => b.bot);
  add("ai_training_access", "Access", "AI training crawlers", "info",
    blockedTrain.length ? `Blocked: ${blockedTrain.join(", ")}. A business choice: blocking training can reduce how well models know the brand without search.` : "All allowed");
  add("robots_txt", "Access", "robots.txt file", robotsTxt !== null ? "pass" : "warn", robotsTxt !== null ? "Found" : "Not found: crawlers use defaults");
  add("sitemap", "Access", "XML sitemap", sitemapUrls ? "pass" : "warn",
    sitemapUrls ? `${sitemapUrls.toLocaleString("en")} URLs listed` : "No sitemap found in robots.txt, /sitemap.xml or /sitemap_index.xml");
  add("llms_txt", "Access", "llms.txt file", llmsTxt ? "pass" : "warn", llmsTxt ? "Found" : "Not found. Optional: a short Markdown guide to the site's key pages for AI agents");
  add("https", "Access", "HTTPS", baseUrl.startsWith("https://") ? "pass" : "fail", baseUrl.startsWith("https://") ? "Site served over HTTPS" : "Site served over plain HTTP");

  const lds = pages.flatMap((p) => p.jsonLd);
  const org = lds.filter((ld) => typesOf(ld).some((t) => ORG_TYPES.has(t)));
  add("schema_org", "Structured data", "Organization or business schema", org.length ? "pass" : "fail",
    org.length ? `Found: ${[...new Set(org.flatMap(typesOf))].join(", ")}` : "No Organization/LocalBusiness JSON-LD: AI has no structured statement of who the brand is");
  const offer = [...new Set(lds.flatMap(typesOf).filter((t) => OFFER_TYPES.has(t)))];
  add("schema_offer", "Structured data", "Product, service or FAQ schema", offer.length ? "pass" : "warn",
    offer.length ? `Found: ${offer.join(", ")}` : "No Product/Service/Offer/FAQPage JSON-LD on the pages read");
  const sameAs = [...new Set(org.flatMap((ld) => {
    const v = ld.sameAs;
    return (Array.isArray(v) ? v : v ? [v] : []).map(String);
  }))];
  add("same_as", "Structured data", "Official profiles linked (sameAs)", sameAs.length ? "pass" : "warn",
    sameAs.length ? `${sameAs.length} profiles linked` : "No sameAs links: AI can't tie the site to the brand's social, review and directory profiles");

  const n = pages.length || 1;
  const withDesc = pages.filter((p) => p.description).length;
  add("meta_description", "Content", "Pages with a meta description", withDesc / n >= 0.8 ? "pass" : "warn", `${withDesc} of ${pages.length} pages read`);
  const oneH1 = pages.filter((p) => p.h1.length === 1).length;
  add("h1", "Content", "Pages with exactly one H1", oneH1 / n >= 0.8 ? "pass" : "warn", `${oneH1} of ${pages.length} pages read`);
  const avg = pages.reduce((s, p) => s + p.text.length, 0) / n;
  add("readable_text", "Content", "Text readable without JavaScript", avg >= 800 ? "pass" : avg < 300 ? "fail" : "warn",
    `About ${Math.round(avg).toLocaleString("en")} characters per page in the HTML${avg >= 800 ? "" : ". AI crawlers may see little: content may be rendered by JavaScript"}`);
  const langs = [...new Set(pages.map((p) => p.lang).filter(Boolean))];
  add("lang", "Content", "Page language declared", langs.length ? "pass" : "warn", langs.length ? `lang: ${langs.join(", ")}` : "No lang attribute on <html>");

  const entity: EntitySignal[] = [
    ...[...new Set(lds.flatMap(typesOf))].map((value) => ({ kind: "schema_type" as const, value })),
    ...sameAs.map((value) => ({ kind: "same_as" as const, value })),
  ];
  return { checks, bots, entity };
}
