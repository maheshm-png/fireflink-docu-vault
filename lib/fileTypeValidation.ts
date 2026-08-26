/**
 * Rejects an upload whose actual file content doesn't match the docType the
 * uploader picked — e.g. an HTML export selected as "PDF". Without this, a
 * mismatched file uploads and stores fine, but every downstream feature that
 * assumes the content actually matches the type breaks silently: the preview
 * modal picks the wrong renderer (or a real one that can't parse garbage),
 * text extraction for search fails, and LibreOffice conversion errors out —
 * all invisibly, well after the point where a clear "this doesn't look like
 * a PDF" message would have caught it.
 *
 * Checked via magic bytes/signatures, not file extension (which the
 * uploader also controls and could equally be wrong) — PDF ("%PDF-"), the
 * OOXML zip container shared by .pptx/.docx/.xlsx (PK\x03\x04), and the
 * legacy OLE Compound File container shared by .ppt/.doc/.xls
 * (D0CF11E0A1B11AE1). CSV has no fixed signature (it's just text), so an
 * "excel" upload with a .csv extension is left unchecked — any text content
 * is structurally a valid CSV, there's nothing meaningful to validate.
 */

const PDF_MAGIC = Buffer.from("%PDF-", "latin1");
const OOXML_ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

function startsWith(buffer: Buffer, magic: Buffer): boolean {
  return buffer.length >= magic.length && buffer.subarray(0, magic.length).equals(magic);
}

const OFFICE_LABELS: Record<string, string> = {
  ppt: "a PowerPoint file (.ppt/.pptx)",
  doc: "a Word document (.doc/.docx)",
  excel: "a spreadsheet (.xlsx/.xls/.csv)",
};

/** Returns an error message if the file's real content doesn't match
 * docType, or null if it's fine (including doc types this doesn't check). */
export function validateFileMatchesDocType(buffer: Buffer, filename: string, docType: string): string | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";

  if (docType === "pdf") {
    return startsWith(buffer, PDF_MAGIC)
      ? null
      : `This file doesn't look like a real PDF (its content doesn't start with a PDF header) — double-check the file and the document type.`;
  }

  if (docType === "ppt" || docType === "doc" || (docType === "excel" && ext !== "csv")) {
    const looksLikeOfficeFile = startsWith(buffer, OOXML_ZIP_MAGIC) || startsWith(buffer, OLE_MAGIC);
    return looksLikeOfficeFile
      ? null
      : `This file doesn't look like ${OFFICE_LABELS[docType]} — double-check the file and the document type.`;
  }

  return null; // video / other / csv / link — nothing reliable to check
}
