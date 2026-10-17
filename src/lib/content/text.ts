/** Lowercase, no accents or punctuation - for comparing sheet values ("Đã đăng" -> "da dang"). */
export function normHeaderText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A date from a plan cell: ISO, "Oct 2026", "12/10/2026" (day first), "2026/10/12". Returns YYYY-MM-DD or "". */
export function planDate(value: string): string {
  const v = value.trim();
  if (!v) return "";
  let m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    const year = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    // Day first, unless the first number can't be a day-of-month position (e.g. 10/25/2026).
    const [day, month] = +m[2] > 12 ? [+m[2], +m[1]] : [+m[1], +m[2]];
    return iso(year, month, day);
  }
  const t = Date.parse(/^\w+ \d{4}$/.test(v) ? `1 ${v}` : v);
  if (Number.isNaN(t)) return "";
  const d = new Date(t);
  return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function iso(y: number, m: number, d: number): string {
  if (!(y > 1990 && y < 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return "";
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
