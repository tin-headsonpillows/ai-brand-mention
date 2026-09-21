/**
 * Deterministic-ish mock provider used when OPENAI_API_KEY is not set, so the
 * whole pipeline (variation generation, execution, mention counting, dashboard)
 * can be exercised without hitting a real API or spending money.
 */

const VARIATION_MODIFIERS = [
  "on a tight budget",
  "for a long weekend",
  "close to the beach",
  "with a swimming pool",
  "near the city center",
  "with the best reviews",
  "for a group with young kids",
  "that's pet friendly",
  "for a honeymoon",
  "with free breakfast included",
  "within walking distance of restaurants",
  "for a business trip",
  "with a rooftop bar",
  "for a large family reunion",
  "that offers airport shuttle",
];

export function mockVariations(seedPrompt: string, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const modifier = VARIATION_MODIFIERS[i % VARIATION_MODIFIERS.length];
    out.push(`${stripTrailingPunctuation(seedPrompt)}, ${modifier}? (variation ${i + 1})`);
  }
  return out;
}

function stripTrailingPunctuation(s: string): string {
  return s.replace(/[.?!]+$/, "");
}

function hashCode(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const OPENERS = [
  "Based on traveler reviews, a few options stand out:",
  "Here are some solid picks worth considering:",
  "Great question! A few places come to mind:",
  "For that trip, I'd suggest looking at these options:",
  "Here's what tends to get recommended for this:",
];

const BLURBS = [
  "a well-reviewed choice that fits what you're looking for",
  "popular with travelers for its location and service",
  "known for good value and a comfortable stay",
  "frequently recommended in local travel guides",
  "a solid option if you want something reliable",
];

export function mockChatResponse(
  prompt: string,
  brand: string,
  competitors: string[],
  seedIndex: number
): string {
  const rng = mulberry32(hashCode(prompt) + seedIndex * 2654435761);
  const pool = [brand, ...competitors];
  const mentioned: string[] = [];

  for (const name of pool) {
    const chance = name === brand ? 0.6 : 0.35;
    if (rng() < chance) mentioned.push(name);
  }
  if (mentioned.length === 0 && pool.length > 0) {
    mentioned.push(pool[Math.floor(rng() * pool.length)]);
  }
  // Shuffle order slightly so the brand isn't always listed first.
  mentioned.sort(() => rng() - 0.5);

  const opener = OPENERS[Math.floor(rng() * OPENERS.length)];
  const lines = mentioned.map((name, i) => {
    const blurb = BLURBS[Math.floor(rng() * BLURBS.length)];
    return `${i + 1}. ${name} - ${blurb}.`;
  });

  return [opener, ...lines, "", "Let me know if you'd like more tailored suggestions."].join("\n");
}
