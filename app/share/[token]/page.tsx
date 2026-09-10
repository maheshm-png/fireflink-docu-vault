import { prisma } from "@/lib/prisma";
import Logo from "@/components/Logo";
import DocTypeIcon, { DOC_TYPE_LABEL } from "@/components/DocTypeIcon";
import PptxSlideViewer from "@/components/PptxSlideViewer";
import FullscreenPreviewFrame from "@/components/FullscreenPreviewFrame";

// Public, unauthenticated page for an "anyone with the link" share
// (components/ShareModal.tsx creates the link, app/api/documents/[id]/
// share/route.ts manages it). Deliberately outside /dashboard so
// middleware.ts's auth gate (which only matches /dashboard and /admin)
// never touches this route — no middleware change needed for that.
export default async function SharePage({ params }: { params: { token: string } }) {
  const share = await prisma.shareLink.findUnique({
    where: { token: params.token },
    include: {
      document: {
        include: { category: true, uploadedBy: true, currentVersion: true },
      },
    },
  });

  const unavailable =
    !share || (share.expiresAt !== null && share.expiresAt.getTime() < Date.now()) || share.document.deletedAt;

  if (unavailable) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#FBF8FA] px-6 text-center">
        <Logo width={140} height={34} priority />
        <h1 className="mt-8 text-xl font-bold text-ff-text">This link isn&apos;t available</h1>
        <p className="mt-2 max-w-sm text-sm text-ff-textMuted">
          It may have expired, been turned off, or the document it pointed to is no longer available. Ask
          whoever shared it with you for a new link.
        </p>
      </div>
    );
  }

  const { document } = share;
  const canDownload = share.accessLevel === "view_download";
  const version = document.currentVersion;

  // What can actually be shown inline: a converted PDF (any doc type that
  // has one), or the original itself when it's already natively viewable
  // in a browser (PDF, video). Everything else (raw .pptx/.docx/.xlsx with
  // no conversion available) has nothing to embed — download-or-nothing.
  const previewFormat: "pdf" | "original" | null = version?.previewPdfPath
    ? "pdf"
    : document.docType === "pdf" || document.docType === "video"
    ? "original"
    : null;
  const previewUrl = previewFormat ? `/api/share/${params.token}/view?format=${previewFormat}` : null;

  return (
    <div className="min-h-screen bg-[#FBF8FA]">
      <header className="border-b border-ff-border bg-white px-6 py-4">
        <Logo width={130} height={32} priority />
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-ff border border-ff-border bg-white p-4 shadow-ff">
          <div className="flex min-w-0 items-center gap-2">
            <DocTypeIcon docType={document.docType} className="h-5 w-5 shrink-0 text-ff-textMuted" />
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold text-ff-text">{document.title}</h1>
              <p className="text-xs text-ff-textMuted">
                {document.category.name} · {DOC_TYPE_LABEL[document.docType] ?? document.docType} · Shared by{" "}
                {document.uploadedBy.name}
              </p>
            </div>
          </div>
          {document.externalUrl ? (
            <a
              href={document.externalUrl}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 rounded-ff bg-ff-accent-gradient px-4 py-2 text-sm font-medium text-white shadow-ff transition-all hover:shadow-ff-md hover:brightness-105"
            >
              Open Link
            </a>
          ) : (
            canDownload && (
              <a
                href={`/api/share/${params.token}/download`}
                className="shrink-0 rounded-ff bg-ff-accent-gradient px-4 py-2 text-sm font-medium text-white shadow-ff transition-all hover:shadow-ff-md hover:brightness-105"
              >
                Download
              </a>
            )
          )}
        </div>

        {!document.externalUrl && (
          <div className="overflow-hidden rounded-ff border border-ff-border bg-white shadow-ff">
            {previewUrl ? (
              document.docType === "video" && previewFormat === "original" ? (
                <FullscreenPreviewFrame>
                  <video
                    src={previewUrl}
                    controls
                    // "nodownload" removes the download option from the native
                    // player's own controls menu — a Chrome/Edge-only hint,
                    // not a real access restriction (see the iframe comment
                    // below for the same caveat). Still shown for
                    // view_download shares, where downloading is the point.
                    controlsList={canDownload ? undefined : "nodownload"}
                    // object-contain instead of stretching to fill — the
                    // wrapper's box (80vh normally, the full viewport in
                    // fullscreen) rarely matches the video's own aspect
                    // ratio exactly, so this preserves it and letterboxes
                    // instead of distorting the picture.
                    className="h-full w-full bg-black object-contain"
                  />
                </FullscreenPreviewFrame>
              ) : (
                // #toolbar=0 hides the browser's own built-in PDF viewer
                // chrome (Chrome/Edge respect this) — which otherwise has
                // its own download button completely outside our access
                // control, since the browser renders the actual PDF bytes
                // itself once the iframe loads them. This hides the
                // obvious one-click download path for a view-only share;
                // it isn't real DRM (a technical user can still get the
                // bytes another way, e.g. the network tab) — genuinely
                // uncopyable viewing would mean rendering pages as images
                // server-side instead of serving the real PDF at all, a
                // much larger feature than was asked for here.
                <FullscreenPreviewFrame remountOnToggle>
                  <iframe
                    // zoom=page-fit (the PDF Open Parameters spec, honored
                    // by Chrome/Edge/Firefox's built-in viewers) makes each
                    // fresh load fit the whole page to the current frame
                    // size — paired with remountOnToggle above, this is
                    // what re-fits the view after the frame resizes
                    // (entering/exiting fullscreen), since the built-in
                    // viewer otherwise keeps whatever zoom it already had.
                    src={canDownload ? `${previewUrl}#zoom=page-fit` : `${previewUrl}#toolbar=0&zoom=page-fit`}
                    title={document.title}
                    className="h-full w-full"
                  />
                </FullscreenPreviewFrame>
              )
            ) : document.docType === "ppt" ? (
              // No LibreOffice-converted PDF exists for this version (see
              // lib/officeConvert.ts — conversion can fail or be unavailable)
              // — this approximate renderer is a fallback for that case
              // only, never the first choice, since it can't reproduce the
              // original design (see components/PptxSlideViewer.tsx's own
              // caption).
              <PptxSlideViewer
                documentId={document.id}
                fetchUrl={`/api/share/${params.token}/pptx-preview`}
                allowFullscreen
              />
            ) : (
              <div className="flex h-64 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-ff-textMuted">
                <p>Preview isn&apos;t available for this file type.</p>
                {canDownload && <p>Use the Download button above to view it.</p>}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
