"use client";

import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import type { ArticleImageRef } from "@/lib/articles/types";
import { ImagePicker } from "./ImagePicker";
import { fieldStyle } from "./shared";

/** Applies suggested alt texts to the images with matching src. */
export function applyAltTexts(editor: Editor, alts: Array<{ src: string; alt: string }>) {
  const bySrc = new Map(alts.map((a) => [a.src, a.alt]));
  const { tr } = editor.state;
  let changed = false;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "image" && bySrc.has(node.attrs.src)) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, alt: bySrc.get(node.attrs.src) });
      changed = true;
    }
  });
  if (changed) editor.view.dispatch(tr);
}

/** Adds an H2 at the end of the article (for suggested subtopics), with an empty paragraph to write in. */
export function appendHeading(editor: Editor, text: string) {
  editor
    .chain()
    .focus("end")
    .insertContent([
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text }] },
      { type: "paragraph" },
    ])
    .run();
}

function ToolButton({ label, active, onClick, children, disabled }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="flex h-8 min-w-8 items-center justify-center rounded-md px-1.5 text-sm disabled:opacity-40"
      style={{ background: active ? "color-mix(in srgb, var(--series-1) 14%, transparent)" : "transparent", color: active ? "var(--series-1)" : "var(--text-secondary)" }}
    >
      {children}
    </button>
  );
}

/**
 * The article body editor: headings (H2-H4, since the post title is the H1), lists, links, quotes, tables and
 * images with alt text. "HTML" switches to the raw markup.
 */
