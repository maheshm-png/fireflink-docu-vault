"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserX, UserCheck } from "lucide-react";
import ConfirmModal from "@/components/ConfirmModal";
import AlertModal from "@/components/AlertModal";

export default function UserActiveToggle({
  userId,
  userName,
  isActive,
  isSelf,
}: {
  userId: string;
  userName: string;
  isActive: boolean;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
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
      setError(data?.error ?? "Could not update this user — please try again.");
      return;
    }
    setConfirming(false);
    router.refresh();
  }

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        title={isActive ? "Remove access" : "Restore access"}
        aria-label={isActive ? "Remove access" : "Restore access"}
        className={`rounded p-1 transition-colors ${
          isActive ? "text-ff-danger hover:bg-ff-danger/10" : "text-ff-success hover:bg-ff-success/10"
        }`}
      >
        {isActive ? <UserX className="h-4 w-4" aria-hidden /> : <UserCheck className="h-4 w-4" aria-hidden />}
      </button>

      <ConfirmModal
        open={confirming}
        title={isActive ? "Remove this user?" : "Restore this user?"}
        message={
          isActive
            ? `${userName} will lose access immediately. This can be undone at any time.`
            : `${userName} will regain access to Docu Vault.`
        }
        confirmLabel={isActive ? "Remove" : "Restore"}
        danger={isActive}
        busy={busy}
        onConfirm={toggle}
        onCancel={() => setConfirming(false)}
      />
      <AlertModal message={error} onClose={() => setError(null)} />
    </>
  );
}
