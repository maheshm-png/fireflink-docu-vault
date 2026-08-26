import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";
import mammoth from "mammoth";
import { extractXlsxPreview, parseCsvPreview, type SpreadsheetSheet } from "./spreadsheet";
// pdf-parse has no ESM types export cleanly under NodeNext — required dynamically below.

/** Flattens every worksheet's rows into one search-indexable text blob,
 * labeled by sheet name — a multi-tab workbook's content should all be
 * findable, not just whichever sheet happens to be first. */
function sheetsToText(sheets: SpreadsheetSheet[]): string {
  return sheets
    .map((sheet) => {
      const body = sheet.rows.map((row) => row.join(" ")).join("\n");
      return sheets.length > 1 ? `[${sheet.name}]\n${body}` : body;
    })
    .join("\n\n");
}

/**
 * Extracts plain text from an uploaded file so it can be indexed into
 * Meilisearch. This is what makes "search finds relevant content, not
 * just filenames" actually true.
 *
 * Supported: .pptx (slide text), .pdf (all pages), .docx (body text),
 * .xlsx/.xls (cell text), .csv (cell text). Videos and unsupported formats
 * return an empty string — search still works on their title/tags/category,
 * just not full-text.
 */
export async function extractText(buffer: Buffer, filename: string): Promise<string> {
  const ext = filename.toLowerCase().split(".").pop();

  try {
    switch (ext) {
      case "pptx":
        return extractPptxText(buffer);
      case "pdf":
        return await extractPdfText(buffer);
      case "docx":
        return await extractDocxText(buffer);
      case "xlsx":
      case "xls":
        return sheetsToText(extractXlsxPreview(buffer).sheets);
      case "csv":
        return sheetsToText(parseCsvPreview(buffer.toString("utf-8")).sheets);
      default:
        return "";
    }
  } catch (err) {
    // Never let a bad file block the upload — just skip full-text indexing for it.
    console.error(`Text extraction failed for ${filename}:`, err);
    return "";
  }
}

function extractPptxText(buffer: Buffer): string {
  const zip = new AdmZip(buffer);
  const parser = new XMLParser({ ignoreAttributes: true, textNodeName: "#text" });
  const slideEntries = zip
    .getEntries()
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
    .sort((a, b) => {
      const numA = parseInt(a.entryName.match(/\d+/)?.[0] ?? "0", 10);
      const numB = parseInt(b.entryName.match(/\d+/)?.[0] ?? "0", 10);
      return numA - numB;
    });

  const slideTexts: string[] = [];
  for (const entry of slideEntries) {
    const xml = entry.getData().toString("utf-8");
    const parsed = parser.parse(xml);
    const texts: string[] = [];
    collectTextRuns(parsed, texts);
    slideTexts.push(texts.join(" "));
  }
  return slideTexts.join("\n\n");
}

/** Recursively walks the parsed PPTX XML tree pulling every <a:t> text run. */
function collectTextRuns(node: any, out: string[]) {
  if (node == null || typeof node !== "object") return;
  for (const key of Object.keys(node)) {
    if (key === "a:t") {
      const val = node[key];
      if (typeof val === "string") out.push(val);
      else if (val && typeof val === "object" && "#text" in val) out.push(String(val["#text"]));
    } else if (typeof node[key] === "object") {
      collectTextRuns(node[key], out);
    }
  }
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdfParse = (await import("pdf-parse")).default;
  const data = await pdfParse(buffer);
  return data.text;
}

async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}
