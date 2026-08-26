import "dotenv/config";
/**
 * One-off/rerunnable: converts every existing DocumentVersion that's
 * missing a LibreOffice PDF preview (previewPdfPath null) — versions
 * uploaded before LibreOffice was installed/configured, or where the
 * conversion failed at upload time, never get a retroactive conversion any
 * other way, since scripts/../app/api/documents/route.ts only converts at
 * upload/new-version time.
 *
 * Run: npm run backfill:preview
 * Requires LIBREOFFICE_PATH (or soffice on PATH) and MinIO reachable.
 */
import { prisma } from "../lib/prisma";
import { getFileBuffer, uploadFile } from "../lib/storage";
import { convertToPdf, isConvertible } from "../lib/officeConvert";

async function main() {
  const versions = await prisma.documentVersion.findMany({
    where: { previewPdfPath: null },
    select: { id: true, documentId: true, originalFilename: true, filePath: true, versionNumber: true },
  });

  const targets = versions.filter((v) => isConvertible(v.originalFilename));
  console.log(`Found ${targets.length} version(s) missing a PDF preview.`);

  for (const v of targets) {
    process.stdout.write(`Converting ${v.originalFilename} (doc ${v.documentId} v${v.versionNumber})... `);
    try {
      const buffer = await getFileBuffer(v.filePath);
      const pdf = await convertToPdf(buffer, v.originalFilename);
      if (!pdf) {
        console.log("skipped — conversion failed (invalid/unsupported file, or LibreOffice unavailable; see stderr above)");
        continue;
      }
      const previewPdfPath = `${v.filePath}.preview.pdf`;
      await uploadFile(previewPdfPath, pdf, "application/pdf");
      await prisma.documentVersion.update({ where: { id: v.id }, data: { previewPdfPath } });
      console.log("done");
    } catch (err: any) {
      console.log(`failed: ${err.message ?? err}`);
    }
  }
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
