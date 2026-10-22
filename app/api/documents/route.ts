import { NextRequest, NextResponse } from "next/server";
import { Prisma, DocType } from "@prisma/client";
import { getCurrentUser } from "@/lib/supabase";
import { can } from "@/lib/rbac";
import { buildStorageKey, uploadFile } from "@/lib/storage";
import { isVideoFile, processVideoVersion } from "@/lib/videoText";
import { extractText } from "@/lib/extract";
import { convertToPdf, isConvertible } from "@/lib/officeConvert";
import { logAudit } from "@/lib/audit";
import { notifyManagerReviewNeeded, notifyDocumentPublished, fireNotification } from "@/lib/notify";
import { validateMetadataAgainstSchema, type CategoryFormField } from "@/lib/formSchema";
import { validateFileMatchesDocType } from "@/lib/fileTypeValidation";
import { DUPLICATE_REASON } from "@/lib/duplicates";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { ensureTeamCategory } from "@/lib/teamCategory";
import {
  canBypassReviewFor,
  canUploadSomething,
  documentAccessWhere,
  eligibleReviewerWhere,
  usersWhoCanSeeWhere,
  validateTeamSelection,
  canSeeTeam,
} from "@/lib/access";
import { indexDocument } from "@/lib/search";

// GET /api/documents — list (mainly used for admin/manager views;
// the public dashboard reads from Meilisearch instead for speed).
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Same visibility rule as GET /api/documents/:id: everyone sees published
  // docs; uploader/owner/an assigned reviewer (any round) also see their own
  // non-published ones; superadmin sees everything (org-wide oversight,
  // same as viewDeleted/the audit log). A manager with no assignment on a
  // given document does NOT see it here just by role — same narrower rule
  // as app/dashboard/documents/[id]/page.tsx's canSeeUnpublishedDoc, so this
  // listing can't be used to see a pending document that opening it
  // directly wouldn't allow either. Soft-deleted docs are excluded outright
  // (see viewDeleted/restore for the manager-only recovery path). User
  // relations are select-limited so this never leaks passwordHash or other
  // internal fields.
  const canSeeAll = user.role === "superadmin";
  const userSelect = { id: true, name: true, email: true, role: true } as const;

  const docs = await prisma.document.findMany({
    where: {
      AND: [documentAccessWhere(user)],
      deletedAt: null,
      ...(canSeeAll
        ? {}
        : {
            OR: [
              { status: "published" as const },
              { uploadedById: user.id },
              { ownerId: user.id },
              { reviewRequests: { some: { reviewerId: user.id } } },
            ],
          }),
    },
    include: {
      category: true,
      currentVersion: true,
      owner: { select: userSelect },
      uploadedBy: { select: userSelect },
    },
    orderBy: { updatedAt: "desc" },
  });
  // currentVersion.fileSize is a Prisma BigInt — NextResponse.json() can't
  // JSON-stringify it directly, so convert it to a string first.
  return NextResponse.json(
    docs.map((d) => ({
      ...d,
      currentVersion: d.currentVersion
        ? { ...d.currentVersion, fileSize: d.currentVersion.fileSize.toString() }
        : null,
    }))
  );
}

