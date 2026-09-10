import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";

/**
 * Parses a .pptx into a positioned slide structure — text (run-level bold/
 * italic/underline/size/color, paragraph alignment, bullets) and images with
 * their on-slide coordinates — so the browser can render an actual
 * (approximate) visual preview instead of a flat text dump. Zero new
 * dependencies: PPTX is a zip of XML, same as the existing text extractor in
 * lib/extract.ts already assumes, just reading shape/run formatting too
 * instead of only text content. Everything is parsed here, server-side, from
 * our own storage — nothing is ever sent to a third-party viewer.
 *
 * This is a best-effort renderer, not a PowerPoint engine: animations,
 * transitions, gradients, theme-color references (only literal a:srgbClr is
 * read — a:schemeClr is skipped, so theme-colored text/fills fall back to
 * the default look rather than guessing at the theme), tables, charts, and
 * SmartArt are not reproduced. Shapes without explicit position/size
 * (inherited from a slide layout/master rather than set on the slide
 * itself) are skipped rather than guessed at.
 */

export type TextRun = {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  sizePt?: number;
  color?: string;
};

export type TextParagraph = {
  runs: TextRun[];
  bullet: boolean;
  align?: "l" | "ctr" | "r" | "just";
};

export type SlideShape =
  | { type: "text"; x: number; y: number; w: number; h: number; paragraphs: TextParagraph[]; fill?: string }
  | { type: "image"; x: number; y: number; w: number; h: number; dataUrl: string };

export type SlideDeck = {
  width: number;
  height: number;
  slides: { shapes: SlideShape[] }[];
};

const DEFAULT_WIDTH_EMU = 12192000; // 16:9 widescreen, 13.333in
const DEFAULT_HEIGHT_EMU = 6858000;

// Two parser instances, deliberately different modes:
//  - attrParser: the default (groups same-tag siblings together) — fine for
//    presentation.xml/rels, where we only ever look up one specific tag.
//  - orderedParser: preserveOrder:true keeps sibling elements of DIFFERENT
//    tag names in their original document order. This matters specifically
//    for the slide body: PPTX paints shapes in document order (a shape
//    drawn later covers one drawn earlier), and the default parse mode
//    groups every <p:sp> together and every <p:pic> together, silently
//    losing that interleaving — which was rendering images on top of text
//    regardless of which was actually drawn first in the original slide.
const attrParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text" });
const orderedParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", preserveOrder: true });

type PONode = Record<string, any>;

export function extractPptxSlides(buffer: Buffer): SlideDeck {
  const zip = new AdmZip(buffer);

  let width = DEFAULT_WIDTH_EMU;
  let height = DEFAULT_HEIGHT_EMU;
  const presEntry = zip.getEntry("ppt/presentation.xml");
  if (presEntry) {
    const presXml = attrParser.parse(presEntry.getData().toString("utf-8"));
    const sldSz = presXml?.["p:presentation"]?.["p:sldSz"];
    if (sldSz) {
      width = parseInt(sldSz["@_cx"], 10) || width;
      height = parseInt(sldSz["@_cy"], 10) || height;
    }
  }

  const slideEntries = zip
    .getEntries()
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
    .sort((a, b) => {
      const numA = parseInt(a.entryName.match(/\d+/)?.[0] ?? "0", 10);
      const numB = parseInt(b.entryName.match(/\d+/)?.[0] ?? "0", 10);
      return numA - numB;
    });

  const slides = slideEntries.map((entry) => {
    const slideNum = entry.entryName.match(/slide(\d+)\.xml$/)?.[1];
    const relMap = new Map<string, string>();
    const relsEntry = zip.getEntry(`ppt/slides/_rels/slide${slideNum}.xml.rels`);
    if (relsEntry) {
      const relsXml = attrParser.parse(relsEntry.getData().toString("utf-8"));
      const rels = normalizeArray(relsXml?.Relationships?.Relationship);
      for (const r of rels) relMap.set(r["@_Id"], r["@_Target"]);
    }

    const shapes: SlideShape[] = [];
    const ordered: PONode[] = orderedParser.parse(entry.getData().toString("utf-8"));
    const sld = firstTagValue(ordered, "p:sld");
    const cSld = sld ? firstTagValue(sld, "p:cSld") : undefined;
    const spTree = cSld ? firstTagValue(cSld, "p:spTree") : undefined;
    if (spTree) collectShapes(spTree, shapes, relMap, zip, IDENTITY_TRANSFORM);
    return { shapes };
  });

  return { width, height, slides };
}

/** Children of a specific tag from a preserveOrder-mode node array, e.g.
 * given [{"a:off": [...], ":@": {...}}, {"a:ext": [...]}] and tag "a:off",
 * returns that first entry's own children array. */
function firstTagValue(nodes: PONode[], tag: string): PONode[] | undefined {
  const found = nodes.find((n) => tag in n);
  return found ? (found[tag] as PONode[]) : undefined;
}

function nodeAttrs(node: PONode): Record<string, string> {
  return node[":@"] ?? {};
}

