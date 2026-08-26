import { Presentation, Video, FileText, FileType, FileSpreadsheet, Link2, File, type LucideIcon } from "lucide-react";

const DOC_TYPE_ICON: Record<string, LucideIcon> = {
  ppt: Presentation,
  video: Video,
  pdf: FileText,
  doc: FileType,
  excel: FileSpreadsheet,
  link: Link2,
  other: File,
};

// CSS text-transform: capitalize only fixes the first letter, which turns
// abbreviations like "pdf"/"ppt" into "Pdf"/"Ppt" instead of "PDF"/"PPT" —
// so casing for these needs an explicit label map, not a capitalize class.
export const DOC_TYPE_LABEL: Record<string, string> = {
  ppt: "PPT",
  video: "Video",
  pdf: "PDF",
  doc: "Doc",
  excel: "Excel",
  link: "Link",
  other: "Other",
};

export default function DocTypeIcon({
  docType,
  className = "h-4 w-4",
}: {
  docType: string;
  className?: string;
}) {
  const Icon = DOC_TYPE_ICON[docType] ?? File;
  return <Icon className={className} aria-hidden />;
}
