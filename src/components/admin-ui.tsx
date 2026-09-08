import type { ReactNode } from "react";

export const adminNumberFormatter = new Intl.NumberFormat("id-ID");
export const adminDateFormatter = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" });
export const adminDayFormatter = new Intl.DateTimeFormat("id-ID", { weekday: "short", day: "numeric" });

export function AdminPageHeader({ eyebrow, title, accent, description, aside }: { eyebrow: string; title: string; accent: string; description: string; aside?: ReactNode }) {
  return (
    <header className="admin-header">
      <div><p className="eyebrow">{eyebrow}</p><h1>{title}<br /><em>{accent}</em></h1><p>{description}</p></div>
      {aside}
    </header>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`status-badge ${status === "active" || status === "complete" ? "positive" : ""}`}>{status}</span>;
}
