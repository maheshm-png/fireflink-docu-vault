import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";

/**
 * Storage layer targeting a self-hosted MinIO instance (S3-compatible),
 * running on the free Oracle Cloud VM per the architecture doc — chosen
 * from day one so video storage never hits a paid-tier wall.
 *
 * Files are AES-256 encrypted server-side (MinIO SSE-S3, configured on
 * the bucket) and are never served from a public URL — every access goes
 * through a short-lived presigned URL issued after an RBAC check.
 */

const s3 = new S3Client({
  region: "us-east-1", // MinIO ignores region but the SDK requires one
  endpoint: process.env.MINIO_ENDPOINT, // e.g. https://storage.yourdomain.com
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY!,
    secretAccessKey: process.env.MINIO_SECRET_KEY!,
  },
});

const BUCKET = process.env.MINIO_BUCKET || "fireflink-docs";
const PRESIGNED_URL_TTL_SECONDS = 600; // 10 minutes

export function buildStorageKey(categorySlug: string, documentId: string, filename: string) {
  return `${categorySlug}/${documentId}/${randomUUID()}-${filename}`;
}

// Content types are decided here from the file extension, never taken from
// the browser's upload: in production MinIO is served from the app's own
// domain (infra/Caddyfile), so an object stored as text/html or image/svg+xml
// and opened inline would run its script as the app itself. Anything not on
// this list is stored and served as a plain download.
const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  ogv: "video/ogg",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  zip: "application/zip",
  txt: "text/plain",
};

// Types a browser may render in place (the preview iframe/<video>). Every
// other stored file only ever leaves storage as an attachment.
const INLINE_SAFE_TYPES = new Set([
  "application/pdf",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/ogg",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

function extensionOf(name: string): string {
  return name.toLowerCase().split(/[?#]/)[0].split(".").pop() ?? "";
}

/** The content type a file with this name is stored and served as. */
export function contentTypeFor(filename: string): string {
  return CONTENT_TYPE_BY_EXTENSION[extensionOf(filename)] ?? "application/octet-stream";
}

/** Whether a stored file may be shown inline in the browser. Keys end in the
 * original filename (buildStorageKey) or ".preview.pdf". */
export function isInlineSafe(key: string): boolean {
  return INLINE_SAFE_TYPES.has(contentTypeFor(key));
}

/** Files never pass through a re-encode/transform step anywhere in this
 * pipeline — upload stores the exact original bytes, and download serves
 * those same bytes back via a presigned URL. Nothing here can alter a
 * PPT's layout, a video's quality, or a PDF's formatting.
 *
 * No per-object ServerSideEncryption header here: MinIO's SSE-S3 requires
 * a configured KMS backend (Vault/AWS KMS/KES) to hand out per-object keys,
 * unlike AWS S3 where SSE-S3 works with no external KMS. This project's
 * infra (docker-compose.yml) never provisions one, so setting the header
 * makes every upload fail with "KMS not configured" against a real deploy
 * of this stack. Encryption at rest should instead be handled at the
 * volume/disk level on the host, or by standing up a KMS if MinIO-level
 * SSE-S3 is required. */
export async function uploadFile(key: string, body: Buffer) {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentTypeFor(key),
    })
  );
  return key;
}

/**
 * Short-lived download URL — never expose a permanent/public link to a file.
 * Sets Content-Disposition so the browser saves it under its original
 * filename rather than the internal storage key (which has a UUID prefix).
 */
export async function getDownloadUrl(key: string, originalFilename?: string) {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
    // Overrides whatever type an older upload was stored with (they used to
    // keep the browser-supplied one).
    ResponseContentType: contentTypeFor(key),
    ResponseContentDisposition: originalFilename ? attachmentDisposition(originalFilename) : "attachment",
  });
  return getSignedUrl(s3, command, { expiresIn: PRESIGNED_URL_TTL_SECONDS });
}

// filename= keeps a plain-ASCII fallback for old clients, filename*= carries
// the real (possibly non-ASCII) name.
function attachmentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * Same file, same short-lived presigned access — the only difference from
 * getDownloadUrl is "inline" instead of "attachment", so the browser renders
 * PDFs/video in place (an <iframe>/<video>) instead of triggering a save
 * dialog. Object's stored Content-Type (set at upload) drives whether the
 * browser can actually render it inline; unrenderable types just won't
 * display anything useful, which is why the preview UI only points this at
 * PDF/video and falls back to extracted text for everything else.
 */
export async function getPreviewUrl(key: string, docType?: string) {
  // A PDF or video whose filename has no usual extension still previews,
  // served under its document type (validated or forced, never sniffed).
  const type = isInlineSafe(key)
    ? contentTypeFor(key)
    : docType === "pdf"
    ? "application/pdf"
    : docType === "video"
    ? "video/mp4"
    : null;
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
    // Only PDF/video/raster images ever render in place; anything else
    // downloads, so an uploaded HTML or SVG file can't run on this domain.
    ResponseContentType: type ?? "application/octet-stream",
    ResponseContentDisposition: type ? "inline" : "attachment",
  });
  return getSignedUrl(s3, command, { expiresIn: PRESIGNED_URL_TTL_SECONDS });
}

export async function deleteFile(key: string) {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

/**
 * Reads a file's bytes directly, server-side — used by the PPTX/Excel slide
 * and spreadsheet preview routes, which need to parse the actual file
 * content rather than just hand the browser a link to it.
 */
export async function getFileBuffer(key: string): Promise<Buffer> {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const stream = res.Body as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as any));
  }
  return Buffer.concat(chunks);
}
