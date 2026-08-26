import AdmZip from "adm-zip";
import fs from "fs";
import path from "path";

/**
 * Stamps the Fireflink logo as a translucent watermark onto an already-
 * editable Office file before it's handed to a view-only "user"-role
 * downloader (see the role/docType branch in
 * app/api/documents/[id]/download/route.ts) — contributors, managers, and
 * superadmin still get the clean original. Implemented as direct XML string
 * splicing into the existing zip parts rather than a full parse+rebuild:
 * every insertion point below is chosen so it never touches content anyone
 * else's parser (ours, Word's, PowerPoint's, Excel's, LibreOffice's) already
 * depends on — the safest way to guarantee this can't silently corrupt a
 * file that then looks fine until someone actually opens it.
 *
 * Best-effort by design: an unrecognized or already-malformed source file
 * (see lib/fileTypeValidation.ts — pre-existing bad records can still exist)
 * makes each function throw rather than fall back to serving the clean,
 * unwatermarked original, since the whole point is that a "user"-role
 * downloader should never receive an unmarked editable copy.
 */

const LOGO_PATH = path.join(process.cwd(), "public", "logo-icon.png");
let cachedLogoBytes: Buffer | null = null;
function getLogoBytes(): Buffer {
  if (!cachedLogoBytes) cachedLogoBytes = fs.readFileSync(LOGO_PATH);
  return cachedLogoBytes;
}

function requireZip(buffer: Buffer, label: string): AdmZip {
  try {
    return new AdmZip(buffer);
  } catch (err) {
    throw new Error(`${label}: not a readable Office zip package (${(err as Error).message})`);
  }
}

function readEntryText(zip: AdmZip, path: string): string {
  const entry = zip.getEntry(path);
  if (!entry) throw new Error(`missing required part ${path}`);
  return entry.getData().toString("utf-8");
}

/** Appends a relationship entry to an existing .rels part, or creates one
 * with just that entry if the part doesn't exist yet — every relationship
 * file in this module goes through here so the "existing vs. missing" branch
 * only has to be written once. */
