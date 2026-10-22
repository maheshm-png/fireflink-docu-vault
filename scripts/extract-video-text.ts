import "dotenv/config";
/**
 * Rerunnable: reads every video version that has no extracted text yet
 * (lib/videoText.ts samples frames and has the vision model read them), so
 * videos uploaded before this existed become searchable and answerable by
 * Ask Docu AI. New uploads are processed automatically in the background.
 *
 * Only current versions of non-deleted documents are processed. Pass --all
 * to re-read videos that already have text (e.g. after improving the prompt).
 *
 * Run: npm run video:extract [-- --all]
 */
import { prisma } from "../lib/prisma";
import { isVideoFile, processVideoVersion } from "../lib/videoText";

(async () => {
  const all = process.argv.includes("--all");
  const docs = await prisma.document.findMany({
    where: { docType: "video", currentVersionId: { not: null }, deletedAt: null },
    select: { title: true, currentVersion: { select: { id: true, originalFilename: true, extractedText: true } } },
  });
  const todo = docs.filter(
    (d) => d.currentVersion && isVideoFile(d.currentVersion.originalFilename) && (all || !d.currentVersion.extractedText?.trim())
  );
  console.log(`${todo.length} video(s) to read (of ${docs.length}).`);

  let ok = 0;
  for (const d of todo) {
    const started = Date.now();
    const done = await processVideoVersion(d.currentVersion!.id);
    console.log(`${done ? "read" : "skipped"}: "${d.title}" (${Math.round((Date.now() - started) / 1000)}s)`);
    if (done) ok++;
  }
  console.log(`Done: ${ok} of ${todo.length} read.`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
