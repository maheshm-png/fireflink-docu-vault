"use client";

import { useEffect, useState } from "react";
import BrandedLoader from "./BrandedLoader";

type SpreadsheetSheet = { name: string; rows: string[][]; truncated: boolean };
type SpreadsheetPreview = { sheets: SpreadsheetSheet[] };

export default function SpreadsheetViewer({ documentId, version }: { documentId: string; version?: number }) {
  const [data, setData] = useState<SpreadsheetPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeSheet, setActiveSheet] = useState(0);

  useEffect(() => {
    const url = `/api/documents/${documentId}/spreadsheet-preview${version ? `?version=${version}` : ""}`;
    setData(null);
    setError(null);
    setActiveSheet(0);
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then(setData)
      .catch(() => setError("Could not render this spreadsheet — try downloading it instead."));
  }, [documentId, version]);

  if (error) {
    return <div className="p-10 text-center text-sm text-ff-textMuted">{error}</div>;
  }

  if (!data) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <BrandedLoader size={32} label="Loading spreadsheet..." />
      </div>
    );
  }

  if (data.sheets.length === 0) {
    return <div className="p-10 text-center text-sm text-ff-textMuted">This file has no readable sheets.</div>;
  }

  const sheet = data.sheets[Math.min(activeSheet, data.sheets.length - 1)];

  return (
    <div className="p-4">
      {data.sheets.length > 1 && (
        <div className="mb-3 flex gap-1 overflow-x-auto border-b border-ff-border" aria-label="Sheet tabs">
          {data.sheets.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActiveSheet(i)}
              aria-current={i === activeSheet}
              className={`flex-none whitespace-nowrap border-b-2 px-3 py-1.5 text-xs transition-colors ${
                i === activeSheet
                  ? "border-ff-accent text-ff-accent font-medium"
                  : "border-transparent text-ff-textMuted hover:text-ff-text"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {sheet.rows.length === 0 ? (
        <div className="p-10 text-center text-sm text-ff-textMuted">This sheet has no readable rows.</div>
      ) : (
        <>
          <div className="overflow-auto rounded-ff border border-ff-border">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-ff-lavender text-ff-text">
                <tr>
                  {sheet.rows[0].map((cell, i) => (
                    <th key={i} className="whitespace-nowrap px-3 py-2 font-medium">{cell || " "}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sheet.rows.slice(1).map((row, i) => (
                  <tr key={i} className="border-t border-ff-border">
                    {row.map((cell, j) => (
                      <td key={j} className="whitespace-nowrap px-3 py-1.5 text-ff-text">{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sheet.truncated && (
            <p className="mt-2 text-xs text-ff-textMuted">
              Showing the first 500 rows of {sheet.name} — download the file for the complete data.
            </p>
          )}
        </>
      )}
    </div>
  );
}
