/**
 * Keeps a tab's current view in the URL query (?project=…&view=…) so the address bar always points at what's
 * on screen and can be bookmarked or shared. Uses the native History API, which Next.js syncs with its router.
 */
/** `null` removes a parameter; `undefined` leaves it as it is (e.g. while the value is still loading). */
export function writeParams(updates: Record<string, string | null | undefined>): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    if (value) params.set(key, value);
    else params.delete(key);
  }
  const query = params.toString();
  const next = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history.replaceState(window.history.state, "", next);
  }
}
