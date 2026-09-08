import type { Metadata } from "next";
import { AdminPageHeader, StatusBadge, adminDateFormatter, adminNumberFormatter } from "@/components/admin-ui";
import { ImpersonateButton } from "@/components/impersonate-button";
import { getAdminUsers } from "@/lib/admin";

export const metadata: Metadata = { title: "Pengguna" };

export default async function UsersPage() {
  const users = await getAdminUsers();
  const active = users.filter((user) => user.status === "active").length;
  const admins = users.filter((user) => user.role === "admin").length;

  return (
    <>
      <AdminPageHeader eyebrow="ADMIN / PENGGUNA" title="Kenali akun," accent="jaga akses." description="Lihat pengguna terbaru, status akun, role, dan aktivitas generasinya." aside={<span className="admin-header-pill">50 akun terbaru</span>} />
      <section className="metric-grid metric-grid-three" aria-label="Ringkasan pengguna yang ditampilkan">
        <article className="metric-card primary"><span>Akun ditampilkan</span><strong>{adminNumberFormatter.format(users.length)}</strong><small>maksimal 50 akun terbaru</small></article>
        <article className="metric-card"><span>Akun aktif</span><strong>{adminNumberFormatter.format(active)}</strong><small>dari daftar terbaru</small></article>
        <article className="metric-card"><span>Administrator</span><strong>{adminNumberFormatter.format(admins)}</strong><small>akses dashboard</small></article>
      </section>
      <section className="admin-panel table-panel admin-page-section">
        <div className="panel-heading"><div><p className="eyebrow">DIREKTORI AKUN</p><h2>Pengguna terbaru</h2></div><span>{users.length} ditampilkan</span></div>
        {users.length ? <div className="admin-table-wrap"><table><thead><tr><th>Email</th><th>Role</th><th>Chat sukses</th><th>Status</th><th>Terdaftar</th><th><span className="sr-only">Tindakan</span></th></tr></thead><tbody>{users.map((item) => <tr key={item.id}><td><strong>{item.email}</strong></td><td>{item.role}</td><td>{adminNumberFormatter.format(item.generations)}</td><td><StatusBadge status={item.status} /></td><td>{adminDateFormatter.format(new Date(item.createdAt))}</td><td>{item.role === "user" && item.status === "active" ? <ImpersonateButton userId={item.id} email={item.email} /> : <span className="admin-action-unavailable">—</span>}</td></tr>)}</tbody></table></div> : <p className="admin-empty">Belum ada akun.</p>}
      </section>
    </>
  );
}