// POST /api/documents — upload a new document (lands as pending_review).
// Expects multipart/form-data: file, title, categoryId, ownerId, tags
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // The org role allows uploading, or a team role does (team contributors
  // and managers, whose uploads must then be restricted to their teams,
  // checked below once the form is read).
  if (!canUploadSomething(user)) {
    return NextResponse.json({ error: `Forbidden: role "${user.role}" cannot "upload"` }, { status: 403 });
  }

  const form = await req.formData();
  const file = form.get("file") as File | null;
  // External-link uploads have been removed — every document is a real
  // file now. This blocks it at the API too, not just by removing the
  // "Link External URL" option from the upload form, since this route can
  // be called directly.
  if (form.get("externalUrl")) {
    return NextResponse.json({ error: "Linked (non-file) uploads are no longer supported." }, { status: 400 });
  }
  const title = form.get("title") as string;
  const categoryId = form.get("categoryId") as string;
  const ownerId = form.get("ownerId") as string; // who will review/approve
  const tags = (form.get("tags") as string)?.split(",").map((t) => t.trim()) ?? [];
  const docTypeRaw = (form.get("docType") as string) ?? "other";
  const metadataRaw = form.get("metadata") as string | null;
  const confirmDuplicate = form.get("confirmDuplicate") === "true";
  const confirmedDuplicateOfId = form.get("duplicateOfId") as string | null;
  // Team access control (lib/access.ts): "org" (default, everyone) or
  // "restricted" to the JSON array of team ids in teamIds.
  const visibility = (form.get("visibility") as string) || "org";
  // "No review needed" (opt-in, managers only, never contributors): publishes
  // directly, skipping review. The
  // document is labelled Review Bypassed (Document.reviewBypassed). The three
  // publish-time choices a reviewer would normally make come from the form.
  const bypassReview = form.get("bypassReview") === "true";
  const announceToAll = form.get("announceToAll") === "true";
  const allowFeedback = form.get("allowFeedback") === "true";
  // Team documents never get a public link (lib/access.ts sharingAllowed).
  const shareEnabled = form.get("shareEnabled") === "true" && visibility !== "restricted";
  // Missing means allowed, as before this choice existed.
  const downloadable = form.get("downloadable") !== "false";

  if (visibility !== "org" && visibility !== "restricted") {
    return NextResponse.json({ error: "visibility must be org or restricted." }, { status: 400 });
  }
  if (!(Object.values(DocType) as string[]).includes(docTypeRaw)) {
    return NextResponse.json({ error: "Unknown document type." }, { status: 400 });
  }
  if (visibility === "org" && !can(user.role, "upload")) {
    return NextResponse.json(
      { error: "Your team role lets you upload documents for your teams only. Restrict this one to your teams." },
      { status: 403 }
    );
  }
  let teamIds: string[] = [];
  if (visibility === "restricted") {
    try {
      teamIds = JSON.parse((form.get("teamIds") as string) || "[]");
    } catch {
      return NextResponse.json({ error: "Malformed team selection." }, { status: 400 });
    }
    const teamError = await validateTeamSelection(user, teamIds);
    if (teamError) return NextResponse.json({ error: teamError }, { status: 400 });
    teamIds = [...new Set(teamIds)];
  }
  const accessInfo = { visibility: visibility as "org" | "restricted", teamAccess: teamIds.map((teamId) => ({ teamId })) };

  // Optional folder (Home > My teams) for a document going to exactly one
  // team; it must be one of that team's folders.
  const folderIdRaw = (form.get("folderId") as string | null) || null;
  let folderId: string | null = null;
  if (folderIdRaw) {
    const folder = await prisma.teamFolder.findUnique({ where: { id: folderIdRaw }, select: { teamId: true } });
    // An uploader outside the team doesn't get to browse its folders.
    if (!folder || teamIds.length !== 1 || folder.teamId !== teamIds[0] || !canSeeTeam(user, folder.teamId)) {
      return NextResponse.json({ error: "That folder doesn't belong to the selected team." }, { status: 400 });
    }
    folderId = folderIdRaw;
  }

  if (bypassReview && !canBypassReviewFor(user, accessInfo.visibility, teamIds)) {
    return NextResponse.json(
      {
        error:
          visibility === "restricted"
            ? "Only a manager of every selected team can publish this without review."
            : "Only a manager can publish without review.",
      },
      { status: 403 }
    );
  }

  if (!file || !title || (visibility === "org" && !categoryId) || (!ownerId && !bypassReview)) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  // A manager uploading their own document can't also be its reviewer — the
  // whole point of review is a second set of eyes. The upload form's
  // reviewer dropdown (/api/reviewers) already excludes the caller, but this
  // route can be called directly, so it's the real gate. (A bypassed upload
  // has no reviewer at all, see below.)
  if (!bypassReview && ownerId === user.id) {
    return NextResponse.json(
      { error: "You can't assign yourself as the reviewer for your own upload, choose someone else." },
      { status: 400 }
    );
  }

  // A restricted document may only be reviewed by a manager in one of its
  // teams; anyone else would be handed confidential content.
  if (!bypassReview) {
    const reviewerOk = await prisma.user.count({ where: { AND: [{ id: ownerId }, eligibleReviewerWhere(accessInfo)] } });
    if (!reviewerOk) {
      return NextResponse.json(
        {
          error:
            visibility === "restricted"
              ? "For a restricted document, choose a reviewer who is a manager in one of its teams."
              : "Choose an active manager as the reviewer.",
        },
        { status: 400 }
      );
    }
  }

  // Team documents don't use global categories: they all sit in the built-in
  // team category (lib/teamCategory.ts). Documents for everyone need a real one.
  const category =
    visibility === "restricted"
      ? await prisma.category.findUniqueOrThrow({ where: { id: await ensureTeamCategory(user.id) } })
      : await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category || (visibility === "org" && category.isSystem)) {
    return NextResponse.json({ error: "Choose a category." }, { status: 400 });
  }

  let metadata: Record<string, unknown> = {};
  try {
    metadata = metadataRaw ? JSON.parse(metadataRaw) : {};
  } catch {
    return NextResponse.json({ error: "Malformed metadata" }, { status: 400 });
  }

  // Server-side enforcement of the category's required fields — the
  // upload form enforces this client-side too, but this route can be
  // called directly, so the check has to live here as the real gate.
  const schema = (category.formSchema as unknown as CategoryFormField[]) ?? [];
  const { valid, missing } = validateMetadataAgainstSchema(schema, metadata);
  if (!valid) {
    return NextResponse.json(
      { error: `Missing required field(s) for "${category.name}": ${missing.join(", ")}` },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const checksum = crypto.createHash("sha256").update(buffer).digest("hex");

  const typeError = validateFileMatchesDocType(buffer, file.name, docTypeRaw);
  if (typeError) {
    return NextResponse.json({ error: typeError }, { status: 400 });
  }

  // Duplicate check — before any storage write, so a rejected duplicate
  // never costs a wasted upload. Two independent signals: identical file
  // content (checksum, across any existing version) or an identical title.
  // Either can be force-uploaded past (confirmDuplicate),
  // but the resulting document is tagged with duplicateOfId/duplicateReason
  // so it's visible to everyone, not silently forked content. Re-derived
  // server-side (not trusted from the client) even on a confirmed
  // force-upload, so the stored reason always reflects what was matched.
  const [checksumMatch, titleMatch] = await Promise.all([
    checksum
      ? prisma.documentVersion.findFirst({
          where: { checksum, document: { AND: [{ deletedAt: null }, documentAccessWhere(user)] } },
          include: { document: true },
        })
      : Promise.resolve(null),
    // Only documents this uploader can see: matching against a restricted
    // document of another team would reveal its title in the warning.
    prisma.document.findFirst({
      where: { AND: [{ title: { equals: title, mode: "insensitive" }, deletedAt: null }, documentAccessWhere(user)] },
    }),
  ]);
  const duplicateMatch = checksumMatch?.document ?? titleMatch;
  const duplicateReason = checksumMatch ? DUPLICATE_REASON.content : DUPLICATE_REASON.title;

  if (duplicateMatch && !(confirmDuplicate && confirmedDuplicateOfId === duplicateMatch.id)) {
    return NextResponse.json(
      { duplicate: { documentId: duplicateMatch.id, title: duplicateMatch.title, reason: duplicateReason } },
      { status: 409 }
    );
  }

  const documentId = crypto.randomUUID();
  const storageKey = buildStorageKey(category.name.toLowerCase().replace(/\s+/g, "-"), documentId, file.name);

  // extractText, uploadFile, and the LibreOffice PDF conversion all just
  // read the already-buffered file and don't depend on each other —
  // running them concurrently instead of one after the other cuts upload
  // latency significantly for larger files. Conversion is best-effort: it
  // returns null (never throws) if LibreOffice isn't installed or the
  // file can't be converted, and the preview falls back gracefully then.
  const [extractedText, , pdfBuffer] = await Promise.all([
    extractText(buffer!, file.name),
    uploadFile(storageKey, buffer!, file.type),
    isConvertible(file.name) ? convertToPdf(buffer!, file.name) : Promise.resolve(null),
  ]);

  let previewPdfPath: string | null = null;
  if (pdfBuffer) {
    previewPdfPath = `${storageKey}.preview.pdf`;
    await uploadFile(previewPdfPath, pdfBuffer, "application/pdf");
  }

  const document = await prisma.document.create({
    data: {
      id: documentId,
      title,
      categoryId: category.id,
      docType: docTypeRaw as any,
      status: bypassReview ? "published" : "pending_review",
      tags,
      metadata: metadata as Prisma.InputJsonValue,
      // A bypassed upload has no separate reviewer: the publishing manager
      // owns it (and gets its staleness reminders).
      ownerId: bypassReview ? user.id : ownerId,
      uploadedById: user.id,
      visibility: accessInfo.visibility,
      ...(teamIds.length
        ? { teamAccess: { create: teamIds.map((teamId) => ({ teamId, grantedById: user.id, folderId })) } }
        : {}),
      ...(bypassReview
        ? { reviewBypassed: true, lastReviewedAt: new Date(), feedbackEnabled: allowFeedback, shareEnabled, downloadable }
        : {}),
      // Never permanent by default: a manager can mark it permanent later
      // (Manage tab). A category with no review cycle just never comes due.
      neverExpires: false,
      ...(duplicateMatch ? { duplicateOfId: duplicateMatch.id, duplicateReason } : {}),
      versions: {
        create: {
          versionNumber: 1,
          filePath: storageKey,
          originalFilename: file.name,
          fileSize: BigInt(buffer!.length),
          checksum: checksum!,
          extractedText,
          previewPdfPath,
          uploadedById: user.id,
        },
      },
    },
    include: { versions: true, category: true, owner: true, duplicateOf: true },
  });

  // Videos have no text to extract on upload; they're read in the
  // background instead (lib/videoText.ts) so search and Ask Docu AI can
  // use what's on screen. Never blocks or fails the upload.
  if (isVideoFile(file.name) && document.versions[0]) void processVideoVersion(document.versions[0].id);

  if (bypassReview) {
    return publishBypassedUpload(user, document, announceToAll, teamIds);
  }

  // Deliberately NOT setting currentVersionId here — a fresh upload hasn't
  // been approved yet, so there's nothing yet that should count as "the"
  // live/servable version. Preview for the uploader/reviewer while it's
  // pending falls back to document.versions[0] instead (see
  // app/dashboard/documents/[id]/page.tsx's forReferenceVisible section and
  // ReviewTrailWithHighlights' `document.currentVersion ?? document.versions[0]`).
  // currentVersionId gets set for real the moment this is actually approved
  // (app/api/documents/[id]/review/route.ts), which is also what makes
  // Share/Download available on the document's own page.

  await prisma.reviewRequest.create({
    data: {
      documentId: document.id,
      requestedById: user.id,
      reviewerId: ownerId,
    },
  });

  await logAudit({ userId: user.id, action: "upload", documentId: document.id, documentTitle: title });

  // Deliberately no whole-team notification here — a fresh upload awaiting
  // its first review is routine, pre-publish status (see lib/notify.ts).
  // The assigned reviewer does get a targeted action-item alert, though, on
  // the separate manager-only Chat space.
  fireNotification(
    notifyManagerReviewNeeded({
      documentTitle: document.title,
      documentId: document.id,
      categoryName: document.category.name,
      uploaderName: user.name,
      reviewerId: document.ownerId,
      reviewerName: document.owner.name,
      reviewerEmail: document.owner.email,
      isNewVersion: false,
    })
  );

  // NOTE: this does not yet index into Meilisearch — it's intentionally
  // excluded from search until it's approved and published.

  // Only { id } — the caller (UploadForm) just redirects to the new doc's
  // page. Returning the full Prisma object would also fail to serialize:
  // DocumentVersion.fileSize is a BigInt, which NextResponse.json() can't
  // JSON-stringify.
  return NextResponse.json({ document: { id: document.id } }, { status: 201 });
}

// Finishes a "No review needed" upload: the document row already exists as
// published. Records the bypass as a single, already-approved round-1 review
// by the uploading manager, so every existing "was this version approved"
// check (lib/versionRounds.ts) and the review trail treat it exactly like a
// reviewed publish, with the bypass visible in the trail by name. Then sets
// the live version, indexes it for search and sends the usual publish
// notices (scoped to who can see it).
async function publishBypassedUpload(
  user: { id: string; name: string },
  document: {
    id: string;
    title: string;
    tags: string[];
    docType: string;
    visibility: "org" | "restricted";
    updatedAt: Date;
    versions: { id: string; extractedText: string | null; previewPdfPath: string | null }[];
    category: { name: string };
    duplicateOf: { title: string } | null;
  },
  announceToAll: boolean,
  teamIds: string[]
) {
  const version = document.versions[0];
  await prisma.$transaction([
    prisma.reviewRequest.create({
      data: {
        documentId: document.id,
        requestedById: user.id,
        reviewerId: user.id,
        status: "approved",
        comments: "Review bypassed: published directly by the uploading manager.",
        resolvedAt: new Date(),
      },
    }),
    prisma.document.update({ where: { id: document.id }, data: { currentVersionId: version.id } }),
  ]);

  await indexDocument({
    id: document.id,
    title: document.title,
    tags: document.tags,
    categoryName: document.category.name,
    docType: document.docType,
    status: "published",
    extractedText: version.extractedText ?? "",
    uploadedByName: user.name,
    isStale: false,
    updatedAt: document.updatedAt.toISOString(),
    duplicateOfTitle: document.duplicateOf?.title ?? null,
    hasPreviewPdf: Boolean(version.previewPdfPath),
  });

  await logAudit({ userId: user.id, action: "upload_review_bypassed", documentId: document.id, documentTitle: document.title });

  if (announceToAll) {
    const recipients = await prisma.user.findMany({
      where: {
        AND: [
          { isActive: true, id: { not: user.id } },
          usersWhoCanSeeWhere({ visibility: document.visibility, teamAccess: teamIds.map((teamId) => ({ teamId })) }),
        ],
      },
      select: { id: true, name: true },
    });
    fireNotification(
      notifyDocumentPublished({
        documentTitle: document.title,
        documentId: document.id,
        categoryName: document.category.name,
        uploaderName: user.name,
        recipients,
      })
    );
  }

  return NextResponse.json({ document: { id: document.id } }, { status: 201 });
}
