import { execFile } from "child_process";
import { existsSync } from "fs";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import sharp from "sharp";
import { prisma } from "./prisma";
import { getFileBuffer } from "./storage";
import { describeImage } from "./llm";
import { updateIndexedText } from "./search";

// Videos have no text to extract, so this "reads" them instead: frames are
// sampled across the video with ffmpeg and the vision model transcribes the
// on-screen text (slides, titles, UI labels) and says what's being shown.
// The result becomes the version's extractedText, so search and Ask Docu AI
// can find and answer from videos like any other document. Spoken audio
// isn't covered: the model server has no speech-to-text.

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "m4v", "webm", "mkv", "avi", "wmv", "mpeg", "mpg"]);
const MIN_FRAMES = 4;
const MAX_FRAMES = 24;
const SECONDS_PER_FRAME = 20;

export function isVideoFile(filename: string): boolean {
  return VIDEO_EXTENSIONS.has(filename.toLowerCase().split(".").pop() ?? "");
}

// FFMPEG_PATH, else the ffmpeg-static binary (local development), else
// ffmpeg on the PATH (installed in the Docker image).
function ffmpegPath(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const p = require("ffmpeg-static") as string | null;
    if (p && existsSync(p)) return p;
  } catch {
    // not installed (production image): fall through
  }
  return "ffmpeg";
}

function run(args: string[], timeoutMs = 120_000): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  return new Promise((resolve) => {
    execFile(ffmpegPath(), args, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({ stdout: String(stdout), stderr: String(stderr), ok: !err })
    );
  });
}

async function durationSeconds(file: string): Promise<number> {
  // `ffmpeg -i` exits non-zero without an output file, but prints Duration.
  const { stderr } = await run(["-hide_banner", "-i", file], 30_000);
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

function stamp(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

// A 48x27 grayscale thumbnail: cheap way to spot frames that barely
// changed (the same slide held for a minute) and skip reading them twice.
async function fingerprint(jpeg: Buffer): Promise<Buffer> {
  return sharp(jpeg).resize(48, 27, { fit: "fill" }).grayscale().raw().toBuffer();
}

// Slides differ mostly in their text, which barely moves an average, so
// this counts cells that changed noticeably instead: two different slides
// change a few percent of cells, a held frame (plus compression noise)
// almost none.
function nearlySame(a: Buffer, b: Buffer): boolean {
  let changed = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 30) changed++;
  return changed / a.length < 0.005;
}

/** Reads a video into timestamped text. Empty string if it can't be read. */
export async function extractVideoText(buffer: Buffer, filename: string, title: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "docu-video-"));
  try {
    const input = path.join(dir, `input.${filename.split(".").pop() || "mp4"}`);
    await writeFile(input, buffer);
    const duration = await durationSeconds(input);
    if (!duration) {
      console.error(`Video text: couldn't read the duration of ${filename} (is ffmpeg installed?)`);
      return "";
    }

    const count = Math.min(MAX_FRAMES, Math.max(MIN_FRAMES, Math.round(duration / SECONDS_PER_FRAME)));
    const times = Array.from({ length: count }, (_, i) => ((i + 0.5) * duration) / count);

    const sections: string[] = [];
    let previous: Buffer | null = null;
    for (const t of times) {
      const out = path.join(dir, `frame-${Math.round(t * 1000)}.jpg`);
      // -ss before -i: fast seek. 1024px wide is enough for the model to read slide text.
      const res = await run(["-hide_banner", "-loglevel", "error", "-ss", t.toFixed(2), "-i", input, "-frames:v", "1", "-vf", "scale='min(1024,iw)':-2", "-q:v", "4", "-y", out]);
      if (!res.ok || !existsSync(out)) continue;
      const jpeg = await readFile(out);

      const print = await fingerprint(jpeg).catch(() => null);
      if (print && previous && nearlySame(print, previous)) continue;
      previous = print;

      const read = await describeImage(
        jpeg,
        `This is a frame at ${stamp(t)} from a company video titled "${title}". First transcribe all readable on-screen text (slide titles, bullet points, labels, names, numbers, UI text) exactly as written. Then, in one sentence, say what is being shown or demonstrated. Plain text, no preamble. If the frame is blank or unreadable, reply with just: (nothing readable)`
      );
      const text = read?.text.trim();
      if (text && !/^\(nothing readable\)$/i.test(text)) sections.push(`[${stamp(t)}] ${text}`);
    }

    if (!sections.length) return "";
    return [`Video "${title}" (${stamp(duration)} long). On-screen content by timestamp:`, ...sections].join("\n\n");
  } catch (err) {
    console.error(`Video text extraction failed for ${filename}:`, err);
    return "";
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Reads one stored video version and saves the text onto it; if that version
 * is the published current one, the search index is refreshed too. Safe to
 * run in the background (never throws) and to re-run.
 */
export async function processVideoVersion(versionId: string): Promise<boolean> {
  try {
    const version = await prisma.documentVersion.findUnique({
      where: { id: versionId },
      select: {
        id: true,
        filePath: true,
        originalFilename: true,
        document: { select: { id: true, title: true, status: true, currentVersionId: true } },
      },
    });
    if (!version || !isVideoFile(version.originalFilename)) return false;

    const buffer = await getFileBuffer(version.filePath);
    const text = await extractVideoText(buffer, version.originalFilename, version.document.title);
    if (!text) return false;

    await prisma.documentVersion.update({ where: { id: version.id }, data: { extractedText: text } });
    if (version.document.status === "published" && version.document.currentVersionId === version.id) {
      await updateIndexedText(version.document.id, text);
    }
    return true;
  } catch (err) {
    console.error(`Video processing failed for version ${versionId}:`, err);
    return false;
  }
}
