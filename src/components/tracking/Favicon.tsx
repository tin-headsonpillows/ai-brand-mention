"use client";

import { useState } from "react";

/** Google's public favicon service - no API key, works for any domain. Falls back to a plain dot on error. */
export function Favicon({ domain, size = 16 }: { domain: string; size?: number }) {
  const [errored, setErrored] = useState(false);

  if (!domain || errored) {
    return (
      <span
        aria-hidden
        className="inline-block shrink-0 rounded-full"
        style={{ width: size, height: size, background: "var(--gridline)" }}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- tiny external favicon, not worth next/image's remote-domain allowlisting
    <img
      src={`https://www.google.com/s2/favicons?sz=${size * 2}&domain=${encodeURIComponent(domain)}`}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-sm"
      onError={() => setErrored(true)}
    />
  );
}
