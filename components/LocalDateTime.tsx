"use client";

import { useEffect, useState } from "react";
import { formatDate, formatDateTime } from "@/lib/formatDate";

/**
 * Server components render with the container's timezone (UTC in
 * production), not the viewer's — `toLocaleString` inside a server
 * component silently produces the wrong wall-clock time for anyone not in
 * UTC. These render blank on the server/first paint and fill in via
 * useEffect, which runs in the browser and picks up its real timezone.
 * A brief blank-to-filled flash on load is the trade-off, instead of a
 * wrong-to-right flash (or a hydration mismatch) from formatting eagerly.
 */
export function LocalDate({ value }: { value: string | Date }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => setText(formatDate(value)), [value]);
  return <>{text ?? "—"}</>;
}

export function LocalDateTime({ value }: { value: string | Date }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => setText(formatDateTime(value)), [value]);
  return <>{text ?? "—"}</>;
}
