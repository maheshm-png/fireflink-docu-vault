// Shared between the upload route (POST /api/documents) and the edit route
// (PATCH /api/documents/:id) so both recognize the same two reasons and the
// edit route can tell, when a title changes, whether a previously-set
// duplicate flag was about the title (and so may now be resolved) or about
// file content (which a metadata-only edit can never resolve).
export const DUPLICATE_REASON = {
  content: "This file's content matches an existing document.",
  title: "A document with this title already exists.",
} as const;