export function RichEditor({
  value,
  onChange,
  projectId,
  onReady,
  focusKeyword,
}: {
  value: string;
  onChange: (html: string) => void;
  projectId: string;
  onReady?: (editor: Editor) => void;
  focusKeyword?: string;
}) {
  const [mode, setMode] = useState<"visual" | "html">("visual");
  const [picker, setPicker] = useState(false);
  const lastHtml = useRef(value);

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3, 4] }, link: { openOnClick: false, autolink: true, defaultProtocol: "https" } }),
      Image.configure({ inline: false, allowBase64: false }),
      TableKit.configure({ table: { resizable: false } }),
      Placeholder.configure({ placeholder: "Write the article, or import it from a Google Doc..." }),
    ],
    content: value,
    editorProps: { attributes: { class: "article-prose", spellcheck: "true" } },
    onUpdate: ({ editor: e }) => {
      const html = e.getHTML();
      lastHtml.current = html;
      onChange(html);
    },
  });

  useEffect(() => {
    if (editor && onReady) onReady(editor);
  }, [editor, onReady]);

  // Content replaced from outside (re-import, HTML mode, applied suggestion): load it without echoing back.
  useEffect(() => {
    if (!editor || value === lastHtml.current) return;
    lastHtml.current = value;
    editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);

  const headingValue = editor?.isActive("heading", { level: 2 })
    ? "h2"
    : editor?.isActive("heading", { level: 3 })
      ? "h3"
      : editor?.isActive("heading", { level: 4 })
        ? "h4"
        : "p";

  function setBlock(v: string) {
    if (!editor) return;
    if (v === "p") editor.chain().focus().setParagraph().run();
    else editor.chain().focus().toggleHeading({ level: Number(v[1]) as 2 | 3 | 4 }).run();
  }

  function setLink() {
    if (!editor) return;
    const current = editor.getAttributes("link").href as string | undefined;
    const href = window.prompt("Link address (leave empty to remove the link)", current ?? "https://");
    if (href === null) return;
    if (!href.trim()) editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: href.trim() }).run();
  }

  function insertImage(image: ArticleImageRef) {
    editor?.chain().focus().setImage({ src: image.src, alt: image.alt, title: image.title }).run();
  }

  const imageSelected = Boolean(editor?.isActive("image"));
  const imageAttrs = imageSelected ? (editor!.getAttributes("image") as { src: string; alt?: string }) : null;

  return (
    <div className="flex min-w-0 flex-col rounded-xl border" style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}>
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 rounded-t-xl border-b px-2 py-1.5" style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}>
        <select
          value={headingValue}
          onChange={(e) => setBlock(e.target.value)}
          disabled={mode === "html"}
          aria-label="Text style"
          className="mr-1 rounded-md border px-2 py-1 text-xs"
          style={fieldStyle}
        >
          <option value="p">Paragraph</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
          <option value="h4">Heading 4</option>
        </select>
        <ToolButton label="Bold" active={editor?.isActive("bold")} disabled={mode === "html"} onClick={() => editor?.chain().focus().toggleBold().run()}>
          <b>B</b>
        </ToolButton>
        <ToolButton label="Italic" active={editor?.isActive("italic")} disabled={mode === "html"} onClick={() => editor?.chain().focus().toggleItalic().run()}>
          <i>I</i>
        </ToolButton>
        <ToolButton label="Link" active={editor?.isActive("link")} disabled={mode === "html"} onClick={setLink}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <path d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 013.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 014.5 9l1-1" strokeLinecap="round" />
          </svg>
        </ToolButton>
        <ToolButton label="Bulleted list" active={editor?.isActive("bulletList")} disabled={mode === "html"} onClick={() => editor?.chain().focus().toggleBulletList().run()}>
          •≡
        </ToolButton>
        <ToolButton label="Numbered list" active={editor?.isActive("orderedList")} disabled={mode === "html"} onClick={() => editor?.chain().focus().toggleOrderedList().run()}>
          1.
        </ToolButton>
        <ToolButton label="Quote" active={editor?.isActive("blockquote")} disabled={mode === "html"} onClick={() => editor?.chain().focus().toggleBlockquote().run()}>
          “”
        </ToolButton>
        <ToolButton label="Insert image" disabled={mode === "html"} onClick={() => setPicker(true)}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
            <rect x="2" y="3" width="12" height="10" rx="1.5" />
            <circle cx="6" cy="6.5" r="1.2" />
            <path d="M2.5 12l3.5-3.5 2.5 2.5 2-2 3 3" />
          </svg>
        </ToolButton>
        <ToolButton label="Undo" disabled={mode === "html" || !editor?.can().undo()} onClick={() => editor?.chain().focus().undo().run()}>
          ↶
        </ToolButton>
        <ToolButton label="Redo" disabled={mode === "html" || !editor?.can().redo()} onClick={() => editor?.chain().focus().redo().run()}>
          ↷
        </ToolButton>
        <span className="ml-auto" />
        <button
          type="button"
          onClick={() => setMode((m) => (m === "visual" ? "html" : "visual"))}
          className="rounded-md border px-2 py-1 text-xs font-medium"
          style={{ borderColor: "var(--border-hairline)", color: mode === "html" ? "var(--series-1)" : "var(--text-secondary)" }}
          aria-pressed={mode === "html"}
        >
          HTML
        </button>
      </div>

      {imageAttrs && mode === "visual" ? (
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs" style={{ borderColor: "var(--border-hairline)", background: "var(--page-plane)" }}>
          <span style={{ color: "var(--text-secondary)" }}>Image alt text</span>
          <input
            key={imageAttrs.src}
            defaultValue={imageAttrs.alt ?? ""}
            onChange={(e) => editor?.chain().updateAttributes("image", { alt: e.target.value }).run()}
            placeholder={focusKeyword ? `Describe the image (e.g. mention "${focusKeyword}" if it fits)` : "Describe the image"}
            className="min-w-[220px] flex-1 rounded-md border px-2 py-1 text-xs outline-none"
            style={fieldStyle}
          />
          <button type="button" onClick={() => editor?.chain().focus().deleteSelection().run()} className="rounded-md border px-2 py-1" style={{ borderColor: "var(--border-hairline)", color: "var(--status-critical)" }}>
            Remove image
          </button>
        </div>
      ) : null}

      {mode === "visual" ? (
        <EditorContent editor={editor} className="min-h-[420px] px-5 py-4" />
      ) : (
        <textarea
          value={value}
          onChange={(e) => {
            lastHtml.current = "";
            onChange(e.target.value);
          }}
          spellCheck={false}
          className="min-h-[420px] w-full resize-y rounded-b-xl px-4 py-3 font-mono text-xs leading-relaxed outline-none"
          style={{ background: "var(--page-plane)", color: "var(--text-primary)" }}
          aria-label="Article HTML"
        />
      )}

      {picker ? <ImagePicker projectId={projectId} title="Insert an image" defaultAlt={focusKeyword} onPick={insertImage} onClose={() => setPicker(false)} /> : null}
    </div>
  );
}