// A shape's own <a:xfrm> off/ext is expressed in its IMMEDIATE parent's
// coordinate space — for a top-level shape that parent is the slide itself
// (EMUs, 0..deck.width/height), but for a shape inside a <p:grpSp> it's the
// group's own local child coordinate space (<a:chOff>/<a:chExt> on the
// group's <a:xfrm>), which must be mapped through the group's own
// off/ext/chOff/chExt transform — recursively, for nested groups — to reach
// real slide-absolute coordinates. Skipping this (as an earlier version of
// this file did) is exactly why a grouped diagram (boxes/arrows/labels,
// extremely common for anything drawn as a flowchart) rendered with every
// shape in the wrong place: their raw group-local coordinates were used
// as-is, so the group's own position/scale never got applied.
type Transform = (x: number, y: number, w: number, h: number) => { x: number; y: number; w: number; h: number };

const IDENTITY_TRANSFORM: Transform = (x, y, w, h) => ({ x, y, w, h });

function composeGroupTransform(
  outer: Transform,
  group: { offX: number; offY: number; extW: number; extH: number; chOffX: number; chOffY: number; chExtW: number; chExtH: number }
): Transform {
  const scaleX = group.chExtW ? group.extW / group.chExtW : 1;
  const scaleY = group.chExtH ? group.extH / group.chExtH : 1;
  return (x, y, w, h) =>
    outer(
      group.offX + (x - group.chOffX) * scaleX,
      group.offY + (y - group.chOffY) * scaleY,
      w * scaleX,
      h * scaleY
    );
}

function collectShapes(nodes: PONode[], shapes: SlideShape[], relMap: Map<string, string>, zip: AdmZip, transform: Transform) {
  for (const node of nodes) {
    if ("p:sp" in node) {
      const children = node["p:sp"] as PONode[];
      const spPr = firstTagValue(children, "p:spPr");
      const local = readXfrm(spPr ? firstTagValue(spPr, "a:xfrm") : undefined);
      if (local.w === 0 || local.h === 0) continue; // no explicit position — inherited from layout, skip rather than guess
      const { x, y, w, h } = transform(local.x, local.y, local.w, local.h);
      const txBody = firstTagValue(children, "p:txBody");
      const paragraphs = txBody ? collectParagraphs(txBody) : [];
      const hasText = paragraphs.some((p) => p.runs.some((r) => r.text.trim()));
      if (!hasText) continue;
      const fill = extractSolidFill(spPr);
      shapes.push({ type: "text", x, y, w, h, paragraphs, fill });
    } else if ("p:pic" in node) {
      const children = node["p:pic"] as PONode[];
      const spPr = firstTagValue(children, "p:spPr");
      const local = readXfrm(spPr ? firstTagValue(spPr, "a:xfrm") : undefined);
      if (local.w === 0 || local.h === 0) continue;
      const { x, y, w, h } = transform(local.x, local.y, local.w, local.h);
      const blipFill = firstTagValue(children, "p:blipFill");
      const blipNode = blipFill?.find((n) => "a:blip" in n);
      const embedId = blipNode ? nodeAttrs(blipNode)["@_r:embed"] : undefined;
      const target = embedId ? relMap.get(embedId) : undefined;
      if (!target) continue;
      const mediaPath = resolveMediaPath(target);
      const mediaEntry = zip.getEntry(mediaPath);
      if (!mediaEntry) continue;
      const ext = mediaPath.split(".").pop()?.toLowerCase();
      const mime = ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : ext === "svg" ? "image/svg+xml" : "image/jpeg";
      const dataUrl = `data:${mime};base64,${mediaEntry.getData().toString("base64")}`;
      shapes.push({ type: "image", x, y, w, h, dataUrl });
    } else if ("p:grpSp" in node) {
      const children = node["p:grpSp"] as PONode[];
      const grpSpPr = firstTagValue(children, "p:grpSpPr");
      const groupXfrm = grpSpPr ? firstTagValue(grpSpPr, "a:xfrm") : undefined;
      const group = readGroupXfrm(groupXfrm);
      // A group with a degenerate child-space (chExt 0 on either axis, or no
      // xfrm at all) can't be transformed meaningfully — skip its contents
      // rather than plot them at a nonsensical scale.
      if (!group) continue;
      const nestedTransform = composeGroupTransform(transform, group);
      collectShapes(children, shapes, relMap, zip, nestedTransform);
    }
  }
}

function readXfrm(xfrm?: PONode[]) {
  if (!xfrm) return { x: 0, y: 0, w: 0, h: 0 };
  const offNode = xfrm.find((n) => "a:off" in n);
  const extNode = xfrm.find((n) => "a:ext" in n);
  const offAttrs = offNode ? nodeAttrs(offNode) : {};
  const extAttrs = extNode ? nodeAttrs(extNode) : {};
  return {
    x: parseInt(offAttrs["@_x"], 10) || 0,
    y: parseInt(offAttrs["@_y"], 10) || 0,
    w: parseInt(extAttrs["@_cx"], 10) || 0,
    h: parseInt(extAttrs["@_cy"], 10) || 0,
  };
}

