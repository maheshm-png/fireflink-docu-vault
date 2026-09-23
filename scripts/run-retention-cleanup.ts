import "dotenv/config";
/**
 * Daily scheduled job (cron on the Oracle VM, or Supabase Edge Function on a
 * schedule, same as scripts/run-staleness-check.ts) that enforces two
 * retention rules:
 *
 *   1. A soft-deleted document (see DELETE /api/documents/:id) is
 *      permanently purged — storage files and DB rows — once it's been
 *      deleted for longer than AppSettings.deletedDocRetentionDays without
 *      being restored.
 *   2. A superseded file version (uploaded more than
 *      AppSettings.oldVersionRetentionDays ago and not the document's
 *      current version) is permanently removed to bound storage growth. The
 *      current version is never touched, no matter its age, and a document
 *      flagged "permanent" (neverExpires) is exempt entirely — so a document
 *      is always retrievable.
 *
 * Both windows are editable at /admin/settings. Run: npm run retention:run
 */

import { prisma } from "../lib/prisma";
import { deleteFile } from "../lib/storage";
import { notifyManagerRetentionAlert } from "../lib/notify";
import { getAppSettings } from "../lib/settings";
import { computeRoundAttempts } from "../lib/versionRounds";

async function purgeExpiredDeletedDocuments(retentionDays: number) {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const docs = await prisma.document.findMany({
    where: { deletedAt: { lte: cutoff } },
    include: { versions: true },
  });

  const purged: { title: string }[] = [];

  for (const doc of docs) {
    for (const version of doc.versions) {
      const keys = [version.filePath, version.previewPdfPath].filter((k): k is string => Boolean(k));
      for (const key of keys) {
        try {
          await deleteFile(key);
        } catch (err) {
          // Best-effort: an orphaned storage object is harmless and invisible;
          // leaving the DB row behind because one blob failed to delete would
          // be worse, so we log and continue rather than aborting the purge.
          console.error(`Failed to delete storage object ${key}:`, err);
        }
      }
    }

    // Children first (all FKs to Document are RESTRICT, not CASCADE), parent
    // last, one transaction — same shape as the original hard-delete route.
    // inlineComment must come before reviewRequest — InlineComment also has
    // a RESTRICT FK into ReviewRequest, so any left over would block that
    // delete too, not just the final document.delete.
    await prisma.$transaction([
      prisma.document.update({ where: { id: doc.id }, data: { currentVersionId: null } }),
      prisma.documentEvent.deleteMany({ where: { documentId: doc.id } }),
      prisma.stalenessFlag.deleteMany({ where: { documentId: doc.id } }),
      prisma.inlineComment.deleteMany({ where: { documentId: doc.id } }),
      prisma.documentFeedback.deleteMany({ where: { documentId: doc.id } }),
      prisma.shareLink.deleteMany({ where: { documentId: doc.id } }),
      prisma.reviewRequest.deleteMany({ where: { documentId: doc.id } }),
      prisma.documentVersion.deleteMany({ where: { documentId: doc.id } }),
      prisma.document.delete({ where: { id: doc.id } }),
    ]);

    purged.push({ title: doc.title });
  }

  return purged;
}

async function purgeOldSupersededVersions(retentionDays: number) {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const versions = await prisma.documentVersion.findMany({
    // isCurrentFor is the back-relation of Document.currentVersion — null
    // means this version isn't any document's current one, so it's safe to
    // remove without ever making a document unretrievable. Documents flagged
    // neverExpires ("permanent", no re-review needed) are exempt entirely —
    // even a superseded version of one is kept indefinitely.
    where: { uploadedAt: { lte: cutoff }, isCurrentFor: null, document: { neverExpires: false } },
    include: { document: true },
  });

  const purged: { documentTitle: string; versionLabel: string }[] = [];

  for (const version of versions) {
    // Computed before deleting the row below — needs this document's full
    // version/round history as it stands right now, since once this row is
    // gone it can no longer contribute to that computation for anything
    // purged after it in this same run.
    const [labelVersions, labelReviewRequests] = await Promise.all([
      prisma.documentVersion.findMany({
        where: { documentId: version.documentId },
        select: { id: true, versionNumber: true, uploadedAt: true },
      }),
      prisma.reviewRequest.findMany({
        where: { documentId: version.documentId },
        select: { roundNumber: true, status: true, comments: true, createdAt: true },
      }),
    ]);
    const versionLabel =
      computeRoundAttempts(labelVersions, labelReviewRequests, version.document.revokedAt).byVersionId.get(version.id)?.label ??
      `v${version.versionNumber}`;

    const keys = [version.filePath, version.previewPdfPath].filter((k): k is string => Boolean(k));
    for (const key of keys) {
      try {
        await deleteFile(key);
      } catch (err) {
        console.error(`Failed to delete storage object ${key}:`, err);
      }
    }
    await prisma.documentVersion.delete({ where: { id: version.id } });
    purged.push({ documentTitle: version.document.title, versionLabel });
  }

  return purged;
}

async function main() {
  const settings = await getAppSettings();
  const purgedDocs = await purgeExpiredDeletedDocuments(settings.deletedDocRetentionDays);
  const purgedVersions = await purgeOldSupersededVersions(settings.oldVersionRetentionDays);

  await notifyManagerRetentionAlert({ purgedDeletedDocs: purgedDocs, purgedVersions });

  console.log(
    `Retention cleanup complete: ${purgedDocs.length} deleted document(s) purged, ${purgedVersions.length} old version(s) purged.`
  );
}

main().finally(() => prisma.$disconnect());
