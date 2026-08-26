import { getCategoryIcon } from "@/lib/categoryIcon";

export default function CategoryIcon({
  name,
  className = "h-5 w-5",
}: {
  name: string;
  className?: string;
}) {
  const Icon = getCategoryIcon(name);
  return <Icon className={className} aria-hidden />;
}
