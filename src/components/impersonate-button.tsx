"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ImpersonateButton({ userId, email }: { userId: string; email: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function startImpersonation() {
    if (!window.confirm(`Masuk sebagai ${email}? Semua tindakan berikutnya memakai akun pengguna ini.`)) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/admin/impersonation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(data?.error?.message ?? "Impersonasi gagal dimulai.");
      }
      router.push("/");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impersonasi gagal dimulai.");
      setPending(false);
    }
  }

  return (
    <div className="impersonate-control">
      <button type="button" className="impersonate-button" aria-label={`Akses RouterChat sebagai ${email}`} onClick={startImpersonation} disabled={pending}>
        {pending ? "Membuka…" : "Akses akun"}
      </button>
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
