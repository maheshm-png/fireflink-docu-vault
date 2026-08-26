import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";

/**
 * Parses .xlsx (every worksheet, in tab order) or .csv into plain row/cell
 * grids for preview. Same zero-new-dependency approach as lib/pptxSlides.ts
 * — .xlsx is also just a zip of XML, so this reuses adm-zip + fast-xml-parser
 * rather than pulling in a spreadsheet library. Not a full spreadsheet
 * feature set (no formulas, no merged-cell layout) — enough to preview the
 * data, across every tab, with dates/percentages read as such rather than
 * as raw serial numbers, without downloading.
 */

export type SpreadsheetSheet = { name: string; rows: string[][]; truncated: boolean };
export type SpreadsheetPreview = { sheets: SpreadsheetSheet[] };

const MAX_ROWS = 500;
const MAX_SHEETS = 20;

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text" });

export function extractXlsxPreview(buffer: Buffer): SpreadsheetPreview {
  const zip = new AdmZip(buffer);

  const sharedStrings: string[] = [];
  const sstEntry = zip.getEntry("xl/sharedStrings.xml");
  if (sstEntry) {
    const sst = parser.parse(sstEntry.getData().toString("utf-8"));
    for (const item of normalizeArray(sst?.sst?.si)) sharedStrings.push(extractSharedItemText(item));
  }

  const numFmtByStyle = parseCellFormats(zip);
  const sheetRefs = resolveSheetList(zip);

  const sheets: SpreadsheetSheet[] = [];
  for (const ref of sheetRefs.slice(0, MAX_SHEETS)) {
    const entry = zip.getEntry(ref.target);
    if (!entry) continue;
    sheets.push(parseSheet(entry.getData().toString("utf-8"), ref.name, sharedStrings, numFmtByStyle));
  }

  // Fallback for the (rare) case workbook.xml/rels couldn't be resolved —
  // scan sheetN.xml entries directly in file order rather than showing nothing.
  if (sheets.length === 0) {
    const fallbackEntries = zip
      .getEntries()
      .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.entryName))
      .sort((a, b) => {
        const na = parseInt(a.entryName.match(/\d+/)?.[0] ?? "0", 10);
        const nb = parseInt(b.entryName.match(/\d+/)?.[0] ?? "0", 10);
        return na - nb;
      });
    fallbackEntries.slice(0, MAX_SHEETS).forEach((entry, i) => {
      sheets.push(parseSheet(entry.getData().toString("utf-8"), `Sheet${i + 1}`, sharedStrings, numFmtByStyle));
    });
  }

  return { sheets };
}

/** Reads xl/workbook.xml (tab names, in display order) + its rels (name ->
 * worksheet file) — sheetN.xml's own number doesn't reliably match tab
 * order once a workbook has been reordered/renamed in Excel, so this is the
 * only correct way to label and order tabs the way the user actually sees
 * them. */
function resolveSheetList(zip: AdmZip): { name: string; target: string }[] {
  const wbEntry = zip.getEntry("xl/workbook.xml");
  if (!wbEntry) return [];
  const wbXml = parser.parse(wbEntry.getData().toString("utf-8"));
  const sheetNodes = normalizeArray(wbXml?.workbook?.sheets?.sheet);

  const relMap = new Map<string, string>();
  const relsEntry = zip.getEntry("xl/_rels/workbook.xml.rels");
  if (relsEntry) {
    const relsXml = parser.parse(relsEntry.getData().toString("utf-8"));
    for (const r of normalizeArray(relsXml?.Relationships?.Relationship)) {
      relMap.set(r["@_Id"], r["@_Target"]);
    }
  }

  return sheetNodes
    .map((s: any) => {
      const rId = s["@_r:id"];
      const target = rId ? relMap.get(rId) : undefined;
      if (!target) return null;
      const resolved = `xl/${target.replace(/^\.?\/*/, "")}`;
      return { name: String(s["@_name"] ?? "Sheet"), target: resolved };
    })
    .filter((s: { name: string; target: string } | null): s is { name: string; target: string } => s !== null);
}

