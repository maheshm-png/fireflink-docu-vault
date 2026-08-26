import type { CategoryFormField } from "@/lib/formSchema";

/** Renders one input for a category's custom form field. Shared by the
 * upload form and the document-edit form so both stay in sync. */
export default function DynamicField({
  field,
  value,
  onChange,
}: {
  field: CategoryFormField;
  value: any;
  onChange: (v: any) => void;
}) {
  const label = (
    <label className="mb-1 block text-xs text-ff-textMuted">
      {field.label} {field.required && <span className="text-ff-danger">*</span>}
    </label>
  );

  switch (field.type) {
    case "textarea":
      return (
        <div>
          {label}
          <textarea
            required={field.required}
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
            rows={3}
            className="w-full rounded-ff border border-ff-border px-3 py-2 text-sm"
          />
        </div>
      );
    case "select":
      return (
        <div>
          {label}
          <select
            required={field.required}
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
            className="w-full rounded-ff border border-ff-border px-3 py-2 text-sm"
          >
            <option value="" disabled>Choose...</option>
            {(field.options ?? []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        </div>
      );
    case "date":
      return (
        <div>
          {label}
          <input
            type="date"
            required={field.required}
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
            className="w-full rounded-ff border border-ff-border px-3 py-2 text-sm"
          />
        </div>
      );
    case "number":
      return (
        <div>
          {label}
          <input
            type="number"
            required={field.required}
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
            className="w-full rounded-ff border border-ff-border px-3 py-2 text-sm"
          />
        </div>
      );
    case "checkbox":
      return (
        <label className="flex items-center gap-2 text-sm text-ff-text">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
          />
          {field.label} {field.required && <span className="text-ff-danger">*</span>}
        </label>
      );
    default:
      return (
        <div>
          {label}
          <input
            type="text"
            required={field.required}
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
            className="w-full rounded-ff border border-ff-border px-3 py-2 text-sm"
          />
        </div>
      );
  }
}
