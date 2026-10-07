/**
 * Google Docs API document JSON -> article HTML. The Doc's Title (or its first Heading 1) becomes the
 * article title; the remaining headings start at H2 because WordPress prints the post title as the H1.
 */

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const str = (v: unknown) => (typeof v === "string" ? v : "");

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface DocImage {
  /** Temporary Google URL (valid ~30 minutes) - the importer copies it into the project library. */
  src: string;
  alt: string;
}

export interface ConvertedDoc {
  title: string;
  html: string;
  images: DocImage[];
}

function runsToHtml(elements: Json[], inlineObjects: Json, images: DocImage[]): string {
  let out = "";
  for (const el of elements) {
    const run = obj(el.textRun);
    if (el.textRun) {
      let text = str(run.content).replace(/\n$/, "").replace(/\u000b/g, "\n");
      if (!text) continue;
      const style = obj(run.textStyle);
      text = escapeHtml(text).replace(/\n/g, "<br>");
      if (style.bold) text = `<strong>${text}</strong>`;
      if (style.italic) text = `<em>${text}</em>`;
      if (style.underline && !obj(style.link).url) text = `<u>${text}</u>`;
      const url = str(obj(style.link).url);
      if (url) text = `<a href="${escapeHtml(url)}">${text}</a>`;
      out += text;
      continue;
    }
    const inline = obj(el.inlineObjectElement);
    if (el.inlineObjectElement) {
      const embedded = obj(obj(obj(inlineObjects[str(inline.inlineObjectId)]).inlineObjectProperties).embeddedObject);
      const src = str(obj(embedded.imageProperties).contentUri);
      if (src) {
        const alt = str(embedded.description) || str(embedded.title);
        images.push({ src, alt });
        out += `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">`;
      }
      continue;
    }
    const rich = obj(el.richLink);
    if (el.richLink) {
      const props = obj(rich.richLinkProperties);
      const uri = str(props.uri);
      if (uri) out += `<a href="${escapeHtml(uri)}">${escapeHtml(str(props.title) || uri)}</a>`;
    }
  }
  return out.trim();
}

export function docToHtml(doc: Json): ConvertedDoc {
  const body = arr(obj(doc.body).content);
  const inlineObjects = obj(doc.inlineObjects);
  const lists = obj(doc.lists);
  const images: DocImage[] = [];
  const blocks: string[] = [];
  let title = "";
  const hasTitleStyle = body.some((b) => str(obj(obj(b.paragraph).paragraphStyle).namedStyleType) === "TITLE");
  let openList: { id: string; tag: "ul" | "ol" } | null = null;

  const closeList = () => {
    if (openList) blocks.push(`</${openList.tag}>`);
    openList = null;
  };

  const paragraphHtml = (p: Json): { tag: string; html: string; listId?: string; ordered?: boolean } | null => {
    const style = str(obj(p.paragraphStyle).namedStyleType);
    const html = runsToHtml(arr(p.elements), inlineObjects, images);
    if (!html) return null;
    const bullet = obj(p.bullet);
    if (p.bullet) {
      const listId = str(bullet.listId);
      const level = Number(bullet.nestingLevel ?? 0);
      const glyph = obj(arr(obj(obj(lists[listId]).listProperties).nestingLevels)[level]);
      const ordered = Boolean(glyph.glyphType) && str(glyph.glyphType) !== "GLYPH_TYPE_UNSPECIFIED" && !glyph.glyphSymbol;
      return { tag: "li", html, listId, ordered };
    }
    const heading: Record<string, string> = { HEADING_1: "h2", HEADING_2: "h2", HEADING_3: "h3", HEADING_4: "h4", HEADING_5: "h5", HEADING_6: "h6" };
    if (style === "TITLE") return { tag: "title", html };
    if (style === "SUBTITLE") return { tag: "p", html: `<em>${html}</em>` };
    if (style === "HEADING_1" && !hasTitleStyle && !title) return { tag: "title", html };
    return { tag: heading[style] ?? "p", html };
  };

  for (const block of body) {
    if (block.paragraph) {
      const p = paragraphHtml(obj(block.paragraph));
      if (!p) continue;
      if (p.tag === "title") {
        if (!title) {
          title = p.html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
          continue;
        }
        p.tag = "h2";
      }
      if (p.tag === "li") {
        const tag: "ul" | "ol" = p.ordered ? "ol" : "ul";
        const current = openList as { id: string; tag: "ul" | "ol" } | null;
        if (!current || current.id !== p.listId || current.tag !== tag) {
          closeList();
          blocks.push(`<${tag}>`);
          openList = { id: p.listId ?? "", tag };
        }
        blocks.push(`<li>${p.html}</li>`);
        continue;
      }
      closeList();
      blocks.push(`<${p.tag}>${p.html}</${p.tag}>`);
      continue;
    }
    closeList();
    if (block.table) {
      const rows = arr(obj(block.table).tableRows).map((row, r) => {
        const cells = arr(obj(row).tableCells).map((cell) => {
          const inner = arr(obj(cell).content)
            .map((c) => (c.paragraph ? runsToHtml(arr(obj(c.paragraph).elements), inlineObjects, images) : ""))
            .filter(Boolean)
            .join("<br>");
          return r === 0 ? `<th>${inner}</th>` : `<td>${inner}</td>`;
        });
        return `<tr>${cells.join("")}</tr>`;
      });
      blocks.push(`<table><tbody>${rows.join("")}</tbody></table>`);
    }
  }
  closeList();
  return { title: title.trim() || str(doc.title), html: blocks.join("\n"), images };
}