function addRelationship(zip: AdmZip, relsPath: string, relEntry: string) {
  const existing = zip.getEntry(relsPath);
  if (existing) {
    const xml = existing.getData().toString("utf-8");
    const idx = xml.lastIndexOf("</Relationships>");
    if (idx === -1) throw new Error(`${relsPath} has no </Relationships>`);
    zip.updateFile(existing, Buffer.from(xml.slice(0, idx) + relEntry + xml.slice(idx), "utf-8"));
  } else {
    const newXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relEntry}</Relationships>`;
    zip.addFile(relsPath, Buffer.from(newXml, "utf-8"));
  }
}

/** Registers the .png Default extension in [Content_Types].xml if some
 * other part hasn't already registered it (any file with an existing image
 * already has this) — an embedded .png with no content-type mapping at all
 * is what a strict parser refuses to load. */
function ensurePngContentType(zip: AdmZip) {
  const contentTypesPath = "[Content_Types].xml";
  const xml = readEntryText(zip, contentTypesPath);
  if (/<Default\s+Extension="png"/i.test(xml)) return;
  const idx = xml.lastIndexOf("</Types>");
  if (idx === -1) throw new Error("[Content_Types].xml has no </Types>");
  const withPng = xml.slice(0, idx) + `<Default Extension="png" ContentType="image/png"/>` + xml.slice(idx);
  zip.updateFile(zip.getEntry(contentTypesPath)!, Buffer.from(withPng, "utf-8"));
}

// ---------------------------------------------------------------------
// PPTX — embeds the logo once as shared media, then on each slide adds a
// relationship to it (relationships are scoped per-part, so every slide
// needs its own, even though they all point at the same image file) plus a
// rotated, ~30%-opacity <p:pic> in the existing <p:spTree>, right before its
// closing tag.
// ---------------------------------------------------------------------
export function watermarkPptx(buffer: Buffer): Buffer {
  const zip = requireZip(buffer, "pptx");

  let width = 12192000;
  let height = 6858000;
  const presEntry = zip.getEntry("ppt/presentation.xml");
  if (presEntry) {
    const xml = presEntry.getData().toString("utf-8");
    if (/<p:sldSz\b/.test(xml)) {
      width = parseInt(xml.match(/\bcx="(\d+)"/)?.[1] ?? String(width), 10);
      height = parseInt(xml.match(/\bcy="(\d+)"/)?.[1] ?? String(height), 10);
    }
  }

  const mediaPath = "ppt/media/ff-watermark-logo.png";
  if (!zip.getEntry(mediaPath)) zip.addFile(mediaPath, getLogoBytes());
  ensurePngContentType(zip);

  const side = Math.round(Math.min(width, height) * 0.45);
  const offX = Math.round((width - side) / 2);
  const offY = Math.round((height - side) / 2);
  const relId = "rIdFFWatermarkLogo";

  const shapeXml =
    `<p:pic><p:nvPicPr><p:cNvPr id="999002" name="FF Watermark"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="${relId}"><a:alphaModFix amt="28000"/></a:blip><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr><a:xfrm rot="-2700000"><a:off x="${offX}" y="${offY}"/><a:ext cx="${side}" cy="${side}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;

  const slideEntries = zip.getEntries().filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName));
  if (slideEntries.length === 0) throw new Error("pptx: no slides found");

  for (const entry of slideEntries) {
    const slideNum = entry.entryName.match(/slide(\d+)\.xml$/)![1];
    addRelationship(
      zip,
      `ppt/slides/_rels/slide${slideNum}.xml.rels`,
      `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/ff-watermark-logo.png"/>`
    );

    const xml = zip.getEntry(entry.entryName)!.getData().toString("utf-8");
    const idx = xml.lastIndexOf("</p:spTree>");
    if (idx === -1) throw new Error(`pptx: ${entry.entryName} has no <p:spTree> to watermark`);
    const patched = xml.slice(0, idx) + shapeXml + xml.slice(idx);
    zip.updateFile(zip.getEntry(entry.entryName)!, Buffer.from(patched, "utf-8"));
  }

  return zip.toBuffer();
}