function parseSheet(
  xmlText: string,
  name: string,
  sharedStrings: string[],
  numFmtByStyle: Map<number, NumFmtKind>
): SpreadsheetSheet {
  const sheetXml = parser.parse(xmlText);
  const rowNodes = normalizeArray(sheetXml?.worksheet?.sheetData?.row);

  const rows: string[][] = [];
  let truncated = false;
  for (const rowNode of rowNodes) {
    if (rows.length >= MAX_ROWS) {
      truncated = true;
      break;
    }
    const rowValues = normalizeArray(rowNode?.c).map((cell) => {
      const type = cell["@_t"];
      const vNode = cell?.v;
      const raw = vNode && typeof vNode === "object" ? vNode["#text"] : vNode;
      if (raw === undefined || raw === null) return "";

      if (type === "s") {
        const idx = parseInt(String(raw), 10);
        return sharedStrings[idx] ?? "";
      }

      // Numeric cell — check its style for a date/percentage format before
      // falling back to the raw number, so "1/5/2026" doesn't preview as
      // the serial number 46031 and "15%" doesn't preview as 0.15.
      const styleIdx = cell["@_s"] !== undefined ? parseInt(cell["@_s"], 10) : undefined;
      const kind = styleIdx !== undefined ? numFmtByStyle.get(styleIdx) : undefined;
      const num = parseFloat(String(raw));
      if (!Number.isNaN(num)) {
        if (kind === "date") return formatExcelDate(num);
        if (kind === "percent") return formatExcelPercent(num);
      }
      return String(raw);
    });
    rows.push(rowValues);
  }

  return { name, rows, truncated };
}

type NumFmtKind = "date" | "percent";

// Built-in numFmtId values defined by the OOXML spec (ECMA-376) for date/
// time and percentage formats — the ones that actually show up in practice.
// Custom formats (numFmtId >= 164) are intentionally not pattern-matched:
// heuristically guessing at an arbitrary formatCode string risks mislabeling
// a plain number as a date, which is worse than just showing the number.
const BUILTIN_DATE_FMT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 57]);
const BUILTIN_PERCENT_FMT_IDS = new Set([9, 10]);

/** Maps each cellXfs style index (what a cell's `s` attribute references)
 * to a date/percent classification, via xl/styles.xml. */
function parseCellFormats(zip: AdmZip): Map<number, NumFmtKind> {
  const result = new Map<number, NumFmtKind>();
  const entry = zip.getEntry("xl/styles.xml");
  if (!entry) return result;

  const xml = parser.parse(entry.getData().toString("utf-8"));
  const cellXfs = normalizeArray(xml?.styleSheet?.cellXfs?.xf);
  cellXfs.forEach((xf, i) => {
    const numFmtId = parseInt(xf["@_numFmtId"], 10) || 0;
    if (BUILTIN_DATE_FMT_IDS.has(numFmtId)) result.set(i, "date");
    else if (BUILTIN_PERCENT_FMT_IDS.has(numFmtId)) result.set(i, "percent");
  });
  return result;
}

/** Excel's date serial epoch is 1899-12-30 (not 1900-01-01) to compensate
 * for the spreadsheet's well-known fake 1900 leap-year bug — this is the
 * standard conversion used across every spreadsheet-reading library. */
function formatExcelDate(serial: number): string {
  const utcMs = Math.round((serial - 25569) * 86400 * 1000);
  const date = new Date(utcMs);
  if (Number.isNaN(date.getTime())) return String(serial);
  const hasTime = !Number.isInteger(serial);
  return hasTime
    ? date.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function formatExcelPercent(value: number): string {
  const pct = value * 100;
  const rounded = Math.round(pct * 100) / 100;
  return `${rounded % 1 === 0 ? rounded : rounded.toFixed(2)}%`;
}

function normalizeArray(v: any): any[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function extractSharedItemText(si: any): string {
  if (si == null) return "";
  if (si.t !== undefined) {
    return typeof si.t === "object" ? String(si.t["#text"] ?? "") : String(si.t);
  }
  // Rich text runs: <si><r><t>...</t></r><r><t>...</t></r></si>
  return normalizeArray(si.r)
    .map((r) => (typeof r.t === "object" ? r.t["#text"] : r.t) ?? "")
    .join("");
}

export function parseCsvPreview(text: string): SpreadsheetPreview {
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.length > 0);
  const truncated = lines.length > MAX_ROWS;
  return { sheets: [{ name: "Sheet1", rows: lines.slice(0, MAX_ROWS).map(parseCsvLine), truncated }] };
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}