/** Reads a group shape's own <a:xfrm> — off/ext (its position/size in the
 * PARENT coordinate space) AND chOff/chExt (the coordinate space its
 * children's own xfrm values are expressed in) — returning null when
 * either is missing/degenerate, since there's then no sound way to place
 * its children. */
function readGroupXfrm(xfrm?: PONode[]) {
  if (!xfrm) return null;
  const offNode = xfrm.find((n) => "a:off" in n);
  const extNode = xfrm.find((n) => "a:ext" in n);
  const chOffNode = xfrm.find((n) => "a:chOff" in n);
  const chExtNode = xfrm.find((n) => "a:chExt" in n);
  if (!offNode || !extNode || !chOffNode || !chExtNode) return null;
  const offAttrs = nodeAttrs(offNode);
  const extAttrs = nodeAttrs(extNode);
  const chOffAttrs = nodeAttrs(chOffNode);
  const chExtAttrs = nodeAttrs(chExtNode);
  const extW = parseInt(extAttrs["@_cx"], 10) || 0;
  const extH = parseInt(extAttrs["@_cy"], 10) || 0;
  if (extW === 0 || extH === 0) return null;
  return {
    offX: parseInt(offAttrs["@_x"], 10) || 0,
    offY: parseInt(offAttrs["@_y"], 10) || 0,
    extW,
    extH,
    chOffX: parseInt(chOffAttrs["@_x"], 10) || 0,
    chOffY: parseInt(chOffAttrs["@_y"], 10) || 0,
    chExtW: parseInt(chExtAttrs["@_cx"], 10) || 0,
    chExtH: parseInt(chExtAttrs["@_cy"], 10) || 0,
  };
}

/** Reads a literal RGB fill color (a:solidFill > a:srgbClr) from a spPr or
 * rPr's children. Theme-referenced colors (a:schemeClr) are deliberately
 * skipped rather than resolved — that needs the theme XML too, and a wrong
 * guess reads worse than falling back to the default text/shape color. */
function extractSolidFill(children?: PONode[]): string | undefined {
  if (!children) return undefined;
  const fillNode = children.find((n) => "a:solidFill" in n);
  if (!fillNode) return undefined;
  const fillChildren = fillNode["a:solidFill"] as PONode[];
  const srgb = fillChildren.find((n) => "a:srgbClr" in n);
  if (!srgb) return undefined;
  const val = nodeAttrs(srgb)["@_val"];
  return val ? `#${val}` : undefined;
}

const VALID_ALIGN = new Set(["l", "ctr", "r", "just"]);

function collectParagraphs(txBody: PONode[]): TextParagraph[] {
  const paragraphs = txBody.filter((n) => "a:p" in n);
  return paragraphs.map((p) => {
    const pChildren = p["a:p"] as PONode[];
    const runs = pChildren.filter((n) => "a:r" in n).map((r) => parseRun(r["a:r"] as PONode[]));

    const pPrNode = pChildren.find((n) => "a:pPr" in n);
    let bullet = false;
    let align: TextParagraph["align"];
    if (pPrNode) {
      const pPrChildren = pPrNode["a:pPr"] as PONode[];
      const explicitlyNoBullet = pPrChildren.some((n) => "a:buNone" in n);
      bullet = !explicitlyNoBullet && pPrChildren.some((n) => "a:buChar" in n || "a:buAutoNum" in n);
      const algn = nodeAttrs(pPrNode)["@_algn"];
      if (algn && VALID_ALIGN.has(algn)) align = algn as TextParagraph["align"];
    }

    return { runs, bullet, align };
  });
}

function parseRun(rChildren: PONode[]): TextRun {
  const tNode = rChildren.find((n) => "a:t" in n);
  const tChildren = tNode ? (tNode["a:t"] as PONode[] | undefined) : undefined;
  const textNode = tChildren?.find((n) => "#text" in n);
  const text = textNode ? String(textNode["#text"]) : "";

  const rPrNode = rChildren.find((n) => "a:rPr" in n);
  if (!rPrNode) return { text, bold: false, italic: false, underline: false };

  const attrs = nodeAttrs(rPrNode);
  const bold = attrs["@_b"] === "1";
  const italic = attrs["@_i"] === "1";
  const underline = attrs["@_u"] !== undefined && attrs["@_u"] !== "none";
  const sizePt = attrs["@_sz"] ? parseInt(attrs["@_sz"], 10) / 100 : undefined;
  const color = extractSolidFill(rPrNode["a:rPr"] as PONode[]);

  return { text, bold, italic, underline, sizePt, color };
}

function normalizeArray(v: any): any[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Resolves a slide-relative relationship target (e.g. "../media/image1.png",
 * relative to ppt/slides/) to its absolute zip entry path. */
function resolveMediaPath(target: string): string {
  const stack: string[] = [];
  for (const part of `ppt/slides/${target}`.split("/")) {
    if (part === "..") stack.pop();
    else if (part !== ".") stack.push(part);
  }
  return stack.join("/");
}