// ---------------------------------------------------------------------
// DOCX — a VML picture watermark (the same "Insert Watermark > Picture
// Watermark" construct Word itself generates: an _x0000_t75 picture-frame
// shape with gain/blacklevel washout, no custom shapetype definition
// needed unlike a text watermark), placed in a dedicated header part so it
// repeats on every page. Requires coordinated additions (header part +
// its own image relationship, content-type registrations, document-level
// relationship) plus a headerReference in every sectPr — each one is
// additive (new entries appended before a known closing tag), never
// rewriting existing content, so an already-valid document stays valid.
// ---------------------------------------------------------------------
export function watermarkDocx(buffer: Buffer): Buffer {
  const zip = requireZip(buffer, "docx");

  const headerPath = "word/header-ff-watermark.xml";
  if (zip.getEntry(headerPath)) throw new Error("docx: watermark header part already exists");

  const mediaPath = "word/media/ff-watermark-logo.png";
  if (!zip.getEntry(mediaPath)) zip.addFile(mediaPath, getLogoBytes());
  ensurePngContentType(zip);

  const imgRelId = "rIdFFWatermarkLogo";
  addRelationship(
    zip,
    "word/_rels/header-ff-watermark.xml.rels",
    `<Relationship Id="${imgRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/ff-watermark-logo.png"/>`
  );

  // gain/blacklevel are the exact washout values Word's own "Insert Picture
  // Watermark" feature writes — a documented, widely-reused magic constant
  // pair for fading a picture into a translucent-looking watermark via VML.
  const headerXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
    `<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
    `xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">` +
    `<w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr><w:r><w:pict>` +
    `<v:shape id="FFWatermarkLogo" o:spid="_x0000_s1025" type="#_x0000_t75" ` +
    `style="position:absolute;margin-left:0;margin-top:0;width:250pt;height:248pt;z-index:-251654144;` +
    `mso-position-horizontal:center;mso-position-horizontal-relative:margin;` +
    `mso-position-vertical:center;mso-position-vertical-relative:margin" o:allowincell="f">` +
    `<v:imagedata r:id="${imgRelId}" o:title="" gain="19661f" blacklevel="22938f"/>` +
    `</v:shape></w:pict></w:r></w:p></w:hdr>`;
  zip.addFile(headerPath, Buffer.from(headerXml, "utf-8"));

  // A genuine Word-produced .docx always ships styles.xml/settings.xml, but
  // a minimal/hand-built one might not — and LibreOffice's DOCX header
  // handling turns out to depend on them being present (confirmed by direct
  // testing: identical header-wiring logic succeeds against a package that
  // has them and fails against one that doesn't, regardless of how the
  // header itself is wired). Adding bare-minimum versions when missing costs
  // nothing for a document that already has them and fixes real breakage
  // for the ones that don't. The header's <w:pStyle w:val="Header"/> also
  // needs a "Header" style to actually resolve to something.
  const contentTypeOverrides: string[] = [];
  const documentRelEntries: string[] = [];

  if (!zip.getEntry("word/styles.xml")) {
    zip.addFile(
      "word/styles.xml",
      Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
          `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
          `<w:docDefaults/>` +
          `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
          `<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="Header"/><w:basedOn w:val="Normal"/></w:style>` +
          `</w:styles>`,
        "utf-8"
      )
    );
    contentTypeOverrides.push(
      `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>`
    );
    documentRelEntries.push(
      `<Relationship Id="rIdFFStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
    );
  }
  if (!zip.getEntry("word/settings.xml")) {
    zip.addFile(
      "word/settings.xml",
      Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
          `<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>`,
        "utf-8"
      )
    );
    contentTypeOverrides.push(
      `<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>`
    );
    documentRelEntries.push(
      `<Relationship Id="rIdFFSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>`
    );
  }

  // Read-only enforcement, no password — the same "Restrict Editing > Read
  // Only, no exceptions" Word itself writes when you don't set a password.
  // Not real security (anyone can turn it off via Review > Restrict Editing
  // > Stop Protection, one click, no prompt) — it's a deterrent against a
  // casual edit/delete of the watermark shape, not a lock a determined
  // recipient can't remove. settings.xml is guaranteed to exist by this
  // point (just-created above, or it already did).
  const settingsEntry = zip.getEntry("word/settings.xml")!;
  const settingsXml = settingsEntry.getData().toString("utf-8");
  if (!settingsXml.includes("<w:documentProtection")) {
    // Must search from the <w:settings root tag specifically, not just the
    // first ">" in the file — that would match the "?>" closing the XML
    // declaration instead, landing the tag outside the root element entirely.
    const rootTagStart = settingsXml.indexOf("<w:settings");
    if (rootTagStart === -1) throw new Error("docx: word/settings.xml has no <w:settings> root element");
    const rootCloseIdx = settingsXml.indexOf(">", rootTagStart) + 1;
    const isSelfClosing = settingsXml.slice(0, rootCloseIdx).endsWith("/>");
    const protectionTag = `<w:documentProtection w:edit="readOnly" w:enforcement="1"/>`;
    const patched = isSelfClosing
      ? settingsXml.slice(0, rootCloseIdx - 2) + `>${protectionTag}</w:settings>`
      : settingsXml.slice(0, rootCloseIdx) + protectionTag + settingsXml.slice(rootCloseIdx);
    zip.updateFile(settingsEntry, Buffer.from(patched, "utf-8"));
  }

  const relId = "rIdFFWatermark";
  contentTypeOverrides.push(
    `<Override PartName="/${headerPath}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>`
  );
  documentRelEntries.push(
    `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header-ff-watermark.xml"/>`
  );

  const contentTypesPath = "[Content_Types].xml";
  const contentTypesXml = readEntryText(zip, contentTypesPath);
  const ctIdx = contentTypesXml.lastIndexOf("</Types>");
  if (ctIdx === -1) throw new Error("docx: [Content_Types].xml has no </Types>");
  zip.updateFile(
    zip.getEntry(contentTypesPath)!,
    Buffer.from(contentTypesXml.slice(0, ctIdx) + contentTypeOverrides.join("") + contentTypesXml.slice(ctIdx), "utf-8")
  );

  addRelationship(zip, "word/_rels/document.xml.rels", documentRelEntries.join(""));

  const docPath = "word/document.xml";
  let docXml = readEntryText(zip, docPath);
  // r:id on the headerReference below needs the relationships namespace in
  // scope on the root — present on every real Word-produced document, but
  // guard it for a hand-built one that omits it.
  const rootTag = docXml.match(/<w:document\b[^>]*>/)?.[0];
  if (rootTag && !/\bxmlns:r=/.test(rootTag)) {
    docXml = docXml.replace(
      "<w:document ",
      '<w:document xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
    );
  }
  const headerRefTag = `<w:headerReference w:type="default" r:id="${relId}"/>`;

  // Pass 1: redirect any EXISTING default headerReference to point at ours
  // instead — if every section already had one, this alone finishes the job.
  let redirectedCount = 0;
  docXml = docXml.replace(/<w:headerReference w:type="default"[^/]*\/>/g, () => {
    redirectedCount++;
    return headerRefTag;
  });

  // Pass 2: only for sections that had none — insert one as the first child
  // of each sectPr. Single regex covers both the self-closing form
  // (<w:sectPr .../>, no other section properties set) and the open form
  // (<w:sectPr ...>...</w:sectPr>), branching on whether the captured
  // attributes end in "/", so there's no risk of a self-closing sectPr with
  // attributes getting matched twice by two separate passes.
  let sectionCount = redirectedCount;
  if (redirectedCount === 0) {
    docXml = docXml.replace(/<w:sectPr\b([^>]*)>/g, (_match, attrsRaw: string) => {
      sectionCount++;
      const selfClosing = attrsRaw.endsWith("/");
      const attrs = selfClosing ? attrsRaw.slice(0, -1) : attrsRaw;
      return selfClosing ? `<w:sectPr${attrs}>${headerRefTag}</w:sectPr>` : `<w:sectPr${attrs}>${headerRefTag}`;
    });
  }

  // A real Word document always has at least one sectPr (it's how page
  // size/margins get defined), but a minimal/hand-built one may not —
  // fall back to adding a bare one, valid on its own with Word's defaults.
  if (sectionCount === 0) {
    const bodyCloseIdx = docXml.lastIndexOf("</w:body>");
    if (bodyCloseIdx === -1) throw new Error("docx: no <w:body> found to attach a section/watermark to");
    docXml = docXml.slice(0, bodyCloseIdx) + `<w:sectPr>${headerRefTag}</w:sectPr>` + docXml.slice(bodyCloseIdx);
  }
  zip.updateFile(zip.getEntry(docPath)!, Buffer.from(docXml, "utf-8"));

  return zip.toBuffer();
}

