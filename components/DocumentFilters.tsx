"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SlidersHorizontal, X, ChevronDown, Bookmark } from "lucide-react";
import BrandedLoader from "./BrandedLoader";
import AlertModal from "./AlertModal";
import ConfirmModal from "./ConfirmModal";
import { DOC_TYPE_LABEL } from "./DocTypeIcon";
import { CUSTOM_FIELD_PREFIX, isFilterKey, type FilterOptions } from "@/lib/docFilters";

export type SavedFilterChip = { id: string; name: string; params: [string, string][] };

type Pairs = [string, string][];

// Shown straight in the toolbar and applied on pick, no panel needed; the
// panel has these too, alongside everything else.
const QUICK_FILTERS = [
  { key: "docType", label: "Type" },
  { key: "uploader", label: "Uploaded by" },
  { key: "tags", label: "Tags" },
  { key: "owner", label: "Owner" },
];

const sortPairs = (pairs: Pairs) =>
  [...pairs].sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
const samePairs = (a: Pairs, b: Pairs) => JSON.stringify(sortPairs(a)) === JSON.stringify(sortPairs(b));

// Custom filter builder for one listing section (a Published Documents
// category tab, a Review Dashboard status tab, Revoked Documents). Every
// filter is a query-string param (see lib/docFilters.ts), so Apply is just
// navigation, and a saved filter is those same params stored per user per
// section (app/api/saved-filters). keepKeys are the params that pick the
// section itself (category, status, view) and survive every filter change.
export default function DocumentFilters({
  basePath,
  section,
  options,
  saved,
  keepKeys,
}: {
  basePath: string;
  section: string;
  options: FilterOptions;
  saved: SavedFilterChip[];
  keepKeys: string[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const currentPairs: Pairs = [...params.entries()].filter(([k, v]) => isFilterKey(k) && v.trim() !== "");
  const activeCount = new Set(currentPairs.map(([k]) => k.replace(/_(min|max|from|to)$/, ""))).size;

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Pairs>(currentPairs);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<SavedFilterChip | null>(null);
  const [deleting, setDeleting] = useState(false);

  function openPanel() {
    setDraft(currentPairs);
    setSaveName(saved.find((s) => samePairs(s.params, currentPairs))?.name ?? "");
    setOpen(true);
  }

  function navigate(pairs: Pairs) {
    const next = new URLSearchParams();
    for (const key of keepKeys) {
      const v = params.get(key);
      if (v) next.set(key, v);
    }
    for (const [k, v] of pairs) if (v.trim() !== "") next.append(k, v.trim());
    const qs = next.toString();
    router.push(qs ? `${basePath}?${qs}` : basePath);
    router.refresh();
  }

  const getOne = (key: string) => draft.find(([k]) => k === key)?.[1] ?? "";
  const getAll = (key: string) => draft.filter(([k]) => k === key).map(([, v]) => v);
  const setOne = (key: string, value: string) =>
    setDraft((d) => [...d.filter(([k]) => k !== key), ...(value ? ([[key, value]] as Pairs) : [])]);
  const setAll = (key: string, values: string[]) =>
    setDraft((d) => [...d.filter(([k]) => k !== key), ...values.map((v) => [key, v] as [string, string])]);

  function apply() {
    setOpen(false);
    navigate(draft);
  }

  async function save() {
    const pairs = draft.filter(([, v]) => v.trim() !== "");
    if (pairs.length === 0) {
      setError("Set at least one filter before saving.");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/saved-filters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section, name: saveName, params: pairs }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not save this filter, please try again.");
      return;
    }
    setOpen(false);
    navigate(pairs);
  }

  async function removeSaved(filter: SavedFilterChip) {
    setDeleting(true);
    const res = await fetch(`/api/saved-filters/${filter.id}`, { method: "DELETE" });
    setDeleting(false);
    setConfirmDelete(null);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not delete this filter, please try again.");
      return;
    }
    router.refresh();
  }

  function quickOptions(key: string) {
    if (key === "docType") return options.docTypes.map((t) => ({ value: t, label: DOC_TYPE_LABEL[t] ?? t }));
    if (key === "uploader") return options.uploaders.map((u) => ({ value: u, label: u }));
    if (key === "owner") return options.owners.map((u) => ({ value: u, label: u }));
    return options.tags.map((t) => ({ value: t, label: t }));
  }

  const inputClass =
    "w-full rounded-ff border border-ff-border bg-white px-2.5 py-1.5 text-sm text-ff-text focus:border-ff-accent focus:outline-none";

  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => (open ? setOpen(false) : openPanel())}
          aria-expanded={open}
          className={`flex items-center gap-1.5 rounded-ff border px-3 py-2 text-sm transition-colors ${
            activeCount > 0 || open
              ? "border-ff-accent/50 bg-ff-lavender text-ff-accent"
              : "border-ff-border bg-white text-ff-text hover:bg-ff-lavender"
          }`}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden />
          Filters
          {activeCount > 0 && (
            <span className="rounded-full bg-ff-accent-gradient px-1.5 text-xs font-medium text-white">{activeCount}</span>
          )}
        </button>

        {QUICK_FILTERS.map(({ key, label }) => {
          const opts = quickOptions(key);
          if (opts.length === 0) return null;
          return (
            <div key={key} className="w-44">
              <MultiSelect
                label={label}
                options={opts}
                selected={currentPairs.filter(([k]) => k === key).map(([, v]) => v)}
                onChange={(values) =>
                  navigate([...currentPairs.filter(([k]) => k !== key), ...values.map((v) => [key, v] as [string, string])])
                }
              />
            </div>
          );
        })}

        {saved.map((s) => {
          const isActive = currentPairs.length > 0 && samePairs(s.params, currentPairs);
          return (
            <span
              key={s.id}
              className={`inline-flex max-w-[16rem] items-center rounded-full border text-xs transition-colors ${
                isActive ? "border-transparent bg-ff-accent-gradient text-white shadow-ff" : "border-ff-border bg-white text-ff-text"
              }`}
            >
              <button
                type="button"
                onClick={() => navigate(isActive ? [] : s.params)}
                title={isActive ? "Click to clear this filter" : "Apply this filter"}
                className="flex min-w-0 items-center gap-1 py-1 pl-2.5 pr-1"
              >
                <Bookmark className="h-3 w-3 shrink-0" aria-hidden />
                <span className="truncate">{s.name}</span>
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(s)}
                aria-label={`Delete saved filter ${s.name}`}
                className={`mr-1 rounded-full p-0.5 ${isActive ? "hover:bg-white/20" : "text-ff-textMuted hover:bg-ff-lavender hover:text-ff-text"}`}
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </span>
          );
        })}

        {activeCount > 0 && (
          <button
            type="button"
            onClick={() => navigate([])}
            className="text-xs text-ff-textMuted underline-offset-2 hover:text-ff-text hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {open && (
        <div className="mt-3 rounded-ff border border-ff-border bg-white p-4 shadow-ff-md">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Keyword">
              <input
                value={getOne("q")}
                onChange={(e) => setOne("q", e.target.value)}
                placeholder="Title, tags, uploader..."
                className={inputClass}
              />
            </Field>
            <Field label="Title contains">
              <input value={getOne("title")} onChange={(e) => setOne("title", e.target.value)} className={inputClass} />
            </Field>
            {options.categories && options.categories.length > 0 && (
              <Field label="Category">
                <MultiSelect
                  options={options.categories.map((c) => ({ value: c.id, label: c.name }))}
                  selected={getAll("cat")}
                  onChange={(v) => setAll("cat", v)}
                />
              </Field>
            )}
            <Field label="Document type">
              <MultiSelect
                options={options.docTypes.map((t) => ({ value: t, label: DOC_TYPE_LABEL[t] ?? t }))}
                selected={getAll("docType")}
                onChange={(v) => setAll("docType", v)}
              />
            </Field>
            <Field label="Uploaded by">
              <MultiSelect
                options={options.uploaders.map((u) => ({ value: u, label: u }))}
                selected={getAll("uploader")}
                onChange={(v) => setAll("uploader", v)}
              />
            </Field>
            <Field label="Owner">
              <MultiSelect
                options={options.owners.map((u) => ({ value: u, label: u }))}
                selected={getAll("owner")}
                onChange={(v) => setAll("owner", v)}
              />
            </Field>
            <Field label="Tags (any of)">
              <MultiSelect
                options={options.tags.map((t) => ({ value: t, label: t }))}
                selected={getAll("tags")}
                onChange={(v) => setAll("tags", v)}
              />
            </Field>
            <Field label="Last updated between">
              <DateRange
                from={getOne("updatedFrom")}
                to={getOne("updatedTo")}
                onFrom={(v) => setOne("updatedFrom", v)}
                onTo={(v) => setOne("updatedTo", v)}
                inputClass={inputClass}
              />
            </Field>
            <Field label="Uploaded between">
              <DateRange
                from={getOne("createdFrom")}
                to={getOne("createdTo")}
                onFrom={(v) => setOne("createdFrom", v)}
                onTo={(v) => setOne("createdTo", v)}
                inputClass={inputClass}
              />
            </Field>
            <Field label="Flags">
              <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1.5">
                {options.showStale && (
                  <Check label="Flagged outdated" checked={getOne("stale") === "true"} onChange={(c) => setOne("stale", c ? "true" : "")} />
                )}
                <Check label="Possible duplicate" checked={getOne("dup") === "true"} onChange={(c) => setOne("dup", c ? "true" : "")} />
              </div>
            </Field>
          </div>

          {options.customFields.length > 0 && (
            <>
              <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-ff-textMuted">Category fields</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {options.customFields.map((f) => {
                  const key = `${CUSTOM_FIELD_PREFIX}${f.id}`;
                  if (f.type === "number") {
                    return (
                      <Field key={f.id} label={f.label}>
                        <div className="flex items-center gap-1.5">
                          <input type="number" value={getOne(`${key}_min`)} onChange={(e) => setOne(`${key}_min`, e.target.value)} placeholder="Min" className={inputClass} />
                          <span className="text-xs text-ff-textMuted">to</span>
                          <input type="number" value={getOne(`${key}_max`)} onChange={(e) => setOne(`${key}_max`, e.target.value)} placeholder="Max" className={inputClass} />
                        </div>
                      </Field>
                    );
                  }
                  if (f.type === "date") {
                    return (
                      <Field key={f.id} label={f.label}>
                        <DateRange
                          from={getOne(`${key}_from`)}
                          to={getOne(`${key}_to`)}
                          onFrom={(v) => setOne(`${key}_from`, v)}
                          onTo={(v) => setOne(`${key}_to`, v)}
                          inputClass={inputClass}
                        />
                      </Field>
                    );
                  }
                  if (f.type === "text" || f.type === "textarea") {
                    return (
                      <Field key={f.id} label={`${f.label} contains`}>
                        <input value={getOne(key)} onChange={(e) => setOne(key, e.target.value)} className={inputClass} />
                      </Field>
                    );
                  }
                  return (
                    <Field key={f.id} label={f.label}>
                      <MultiSelect
                        options={f.values.map((v) => ({ value: v, label: v }))}
                        selected={getAll(key)}
                        onChange={(v) => setAll(key, v)}
                      />
                    </Field>
                  );
                })}
              </div>
            </>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-ff-border pt-4">
            <button
              type="button"
              onClick={apply}
              className="rounded-ff bg-ff-accent-gradient px-4 py-1.5 text-sm font-medium text-white shadow-ff hover:opacity-90"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => setDraft([])}
              className="rounded-ff border border-ff-border px-3 py-1.5 text-sm text-ff-text hover:bg-ff-lavender"
            >
              Reset
            </button>
            <div className="flex-1" />
            <input
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              maxLength={60}
              placeholder="Name this filter"
              aria-label="Saved filter name"
              className="w-48 rounded-ff border border-ff-border px-2.5 py-1.5 text-sm focus:border-ff-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={save}
              disabled={saving || !saveName.trim()}
              className="flex items-center gap-1.5 rounded-ff border border-ff-accent/50 px-3 py-1.5 text-sm font-medium text-ff-accent hover:bg-ff-lavender disabled:opacity-50"
            >
              {saving ? <BrandedLoader size={14} /> : <Bookmark className="h-4 w-4" aria-hidden />}
              Save and apply
            </button>
          </div>
        </div>
      )}

      <AlertModal message={error} onClose={() => setError(null)} />
      <ConfirmModal
        open={confirmDelete !== null}
        title="Delete this saved filter?"
        message={confirmDelete ? `"${confirmDelete.name}" will be removed from your filters.` : undefined}
        confirmLabel="Yes, delete"
        danger
        busy={deleting}
        onConfirm={() => confirmDelete && removeSaved(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs font-medium text-ff-textMuted">{label}</p>
      {children}
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-sm text-ff-text">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-[#7C3B74]" />
      {label}
    </label>
  );
}

