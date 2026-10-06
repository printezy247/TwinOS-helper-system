/**
 * CSV for the sheet export (§9.L.96). RFC 4180 with one addition: a cell a
 * spreadsheet would treat as a formula is prefixed with an apostrophe.
 *
 * That guard is not paranoia here. The log's `notes` column carries content
 * titles, and titles come from RSS and social feeds — text Jack does not write.
 * A title beginning `=HYPERLINK(...)` would otherwise be executed when the CSV
 * is opened in Sheets or Excel. A negative number must survive untouched,
 * which is why the guard looks at `=`, `+`, `@` and leading tab/CR and not at
 * every minus sign.
 */

const NEEDS_QUOTES = /[",\r\n]/;
const FORMULA_START = /^[=+@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = typeof value === "string" ? value : String(value);
  if (FORMULA_START.test(s)) s = "'" + s;
  if (NEEDS_QUOTES.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toCsv(rows: Array<Record<string, unknown>>, columns?: readonly string[]): string {
  const cols = columns && columns.length
    ? [...columns]
    : [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const lines = [cols.map(csvCell).join(",")];
  for (const row of rows) lines.push(cols.map((c) => csvCell(row[c])).join(","));
  return lines.join("\r\n") + "\r\n";
}
