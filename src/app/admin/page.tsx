import type { Metadata } from "next";
import Link from "next/link";
import { AdminPageHeader, adminNumberFormatter } from "@/components/admin-ui";
import { getAdminOverview } from "@/lib/admin";

export const metadata: Metadata = { title: "Ringkasan" };

export default async function AdminPage() {
  const overview = await getAdminOverview();

  return (
    <>
      <AdminPageHeader eyebrow="ADMIN / RINGKASAN" title="Semua yang penting," accent="tanpa keramaian." description="Kondisi RouterChat hari ini dalam angka. Buka halaman detail saat perlu menyelidiki lebih jauh." aside={<Link className="admin-chat-link" href="/">Buka chatbot <span aria-hidden="true">↗</span></Link>} />
      <section className="metric-grid" aria-label="Ringkasan hari ini">
        <article className="metric-card primary"><span>Generasi hari ini</span><strong>{adminNumberFormatter.format(overview.generationsToday)}</strong><small>{adminNumberFormatter.format(overview.failedToday)} gagal</small></article>
        <article className="metric-card"><span>Total pengguna</span><strong>{adminNumberFormatter.format(overview.users)}</strong><small>{adminNumberFormatter.format(overview.activeUsersToday)} aktif hari ini</small></article>
        <article className="metric-card"><span>Total generasi</span><strong>{adminNumberFormatter.format(overview.totalGenerations)}</strong><small>seluruh waktu</small></article>
        <article className="metric-card"><span>Akun aktif</span><strong>{adminNumberFormatter.format(overview.activeAccounts)}</strong><small>{adminNumberFormatter.format(overview.users - overview.activeAccounts)} ditangguhkan</small></article>
      </section>
      <section className="admin-section-links" aria-labelledby="detail-heading">
        <div className="admin-section-heading"><p className="eyebrow">PUSAT KONTROL</p><h2 id="detail-heading">Pilih data yang ingin diperiksa</h2></div>
        <div className="admin-link-grid">
          <Link className="admin-detail-card usage" href="/admin/usage"><span className="admin-detail-icon" aria-hidden="true">⌁</span><div><p>PENGGUNAAN</p><h3>Aktivitas chatbot</h3><span>Grafik tujuh hari dan distribusi role.</span></div><b aria-hidden="true">↗</b></Link>
          <Link className="admin-detail-card users" href="/admin/users"><span className="admin-detail-icon" aria-hidden="true">◎</span><div><p>PENGGUNA</p><h3>Direktori akun</h3><span>Status, role, dan jumlah chat sukses.</span></div><b aria-hidden="true">↗</b></Link>
          <Link className="admin-detail-card errors" href="/admin/errors"><span className="admin-detail-icon" aria-hidden="true">!</span><div><p>OPERASIONAL</p><h3>Error terbaru</h3><span>Provider, model, kode, dan durasi.</span></div><b aria-hidden="true">↗</b></Link>
        </div>
      </section>
    </>
  );
}
