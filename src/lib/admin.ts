import { query } from "./db";

export type AdminOverview = {
  users: number;
  activeUsersToday: number;
  generationsToday: number;
  failedToday: number;
  totalGenerations: number;
  activeAccounts: number;
};
export type AdminDailyUsage = Array<{ day: string; successful: number; failed: number; activeUsers: number }>;
export type AdminRoleDistribution = Array<{ role: string; users: number }>;
export type AdminUser = { id: string; email: string; role: string; status: string; generations: number; createdAt: string };
export type AdminError = { email: string; model: string; errorCode: string | null; durationMs: number | null; createdAt: string };
export type AdminDashboardData = {
  overview: AdminOverview;
  dailyUsage: AdminDailyUsage;
  roleDistribution: AdminRoleDistribution;
  recentUsers: AdminUser[];
  recentErrors: AdminError[];
};

export async function getAdminOverview(): Promise<AdminOverview> {
  const result = await query<{
    users: number;
    active_users_today: number;
    generations_today: number;
    failed_today: number;
    total_generations: number;
    active_accounts: number;
  }>(`SELECT
    (SELECT COUNT(*)::int FROM users) AS users,
    (SELECT COUNT(DISTINCT user_id)::int FROM generation_runs WHERE status <> 'failed' AND created_at >= CURRENT_DATE) AS active_users_today,
    (SELECT COUNT(*)::int FROM generation_runs WHERE status <> 'failed' AND created_at >= CURRENT_DATE) AS generations_today,
    (SELECT COUNT(*)::int FROM generation_runs WHERE status = 'failed' AND created_at >= CURRENT_DATE) AS failed_today,
    (SELECT COUNT(*)::int FROM generation_runs WHERE status <> 'failed') AS total_generations,
    (SELECT COUNT(*)::int FROM users WHERE status = 'active') AS active_accounts`);
  const row = result.rows[0];
  return {
    users: row.users,
    activeUsersToday: row.active_users_today,
    generationsToday: row.generations_today,
    failedToday: row.failed_today,
    totalGenerations: row.total_generations,
    activeAccounts: row.active_accounts,
  };
}

export async function getAdminDailyUsage(): Promise<AdminDailyUsage> {
  const result = await query<{ day: string; successful: number; failed: number; active_users: number }>(
    `SELECT days.day::date::text AS day,
       COUNT(g.id) FILTER (WHERE g.status <> 'failed')::int AS successful,
       COUNT(g.id) FILTER (WHERE g.status = 'failed')::int AS failed,
       COUNT(DISTINCT g.user_id) FILTER (WHERE g.status <> 'failed')::int AS active_users
     FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, INTERVAL '1 day') AS days(day)
     LEFT JOIN generation_runs g ON g.created_at >= days.day AND g.created_at < days.day + INTERVAL '1 day'
     GROUP BY days.day ORDER BY days.day`,
  );
  return result.rows.map((row) => ({ day: row.day, successful: row.successful, failed: row.failed, activeUsers: row.active_users }));
}

export async function getAdminRoleDistribution(): Promise<AdminRoleDistribution> {
  const result = await query<{ role: string; users: number }>(
    "SELECT role, COUNT(*)::int AS users FROM users GROUP BY role ORDER BY users DESC, role",
  );
  return result.rows;
}

export async function getAdminUsers(limit = 50): Promise<AdminUser[]> {
  const safeLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
  const result = await query<{ id: string; email: string; role: string; status: string; generations: number; created_at: string }>(
    `SELECT u.id, u.email, u.role, u.status,
       (SELECT COUNT(*)::int FROM generation_runs g WHERE g.user_id = u.id AND g.status <> 'failed') AS generations,
       u.created_at
     FROM users u ORDER BY u.created_at DESC LIMIT $1`,
    [safeLimit],
  );
  return result.rows.map((row) => ({ id: row.id, email: row.email, role: row.role, status: row.status, generations: row.generations, createdAt: row.created_at }));
}

export async function getAdminErrors(limit = 50): Promise<AdminError[]> {
  const safeLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
  const result = await query<{ email: string; model: string; error_code: string | null; duration_ms: number | null; created_at: string }>(
    `SELECT u.email, g.model_id AS model, g.error_code, g.duration_ms, g.created_at
     FROM generation_runs g JOIN users u ON u.id = g.user_id
     WHERE g.status = 'failed' ORDER BY g.created_at DESC LIMIT $1`,
    [safeLimit],
  );
  return result.rows.map((row) => ({ email: row.email, model: row.model, errorCode: row.error_code, durationMs: row.duration_ms, createdAt: row.created_at }));
}

export async function getAdminDashboardData(): Promise<AdminDashboardData> {
  const [overview, dailyUsage, roleDistribution, recentUsers, recentErrors] = await Promise.all([
    getAdminOverview(), getAdminDailyUsage(), getAdminRoleDistribution(), getAdminUsers(8), getAdminErrors(8),
  ]);
  return { overview, dailyUsage, roleDistribution, recentUsers, recentErrors };
}
