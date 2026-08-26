"use client";

import { useState } from "react";
import { diffLines } from "diff";

type VersionText = { versionNumber: number; extractedText: string };

export default function VersionDiff({
  documentId,
  versions,
}: {
  documentId: string;
  versions: VersionText[];
}) {
  const [fromV, setFromV] = useState(versions[versions.length - 1].versionNumber);
  const [toV, setToV] = useState(versions[0].versionNumber);

  const from = versions.find((v) => v.versionNumber === fromV)?.extractedText ?? "";
  const to = versions.find((v) => v.versionNumber === toV)?.extractedText ?? "";
  const parts = diffLines(from, to);

  const hasContent = versions.some((v) => v.extractedText.trim().length > 0);

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-base font-bold text-ff-text">Compare Versions</h2>
      <div className="mb-3 flex items-center gap-3 text-sm">
        <label className="flex items-center gap-1">
          From
          <select
            value={fromV}
            onChange={(e) => setFromV(parseInt(e.target.value, 10))}
            className="rounded-ff border border-ff-border px-2 py-1"
          >
            {versions.map((v) => (
              <option key={v.versionNumber} value={v.versionNumber}>v{v.versionNumber}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          To
          <select
            value={toV}
            onChange={(e) => setToV(parseInt(e.target.value, 10))}
            className="rounded-ff border border-ff-border px-2 py-1"
          >
            {versions.map((v) => (
              <option key={v.versionNumber} value={v.versionNumber}>v{v.versionNumber}</option>
            ))}
          </select>
        </label>
      </div>

      {!hasContent ? (
        <p className="text-sm text-ff-textMuted">
          No extracted text available to diff for this file type yet (video/image files aren&apos;t text-diffable).
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-medium text-ff-textMuted">v{fromV}</div>
            <pre className="max-h-96 overflow-auto rounded-ff border border-ff-border bg-white p-4 text-xs shadow-ff">
              {parts
                .filter((part) => !part.added)
                .map((part, i) => (
                  <span
                    key={i}
                    className={part.removed ? "block bg-ff-danger/10 text-ff-danger line-through" : "block text-ff-textMuted"}
                  >
                    {part.value}
                  </span>
                ))}
            </pre>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-ff-textMuted">v{toV}</div>
            <pre className="max-h-96 overflow-auto rounded-ff border border-ff-border bg-white p-4 text-xs shadow-ff">
              {parts
                .filter((part) => !part.removed)
                .map((part, i) => (
                  <span
                    key={i}
                    className={part.added ? "block bg-ff-success/10 text-ff-success" : "block text-ff-textMuted"}
                  >
                    {part.value}
                  </span>
                ))}
            </pre>
          </div>
        </div>
      )}
    </section>
  );
}
