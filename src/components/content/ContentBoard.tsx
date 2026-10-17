"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { STAGES, STAGE_LABEL, type ContentBoard as Board, type ContentItem, type ContentPlanConfig, type Stage } from "@/lib/content/types";
import { EmptyState, Segmented } from "@/components/tracking/ui";
import { Field, Modal, buttonPrimary, buttonSecondary, fieldStyle, secondaryStyle } from "@/components/articles/shared";
import type { GoogleStatus } from "@/components/articles/ImportDialog";

type Layout = "board" | "table";

const DONE: Stage[] = ["approved", "published"];
const CARD_MIME = "application/x-content-card";

/** Stage marker: one hue getting darker as the article moves along; Published is the "done" status color. */
const stageColor = (stage: Stage) => {
  const i = STAGES.findIndex((s) => s.id === stage);
  if (stage === "published") return "var(--status-good)";
  return `color-mix(in srgb, var(--series-1) ${30 + i * 14}%, var(--gridline))`;
};

const isRealDoc = (url: string) => /^https:\/\/docs\.google\.com\//.test(url);
const monthOf = (item: ContentItem) => (/^\d{4}-\d{2}/.test(item.publishDate) ? item.publishDate.slice(0, 7) : /^\d{4}-\d{2}/.test(item.dueDate) ? item.dueDate.slice(0, 7) : "");
const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString(undefined, { month: "short", year: "numeric" });

