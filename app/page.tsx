import { redirect } from "next/navigation";

// The site root never renders anything itself: it sends everyone to Docu
// Vault's sign-in. The Workspace launcher lives at /workspace instead.
export default function RootPage() {
  redirect("/login");
}
