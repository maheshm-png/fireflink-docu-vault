"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserX, UserCheck } from "lucide-react";
import AlertModal from "@/components/AlertModal";

// Single click, no confirm step — removing/restoring access is fully
// reversible any time by clicking this same control again (the old confirm
// dialog's own copy said as much: "This can be undone at any time"), so the
// extra step was friction without a real safety purpose.
export default function UserActiveToggle({
  userId,
  isActive,
  isSelf,
}: {
  userId: string;
  isActive: boolean;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isSelf) {
    return <span className="text-xs text-ff-textMuted">You</span>;
  }

  async function toggle() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !isActive }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not update this user, please try again.");
      return;
    }
    router.refresh();
  }

  return (
    <>
      <button
        onClick={toggle}
        disabled={busy}
        title={isActive ? "Remove access" : "Restore access"}
        aria-label={isActive ? "Remove access" : "Restore access"}
        className={`rounded p-1 transition-colors disabled:opacity-60 ${
          isActive ? "text-ff-danger hover:bg-ff-danger/10" : "text-ff-success hover:bg-ff-success/10"
        }`}
      >
        {isActive ? <UserX className="h-4 w-4" aria-hidden /> : <UserCheck className="h-4 w-4" aria-hidden />}
      </button>

      <AlertModal message={error} onClose={() => setError(null)} />
    </>
  );
}
