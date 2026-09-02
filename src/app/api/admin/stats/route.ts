import { getAdminDashboardData } from "@/lib/admin";
import { getCurrentUser } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { isAdminRole } from "@/lib/roles";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError("Sesi tidak valid.", 401, "UNAUTHORIZED");
  if (!isAdminRole(user.role)) return jsonError("Akses ditolak.", 403, "FORBIDDEN");
  const dashboard = await getAdminDashboardData();
  return Response.json({ stats: dashboard.overview, ...dashboard });
}
