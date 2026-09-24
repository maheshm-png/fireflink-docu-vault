import {
  FileText,
  Users,
  TrendingUp,
  Filter,
  Presentation,
  Briefcase,
  Calendar,
  MessageSquare,
  Mail,
  BarChart3,
  Globe,
  Shield,
  Wallet,
  Headphones,
  type LucideIcon,
} from "lucide-react";

// Fixed picklist a superadmin chooses from (app/admin/workspace-apps), not
// free text — every WorkspaceApp.icon column value must be one of these
// keys. Keeps every launcher tile (app/page.tsx) drawing from the same
// icon set the rest of the app already uses, rather than an admin being
// able to reference an arbitrary/misspelled lucide-react export name that
// would silently fail to render.
export const WORKSPACE_ICONS: Record<string, LucideIcon> = {
  FileText,
  Users,
  TrendingUp,
  Filter,
  Presentation,
  Briefcase,
  Calendar,
  MessageSquare,
  Mail,
  BarChart3,
  Globe,
  Shield,
  Wallet,
  Headphones,
};

export const WORKSPACE_ICON_KEYS = Object.keys(WORKSPACE_ICONS);

export const DEFAULT_WORKSPACE_ICON = "Globe";