function ago(iso: string | null, now: number): string {
  if (!iso) return "never";
  const min = Math.round((now - new Date(iso).getTime()) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

async function api<T>(url: string, method: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

/**
 * The project's content workflow: a card per article in the plan, in Brief → Draft → Internal review → Client
 * review → Approved → Published. Moving a card writes the matching status to the plan; each card can get its
 * Google Doc (created in the project's folder and linked in the plan) and be shared with the client.
 */
export function ContentBoard({
  projectId,
  google,
  onSetup,
  onOpenArticle,
  onArticlesChanged,
}: {
  projectId: string;
  google: GoogleStatus | null;
  onSetup: () => void;
  onOpenArticle: (id: string) => void;
  onArticlesChanged: () => void;
}) {
  const [config, setConfig] = useState<ContentPlanConfig | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(0);
  const [layout, setLayout] = useState<Layout>("board");
  const [q, setQ] = useState("");
  const [writer, setWriter] = useState("");
  const [category, setCategory] = useState("");
  const [month, setMonth] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropStage, setDropStage] = useState<Stage | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [reloads, setReloads] = useState(0);
  const load = useCallback(() => setReloads((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/content?project=${encodeURIComponent(projectId)}`, { cache: "no-store" })
      .then((res) => res.json().catch(() => ({})))
      .then((data: { config?: ContentPlanConfig | null; board?: Board }) => {
        if (cancelled) return;
        setConfig(data.config ?? null);
        setBoard(data.board ?? null);
        setNow(Date.now());
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, reloads]);

  const today = useMemo(() => (now ? new Date(now).toISOString().slice(0, 10) : ""), [now]);
  const isOverdue = (i: ContentItem) => Boolean(today && i.dueDate && i.dueDate < today && !DONE.includes(i.stage));

  const replaceItem = (item: ContentItem) => setBoard((b) => (b ? { ...b, items: b.items.map((i) => (i.key === item.key ? item : i)) } : b));

  async function sync() {
    setBusy("sync");
    setError(null);
    try {
      const data = await api<{ board: Board }>("/api/content/sync", "POST", { project: projectId });
      setBoard(data.board);
      setNow(Date.now());
      setNotice(`Synced ${data.board.items.length} articles from the plan.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setBusy(null);
    }
  }

  async function move(key: string, stage: Stage) {
    const before = board?.items.find((i) => i.key === key);
    if (!before || before.stage === stage) return;
    replaceItem({ ...before, stage });
    setError(null);
    try {
      const data = await api<{ item: ContentItem; sheet: string; note?: string; shared?: string[] }>("/api/content/item", "PATCH", { project: projectId, key, stage });
      replaceItem(data.item);
      const parts = [
        `"${data.item.title}" → ${STAGE_LABEL[stage]}.`,
        data.sheet === "written" ? `Plan status set to "${data.item.sheetStatus}".` : data.sheet === "simulated" ? "(Sample plan: the Sheet write is simulated.)" : "",
        data.shared?.length ? `Shared with ${data.shared.join(", ")}.` : "",
        data.note ?? "",
      ];
      setNotice(parts.filter(Boolean).join(" "));
    } catch (err) {
      replaceItem(before);
      setError(err instanceof Error ? err.message : "Couldn't move the card");
    }
  }

  async function createDocs(keys: string[]) {
    if (!keys.length) return;
    setBusy("docs");
    setError(null);
    let made = 0;
    const failures: string[] = [];
    let simulated = false;
    let added: string | undefined;
    try {
      for (let i = 0; i < keys.length; i += 10) {
        setNotice(`Creating Docs ${Math.min(i + 10, keys.length)}/${keys.length}...`);
        const data = await api<{ created: Array<{ key: string; docUrl: string }>; failed: Array<{ title: string; error: string }>; simulated: boolean; addedColumn?: string }>(
          "/api/content/docs",
          "POST",
          { project: projectId, keys: keys.slice(i, i + 10) }
        );
        made += data.created.length;
        failures.push(...data.failed.map((f) => `${f.title}: ${f.error}`));
        simulated ||= data.simulated;
        added ??= data.addedColumn;
        setBoard((b) => (b ? { ...b, items: b.items.map((it) => ({ ...it, docUrl: data.created.find((c) => c.key === it.key)?.docUrl ?? it.docUrl })) } : b));
        if (data.failed.length && !data.created.length) break;
      }
      setNotice(
        [`${made} Doc${made === 1 ? "" : "s"} created${simulated ? " (sample plan: simulated, nothing was added to Drive)" : ` in ${config?.drive.folderName ?? "the project's folder"}`}.`, added ? `Added a "${added}" column to the plan for the links.` : ""]
          .filter(Boolean)
          .join(" ")
      );
      if (failures.length) setError(failures.slice(0, 3).join(" · "));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create Docs");
    } finally {
      setBusy(null);
    }
  }

  const items = useMemo(() => board?.items ?? [], [board]);
  const writers = useMemo(() => [...new Set(items.map((i) => i.writer).filter(Boolean))].sort(), [items]);
  const categories = useMemo(() => [...new Set(items.map((i) => i.category).filter(Boolean))].sort(), [items]);
  const months = useMemo(() => [...new Set(items.map(monthOf).filter(Boolean))].sort(), [items]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter(
      (i) =>
        (!writer || i.writer === writer) &&
        (!category || i.category === category) &&
        (!month || monthOf(i) === month) &&
        (!needle || `${i.title} ${i.focusKeyword} ${i.writer} ${i.category}`.toLowerCase().includes(needle))
    );
  }, [items, q, writer, category, month]);

  if (!loaded) return <p className="text-sm" style={{ color: "var(--text-muted)" }}>Loading the content board...</p>;

  if (!config) {
    return (
      <EmptyState
        title="Set up this project's content plan"
        body="Link the project's Google Sheet once - any layout works. The board then shows every article from Brief to Published, creates Docs in the project's Drive folder and writes statuses back to the plan."
        action={
          <button type="button" onClick={onSetup} className={buttonPrimary} style={{ background: "var(--series-1)" }}>
            Set up content plan
          </button>
        }
      />
    );
  }

  const needDoc = shown.filter((i) => !i.docUrl && !DONE.includes(i.stage));
  const openItem = items.find((i) => i.key === openKey) ?? null;
  const sample = config.spreadsheetId === "sample";
  const tiles = [
    { label: "Articles", value: shown.length, hint: `${shown.filter((i) => i.stage === "published").length} published` },
    { label: "Overdue", value: shown.filter(isOverdue).length, hint: "past due, not approved", tone: shown.some(isOverdue) ? "var(--status-critical)" : undefined },
    { label: "With the client", value: shown.filter((i) => i.stage === "client").length, hint: "waiting for approval" },
    { label: "Need a Doc", value: needDoc.length, hint: "planned, no Doc yet" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {board?.source?.title ?? "Content plan"} <span style={{ color: "var(--text-muted)" }}>· {config.tab}</span>
          </span>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            Synced {ago(board?.syncedAt ?? null, now)}
            {sample ? " · sample plan (Google writes are simulated)" : google?.canWrite ? " · changes are written to the plan" : " · sign in with Google (Settings) to write changes to the plan"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setAdding(true)} className={buttonSecondary} style={secondaryStyle}>
            Add article
          </button>
          {needDoc.length ? (
            <button type="button" disabled={busy !== null} onClick={() => void createDocs(needDoc.map((i) => i.key))} className={buttonSecondary} style={secondaryStyle}>
              {busy === "docs" ? "Creating Docs..." : `Create ${needDoc.length} Doc${needDoc.length === 1 ? "" : "s"}`}
            </button>
          ) : null}
          <button type="button" disabled={busy !== null} onClick={() => void sync()} className={buttonPrimary} style={{ background: "var(--series-1)" }}>
            {busy === "sync" ? "Syncing..." : "Sync from Sheet"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="flex flex-col rounded-xl border px-4 py-3" style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}>
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {t.label}
            </span>
            <span className="tabular text-2xl font-semibold" style={{ color: t.tone ?? "var(--text-primary)" }}>
              {t.value}
            </span>
            <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              {t.hint}
            </span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, keyword, writer..." className="min-w-[200px] flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none sm:flex-none" style={fieldStyle} aria-label="Search articles" />
        {writers.length ? (
          <select value={writer} onChange={(e) => setWriter(e.target.value)} className="rounded-lg border px-2 py-1.5 text-xs" style={fieldStyle} aria-label="Writer">
            <option value="">All writers</option>
            {writers.map((w) => (
              <option key={w}>{w}</option>
            ))}
          </select>
        ) : null}
        {categories.length ? (
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-lg border px-2 py-1.5 text-xs" style={fieldStyle} aria-label="Category">
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        ) : null}
        {months.length ? (
          <select value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-lg border px-2 py-1.5 text-xs" style={fieldStyle} aria-label="Month">
            <option value="">All months</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        ) : null}
        <div className="ml-auto">
          <Segmented
            value={layout}
            options={[
              { value: "board", label: "Board" },
              { value: "table", label: "Table" },
            ]}
            onChange={setLayout}
            ariaLabel="Board layout"
          />
        </div>
      </div>

      {notice ? (
        <p className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-xs" role="status" style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)", background: "var(--surface-1)" }}>
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="underline" style={{ color: "var(--text-muted)" }}>
            Dismiss
          </button>
        </p>
      ) : null}
      {error ? (
        <p className="text-sm" role="alert" style={{ color: "var(--status-critical)" }}>
          {error}
        </p>
      ) : null}
      {board?.warnings.length ? (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          {board.warnings.join(" ")}{" "}
          <button type="button" onClick={onSetup} className="underline">
            Fix in Settings
          </button>
        </p>
      ) : null}

      {!board?.syncedAt ? (
        <EmptyState title="Not synced yet" body="Read the plan to fill the board." action={<button type="button" onClick={() => void sync()} className={buttonPrimary} style={{ background: "var(--series-1)" }}>Sync from Sheet</button>} />
      ) : layout === "board" ? (
        <div className="-mx-1 grid auto-cols-[minmax(200px,1fr)] grid-flow-col gap-3 overflow-x-auto px-1 pb-2">
          {STAGES.map((stage) => {
            const cards = shown.filter((i) => i.stage === stage.id);
            const over = dropStage === stage.id;
            return (
              <section
                key={stage.id}
                aria-label={stage.label}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes(CARD_MIME)) return;
                  e.preventDefault();
                  setDropStage(stage.id);
                }}
                onDragLeave={() => setDropStage((s) => (s === stage.id ? null : s))}
                onDrop={(e) => {
                  e.preventDefault();
                  const key = e.dataTransfer.getData(CARD_MIME) || dragKey;
                  if (key) void move(key, stage.id);
                  setDragKey(null);
                  setDropStage(null);
                }}
                className="flex min-h-[220px] flex-col gap-2 rounded-xl border p-2"
                style={{ borderColor: over ? "var(--series-1)" : "var(--border-hairline)", background: "var(--page-plane)" }}
              >
                <header className="flex items-center justify-between px-1 pt-1" title={stage.hint}>
                  <span className="flex items-center gap-2 text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                    <span className="h-2 w-2 rounded-full" style={{ background: stageColor(stage.id) }} aria-hidden />
                    {stage.label}
                  </span>
                  <span className="tabular rounded-full px-2 text-[11px]" style={{ background: "var(--surface-1)", color: "var(--text-secondary)" }}>
                    {cards.length}
                  </span>
                </header>
                {cards.map((item) => (
                  <Card
                    key={item.key}
                    item={item}
                    overdue={isOverdue(item)}
                    dragging={dragKey === item.key}
                    onOpen={() => setOpenKey(item.key)}
                    onDragStart={() => setDragKey(item.key)}
                    onDragEnd={() => {
                      setDragKey(null);
                      setDropStage(null);
                    }}
                  />
                ))}
                {!cards.length ? (
                  <p className="px-1 py-4 text-center text-[11px]" style={{ color: "var(--text-muted)" }}>
                    {dragKey ? "Drop here" : "—"}
                  </p>
                ) : null}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}>
          <table className="w-full min-w-[860px] text-xs">
            <thead style={{ background: "var(--page-plane)" }}>
              <tr className="text-left" style={{ color: "var(--text-muted)" }}>
                {["Title", "Keyword", "Writer", "Due", "Publish", "Stage", "Doc", "Row"].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((item) => (
                <tr key={item.key} className="border-t" style={{ borderColor: "var(--border-hairline)" }}>
                  <td className="max-w-[300px] px-3 py-2">
                    <button type="button" onClick={() => setOpenKey(item.key)} className="truncate text-left font-medium underline-offset-2 hover:underline" style={{ color: "var(--text-primary)" }}>
                      {item.title}
                    </button>
                  </td>
                  <td className="max-w-[180px] truncate px-3 py-2" style={{ color: "var(--text-secondary)" }}>
                    {item.focusKeyword}
                  </td>
                  <td className="px-3 py-2" style={{ color: "var(--text-secondary)" }}>
                    {item.writer}
                  </td>
                  <td className="tabular px-3 py-2" style={{ color: isOverdue(item) ? "var(--status-critical)" : "var(--text-secondary)" }}>
                    {item.dueDate}
                    {isOverdue(item) ? " · overdue" : ""}
                  </td>
                  <td className="tabular px-3 py-2" style={{ color: "var(--text-secondary)" }}>
                    {item.publishDate}
                  </td>
                  <td className="px-3 py-2">
                    <StageSelect value={item.stage} onChange={(s) => void move(item.key, s)} />
                  </td>
                  <td className="px-3 py-2">
                    <DocLink url={item.docUrl} />
                  </td>
                  <td className="tabular px-3 py-2" style={{ color: "var(--text-muted)" }}>
                    {item.rowNumber ?? "board"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openItem ? (
        <ItemDrawer
          key={openItem.key}
          item={openItem}
          config={config}
          projectId={projectId}
          overdue={isOverdue(openItem)}
          busy={busy}
          onClose={() => setOpenKey(null)}
          onMove={(s) => void move(openItem.key, s)}
          onCreateDoc={() => void createDocs([openItem.key])}
          onChange={replaceItem}
          onRemoved={() => {
            setOpenKey(null);
            load();
          }}
          onOpenArticle={onOpenArticle}
          onArticlesChanged={onArticlesChanged}
          onNotice={setNotice}
        />
      ) : null}
      {adding ? (
        <AddDialog
          projectId={projectId}
          writers={writers}
          onClose={() => setAdding(false)}
          onAdded={(item, note) => {
            setBoard((b) => (b ? { ...b, items: [...b.items, item] } : b));
            setAdding(false);
            setNotice(note);
          }}
        />
      ) : null}
    </div>
  );
}

function StageSelect({ value, onChange }: { value: Stage; onChange: (s: Stage) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as Stage)} className="rounded-md border px-2 py-1 text-xs" style={fieldStyle} aria-label="Stage">
      {STAGES.map((s) => (
        <option key={s.id} value={s.id}>
          {s.label}
        </option>
      ))}
    </select>
  );
}

function DocLink({ url }: { url: string }) {
  if (!url) return <span style={{ color: "var(--text-muted)" }}>no Doc</span>;
  if (!isRealDoc(url)) return <span style={{ color: "var(--text-muted)" }}>sample Doc</span>;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="font-medium underline" style={{ color: "var(--series-1)" }}>
      Open Doc ↗
    </a>
  );
}

function Card({
  item,
  overdue,
  dragging,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  item: ContentItem;
  overdue: boolean;
  dragging: boolean;
  onOpen: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const meta = [item.writer || "No writer", item.dueDate ? `due ${item.dueDate}` : ""].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData(CARD_MIME, item.key);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className="flex cursor-grab flex-col gap-1.5 rounded-lg border p-3 text-left transition-shadow hover:shadow-sm active:cursor-grabbing"
      style={{ borderColor: overdue ? "var(--status-critical)" : "var(--border-hairline)", background: "var(--surface-1)", opacity: dragging ? 0.5 : 1 }}
    >
      <span className="line-clamp-2 text-sm font-medium leading-snug" style={{ color: "var(--text-primary)" }}>
        {item.title}
      </span>
      {item.focusKeyword && item.focusKeyword !== item.title ? (
        <span className="truncate text-xs" style={{ color: "var(--text-secondary)" }}>
          Keyword: {item.focusKeyword}
        </span>
      ) : null}
      <span className="text-[11px]" style={{ color: overdue ? "var(--status-critical)" : "var(--text-muted)" }}>
        {overdue ? "⚠ overdue · " : ""}
        {meta}
      </span>
      <span className="flex flex-wrap items-center gap-1 text-[10px]">
        {item.docUrl ? <Tag>{isRealDoc(item.docUrl) ? "Doc" : "sample Doc"}</Tag> : null}
        {item.category ? <Tag>{item.category}</Tag> : null}
        {item.action ? <Tag>{item.action}</Tag> : null}
        {item.sharedWith?.length ? <Tag>shared</Tag> : null}
        {item.boardStage ? <Tag muted>board only</Tag> : null}
      </span>
    </button>
  );
}

function Tag({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <span className="max-w-[140px] truncate rounded px-1.5 py-0.5" style={{ background: "var(--page-plane)", color: muted ? "var(--text-muted)" : "var(--text-secondary)", border: "1px solid var(--border-hairline)" }}>
      {children}
    </span>
  );
}

function ItemDrawer({
  item,
  config,
  projectId,
  overdue,
  busy,
  onClose,
  onMove,
  onCreateDoc,
  onChange,
  onRemoved,
  onOpenArticle,
  onArticlesChanged,
  onNotice,
}: {
  item: ContentItem;
  config: ContentPlanConfig;
  projectId: string;
  overdue: boolean;
  busy: string | null;
  onClose: () => void;
  onMove: (s: Stage) => void;
  onCreateDoc: () => void;
  onChange: (item: ContentItem) => void;
  onRemoved: () => void;
  onOpenArticle: (id: string) => void;
  onArticlesChanged: () => void;
  onNotice: (n: string) => void;
}) {
  const [emails, setEmails] = useState(config.clientEmails.join(", "));
  const [notes, setNotes] = useState(item.notes ?? "");
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(label: string, fn: () => Promise<void>) {
    setWorking(label);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setWorking(null);
    }
  }

  const share = () =>
    run("share", async () => {
      const list = emails.split(/[\s,;]+/).filter(Boolean);
      const data = await api<{ item: ContentItem; shared: string[]; simulated: boolean }>("/api/content/share", "POST", { project: projectId, key: item.key, emails: list });
      onChange(data.item);
      onNotice(`${data.simulated ? "(Sample) " : ""}Shared "${item.title}" with ${data.shared.join(", ")} - they can comment in the Doc.`);
    });

  const importArticle = () =>
    run("import", async () => {
      const data = await api<{ results: Array<{ status: string; id?: string; error?: string }> }>("/api/articles/import", "POST", {
        project: projectId,
        items: [
          {
            rowNumber: item.rowNumber ?? undefined,
            sheetId: item.rowNumber ? config.spreadsheetId : undefined,
            sheetTab: item.rowNumber ? config.tab : undefined,
            docUrl: item.docUrl,
            title: item.title,
            focusKeyword: item.focusKeyword,
            secondaryKeywords: item.secondaryKeywords,
            categories: item.category,
            publishDate: item.publishDate,
            status: item.sheetStatus,
          },
        ],
      });
      const r = data.results[0];
      if (!r?.id) throw new Error(r?.error ?? "Import failed");
      const linked = await api<{ item: ContentItem }>("/api/content/item", "PATCH", { project: projectId, key: item.key, articleId: r.id });
      onChange(linked.item);
      onArticlesChanged();
      onOpenArticle(r.id);
    });

  const saveNotes = () =>
    run("notes", async () => {
      const data = await api<{ item: ContentItem }>("/api/content/item", "PATCH", { project: projectId, key: item.key, notes });
      onChange(data.item);
    });

  const remove = () =>
    run("remove", async () => {
      await api("/api/content/item", "DELETE", { project: projectId, key: item.key });
      onRemoved();
    });

  const facts: Array<[string, string]> = [
    ["Focus keyword", item.focusKeyword],
    ["Secondary keywords", item.secondaryKeywords],
    ["Category", item.category],
    ["Writer", item.writer],
    ["Due", item.dueDate + (overdue ? " (overdue)" : "")],
    ["Publish", item.publishDate],
    ["Priority", item.priority],
    ["Type", item.action],
    ["Status in the plan", item.sheetStatus],
    ["Plan row", item.rowNumber ? String(item.rowNumber) : "added on the board"],
  ];

  return (
    <Modal title={item.title} onClose={onClose} width="max-w-2xl">
      <div className="flex flex-col gap-4 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <Field label="Stage">
            <StageSelect value={item.stage} onChange={onMove} />
          </Field>
          {item.boardStage ? (
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              Set on the board - the plan still says &quot;{item.sheetStatus || "(empty)"}&quot;.
            </span>
          ) : null}
        </div>

        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
          {facts
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="flex flex-col">
                <dt className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {k}
                </dt>
                <dd style={{ color: k.startsWith("Due") && overdue ? "var(--status-critical)" : "var(--text-primary)" }}>{v}</dd>
              </div>
            ))}
          {item.publishUrl ? (
            <div className="flex flex-col">
              <dt className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                Published at
              </dt>
              <dd className="truncate">
                <a href={item.publishUrl} target="_blank" rel="noreferrer" className="underline" style={{ color: "var(--series-1)" }}>
                  {item.publishUrl.replace(/^https?:\/\//, "")}
                </a>
              </dd>
            </div>
          ) : null}
        </dl>

        <section className="flex flex-col gap-2 rounded-lg border p-3" style={{ borderColor: "var(--border-hairline)" }}>
          <h4 className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
            Google Doc
          </h4>
          {item.docUrl ? (
            <div className="flex flex-wrap items-center gap-3">
              <DocLink url={item.docUrl} />
              {!isRealDoc(item.docUrl) ? (
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  Sample plan - no file in Drive.
                </span>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" disabled={busy !== null} onClick={onCreateDoc} className={buttonSecondary} style={secondaryStyle}>
                {busy === "docs" ? "Creating..." : "Create Google Doc"}
              </button>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                {config.drive.templateId ? "Copies the template" : "Blank Doc with a brief"}
                {config.drive.folderName ? ` in "${config.drive.folderName}"` : ""}
                {config.writeBack.docLinks ? ", linked in the plan" : ""}.
              </span>
            </div>
          )}
          {item.docUrl ? (
            <div className="flex flex-wrap items-end gap-2 border-t pt-2" style={{ borderColor: "var(--border-hairline)" }}>
              <div className="min-w-[220px] flex-1">
                <Field label="Share for client review (comment access)">
                  <input value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="client@example.com" className="w-full rounded-lg border px-3 py-1.5 text-sm outline-none" style={fieldStyle} />
                </Field>
              </div>
              <button type="button" disabled={working !== null || !emails.trim()} onClick={() => void share()} className={buttonSecondary} style={secondaryStyle}>
                {working === "share" ? "Sharing..." : "Share Doc"}
              </button>
              {item.sharedWith?.length ? (
                <span className="w-full text-xs" style={{ color: "var(--text-muted)" }}>
                  Shared with {item.sharedWith.join(", ")}
                </span>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="flex flex-wrap items-center gap-3">
          {item.articleId ? (
            <button type="button" onClick={() => onOpenArticle(item.articleId!)} className={buttonPrimary} style={{ background: "var(--series-1)" }}>
              Open in the article editor
            </button>
          ) : (
            <button type="button" disabled={working !== null} onClick={() => void importArticle()} className={buttonPrimary} style={{ background: "var(--series-1)" }}>
              {working === "import" ? "Importing..." : item.docUrl ? "Import Doc into the editor" : "Start in the article editor"}
            </button>
          )}
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            Edit, check SEO and publish to WordPress.
          </span>
        </section>

        <Field label="Notes (on the board only)">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full rounded-lg border px-3 py-2 text-sm outline-none" style={fieldStyle} />
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {item.key.startsWith("local:") ? (
            <button type="button" disabled={working !== null} onClick={() => void remove()} className="text-xs underline" style={{ color: "var(--status-critical)" }}>
              Remove card
            </button>
          ) : (
            <span />
          )}
          <button type="button" disabled={working !== null || notes === (item.notes ?? "")} onClick={() => void saveNotes()} className={buttonSecondary} style={secondaryStyle}>
            {working === "notes" ? "Saving..." : "Save notes"}
          </button>
        </div>

        {item.history.length ? (
          <details className="text-xs">
            <summary className="cursor-pointer" style={{ color: "var(--text-secondary)" }}>
              History ({item.history.length})
            </summary>
            <ul className="mt-2 flex flex-col gap-1" style={{ color: "var(--text-muted)" }}>
              {[...item.history].reverse().map((h, i) => (
                <li key={i}>
                  {new Date(h.at).toLocaleString()} · {h.from ? `${STAGE_LABEL[h.from]} → ` : ""}
                  {STAGE_LABEL[h.to]} {h.by === "sheet" ? "(from the plan)" : ""}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {error ? (
          <p role="alert" style={{ color: "var(--status-critical)" }}>
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function AddDialog({ projectId, writers, onClose, onAdded }: { projectId: string; writers: string[]; onClose: () => void; onAdded: (item: ContentItem, note: string) => void }) {
  const [title, setTitle] = useState("");
  const [focusKeyword, setFocusKeyword] = useState("");
  const [writer, setWriter] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setSaving(true);
    setError(null);
    try {
      const data = await api<{ item: ContentItem; sheet: string; note?: string }>("/api/content/item", "POST", { project: projectId, title, focusKeyword, writer, dueDate });
      onAdded(data.item, data.sheet === "written" ? `Added "${data.item.title}" to the plan (row ${data.item.rowNumber}).` : data.note ?? `Added "${data.item.title}" to the board.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add the article");
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Add an article"
      onClose={onClose}
      width="max-w-lg"
      footer={
        <>
          <button type="button" onClick={onClose} className={buttonSecondary} style={secondaryStyle}>
            Cancel
          </button>
          <button type="button" disabled={saving || !title.trim()} onClick={() => void add()} className={buttonPrimary} style={{ background: "var(--series-1)" }}>
            {saving ? "Adding..." : "Add to Brief"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-lg border px-3 py-1.5 text-sm outline-none" style={fieldStyle} autoFocus />
        </Field>
        <Field label="Focus keyword">
          <input value={focusKeyword} onChange={(e) => setFocusKeyword(e.target.value)} className="w-full rounded-lg border px-3 py-1.5 text-sm outline-none" style={fieldStyle} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Writer">
            <input value={writer} onChange={(e) => setWriter(e.target.value)} list="content-writers" className="w-full rounded-lg border px-3 py-1.5 text-sm outline-none" style={fieldStyle} />
            <datalist id="content-writers">
              {writers.map((w) => (
                <option key={w} value={w} />
              ))}
            </datalist>
          </Field>
          <Field label="Due date">
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full rounded-lg border px-3 py-1.5 text-sm outline-none" style={fieldStyle} />
          </Field>
        </div>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          With Google sign-in, the article is added as a new row at the end of the plan; otherwise it stays on the board.
        </p>
        {error ? (
          <p role="alert" className="text-sm" style={{ color: "var(--status-critical)" }}>
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
