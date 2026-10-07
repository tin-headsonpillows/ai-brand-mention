"use client";

import { useState } from "react";
import { SIZE_PRESETS } from "@/lib/images/crop";
import type { GenerateQuality, LibraryItem } from "@/lib/images/types";
import { Segmented } from "@/components/tracking/ui";
import { ImageGrid } from "./ImageGrid";
import { downscaleToDataUrl, libraryFileUrl, type SelectedImage } from "./imageClient";

const MAX_REFERENCES = 4;

/** Approximate OpenAI image prices per image (square / non-square), for the cost hint only. */
const PRICE: Record<GenerateQuality, [number, number]> = {
  low: [0.011, 0.016],
  medium: [0.042, 0.063],
  high: [0.167, 0.25],
};

interface Reference {
  id: string;
  label: string;
  preview: string;
  dataUrl?: string;
  url?: string;
}

const fieldStyle: React.CSSProperties = {
  borderColor: "var(--border-hairline)",
  background: "var(--page-plane)",
  color: "var(--text-primary)",
};

export function libraryItemToSelected(projectId: string, item: LibraryItem, target?: { width: number; height: number }): SelectedImage {
  const url = libraryFileUrl(projectId, item.id);
  return {
    key: `lib-${item.id}`,
    kind: item.kind,
    src: url,
    thumb: url,
    title: item.title,
    width: item.width,
    height: item.height,
    pageUrl: item.pageUrl,
    libraryId: item.id,
    target,
  };
}

