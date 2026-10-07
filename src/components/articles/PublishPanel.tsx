"use client";

import { useEffect, useState } from "react";
import type { Article, ArticleImageRef, ArticleStatus, PublishMode } from "@/lib/articles/types";
import type { WordPressSettingsView } from "@/lib/wordpress/store";
import { Segmented } from "@/components/tracking/ui";
import { ImagePicker } from "./ImagePicker";
import { Field, buttonSecondary, fieldStyle, secondaryStyle, toList } from "./shared";

export interface PublishDraft {
  categories: string[];
  tags: string[];
  publish: Article["publish"];
  status: ArticleStatus;
  featuredImage?: ArticleImageRef;
}

const pad = (n: number) => String(n).padStart(2, "0");
function toLocalInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function PublishPanel({
  projectId,
  draft,
  onChange,
  wordpress,
  settings,
  categories,
  focusKeyword,
  publishing,
  result,
  onPublish,
  onOpenSettings,
}: {
  projectId: string;
  draft: PublishDraft;
  onChange: (patch: Partial<PublishDraft>) => void;
  wordpress?: Article["wordpress"];
  settings: WordPressSettingsView | null;
  categories: string[];
  focusKeyword: string;
  publishing: boolean;
  result: { warnings: string[]; error: string | null } | null;
  onPublish: () => void;
  onOpenSettings: () => void;
}) {
  const [picker, setPicker] = useState(false);
  const [categoryText, setCategoryText] = useState(draft.categories.join(", "));
  const [tagText, setTagText] = useState(draft.tags.join(", "));
  const connected = Boolean(settings?.hasPassword);
  const mode = draft.publish.mode;
  // "Now" ticks so a schedule time that slips into the past is caught.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const scheduleInvalid = mode === "future" && (!draft.publish.date || new Date(draft.publish.date).getTime() <= now);
  const onSite = wordpress && settings && wordpress.siteUrl === settings.siteUrl;
  const action = mode === "draft" ? "Send to WordPress as draft" : mode === "publish" ? "Publish now" : "Schedule post";

  // Keep the text boxes in step when suggestions add categories/tags.
  const [lastCategories, setLastCategories] = useState(draft.categories);
  if (lastCategories !== draft.categories) {
    setLastCategories(draft.categories);
    if (toList(categoryText).join("|") !== draft.categories.join("|")) setCategoryText(draft.categories.join(", "));
  }
  const [lastTags, setLastTags] = useState(draft.tags);
  if (lastTags !== draft.tags) {
    setLastTags(draft.tags);
    if (toList(tagText).join("|") !== draft.tags.join("|")) setTagText(draft.tags.join(", "));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 rounded-lg border p-3" style={{ borderColor: "var(--border-hairline)", background: "var(--page-plane)" }}>
        <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
          WordPress site
        </span>
        {connected ? (
          <span className="text-sm" style={{ color: "var(--text-primary)" }}>
            {settings!.siteUrl.replace(/^https?:\/\//, "")}
            <span className="text-xs" style={{ color: settings!.lastTest?.ok === false ? "var(--status-critical)" : "var(--text-muted)" }}>
              {" "}
              · {settings!.lastTest ? (settings!.lastTest.ok ? `as ${settings!.lastTest.user}` : "last test failed") : "not tested yet"}
              {settings!.seoPlugin !== "none" ? ` · ${settings!.seoPlugin === "yoast" ? "Yoast" : "Rank Math"}${settings!.lastTest?.helper ? "" : " (helper plugin not detected)"}` : ""}
            </span>
          </span>
        ) : (
          <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Not connected.{" "}
            <button type="button" onClick={onOpenSettings} className="font-medium underline" style={{ color: "var(--series-1)" }}>
              Connect WordPress
            </button>
          </span>
        )}
      </div>

      <Field label="Featured image">
        {draft.featuredImage ? (
          <div className="flex flex-col gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- featured image preview */}
            <img src={draft.featuredImage.src} alt="" className="aspect-video w-full rounded-lg object-cover" style={{ background: "var(--page-plane)" }} />
            <input
              value={draft.featuredImage.alt}
              onChange={(e) => onChange({ featuredImage: { ...draft.featuredImage!, alt: e.target.value } })}
              placeholder="Alt text"
              className="rounded-lg border px-3 py-1.5 text-sm outline-none"
              style={fieldStyle}
              aria-label="Featured image alt text"
            />
            <div className="flex gap-2">
              <button type="button" onClick={() => setPicker(true)} className={buttonSecondary} style={secondaryStyle}>
                Change
              </button>
              <button type="button" onClick={() => onChange({ featuredImage: undefined })} className={buttonSecondary} style={{ ...secondaryStyle, color: "var(--status-critical)" }}>
                Remove
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setPicker(true)} className="rounded-lg border border-dashed px-3 py-6 text-sm" style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)" }}>
            + Choose from library, a link or an upload
          </button>
        )}
      </Field>

      <Field label="Categories" hint={categories.length ? "Comma-separated. New names are created in WordPress." : "Comma-separated."}>
        <input
          value={categoryText}
          onChange={(e) => {
            setCategoryText(e.target.value);
            onChange({ categories: toList(e.target.value) });
          }}
          className="rounded-lg border px-3 py-1.5 text-sm outline-none"
          style={fieldStyle}
        />
      </Field>
      {categories.length ? (
        <div className="-mt-2 flex flex-wrap gap-1">
          {categories
            .filter((c) => !draft.categories.includes(c))
            .slice(0, 12)
            .map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onChange({ categories: [...draft.categories, c] })}
                className="rounded-full border px-2 py-0.5 text-[11px]"
                style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)" }}
              >
                + {c}
              </button>
            ))}
        </div>
      ) : null}
      <Field label="Tags" hint="Comma-separated.">
        <input
          value={tagText}
          onChange={(e) => {
            setTagText(e.target.value);
            onChange({ tags: toList(e.target.value) });
          }}
          className="rounded-lg border px-3 py-1.5 text-sm outline-none"
          style={fieldStyle}
        />
      </Field>

      <Field label="Workflow status">
        <select value={draft.status} onChange={(e) => onChange({ status: e.target.value as ArticleStatus })} className="rounded-lg border px-2 py-1.5 text-sm" style={fieldStyle}>
          <option value="draft">Draft - still editing</option>
          <option value="ready">Ready to publish</option>
          {draft.status === "published" || draft.status === "scheduled" || draft.status === "error" ? (
            <option value={draft.status}>{draft.status === "error" ? "Publish failed" : draft.status === "published" ? "Published" : "Scheduled"}</option>
          ) : null}
        </select>
      </Field>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
          When it goes to WordPress
        </span>
        <Segmented<PublishMode>
          value={mode}
          options={[
            { value: "draft", label: "Draft" },
            { value: "publish", label: "Publish now" },
            { value: "future", label: "Schedule" },
          ]}
          onChange={(m) => onChange({ publish: { ...draft.publish, mode: m } })}
          ariaLabel="Publish mode"
        />
        {mode === "future" ? (
          <input
            type="datetime-local"
            value={toLocalInput(draft.publish.date)}
            onChange={(e) => onChange({ publish: { mode, date: e.target.value ? new Date(e.target.value).toISOString() : undefined } })}
            className="rounded-lg border px-3 py-1.5 text-sm outline-none"
            style={fieldStyle}
            aria-label="Scheduled date and time"
          />
        ) : null}
        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          {mode === "draft"
            ? "Lands in WordPress as a draft for a final check there."
            : mode === "publish"
              ? "Goes live on the site straight away."
              : scheduleInvalid
                ? "Pick a date and time in the future (your local time)."
                : `WordPress publishes it on ${new Date(draft.publish.date!).toLocaleString()} (your local time).`}
        </span>
      </div>

      <button
        type="button"
        onClick={onPublish}
        disabled={!connected || publishing || scheduleInvalid}
        className="rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        style={{ background: mode === "publish" ? "var(--success-text)" : "var(--series-1)" }}
      >
        {publishing ? "Sending to WordPress..." : onSite ? `${action} (updates post #${wordpress!.postId})` : action}
      </button>

      {result?.error ? (
        <p className="text-sm" role="alert" style={{ color: "var(--status-critical)" }}>
          {result.error}
        </p>
      ) : null}
      {result?.warnings.length ? (
        <ul className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>
          {result.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      ) : null}
      {wordpress ? (
        <div className="flex flex-col gap-0.5 rounded-lg border p-3 text-xs" style={{ borderColor: "var(--border-hairline)" }}>
          <span style={{ color: "var(--text-secondary)" }}>
            In WordPress as <b>{wordpress.status === "publish" ? "published" : wordpress.status === "future" ? "scheduled" : wordpress.status}</b> · post #{wordpress.postId} · {new Date(wordpress.publishedAt).toLocaleString()}
          </span>
          {wordpress.link ? (
            <a href={wordpress.link} target="_blank" rel="noreferrer" className="truncate font-medium underline" style={{ color: "var(--series-1)" }}>
              {wordpress.status === "publish" ? "View post" : "Open preview"} ↗
            </a>
          ) : null}
          <a href={`${wordpress.siteUrl}/wp-admin/post.php?post=${wordpress.postId}&action=edit`} target="_blank" rel="noreferrer" className="font-medium underline" style={{ color: "var(--series-1)" }}>
            Edit in WordPress ↗
          </a>
        </div>
      ) : null}

      {picker ? (
        <ImagePicker
          projectId={projectId}
          title="Featured image"
          defaultAlt={draft.featuredImage?.alt || focusKeyword}
          onPick={(image) => onChange({ featuredImage: image })}
          onClose={() => setPicker(false)}
        />
      ) : null}
    </div>
  );
}
