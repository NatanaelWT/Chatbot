"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ImpersonationBanner({ targetEmail }: { targetEmail: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function stopImpersonation() {
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/admin/impersonation", { method: "DELETE" });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(data?.error?.message ?? "Tidak dapat kembali ke akun admin.");
      }
      router.push("/admin/users");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Tidak dapat kembali ke akun admin.");
      setPending(false);
    }
  }

  return (
    <aside className="impersonation-banner" aria-label="Mode impersonasi">
      <span aria-hidden="true">◉</span>
      <p><strong>Mode impersonasi aktif</strong><small>Anda sedang mengakses RouterChat sebagai {targetEmail}.</small></p>
      {error && <small className="impersonation-error" role="alert">{error}</small>}
      <button type="button" onClick={stopImpersonation} disabled={pending}>
        {pending ? "Mengembalikan…" : "Kembali ke admin"}
      </button>
    </aside>
  );
}
