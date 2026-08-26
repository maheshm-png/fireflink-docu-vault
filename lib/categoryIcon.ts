import {
  ShieldCheck, Briefcase, GitCompare, Landmark, HeartPulse, Video, Package, TrendingUp,
  Megaphone, Scale, FileSignature, Users, GraduationCap, Code2, Handshake, LayoutTemplate,
  FileBarChart, HelpCircle, ShoppingBag, Factory, Wifi, Building2, Truck, Plane, Zap,
  Clapperboard, HeartHandshake, TestTube2, Presentation, Rocket, Folder, type LucideIcon,
} from "lucide-react";

/**
 * Picks an icon for a category tile (app/dashboard/home/page.tsx) by
 * matching keywords against its name — categories are freely named by
 * managers (lib/rbac.ts's manageCategories), so there's no fixed enum to
 * switch on the way DocTypeIcon.tsx does for the small, fixed DocType enum.
 * A new category automatically gets a fitting icon the moment it's created,
 * with no code change needed, as long as its name hits one of the keywords
 * below; an unmatched name falls back to a plain folder rather than
 * guessing wrong. Order matters — first match wins, so more specific terms
 * (e.g. "security" before a hypothetical generic "service") are checked
 * before broader catch-alls.
 */
const RULES: { keywords: string[]; icon: LucideIcon }[] = [
  { keywords: ["cyber", "security", "infosec", "penetration", "vulnerab"], icon: ShieldCheck },
  { keywords: ["case stud"], icon: Briefcase },
  { keywords: ["competitor", "comparison", " vs ", " vs.", "versus", "benchmark"], icon: GitCompare },
  { keywords: ["finance", "financial", "accounting", "billing", "invoice", "budget"], icon: Landmark },
  { keywords: ["health", "medical", "hospital", "clinical", "pharma", "patient"], icon: HeartPulse },
  { keywords: ["demo", "video", "webinar", "recording", "walkthrough"], icon: Video },
  { keywords: ["sales", "pitch", "proposal", "quote"], icon: TrendingUp },
  { keywords: ["marketing", "campaign", "brand", "social media"], icon: Megaphone },
  { keywords: ["legal", "compliance", "policy", "regulat", "gdpr", "privacy"], icon: Scale },
  { keywords: ["contract", "agreement", "nda", "msa", "sow"], icon: FileSignature },
  { keywords: ["hr", "human resource", "people", "employee", "onboarding", "recruit", "talent"], icon: Users },
  { keywords: ["training", "education", "academy", "course", "learning", "curriculum"], icon: GraduationCap },
  { keywords: ["technical", "engineering", "architecture", "api", "integration", "developer", "sdk"], icon: Code2 },
  { keywords: ["partner", "alliance", "reseller", "channel"], icon: Handshake },
  { keywords: ["template", "boilerplate", "playbook"], icon: LayoutTemplate },
  { keywords: ["whitepaper", "research", "report", "analysis", "insight"], icon: FileBarChart },
  { keywords: ["faq", "support", "help desk", "troubleshoot", "knowledge base"], icon: HelpCircle },
  { keywords: ["retail", "ecommerce", "e-commerce", "shopping"], icon: ShoppingBag },
  { keywords: ["bank", "insurance", "government", "public sector"], icon: Landmark },
  { keywords: ["manufactur", "industrial", "factory"], icon: Factory },
  { keywords: ["telecom", "network", "connectivity"], icon: Wifi },
  { keywords: ["real estate", "property"], icon: Building2 },
  { keywords: ["logistics", "supply chain", "shipping", "transport", "fleet"], icon: Truck },
  { keywords: ["hospitality", "travel", "hotel", "airline"], icon: Plane },
  { keywords: ["energy", "utilit", "power", "oil", "gas", "renewable"], icon: Zap },
  { keywords: ["media", "entertainment", "broadcast", "streaming"], icon: Clapperboard },
  { keywords: ["nonprofit", "non-profit", "charity", "ngo"], icon: HeartHandshake },
  { keywords: ["testing", " qa ", "quality assurance", "automation", "test case"], icon: TestTube2 },
  { keywords: ["product deck", "product overview", "one pager", "one-pager"], icon: Presentation },
  { keywords: ["product", "roadmap", "launch"], icon: Rocket },
];

export function getCategoryIcon(name: string): LucideIcon {
  const lower = ` ${name.toLowerCase()} `;
  for (const rule of RULES) {
    if (rule.keywords.some((k) => lower.includes(k))) return rule.icon;
  }
  return Folder;
}
