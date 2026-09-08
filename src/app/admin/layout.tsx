import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AdminNavigation } from "@/components/admin-navigation";
import { getCurrentUser } from "@/lib/auth";
import { isAdminRole } from "@/lib/roles";

export const metadata: Metadata = {
  title: { default: "Dashboard admin — RouterChat", template: "%s — RouterChat" },
};
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user || !isAdminRole(user.role)) redirect("/");

  return (
    <main className="admin-page">
      <a className="skip-link" href="#admin-content">Lewati ke konten utama</a>
      <aside className="admin-sidebar">
        <Link className="brand admin-brand" href="/admin" aria-label="Dashboard RouterChat">
          <span className="brand-mark small">R<span>↗</span></span><strong>RouterChat</strong>
        </Link>
        <AdminNavigation />
        <Link className="admin-sidebar-chat" href="/"><span aria-hidden="true">＋</span><span>Buka chatbot</span><span aria-hidden="true">↗</span></Link>
        <div className="admin-account"><span className="avatar">{user.email[0].toUpperCase()}</span><span><strong>{user.email.split("@")[0]}</strong><small>Administrator</small></span></div>
      </aside>
      <section className="admin-content" id="admin-content">
        {children}
        <p className="admin-footnote">Metrik “hari ini” mengikuti timezone database. Semua akun aktif mendapat chat gratis tanpa batas.</p>
      </section>
    </main>
  );
}
