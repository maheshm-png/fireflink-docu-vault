import { execFile } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";

const execFileAsync = promisify(execFile);

function findSofficeBinary(): string {
  if (process.env.LIBREOFFICE_PATH) return process.env.LIBREOFFICE_PATH;
  if (process.platform === "win32") return "C:\\Program Files\\LibreOffice\\program\\soffice.exe";
  return "soffice"; // relies on PATH on Linux/macOS
}

/**
 * Converts a PPT/Excel file to PDF via a self-hosted, headless LibreOffice
 * process — the file never leaves this server, unlike an embedded
 * Office/Google viewer. The resulting PDF then renders through the existing
 * accurate PDF preview (see DocumentPreview.tsx) instead of an approximation.
 *
 * Returns null — never throws — on any failure (LibreOffice not installed,
 * conversion timeout, unsupported content), so upload never blocks on this;
 * the preview just falls back to the lighter-weight renderer.
 */
export async function convertToPdf(buffer: Buffer, originalFilename: string): Promise<Buffer | null> {
  const soffice = findSofficeBinary();
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "ff-convert-"));
  const ext = originalFilename.split(".").pop() || "bin";
  const inputPath = path.join(workDir, `input-${randomUUID()}.${ext}`);

  try {
    await fs.writeFile(inputPath, buffer);
    await execFileAsync(soffice, ["--headless", "--convert-to", "pdf", "--outdir", workDir, inputPath], {
      timeout: 60_000,
    });
    const outputPath = inputPath.slice(0, -(ext.length + 1)) + ".pdf";
    return await fs.readFile(outputPath);
  } catch (err) {
    console.error(`LibreOffice conversion failed for ${originalFilename}:`, err);
    return null;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

const CONVERTIBLE_EXTENSIONS = new Set(["ppt", "pptx", "xls", "xlsx", "csv", "doc", "docx"]);

export function isConvertible(filename: string): boolean {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return CONVERTIBLE_EXTENSIONS.has(ext);
}
