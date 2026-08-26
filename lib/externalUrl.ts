/**
 * Normalizes a shared Google Docs/Sheets/Slides URL (the "/edit" link
 * someone would naturally paste) into its embeddable "/preview" form, so it
 * renders inline in an <iframe> instead of redirecting to the editor.
 * Any other URL is returned unchanged and just iframed as-is.
 */
export function toEmbeddableUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "docs.google.com") return url;
    // e.g. /document/d/<id>/edit, /spreadsheets/d/<id>/edit, /presentation/d/<id>/edit
    if (/\/(document|spreadsheets|presentation)\/d\/[^/]+\//.test(parsed.pathname)) {
      return url.replace(/\/(edit|view)([?#].*)?$/, "/preview");
    }
    return url;
  } catch {
    return url;
  }
}
