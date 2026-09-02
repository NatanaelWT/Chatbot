"use client";

import { useEffect, useState } from "react";
import { AuthPanel } from "./auth-panel";
import { ChatWorkspace } from "./chat-workspace";

export type User = { id: string; email: string; role: "user" | "admin"; status: string };

export function ChatShell({ authError }: { authError?: string }) {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [startupError, setStartupError] = useState("");

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then(async (response) => {
        if (response.ok) {
          const data = (await response.json()) as { user: User };
          setUser(data.user);
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
  if (!user) return <AuthPanel startupError={startupError || authError} />;
  return <ChatWorkspace user={user} onLoggedOut={() => setUser(null)} />;
}
