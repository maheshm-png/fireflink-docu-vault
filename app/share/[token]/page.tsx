import { prisma } from "@/lib/prisma";
import Logo from "@/components/Logo";
import DocTypeIcon, { DOC_TYPE_LABEL } from "@/components/DocTypeIcon";
import PptxSlideViewer from "@/components/PptxSlideViewer";
import FullscreenPreviewFrame from "@/components/FullscreenPreviewFrame";
import PdfPageViewer from "@/components/PdfPageViewer";
import ViewOnlyWatermark from "@/components/ViewOnlyWatermark";
import ShareLinkWatcher from "@/components/ShareLinkWatcher";
import PlumWatermark from "@/components/PlumWatermark";

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
  const accessLabel = canDownload ? "View & Download" : "View Only";
  // See components/ViewOnlyWatermark.tsx's own comment for what this is
  // and isn't — not a screenshot block (no such thing exists for a web
  // page), a traceability marker baked into the rendered pixels. Only for
  // view-only shares: view_download already hands out the clean original
  // file via Download, so watermarking just the ephemeral preview would be
  // security theater once the same content is downloadable anyway.
  const watermarkNode = !canDownload ? (
    <ViewOnlyWatermark
      lines={["CONFIDENTIAL", document.title, new Date().toLocaleString()]}
    />
  ) : undefined;

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
    <div className="min-h-screen bg-gradient-to-b from-ff-lavender/50 via-[#FBF8FA] to-[#FBF8FA]">
      <ShareLinkWatcher
        token={params.token}
        initialAccessLevel={share.accessLevel}
        initialExpiresAt={share.expiresAt ? share.expiresAt.toISOString() : null}
      />
      {/* Same bg-ff-plum-gradient the app's own signed-in Navbar.tsx (and
          the login page) use — tailwind.config.ts's own token, now
          lightened there too, so this page and the rest of the app match. */}
      <header className="relative flex items-center justify-center overflow-hidden bg-ff-plum-gradient px-6 py-4 shadow-ff-lg">
        <PlumWatermark className="absolute -top-8 right-8 z-0 w-20" />
        <Logo variant="white" width={140} height={34} priority className="relative z-10" />
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10">
        <div className="relative mb-6 overflow-hidden rounded-ff border border-ff-border bg-white p-5 shadow-[0_16px_40px_-16px_rgba(58,29,66,0.28)] sm:p-6">
          {/* The full ff-plum-gradient token dips to near-black (#241026)
              at its dark end — fine across a full-height bar, but a 4px
              strip is too short to show anything BUT that end, so it just
              reads as a flat black line. Dropping that stop and keeping
              only the light-to-mid range stays visibly "plum" at this
              height. */}
          <div className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(120deg,#7C3B74_0%,#4A2350_100%)]" />
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3.5">
              {/* A raised, gradient-filled badge instead of a flat tinted
                  square — gives the doc-type icon actual presence as the
                  page's first focal point rather than reading as a muted
                  label icon. Same ff-plum-gradient as the header/footer/
                  strips, so the icon and the frame it sits in read as one
                  consistent set of chrome rather than two different brand
                  colors competing on the same page. */}
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-ff bg-ff-plum-gradient text-white shadow-[0_6px_16px_-4px_rgba(58,29,66,0.55)]">
                <DocTypeIcon docType={document.docType} className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h1 className="text-xl font-bold leading-snug text-ff-text sm:text-2xl">{document.title}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-ff-lavender px-2.5 py-0.5 text-xs font-medium text-ff-textMuted">
                    {document.category.name}
                  </span>
                  <span className="rounded-full bg-ff-lavender px-2.5 py-0.5 text-xs font-medium text-ff-textMuted">
                    {DOC_TYPE_LABEL[document.docType] ?? document.docType}
                  </span>
                  {!document.externalUrl && (
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        canDownload ? "bg-ff-success/15 text-ff-success" : "bg-ff-accent/10 text-ff-accent"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${canDownload ? "bg-ff-success" : "bg-ff-accent"}`} />
                      {accessLabel}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-xs text-ff-textMuted">Shared by {document.uploadedBy.name}</p>
              </div>
            </div>
            {document.externalUrl ? (
              <a
                href={document.externalUrl}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 rounded-ff bg-ff-plum-gradient px-4 py-2 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgba(58,29,66,0.55)] transition-all hover:shadow-[0_10px_24px_-6px_rgba(58,29,66,0.65)] hover:brightness-110"
              >
                Open Link
              </a>
            ) : (
              canDownload && (
                <a
                  href={`/api/share/${params.token}/download`}
                  className="shrink-0 rounded-ff bg-ff-plum-gradient px-4 py-2 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgba(58,29,66,0.55)] transition-all hover:shadow-[0_10px_24px_-6px_rgba(58,29,66,0.65)] hover:brightness-110"
                >
                  Download
                </a>
              )
            )}
          </div>
        </div>

        {!document.externalUrl && (
          <div className="overflow-hidden rounded-ff border border-ff-border bg-white shadow-[0_20px_50px_-20px_rgba(41,16,45,0.35)]">
            {/* The accent strip a document's preview frame opens with —
                ties the frame back to the same brand gradient as the header
                seam and info card's top edge, rather than a plain border.
                Same light-to-mid-only gradient as that strip above (see its
                own comment) rather than the full token, for the same
                reason: too thin to show anything past the dark end. */}
            <div className="h-1.5 w-full bg-[linear-gradient(120deg,#7C3B74_0%,#4A2350_100%)]" />
            {previewUrl ? (
              document.docType === "video" && previewFormat === "original" ? (
                <FullscreenPreviewFrame watermark={watermarkNode}>
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
              ) : canDownload ? (
                // view_download already hands out the clean original file
                // via the Download button above, so there's nothing left to
                // protect in the inline preview — the browser's own native
                // PDF viewer (full zoom/search/print chrome) is the better
                // reading experience, and #zoom=page-fit just fits it to
                // the frame on load/resize (paired with remountOnToggle,
                // which forces a fresh load so that re-fit actually reruns
                // when the frame resizes on a fullscreen toggle).
                <FullscreenPreviewFrame remountOnToggle watermark={watermarkNode}>
                  <iframe src={`${previewUrl}#zoom=page-fit`} title={document.title} className="h-full w-full" />
                </FullscreenPreviewFrame>
              ) : (
                // view-only: rendered page-by-page onto a <canvas> (via
                // pdf.js) instead of embedding the real PDF in an iframe —
                // a canvas render has no text layer at all, so there's
                // nothing for Ctrl+A/copy to select, unlike the native
                // viewer above whose text is fully real and copyable.
                // disableInteraction also blocks right-click ("Save image
                // as...") and drag-to-save on the rendered page. None of
                // this is real DRM — see components/ViewOnlyWatermark.tsx's
                // own comment — a determined viewer can still reach the
                // bytes via devtools or a screen recording; this closes the
                // casual copy/save paths, not every path.
                <PdfPageViewer
                  documentId={document.id}
                  fetchUrl={previewUrl}
                  allowFullscreen
                  watermark={watermarkNode}
                  disableInteraction
                />
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
                watermark={watermarkNode}
                disableInteraction={!canDownload}
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

      <footer className="mt-6 bg-ff-plum-gradient py-2 text-center">
        <p className="text-[11px] text-white/80">
          Shared securely via <span className="font-semibold text-white">FireFlink Docu Vault</span>
        </p>
      </footer>
    </div>
  );
}
