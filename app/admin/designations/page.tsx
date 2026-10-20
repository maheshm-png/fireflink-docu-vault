import { redirect } from "next/navigation";

// Designations were removed from the UI (2026-10-12): they controlled no
// access. The data stays in the database. Old links land on People.
export default function DesignationsRedirect() {
  redirect("/admin/users");
}
