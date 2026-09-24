/**
 * Shared server-side SerpApi key pool. Supports multiple keys (SERPAPI_API_KEY_1..N, plus
 * legacy SERPAPI_API_KEY) so that when one account runs out of searches, calls automatically
 * fall over to the next configured key instead of failing.
 */

const MAX_POOL_SIZE = 8;

export function getServerApiKeys(): string[] {
  const keys: string[] = [];
  for (let i = 1; i <= MAX_POOL_SIZE; i++) {
    const key = process.env[`SERPAPI_API_KEY_${i}`]?.trim();
    if (key) keys.push(key);
  }
  const legacy = process.env.SERPAPI_API_KEY?.trim();
  if (legacy && !keys.includes(legacy)) keys.push(legacy);
  return keys;
}

export function hasServerApiKeys(): boolean {
  return getServerApiKeys().length > 0;
}

/** Tries each key in order, advancing past any key that throws, until one call succeeds. */
export class ServerKeyRotator {
  private index = 0;

  constructor(private readonly keys: string[]) {}

  get poolSize(): number {
    return this.keys.length;
  }

  get currentIndex(): number {
    return Math.min(this.index, Math.max(this.keys.length - 1, 0));
  }

  async run<T>(fn: (apiKey: string) => Promise<T>): Promise<T> {
    if (this.keys.length === 0) throw new Error("No SerpApi keys configured");
    let lastErr: unknown;
    for (let i = this.index; i < this.keys.length; i++) {
      try {
        const result = await fn(this.keys[i]);
        this.index = i;
        return result;
      } catch (err) {
        lastErr = err;
        this.index = i + 1;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("All configured SerpApi keys failed");
  }
}

let sharedRotator: ServerKeyRotator | undefined;

/** A process-lifetime singleton so key exhaustion learned by one request sticks for subsequent ones. */
export function getSharedRotator(): ServerKeyRotator {
  if (!sharedRotator) sharedRotator = new ServerKeyRotator(getServerApiKeys());
  return sharedRotator;
}