// ---------------------------------------------------------------------
// XLSX — a floating logo picture anchored over the workbook's active sheet
// (the one Excel opens to first), using the same DrawingML picture markup
// as the PPTX watermark, wired through a dedicated drawing part. Scope
// note: only the active sheet gets the floating watermark (each additional
// sheet would need its own drawing part + relationship pair, which
// multiplies the moving parts and the corruption risk for something most
// viewers never scroll past the first tab to see) — every sheet's data is
// still delivered as normal, this only limits where the visual stamp
// appears. Excel has no reliable equivalent of Word's page-repeating header
// watermark that's visible in Normal view (its header/footer mechanism only
// renders in Print/Page Layout view), so a floating shape is the only
// option that's actually visible the moment the file opens.
// ---------------------------------------------------------------------
export function watermarkXlsx(buffer: Buffer): Buffer {
  const zip = requireZip(buffer, "xlsx");

  const wbPath = "xl/workbook.xml";
  const wbXml = readEntryText(zip, wbPath);
  const activeMatch = wbXml.match(/<workbookView[^>]*\bactiveTab="(\d+)"/);
  const activeIndex = activeMatch ? parseInt(activeMatch[1], 10) : 0;

  const relsPath = "xl/_rels/workbook.xml.rels";
  const relsXml = readEntryText(zip, relsPath);
  const sheetNodes = [...wbXml.matchAll(/<sheet\b[^>]*\br:id="([^"]+)"[^>]*\/>/g)];
  if (sheetNodes.length === 0) throw new Error("xlsx: no sheets found in workbook.xml");
  const targetRId = sheetNodes[Math.min(activeIndex, sheetNodes.length - 1)][1];
  const relMatch = relsXml.match(new RegExp(`<Relationship[^>]*\\bId="${targetRId}"[^>]*\\bTarget="([^"]+)"`));
  if (!relMatch) throw new Error("xlsx: could not resolve the active sheet's file from workbook rels");
  const sheetPath = `xl/${relMatch[1].replace(/^\.?\/*/, "")}`;

  const mediaPath = "xl/media/ff-watermark-logo.png";
  if (!zip.getEntry(mediaPath)) zip.addFile(mediaPath, getLogoBytes());
  ensurePngContentType(zip);

  const imgRelId = "rIdFFWatermarkLogoImage";
  const side = 3200400; // ~3.5in square, EMU

  // The DrawingML picture itself — identical content whether it lands in a
  // brand-new drawing part or gets merged into an existing one. Its image
  // relationship (imgRelId) always lives in the *drawing* part's own rels
  // file, never the sheet's, regardless of which drawing part ends up
  // holding it.
  const shapeXml =
    `<xdr:absoluteAnchor>` +
    `<xdr:pos x="0" y="0"/><xdr:ext cx="${side}" cy="${side}"/>` +
    `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="999002" name="FF Watermark"/><xdr:cNvPicPr/></xdr:nvPicPr>` +
    `<xdr:blipFill><a:blip r:embed="${imgRelId}"><a:alphaModFix amt="28000"/></a:blip><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
    `<xdr:spPr><a:xfrm rot="2700000"><a:off x="0" y="0"/><a:ext cx="${side}" cy="${side}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>` +
    `<xdr:clientData/></xdr:absoluteAnchor>`;

  const sheetDir = sheetPath.slice(0, sheetPath.lastIndexOf("/"));
  const sheetFile = sheetPath.slice(sheetPath.lastIndexOf("/") + 1);
  const sheetRelsPath = `${sheetDir}/_rels/${sheetFile}.rels`;
  let sheetXml = readEntryText(zip, sheetPath);
  const existingDrawingRef = sheetXml.match(/<drawing r:id="([^"]+)"\s*\/>/);

  // Sheet protection, no password — the same "Protect Sheet" default Excel
  // itself writes when you don't set one. Not real security (Review >
  // Unprotect Sheet needs no password) — a deterrent against a casual
  // edit/delete of the watermark picture or the data, not a lock a
  // determined recipient can't remove. objects="1" is what actually stops
  // the watermark picture itself from being selected and deleted; sheet="1"
  // extends that to the cell data. Written back immediately (both branches
  // below either continue building on this sheetXml or, for the
  // merge-into-existing-drawing path, never otherwise touch the sheet part
  // at all) rather than only in one of the two branches.
  if (!sheetXml.includes("<sheetProtection")) {
    const sheetDataCloseTag = sheetXml.includes("</sheetData>") ? "</sheetData>" : null;
    const protectionTag = `<sheetProtection sheet="1" objects="1" scenarios="1"/>`;
    if (sheetDataCloseTag) {
      const idx = sheetXml.indexOf(sheetDataCloseTag) + sheetDataCloseTag.length;
      sheetXml = sheetXml.slice(0, idx) + protectionTag + sheetXml.slice(idx);
    } else {
      // Self-closing <sheetData/> (a genuinely empty sheet) — same insertion
      // point, just accounting for the different tag shape.
      sheetXml = sheetXml.replace(/<sheetData\s*\/>/, `<sheetData/>${protectionTag}`);
    }
    zip.updateFile(zip.getEntry(sheetPath)!, Buffer.from(sheetXml, "utf-8"));
  }

  /** Resolves a relationship Target string (relative to `fromDir`) to its
   * absolute zip entry path. */
  function resolveRelTarget(fromDir: string, target: string): string {
    const stack: string[] = [];
    for (const part of `${fromDir}/${target}`.split("/")) {
      if (part === "..") stack.pop();
      else if (part !== ".") stack.push(part);
    }
    return stack.join("/");
  }

  if (existingDrawingRef) {
    // The sheet already has a drawing (chart, image, whatever) — Excel only
    // allows one <drawing> child per worksheet, so the watermark has to be
    // merged into that same part rather than adding a second one.
    const sheetRelsXml = readEntryText(zip, sheetRelsPath);
    const drawingRelMatch = sheetRelsXml.match(
      new RegExp(`<Relationship[^>]*\\bId="${existingDrawingRef[1]}"[^>]*\\bTarget="([^"]+)"`)
    );
    if (!drawingRelMatch) throw new Error(`xlsx: ${sheetRelsPath} has no relationship for ${existingDrawingRef[1]}`);
    const existingDrawingPath = resolveRelTarget(sheetDir, drawingRelMatch[1]);
    const drawingDir = existingDrawingPath.slice(0, existingDrawingPath.lastIndexOf("/"));
    const drawingFile = existingDrawingPath.slice(existingDrawingPath.lastIndexOf("/") + 1);
    const drawingRelsPath = `${drawingDir}/_rels/${drawingFile}.rels`;

    // The image relationship belongs to the drawing part that ends up
    // holding the shape, not the sheet — add it there, relative to that
    // drawing's own directory (xl/drawings/ -> ../media/...).
    const drawingMediaRelative = path.posix.relative(drawingDir, mediaPath);
    addRelationship(
      zip,
      drawingRelsPath,
      `<Relationship Id="${imgRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${drawingMediaRelative}"/>`
    );

    const existingDrawingXml = readEntryText(zip, existingDrawingPath);
    // The root can be a proper open/close pair (<xdr:wsDr ...>...</xdr:wsDr>,
    // shapes already present) or self-closing (<xdr:wsDr .../> — a drawing
    // part with zero shapes left, e.g. after a chart was deleted in Excel
    // but the empty part stuck around) — captures whatever prefix is
    // actually in use rather than assuming "xdr" specifically.
    const rootOpenMatch = existingDrawingXml.match(/<([\w.]*:?wsDr)\b([^>]*?)(\/?)>/);
    if (!rootOpenMatch) throw new Error(`xlsx: ${existingDrawingPath} has no recognizable <...wsDr> root element`);
    const [fullMatch, tagName, attrs, selfClosing] = rootOpenMatch;
    let patchedDrawingXml: string;
    if (selfClosing) {
      const openIdx = existingDrawingXml.indexOf(fullMatch);
      patchedDrawingXml =
        existingDrawingXml.slice(0, openIdx) +
        `<${tagName}${attrs}>${shapeXml}</${tagName}>` +
        existingDrawingXml.slice(openIdx + fullMatch.length);
    } else {
      const closeTag = `</${tagName}>`;
      const closeIdx = existingDrawingXml.lastIndexOf(closeTag);
      if (closeIdx === -1) throw new Error(`xlsx: ${existingDrawingPath} has no matching ${closeTag}`);
      patchedDrawingXml = existingDrawingXml.slice(0, closeIdx) + shapeXml + existingDrawingXml.slice(closeIdx);
    }
    zip.updateFile(zip.getEntry(existingDrawingPath)!, Buffer.from(patchedDrawingXml, "utf-8"));
  } else {
    const drawingPath = "xl/drawings/drawing-ff-watermark.xml";
    addRelationship(
      zip,
      "xl/drawings/_rels/drawing-ff-watermark.xml.rels",
      `<Relationship Id="${imgRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/ff-watermark-logo.png"/>`
    );

    const drawingXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
      `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ` +
      `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${shapeXml}</xdr:wsDr>`;
    zip.addFile(drawingPath, Buffer.from(drawingXml, "utf-8"));

    const contentTypesPath = "[Content_Types].xml";
    const contentTypesXml = readEntryText(zip, contentTypesPath);
    const drawingOverride = `<Override PartName="/${drawingPath}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`;
    const ctIdx = contentTypesXml.lastIndexOf("</Types>");
    if (ctIdx === -1) throw new Error("xlsx: [Content_Types].xml has no </Types>");
    zip.updateFile(
      zip.getEntry(contentTypesPath)!,
      Buffer.from(contentTypesXml.slice(0, ctIdx) + drawingOverride + contentTypesXml.slice(ctIdx), "utf-8")
    );

    const drawingRelId = "rIdFFWatermarkDrawing";
    addRelationship(
      zip,
      sheetRelsPath,
      `<Relationship Id="${drawingRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing-ff-watermark.xml"/>`
    );

    const drawingRefTag = `<drawing r:id="${drawingRelId}"/>`;
    const closeIdx = sheetXml.lastIndexOf("</worksheet>");
    if (closeIdx === -1) throw new Error(`xlsx: ${sheetPath} has no </worksheet>`);
    // <drawing> must come after every other optional worksheet child in
    // document order (ECMA-376 §18.3.1.99) — appending immediately before
    // </worksheet> is always schema-valid regardless of what's already present.
    let patchedSheetXml = sheetXml.slice(0, closeIdx) + drawingRefTag + sheetXml.slice(closeIdx);
    // The sheet part needs the spreadsheetml relationships namespace in scope
    // for r:id to resolve — already present on every real worksheet root via
    // xmlns:r, but guard it in case a hand-built/edge-case file omits it.
    // Must search from the <worksheet root tag specifically (via its start
    // index), not just the first ">" in the file — that would match the
    // "?>" closing the XML declaration instead, always missing a genuinely
    // present xmlns:r and risking a duplicate attribute when patched in.
    const worksheetTagStart = patchedSheetXml.indexOf("<worksheet");
    const worksheetTagEnd = patchedSheetXml.indexOf(">", worksheetTagStart) + 1;
    if (!/xmlns:r=/.test(patchedSheetXml.slice(worksheetTagStart, worksheetTagEnd))) {
      patchedSheetXml = patchedSheetXml.replace(
        "<worksheet ",
        '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
      );
    }
    zip.updateFile(zip.getEntry(sheetPath)!, Buffer.from(patchedSheetXml, "utf-8"));
  }

  return zip.toBuffer();
}

export function addWatermark(buffer: Buffer, filename: string, docType: string): Buffer {
  const ext = filename.toLowerCase().split(".").pop();
  if (docType === "ppt" || ext === "ppt" || ext === "pptx") return watermarkPptx(buffer);
  if (docType === "doc" || ext === "doc" || ext === "docx") return watermarkDocx(buffer);
  if (docType === "excel" || ext === "xls" || ext === "xlsx") return watermarkXlsx(buffer);
  throw new Error(`No watermarking implemented for docType "${docType}" (${filename})`);
}