export function GeneratePanel({
  projectId,
  selected,
  onToggle,
  onGenerated,
  mockMode,
}: {
  projectId: string;
  selected: Set<string>;
  onToggle: (image: SelectedImage) => void;
  onGenerated: (images: SelectedImage[]) => void;
  mockMode: boolean;
}) {
  const [prompt, setPrompt] = useState("");
  const [references, setReferences] = useState<Reference[]>([]);
  const [refUrl, setRefUrl] = useState("");
  const [presetId, setPresetId] = useState("square");
  const [width, setWidth] = useState(1080);
  const [height, setHeight] = useState(1080);
  const [quality, setQuality] = useState<GenerateQuality>("medium");
  const [count, setCount] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SelectedImage[]>([]);

  const square = Math.abs(width / height - 1) < 0.2;
  const cost = PRICE[quality][square ? 0 : 1] * count;

  async function addFiles(files: FileList | null) {
    if (!files) return;
    setError(null);
    const room = MAX_REFERENCES - references.length;
    const picked = Array.from(files).slice(0, room);
    try {
      const added = await Promise.all(
        picked.map(async (file) => {
          const dataUrl = await downscaleToDataUrl(file);
          return { id: crypto.randomUUID(), label: file.name, preview: dataUrl, dataUrl };
        })
      );
      setReferences((r) => [...r, ...added]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read that file");
    }
  }

  function addUrl() {
    const url = refUrl.trim();
    if (!/^https?:\/\//i.test(url) || references.length >= MAX_REFERENCES) return;
    setReferences((r) => [...r, { id: crypto.randomUUID(), label: url, preview: `/api/images/proxy?url=${encodeURIComponent(url)}`, url }]);
    setRefUrl("");
  }

  async function generate() {
    if (!prompt.trim()) {
      setError("Describe the image you want.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/images/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: projectId,
          prompt,
          width,
          height,
          quality,
          n: count,
          references: references.map((r) => (r.dataUrl ? { dataUrl: r.dataUrl } : { url: r.url })),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { items?: LibraryItem[]; error?: string };
      if (!res.ok || !data.items) throw new Error(data.error ?? `Generation failed (${res.status})`);
      const made = data.items.map((item) => libraryItemToSelected(projectId, item, { width, height }));
      setResults((r) => [...made, ...r]);
      onGenerated(made);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="grid grid-cols-1 gap-4 rounded-xl border p-4 lg:grid-cols-[minmax(0,1fr)_320px]" style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              Describe the image
            </span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder="e.g. Sunrise over a quiet beachfront hotel pool in Da Nang, warm light, editorial photo style, no people"
              className="rounded-lg border px-3 py-2 text-sm outline-none"
              style={fieldStyle}
            />
          </label>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              Reference images <span className="font-normal" style={{ color: "var(--text-muted)" }}>(optional, up to {MAX_REFERENCES} - style, product or subject to follow)</span>
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {references.map((r) => (
                <span key={r.id} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element -- reference preview */}
                  <img src={r.preview} alt={r.label} title={r.label} className="h-16 w-16 rounded-md object-cover" style={{ background: "var(--page-plane)" }} />
                  <button
                    type="button"
                    onClick={() => setReferences((all) => all.filter((x) => x.id !== r.id))}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-[10px] text-white"
                    style={{ background: "var(--text-primary)" }}
                    aria-label={`Remove ${r.label}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
              {references.length < MAX_REFERENCES ? (
                <label className="flex h-16 cursor-pointer items-center rounded-md border border-dashed px-3 text-xs" style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)" }}>
                  + Upload
                  <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => void addFiles(e.target.files)} />
                </label>
              ) : null}
            </div>
            {references.length < MAX_REFERENCES ? (
              <div className="flex gap-2">
                <input
                  value={refUrl}
                  onChange={(e) => setRefUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addUrl();
                    }
                  }}
                  placeholder="…or paste an image link (https://…)"
                  className="flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none"
                  style={fieldStyle}
                />
                <button type="button" onClick={addUrl} className="rounded-lg border px-3 py-1.5 text-xs font-medium" style={{ borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}>
                  Add link
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
              Final size
            </span>
            <select
              value={presetId}
              onChange={(e) => {
                setPresetId(e.target.value);
                const preset = SIZE_PRESETS.find((p) => p.id === e.target.value);
                if (preset) {
                  setWidth(preset.width);
                  setHeight(preset.height);
                }
              }}
              className="rounded-lg border px-2 py-1.5 text-sm"
              style={fieldStyle}
            >
              {SIZE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
              <option value="custom">Custom size</option>
            </select>
          </label>
          <div className="flex items-end gap-2">
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                Width (px)
              </span>
              <input
                inputMode="numeric"
                value={width}
                onChange={(e) => {
                  setPresetId("custom");
                  setWidth(Math.max(0, Number(e.target.value.replace(/\D/g, "")) || 0));
                }}
                className="w-full rounded-lg border px-2 py-1.5 text-sm tabular"
                style={fieldStyle}
              />
            </label>
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                Height (px)
              </span>
              <input
                inputMode="numeric"
                value={height}
                onChange={(e) => {
                  setPresetId("custom");
                  setHeight(Math.max(0, Number(e.target.value.replace(/\D/g, "")) || 0));
                }}
                className="w-full rounded-lg border px-2 py-1.5 text-sm tabular"
                style={fieldStyle}
              />
            </label>
          </div>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            The model draws at the closest of 1024×1024, 1536×1024 or 1024×1536; each result then opens in the cropper at exactly {width || "?"}×{height || "?"}px.
          </p>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
              Quality
            </span>
            <Segmented
              value={quality}
              options={[
                { value: "low", label: "Low" },
                { value: "medium", label: "Medium" },
                { value: "high", label: "High" },
              ]}
              onChange={setQuality}
              ariaLabel="Quality"
            />
          </div>
          <label className="flex items-center justify-between gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
            Variations
            <select value={count} onChange={(e) => setCount(Number(e.target.value))} className="rounded-lg border px-2 py-1 text-sm" style={fieldStyle}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {mockMode ? "No OpenAI key on the server - placeholder images are generated." : `About $${cost.toFixed(2)} on your OpenAI account (approximate).`}
          </p>
          <button
            type="button"
            onClick={() => void generate()}
            disabled={busy || width < 64 || height < 64}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: "var(--series-1)" }}
          >
            {busy ? "Generating… (can take up to a minute)" : `Generate ${count} image${count === 1 ? "" : "s"}`}
          </button>
          {error ? (
            <p className="text-xs" style={{ color: "var(--status-critical)" }}>
              {error}
            </p>
          ) : null}
        </div>
      </section>

      {results.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            Generated this session <span className="font-normal" style={{ color: "var(--text-muted)" }}>- saved to the project library; new ones are selected for cropping</span>
          </h3>
          <ImageGrid images={results} selected={selected} onToggle={onToggle} />
        </section>
      ) : null}
    </div>
  );
}
