import { ChevronDown } from "lucide-react";
import DocumentTable, { type DocRow, EmptyDocuments } from "./DocumentTable";
import DocumentGrid from "./DocumentGrid";

// Groups the published-documents browse view by category ("domain") into
// collapsible sections instead of one flat, undifferentiated list — the
// categories themselves are the only real grouping concept the data model
// has (there's no sub-category/hierarchy), so this is the honest reading of
// "organize by domain, tree-structure or sub-sections."
export default function DocumentSections({
  groups,
  view,
  hasFilters,
}: {
  groups: { id: string; name: string; rows: DocRow[] }[];
  view: "list" | "grid";
  hasFilters: boolean;
}) {
  const nonEmpty = groups.filter((g) => g.rows.length > 0);

  if (nonEmpty.length === 0) {
    return <EmptyDocuments hasFilters={hasFilters} />;
  }

  return (
    <div className="flex flex-col gap-4">
      {nonEmpty.map((g) => (
        <details
          key={g.id}
          open
          className="group overflow-hidden rounded-ff border border-ff-border bg-white/60 shadow-ff open:shadow-ff-md"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 select-none">
            <span className="flex items-center gap-2 text-base font-bold text-ff-text">
              {g.name}
              <span className="rounded-full bg-ff-lavender px-2 py-0.5 text-xs font-normal text-ff-textMuted">
                {g.rows.length}
              </span>
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-ff-textMuted transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="px-4 pb-4">
            {view === "grid" ? <DocumentGrid rows={g.rows} /> : <DocumentTable rows={g.rows} />}
          </div>
        </details>
      ))}
    </div>
  );
}
