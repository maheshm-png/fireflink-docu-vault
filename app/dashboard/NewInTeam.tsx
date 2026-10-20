"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";
import { useNewDocuments } from "@/components/NewDocumentsProvider";

// "New in <team>": the open team's newly published documents you haven't
// opened yet (Home > My teams). Team documents only ever show here, never in
// the Everyone ticker (lib/newDocuments.ts).
export default function NewInTeam({ teamName }: { teamName: string }) {
  const { recentDocs } = useNewDocuments();
  if (recentDocs.length === 0) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-ff border border-ff-accent/30 bg-ff-accent/5 px-3 py-2 text-sm">
      <span className="flex items-center gap-1 font-medium text-ff-accent">
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
        New in {teamName}:
      </span>
      {recentDocs.map((d, i) => (
        <span key={d.id}>
          <Link href={`/dashboard/documents/${d.id}`} className="text-ff-text hover:underline">
            {d.title}
          </Link>
          {i < recentDocs.length - 1 && <span className="text-ff-textMuted">,</span>}
        </span>
      ))}
    </div>
  );
}
