import type { Metadata } from "next";
import { AdminPageHeader, adminDayFormatter, adminNumberFormatter } from "@/components/admin-ui";
import { getAdminDailyUsage, getAdminRoleDistribution } from "@/lib/admin";

export const metadata: Metadata = { title: "Penggunaan" };

export default async function UsagePage() {
  const dailyUsage = await getAdminDailyUsage();
  const roleDistribution = await getAdminRoleDistribution();
  const chartMaximum = Math.max(1, ...dailyUsage.map((item) => item.successful + item.failed));
  const successful = dailyUsage.reduce((total, item) => total + item.successful, 0);
  const failed = dailyUsage.reduce((total, item) => total + item.failed, 0);
  const users = roleDistribution.reduce((total, item) => total + item.users, 0);

  return (
    <>
      <AdminPageHeader eyebrow="ADMIN / PENGGUNAAN" title="Pola aktivitas," accent="terlihat jelas." description="Pantau volume generasi tujuh hari terakhir dan komposisi akun RouterChat." />
      <section className="metric-grid metric-grid-three" aria-label="Ringkasan penggunaan tujuh hari">
        <article className="metric-card primary"><span>Generasi sukses</span><strong>{adminNumberFormatter.format(successful)}</strong><small>7 hari terakhir</small></article>
        <article className="metric-card"><span>Generasi gagal</span><strong>{adminNumberFormatter.format(failed)}</strong><small>{successful + failed ? `${Math.round(failed / (successful + failed) * 100)}% dari aktivitas` : "Belum ada aktivitas"}</small></article>
        <article className="metric-card"><span>Total akun</span><strong>{adminNumberFormatter.format(users)}</strong><small>seluruh role</small></article>
      </section>
      <div className="admin-two-column admin-page-section">
        <section className="admin-panel usage-panel">
          <div className="panel-heading"><div><p className="eyebrow">7 HARI TERAKHIR</p><h2>Aktivitas chatbot</h2></div><div className="chart-legend"><span><i className="success-dot" />Sukses</span><span><i className="failure-dot" />Gagal</span></div></div>
          <div className="usage-chart" role="img" aria-label="Grafik generasi sukses dan gagal selama tujuh hari terakhir">
            {dailyUsage.map((item) => <div className="usage-day" key={item.day} title={`${item.successful} sukses, ${item.failed} gagal, ${item.activeUsers} pengguna aktif`}><div className="usage-count">{item.successful + item.failed}</div><div className="usage-bar-track"><div className="usage-bar success" style={{ height: `${Math.max(item.successful ? 5 : 0, item.successful / chartMaximum * 100)}%` }} /><div className="usage-bar failure" style={{ height: `${Math.max(item.failed ? 4 : 0, item.failed / chartMaximum * 100)}%` }} /></div><span>{adminDayFormatter.format(new Date(`${item.day}T00:00:00`))}</span></div>)}
          </div>
        </section>
        <section className="admin-panel role-panel">
          <div className="panel-heading"><div><p className="eyebrow">SELURUH AKUN</p><h2>Distribusi role</h2></div></div>
          <div className="role-breakdown">{roleDistribution.map((item) => { const percentage = users ? Math.round(item.users / users * 100) : 0; return <div className="role-row" key={item.role}><div><strong>{item.role}</strong><span>{item.users} akun · {percentage}%</span></div><div className="role-meter"><i style={{ width: `${percentage}%` }} /></div></div>; })}</div>
        </section>
      </div>
    </>
  );
}
