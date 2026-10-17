"use client";

import { useMemo, useState } from "react";
import { estimateTranslation, LANGUAGES, languageLabel, TRANSLATION_MODELS, translatableChars } from "@/lib/articles/languages";
import type { Article } from "@/lib/articles/types";
import { Field, Modal, buttonPrimary, buttonSecondary, fieldStyle, secondaryStyle } from "./shared";

type RunState = { status: "waiting" | "running" | "done" | "error"; message?: string; id?: string; cost?: number };

const usd = (n: number) => (n < 0.01 ? `<$0.01` : `$${n.toFixed(n < 1 ? 3 : 2)}`);

/**
 * Translates the article into one or more languages. Each language becomes its own article (with translated
 * SEO fields and alt texts) linked to this one; the HTML structure is kept exactly.
 */
export function TranslateDialog({
  projectId,
  article,
  siteHost,
  beforeRun,
  onClose,
  onOpen,
  onDone,
}: {
  projectId: string;
  article: Article;
  siteHost?: string;
  /** Saves pending edits first, so the saved article is what gets translated. */
  beforeRun: () => Promise<boolean>;
  onClose: () => void;
  onOpen: (id: string) => void;
  onDone: () => void;
}) {
  const existing = article.translations ?? {};
  const [langs, setLangs] = useState<Set<string>>(new Set());
  const [model, setModel] = useState(TRANSLATION_MODELS[0].id);
  const [instructions, setInstructions] = useState("");
  const [rewrite, setRewrite] = useState(false);
  const [prefix, setPrefix] = useState("/{lang}/");
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [running, setRunning] = useState(false);

  const chars = useMemo(
    () => translatableChars(article.contentHtml, [article.title, article.metaTitle, article.metaDescription, article.excerpt, article.focusKeyword, ...article.secondaryKeywords]),
    [article]
  );
  const estimates = [...langs].map((l) => ({ lang: l, ...estimateTranslation(model, chars, l) }));
  const total = estimates.reduce((s, e) => s + e.usd, 0);

  async function run() {
    if (!(await beforeRun())) return;
    setRunning(true);
    const order = [...langs];
    setRuns(Object.fromEntries(order.map((l) => [l, { status: "waiting" }])));
    for (const lang of order) {
      setRuns((r) => ({ ...r, [lang]: { status: "running" } }));
      try {
        const res = await fetch("/api/articles/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project: projectId, id: article.id, lang, model, instructions, linkPrefix: rewrite ? prefix : "" }),
        });
        const data = (await res.json().catch(() => ({}))) as { article?: Article; usage?: { costUsd: number }; untranslated?: number; error?: string };
        if (!res.ok || !data.article) throw new Error(data.error ?? `Failed (${res.status})`);
        setRuns((r) => ({
          ...r,
          [lang]: { status: "done", id: data.article!.id, cost: data.usage?.costUsd, message: data.untranslated ? `${data.untranslated} passage(s) kept in the original - check them` : undefined },
        }));
      } catch (err) {
        setRuns((r) => ({ ...r, [lang]: { status: "error", message: err instanceof Error ? err.message : "Failed" } }));
      }
    }
    setRunning(false);
    onDone();
  }

  const done = Object.values(runs).filter((r) => r.status === "done");
  const spent = done.reduce((s, r) => s + (r.cost ?? 0), 0);

  return (
    <Modal
      title="Translate article"
      onClose={running ? () => undefined : onClose}
      width="max-w-2xl"
      footer={
        <>
          {done.length ? (
            <span className="mr-auto text-xs" style={{ color: "var(--text-secondary)" }}>
              {done.length} done · cost {usd(spent)}
            </span>
          ) : langs.size ? (
            <span className="mr-auto text-xs" style={{ color: "var(--text-secondary)" }}>
              Estimated {usd(total)} for {langs.size} language{langs.size === 1 ? "" : "s"}
            </span>
          ) : null}
          <button type="button" onClick={onClose} disabled={running} className={buttonSecondary} style={secondaryStyle}>
            {done.length ? "Close" : "Cancel"}
          </button>
          <button type="button" onClick={() => void run()} disabled={running || !langs.size} className={buttonPrimary} style={{ background: "var(--series-1)" }}>
            {running ? "Translating..." : `Translate into ${langs.size || ""} language${langs.size === 1 ? "" : "s"}`}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          Each language becomes its own article - body, title, SEO title and description, keywords and image alt texts translated, every tag, link and image kept as is - ready to review, edit and publish.
          About {chars.toLocaleString()} characters to translate.
        </p>
        <fieldset className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <legend className="mb-1 text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            Languages
          </legend>
          {LANGUAGES.map((l) => {
            const state = runs[l.code];
            return (
              <label key={l.code} className="flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs" style={{ borderColor: langs.has(l.code) ? "var(--series-1)" : "var(--border-hairline)" }}>
                <input
                  type="checkbox"
                  disabled={running}
                  checked={langs.has(l.code)}
                  onChange={(e) => {
                    const next = new Set(langs);
                    if (e.target.checked) next.add(l.code);
                    else next.delete(l.code);
                    setLangs(next);
                  }}
                />
                <span style={{ color: "var(--text-primary)" }}>{l.label}</span>
                {existing[l.code] && !state ? <span style={{ color: "var(--text-muted)" }}>· update</span> : null}
                {state ? (
                  <span className="ml-auto" style={{ color: state.status === "error" ? "var(--status-critical)" : state.status === "done" ? "var(--success-text)" : "var(--text-muted)" }}>
                    {state.status === "done" ? "✓" : state.status === "error" ? "failed" : state.status === "running" ? "…" : ""}
                  </span>
                ) : null}
              </label>
            );
          })}
        </fieldset>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Model" hint={TRANSLATION_MODELS.find((m) => m.id === model)?.note}>
            <select value={model} disabled={running} onChange={(e) => setModel(e.target.value)} className="rounded-lg border px-2 py-1.5 text-sm" style={fieldStyle}>
              {TRANSLATION_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Internal links" hint={siteHost ? `Links to ${siteHost} point to the language's section, e.g. ${siteHost}${prefix.replace("{lang}", "ja")}page` : "Connect WordPress to rewrite links to the site."}>
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={rewrite} disabled={!siteHost || running} onChange={(e) => setRewrite(e.target.checked)} aria-label="Rewrite internal links" />
              <input value={prefix} disabled={!rewrite || running} onChange={(e) => setPrefix(e.target.value)} className="w-28 rounded-lg border px-2 py-1 text-sm" style={fieldStyle} aria-label="Language path" />
            </div>
          </Field>
        </div>
        <Field label="Instructions (optional)" hint="Tone, formal or casual address, terms to keep in English, units or currency to use...">
          <textarea value={instructions} disabled={running} onChange={(e) => setInstructions(e.target.value)} rows={2} className="w-full rounded-lg border px-3 py-2 text-sm outline-none" style={fieldStyle} />
        </Field>

        {Object.keys(runs).length ? (
          <ul className="flex flex-col gap-1.5 rounded-lg border p-3 text-xs" style={{ borderColor: "var(--border-hairline)" }}>
            {Object.entries(runs).map(([lang, r]) => (
              <li key={lang} className="flex flex-wrap items-center gap-2">
                <b style={{ color: "var(--text-primary)" }}>{languageLabel(lang)}</b>
                <span style={{ color: r.status === "error" ? "var(--status-critical)" : "var(--text-secondary)" }}>
                  {r.status === "done" ? `done${r.cost !== undefined ? ` · ${usd(r.cost)}` : ""}` : r.status === "running" ? "translating..." : r.status === "waiting" ? "waiting" : r.message}
                </span>
                {r.status === "done" && r.message ? <span style={{ color: "var(--status-critical)" }}>{r.message}</span> : null}
                {r.id ? (
                  <button type="button" onClick={() => onOpen(r.id!)} className="ml-auto underline" style={{ color: "var(--series-1)" }}>
                    Open
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : estimates.length ? (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {estimates.map((e) => `${languageLabel(e.lang)} ${usd(e.usd)}`).join(" · ")} - estimates; the real cost is shown after each translation.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
