import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminDashboardData } from "@/lib/admin";
import { getCurrentUser } from "@/lib/auth";
import { isAdminRole } from "@/lib/roles";

export const metadata: Metadata = { title: "Dashboard admin — RouterChat" };
export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" });
const dayFormatter = new Intl.DateTimeFormat("id-ID", { weekday: "short", day: "numeric" });
const numberFormatter = new Intl.NumberFormat("id-ID");

function formatDate(value: string): string { return dateFormatter.format(new Date(value)); }
function StatusBadge({ status }: { status: string }) {
  return <span className={`status-badge ${status === "active" || status === "complete" ? "positive" : ""}`}>{status}</span>;
}

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user || !isAdminRole(user.role)) redirect("/");
  const dashboard = await getAdminDashboardData();
  const chartMaximum = Math.max(1, ...dashboard.dailyUsage.map((item) => item.successful + item.failed));
  const { overview } = dashboard;

  return (
    <main className="admin-page">
      <aside className="admin-sidebar">
        <Link className="brand admin-brand" href="/" aria-label="RouterChat"><span className="brand-mark small">R<span>↗</span></span><strong>RouterChat</strong></Link>
        <nav aria-label="Navigasi admin"><a className="active" href="#overview">Ringkasan</a><a href="#usage">Penggunaan</a><a href="#users">Pengguna</a><a href="#errors">Error terbaru</a></nav>
        <div className="admin-account"><span className="avatar">{user.email[0].toUpperCase()}</span><span><strong>{user.email.split("@")[0]}</strong><small>Administrator</small></span></div>
      </aside>

      <section className="admin-content">
        <header className="admin-header" id="overview">
          <div><p className="eyebrow">ADMIN / MONITORING</p><h1>Seluruh sistem,<br /><em>dalam satu layar.</em></h1><p>Aktivitas pengguna, pemakaian chatbot, serta kegagalan generasi.</p></div>
          <Link className="admin-chat-link" href="/">Buka chatbot <span aria-hidden="true">↗</span></Link>
        </header>

        <section className="metric-grid" aria-label="Ringkasan hari ini">
          <article className="metric-card primary"><span>Generasi hari ini</span><strong>{numberFormatter.format(overview.generationsToday)}</strong><small>{numberFormatter.format(overview.failedToday)} gagal</small></article>
          <article className="metric-card"><span>Total pengguna</span><strong>{numberFormatter.format(overview.users)}</strong><small>{numberFormatter.format(overview.activeUsersToday)} aktif hari ini</small></article>
          <article className="metric-card"><span>Total generasi</span><strong>{numberFormatter.format(overview.totalGenerations)}</strong><small>seluruh waktu</small></article>
          <article className="metric-card"><span>Akun aktif</span><strong>{numberFormatter.format(overview.activeAccounts)}</strong><small>{numberFormatter.format(overview.users - overview.activeAccounts)} ditangguhkan</small></article>
        </section>

        <div className="admin-two-column" id="usage">
          <section className="admin-panel usage-panel">
            <div className="panel-heading"><div><p className="eyebrow">7 HARI TERAKHIR</p><h2>Aktivitas chatbot</h2></div><div className="chart-legend"><span><i className="success-dot" />Sukses</span><span><i className="failure-dot" />Gagal</span></div></div>
            <div className="usage-chart" role="img" aria-label="Grafik generasi sukses dan gagal selama tujuh hari terakhir">
              {dashboard.dailyUsage.map((item) => <div className="usage-day" key={item.day} title={`${item.successful} sukses, ${item.failed} gagal, ${item.activeUsers} pengguna aktif`}><div className="usage-count">{item.successful + item.failed}</div><div className="usage-bar-track"><div className="usage-bar success" style={{ height: `${Math.max(item.successful ? 5 : 0, item.successful / chartMaximum * 100)}%` }} /><div className="usage-bar failure" style={{ height: `${Math.max(item.failed ? 4 : 0, item.failed / chartMaximum * 100)}%` }} /></div><span>{dayFormatter.format(new Date(`${item.day}T00:00:00`))}</span></div>)}
            </div>
          </section>

          <section className="admin-panel role-panel">
            <div className="panel-heading"><div><p className="eyebrow">SELURUH AKUN</p><h2>Distribusi role</h2></div></div>
            <div className="role-breakdown">{dashboard.roleDistribution.map((item) => { const percentage = overview.users ? Math.round(item.users / overview.users * 100) : 0; return <div className="role-row" key={item.role}><div><strong>{item.role}</strong><span>{item.users} akun · {percentage}%</span></div><div className="role-meter"><i style={{ width: `${percentage}%` }} /></div></div>; })}</div>
          </section>
        </div>

        <section className="admin-panel table-panel" id="users">
          <div className="panel-heading"><div><p className="eyebrow">AKUN TERBARU</p><h2>Pengguna</h2></div><span>{overview.users} total</span></div>
          <div className="admin-table-wrap"><table><thead><tr><th>Email</th><th>Role</th><th>Chat sukses</th><th>Status</th><th>Terdaftar</th></tr></thead><tbody>{dashboard.recentUsers.map((item) => <tr key={item.email}><td><strong>{item.email}</strong></td><td>{item.role}</td><td>{numberFormatter.format(item.generations)}</td><td><StatusBadge status={item.status} /></td><td>{formatDate(item.createdAt)}</td></tr>)}</tbody></table></div>
        </section>

        <section className="admin-panel table-panel" id="errors">
          <div className="panel-heading"><div><p className="eyebrow">OPERASIONAL</p><h2>Error generasi terbaru</h2></div></div>
          {dashboard.recentErrors.length ? <div className="admin-table-wrap"><table><thead><tr><th>Pengguna</th><th>Model</th><th>Kode error</th><th>Durasi</th><th>Waktu</th></tr></thead><tbody>{dashboard.recentErrors.map((item) => <tr key={`${item.email}-${item.createdAt}`}><td><strong>{item.email}</strong></td><td>{item.model}</td><td><code>{item.errorCode ?? "UNKNOWN"}</code></td><td>{item.durationMs === null ? "—" : `${numberFormatter.format(item.durationMs)} ms`}</td><td>{formatDate(item.createdAt)}</td></tr>)}</tbody></table></div> : <p className="admin-empty">Belum ada kegagalan generasi.</p>}
        </section>

        <p className="admin-footnote">Metrik “hari ini” mengikuti timezone database. Semua akun aktif mendapat chat gratis tanpa batas.</p>
      </section>
    </main>
  );
}
