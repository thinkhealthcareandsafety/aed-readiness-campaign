"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteSubmissionButton({ id, label }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    if (!window.confirm(`Delete this submission${label ? ` (${label})` : ""}? This can't be undone.`)) return;
    setBusy(true);
    const res = await fetch(`/api/admin/submissions/${id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      window.alert("Couldn't delete that submission — please try again.");
      return;
    }
    router.refresh();
  }

  return (
    <button type="button" className="admin-delete-btn" onClick={handleDelete} disabled={busy} aria-label="Delete submission">
      {busy ? "…" : "Delete"}
    </button>
  );
}
