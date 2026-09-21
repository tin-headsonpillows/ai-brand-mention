/**
 * Runs `worker` over `items` with at most `limit` in flight at once, calling
 * `onResult` as each one settles (in completion order, not input order).
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  onResult: (result: R, index: number) => void,
  isAborted: () => boolean
): Promise<void> {
  let cursor = 0;

  async function runNext(): Promise<void> {
    while (cursor < items.length) {
      if (isAborted()) return;
      const index = cursor++;
      const result = await worker(items[index], index);
      if (isAborted()) return;
      onResult(result, index);
    }
  }

  const poolSize = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: poolSize }, runNext));
}
