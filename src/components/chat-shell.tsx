"use client";

import { useEffect, useState } from "react";
import { AuthPanel } from "./auth-panel";
import { ChatWorkspace } from "./chat-workspace";
import { ImpersonationBanner } from "./impersonation-banner";

export type User = { id: string; email: string; role: "user" | "admin"; status: string };

export function ChatShell({ authError }: { authError?: string }) {
  const [session, setSession] = useState<{ user: User; impersonating: boolean } | null>(null);
  const [checking, setChecking] = useState(true);
  const [startupError, setStartupError] = useState("");

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then(async (response) => {
        if (response.ok) {
          const data = (await response.json()) as { user: User; impersonating: boolean };
          setSession(data);
        } else if (response.status >= 500) {
          setStartupError("Backend belum siap. Jalankan npm run db:migrate lalu muat ulang.");
        }
      })
      .catch(() => setStartupError("Backend tidak dapat dihubungi."))
      .finally(() => setChecking(false));
  }, []);

  if (checking) {
    return <main className="app-loading" aria-live="polite">Memuat RouterChat…</main>;
  }
  if (!session) return <AuthPanel startupError={startupError || authError} />;
  return (
    <div className={session.impersonating ? "impersonation-shell" : undefined}>
      {session.impersonating && <ImpersonationBanner targetEmail={session.user.email} />}
      {session.user.status === "active"
        ? <ChatWorkspace user={session.user} onLoggedOut={() => setSession(null)} />
        : <main className="app-loading" role="alert">Akun tujuan tidak lagi aktif. Kembali ke akun admin.</main>}
    </div>
  );
}
