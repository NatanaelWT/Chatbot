import type { Metadata } from "next";
import { AdminPageHeader, adminDateFormatter, adminNumberFormatter } from "@/components/admin-ui";
import { getAdminErrors } from "@/lib/admin";

export const metadata: Metadata = { title: "Error terbaru" };

export default async function ErrorsPage() {
  const errors = await getAdminErrors();
  const affectedModels = new Set(errors.map((item) => item.model)).size;
  const knownCodes = errors.filter((item) => item.errorCode).length;

  return (
    <>
      <AdminPageHeader eyebrow="ADMIN / OPERASIONAL" title="Masalah terbaru," accent="mudah ditelusuri." description="Tinjau kegagalan provider, model terdampak, dan durasi sebelum respons berhenti." aside={<span className={`admin-health ${errors.length ? "warning" : ""}`}><i />{errors.length ? "Perlu ditinjau" : "Sistem sehat"}</span>} />
      <section className="metric-grid metric-grid-three" aria-label="Ringkasan error yang ditampilkan">
        <article className={`metric-card ${errors.length ? "alert" : "primary"}`}><span>Error ditampilkan</span><strong>{adminNumberFormatter.format(errors.length)}</strong><small>maksimal 50 kejadian terbaru</small></article>
        <article className="metric-card"><span>Model terdampak</span><strong>{adminNumberFormatter.format(affectedModels)}</strong><small>pada daftar ini</small></article>
        <article className="metric-card"><span>Kode teridentifikasi</span><strong>{adminNumberFormatter.format(knownCodes)}</strong><small>dapat langsung ditelusuri</small></article>
      </section>
      <section className="admin-panel table-panel admin-page-section">
        <div className="panel-heading"><div><p className="eyebrow">LOG GENERASI</p><h2>Kegagalan terbaru</h2></div><span>{errors.length} kejadian</span></div>
        {errors.length ? <div className="admin-table-wrap"><table><thead><tr><th>Pengguna</th><th>Model</th><th>Kode error</th><th>Durasi</th><th>Waktu</th></tr></thead><tbody>{errors.map((item, index) => <tr key={`${item.email}-${item.createdAt}-${index}`}><td><strong>{item.email}</strong></td><td>{item.model}</td><td><code>{item.errorCode ?? "UNKNOWN"}</code></td><td>{item.durationMs === null ? "—" : `${adminNumberFormatter.format(item.durationMs)} ms`}</td><td>{adminDateFormatter.format(new Date(item.createdAt))}</td></tr>)}</tbody></table></div> : <div className="admin-empty-state"><span aria-hidden="true">✓</span><h2>Tidak ada error</h2><p>Belum ada kegagalan generasi yang perlu ditinjau.</p></div>}
      </section>
    </>
  );
}