function DateRange({
  from,
  to,
  onFrom,
  onTo,
  inputClass,
}: {
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  inputClass: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <input type="date" value={from} max={to || undefined} onChange={(e) => onFrom(e.target.value)} aria-label="From" className={inputClass} />
      <span className="text-xs text-ff-textMuted">to</span>
      <input type="date" value={to} min={from || undefined} onChange={(e) => onTo(e.target.value)} aria-label="To" className={inputClass} />
    </div>
  );
}

function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label?: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  const picked =
    selected.length === 0 ? "Any" : selected.length <= 2 ? selected.map(labelOf).join(", ") : `${selected.length} selected`;
  const summary = label ? `${label}: ${picked}` : picked;
  const visible = query ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase())) : options;

  if (options.length === 0) {
    return <p className="py-1.5 text-sm text-ff-textMuted">Nothing to pick in this section</p>;
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={summary}
        className={`flex w-full items-center justify-between gap-2 rounded-ff border bg-white text-left text-sm text-ff-text focus:border-ff-accent focus:outline-none ${
          label ? "px-3 py-2" : "px-2.5 py-1.5"
        } ${label && selected.length > 0 ? "border-ff-accent/50" : "border-ff-border"}`}
      >
        <span className={`truncate ${selected.length === 0 ? "text-ff-textMuted" : ""}`}>{summary}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-ff-textMuted" aria-hidden />
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 w-full min-w-[14rem] rounded-ff border border-ff-border bg-white p-1.5 shadow-ff-lg">
          {options.length > 8 && (
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search..."
              className="mb-1 w-full rounded-ff border border-ff-border px-2 py-1 text-sm focus:border-ff-accent focus:outline-none"
            />
          )}
          <div className="max-h-56 overflow-y-auto">
            {visible.map((o) => (
              <label key={o.value} className="flex cursor-pointer items-start gap-2 rounded px-2 py-1 text-sm text-ff-text hover:bg-ff-lavender">
                <input
                  type="checkbox"
                  checked={selected.includes(o.value)}
                  onChange={(e) =>
                    onChange(e.target.checked ? [...selected, o.value] : selected.filter((v) => v !== o.value))
                  }
                  className="mt-0.5 accent-[#7C3B74]"
                />
                <span className="break-words [overflow-wrap:anywhere]">{o.label}</span>
              </label>
            ))}
            {visible.length === 0 && <p className="px-2 py-1 text-sm text-ff-textMuted">No matches</p>}
          </div>
          {selected.length > 0 && (
            <button type="button" onClick={() => onChange([])} className="mt-1 w-full rounded px-2 py-1 text-left text-xs text-ff-textMuted hover:bg-ff-lavender">
              Clear selection
            </button>
          )}
        </div>
      )}
    </div>
  );
}
