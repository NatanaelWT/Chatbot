"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/admin", label: "Ringkasan", icon: "⌂" },
  { href: "/admin/usage", label: "Penggunaan", icon: "⌁" },
  { href: "/admin/users", label: "Pengguna", icon: "◎" },
  { href: "/admin/errors", label: "Error terbaru", icon: "!" },
];

export function AdminNavigation() {
  const pathname = usePathname();

  return (
    <nav aria-label="Navigasi admin">
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link className={active ? "active" : undefined} href={item.href} key={item.href} aria-current={active ? "page" : undefined}>
            <span className="admin-nav-icon" aria-hidden="true">{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
