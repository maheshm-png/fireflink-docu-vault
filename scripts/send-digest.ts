import "dotenv/config";
/**
 * Run weekly (cron) to nudge people toward the two things this app is
 * meant to prevent: reviews sitting unresolved, and docs quietly going stale.
 *
 * Run: npm run digest:send
 */
import { notifyWeeklyDigest } from "../lib/notify";
import { prisma } from "../lib/prisma";
import "dotenv/config";

async function main() {
  const users = await prisma.user.findMany({ where: { isActive: true } });

  for (const user of users) {
    const pendingReviews = await prisma.reviewRequest.findMany({
      where: { reviewerId: user.id, status: "pending" },
      include: { document: true },
    });

    const staleDocs = await prisma.stalenessFlag.findMany({
      where: { resolved: false, document: { ownerId: user.id } },
      include: { document: true },
    });

    await notifyWeeklyDigest({
      toName: user.name,
      pendingReviews: pendingReviews.map((r) => ({
        title: r.document.title,
        documentId: r.document.id,
      })),
      staleDocs: staleDocs.map((f) => ({
        title: f.document.title,
        documentId: f.document.id,
        reason: f.reason,
      })),
    });
  }

  console.log(`Digest sent to ${users.length} users.`);
}

main().finally(() => prisma.$disconnect());

