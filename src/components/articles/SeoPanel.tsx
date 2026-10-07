"use client";

import { useState } from "react";
import type { SeoReport, CheckStatus } from "@/lib/articles/seo";
import { normalize, slugify } from "@/lib/articles/seo";

/** Like slugify, but keeps a trailing hyphen so you can keep typing the next word. */
const typingSlug = (v: string) =>
  normalize(v)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 80);
import type { ArticleSuggestions } from "@/lib/articles/types";
import { Counter, Field, ScoreBadge, buttonSecondary, fieldStyle, secondaryStyle, toList } from "./shared";

export interface SeoDraft {
  title: string;
  focusKeyword: string;
  secondaryKeywords: string[];
  metaTitle: string;
  metaDescription: string;
  slug: string;
  excerpt: string;
  categories: string[];
  tags: string[];
}

const STATUS_ICON: Record<CheckStatus, { mark: string; color: string; label: string }> = {
  good: { mark: "✓", color: "var(--success-text)", label: "Passed" },
  ok: { mark: "!", color: "var(--text-secondary)", label: "Could be better" },
  bad: { mark: "✕", color: "var(--status-critical)", label: "Needs work" },
};

function SerpPreview({ draft, siteHost }: { draft: SeoDraft; siteHost?: string }) {
  const title = draft.metaTitle.trim() || draft.title || "Your SEO title";
  const description = draft.metaDescription.trim() || "Add a meta description - otherwise Google picks a snippet from the page.";
  const host = siteHost ?? "your-site.com";
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border p-3" style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }} aria-label="Google result preview">
      <span className="truncate text-xs" style={{ color: "var(--text-secondary)" }}>
        {host} › {draft.slug || "post-slug"}
      </span>
      <span className="line-clamp-1 text-[17px] leading-snug" style={{ color: "var(--series-1)" }}>
        {title.length > 62 ? `${title.slice(0, 60)}…` : title}
      </span>
      <span className="line-clamp-2 text-[13px] leading-snug" style={{ color: "var(--text-secondary)" }}>
        {description.length > 160 ? `${description.slice(0, 157)}…` : description}
      </span>
    </div>
  );
}

function UseButton({ onClick, label = "Use" }: { onClick: () => void; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        onClick();
        setDone(true);
      }}
      className="shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-medium"
      style={{ borderColor: done ? "var(--border-hairline)" : "var(--series-1)", color: done ? "var(--text-muted)" : "var(--series-1)" }}
    >
      {done ? "✓ Applied" : label}
    </button>
  );
}

function SuggestionRow({ text, onUse, meta }: { text: string; onUse: () => void; meta?: string }) {
  return (
    <li className="flex items-start justify-between gap-2 rounded-md px-2 py-1.5" style={{ background: "var(--page-plane)" }}>
      <span className="text-xs" style={{ color: "var(--text-primary)" }}>
        {text}
        {meta ? <span style={{ color: "var(--text-muted)" }}> · {meta}</span> : null}
      </span>
      <UseButton onClick={onUse} />
    </li>
  );
}

export function SeoPanel({
  draft,
  onChange,
  report,
  siteHost,
  suggestions,
  suggesting,
  suggestError,
  onSuggest,
  onApplyAlts,
  onAddHeading,
}: {
  draft: SeoDraft;
  onChange: (patch: Partial<SeoDraft>) => void;
  report: SeoReport;
  siteHost?: string;
  suggestions: ArticleSuggestions | null;
  suggesting: boolean;
  suggestError: string | null;
  onSuggest: () => void;
  onApplyAlts: (alts: Array<{ src: string; alt: string }>) => void;
  onAddHeading: (text: string) => void;
}) {
  const [secondaryText, setSecondaryText] = useState(draft.secondaryKeywords.join(", "));
  const counts = { good: 0, ok: 0, bad: 0 };
  report.checks.forEach((c) => counts[c.status]++);
  const groups = ["Keyword", "Title & meta", "Content", "Media & links"] as const;
  const s = suggestions;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <ScoreBadge score={report.score} size="lg" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            On-page SEO score
          </span>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {counts.good} passed · {counts.ok} could be better · {counts.bad} need work · {report.stats.words.toLocaleString()} words
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={onSuggest}
        disabled={suggesting}
        className="flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
        style={{ background: "var(--series-1)" }}
      >
        <span aria-hidden>✦</span>
        {suggesting ? "Asking ChatGPT..." : s ? "Suggest again with ChatGPT" : "Suggest SEO elements with ChatGPT"}
      </button>
      {suggestError ? (
        <p className="text-xs" style={{ color: "var(--status-critical)" }}>
          {suggestError}
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        <Field label="Focus keyword" hint="The main phrase this article should rank for.">
          <input value={draft.focusKeyword} onChange={(e) => onChange({ focusKeyword: e.target.value })} placeholder="e.g. beachfront hotels in Da Nang" className="rounded-lg border px-3 py-1.5 text-sm outline-none" style={fieldStyle} />
        </Field>
        <Field label="Secondary keywords" hint="Comma-separated related phrases.">
          <input
            value={secondaryText}
            onChange={(e) => {
              setSecondaryText(e.target.value);
              onChange({ secondaryKeywords: toList(e.target.value) });
            }}
            className="rounded-lg border px-3 py-1.5 text-sm outline-none"
            style={fieldStyle}
          />
        </Field>
      </div>

      <SerpPreview draft={draft} siteHost={siteHost} />

      <div className="flex flex-col gap-3">
        <Field label="SEO title" aside={<Counter value={(draft.metaTitle.trim() || draft.title).length} good={[40, 60]} ok={[25, 70]} />} hint={draft.metaTitle.trim() ? undefined : "Empty: the post title is used."}>
          <input value={draft.metaTitle} onChange={(e) => onChange({ metaTitle: e.target.value })} placeholder={draft.title} className="rounded-lg border px-3 py-1.5 text-sm outline-none" style={fieldStyle} />
        </Field>
        <Field label="Meta description" aside={<Counter value={draft.metaDescription.trim().length} good={[120, 160]} ok={[70, 175]} />}>
          <textarea value={draft.metaDescription} onChange={(e) => onChange({ metaDescription: e.target.value })} rows={3} className="rounded-lg border px-3 py-1.5 text-sm outline-none" style={fieldStyle} />
        </Field>
        <Field
          label="URL slug"
          aside={
            draft.focusKeyword ? (
              <button type="button" onClick={() => onChange({ slug: slugify(draft.focusKeyword) })} className="text-[11px] font-medium" style={{ color: "var(--series-1)" }}>
                From keyword
              </button>
            ) : undefined
          }
        >
          <input value={draft.slug} onChange={(e) => onChange({ slug: typingSlug(e.target.value) })} className="rounded-lg border px-3 py-1.5 font-mono text-xs outline-none" style={fieldStyle} />
        </Field>
        <Field label="Excerpt" hint="Optional summary some themes show on listing pages.">
          <textarea value={draft.excerpt} onChange={(e) => onChange({ excerpt: e.target.value })} rows={2} className="rounded-lg border px-3 py-1.5 text-sm outline-none" style={fieldStyle} />
        </Field>
      </div>

      {s ? (
        <div className="flex flex-col gap-3 rounded-xl border p-3" style={{ borderColor: "color-mix(in srgb, var(--series-1) 35%, transparent)", background: "color-mix(in srgb, var(--series-1) 5%, var(--surface-1))" }}>
          <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
            ✦ ChatGPT suggestions <span className="font-normal" style={{ color: "var(--text-muted)" }}>({s.model})</span>
          </span>
          {s.focusKeyword && s.focusKeyword !== draft.focusKeyword ? (
            <Section title="Focus keyword">
              <SuggestionRow text={s.focusKeyword} onUse={() => onChange({ focusKeyword: s.focusKeyword })} />
            </Section>
          ) : null}
          {s.metaTitles.length ? (
            <Section title="SEO title">
              {s.metaTitles.map((t) => (
                <SuggestionRow key={t} text={t} meta={`${t.length} chars`} onUse={() => onChange({ metaTitle: t })} />
              ))}
            </Section>
          ) : null}
          {s.metaDescriptions.length ? (
            <Section title="Meta description">
              {s.metaDescriptions.map((t) => (
                <SuggestionRow key={t} text={t} meta={`${t.length} chars`} onUse={() => onChange({ metaDescription: t })} />
              ))}
            </Section>
          ) : null}
          {s.slug && s.slug !== draft.slug ? (
            <Section title="Slug">
              <SuggestionRow text={s.slug} onUse={() => onChange({ slug: s.slug })} />
            </Section>
          ) : null}
          {s.secondaryKeywords.length ? (
            <Section title="Secondary keywords">
              <SuggestionRow
                text={s.secondaryKeywords.join(", ")}
                onUse={() => {
                  const merged = Array.from(new Set([...draft.secondaryKeywords, ...s.secondaryKeywords]));
                  setSecondaryText(merged.join(", "));
                  onChange({ secondaryKeywords: merged });
                }}
              />
            </Section>
          ) : null}
          {s.excerpt ? (
            <Section title="Excerpt">
              <SuggestionRow text={s.excerpt} onUse={() => onChange({ excerpt: s.excerpt })} />
            </Section>
          ) : null}
          {s.headings.length ? (
            <Section title="Missing subtopics (adds an H2 at the end)">
              {s.headings.map((h) => (
                <li key={h} className="flex items-start justify-between gap-2 rounded-md px-2 py-1.5" style={{ background: "var(--page-plane)" }}>
                  <span className="text-xs" style={{ color: "var(--text-primary)" }}>
                    {h}
                  </span>
                  <UseButton label="Add H2" onClick={() => onAddHeading(h)} />
                </li>
              ))}
            </Section>
          ) : null}
          {s.altTexts.length ? (
            <Section title={`Image alt text (${s.altTexts.length})`}>
              <li className="flex items-start justify-between gap-2 rounded-md px-2 py-1.5" style={{ background: "var(--page-plane)" }}>
                <span className="flex flex-col gap-0.5 text-xs" style={{ color: "var(--text-primary)" }}>
                  {s.altTexts.map((a) => (
                    <span key={a.src}>“{a.alt}”</span>
                  ))}
                </span>
                <UseButton label="Apply all" onClick={() => onApplyAlts(s.altTexts)} />
              </li>
            </Section>
          ) : null}
          {s.categories.length || s.tags.length ? (
            <Section title="Categories & tags">
              {s.categories.length ? (
                <SuggestionRow text={`Categories: ${s.categories.join(", ")}`} onUse={() => onChange({ categories: Array.from(new Set([...draft.categories, ...s.categories])) })} />
              ) : null}
              {s.tags.length ? <SuggestionRow text={`Tags: ${s.tags.join(", ")}`} onUse={() => onChange({ tags: Array.from(new Set([...draft.tags, ...s.tags])) })} /> : null}
            </Section>
          ) : null}
          {s.improvements.length ? (
            <Section title="Suggested edits">
              {s.improvements.map((t) => (
                <li key={t} className="rounded-md px-2 py-1.5 text-xs" style={{ background: "var(--page-plane)", color: "var(--text-primary)" }}>
                  {t}
                </li>
              ))}
            </Section>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        {groups.map((group) => (
          <div key={group} className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              {group}
            </span>
            <ul className="flex flex-col">
              {report.checks
                .filter((c) => c.group === group)
                .map((c) => {
                  const icon = STATUS_ICON[c.status];
                  return (
                    <li key={c.id} className="flex items-start gap-2 py-1">
                      <span className="mt-0.5 w-4 shrink-0 text-center text-xs font-bold" style={{ color: icon.color }} aria-label={icon.label} title={icon.label}>
                        {icon.mark}
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                          {c.label}
                        </span>
                        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                          {c.detail}
                        </span>
                      </span>
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
      </div>
      <button type="button" onClick={onSuggest} disabled={suggesting} className={buttonSecondary} style={secondaryStyle}>
        {suggesting ? "Asking ChatGPT..." : "Ask ChatGPT how to fix these"}
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>
        {title}
      </span>
      <ul className="flex flex-col gap-1">{children}</ul>
    </div>
  );
}
