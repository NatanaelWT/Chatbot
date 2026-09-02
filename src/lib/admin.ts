import { query } from "./db";

export type AdminDashboardData = {
  overview: {
    users: number;
    activeUsersToday: number;
    generationsToday: number;
    failedToday: number;
    totalGenerations: number;
    activeAccounts: number;
  };
  dailyUsage: Array<{ day: string; successful: number; failed: number; activeUsers: number }>;
  roleDistribution: Array<{ role: string; users: number }>;
  recentUsers: Array<{ email: string; role: string; status: string; generations: number; createdAt: string }>;
  recentErrors: Array<{ email: string; model: string; errorCode: string | null; durationMs: number | null; createdAt: string }>;
};

export async function getAdminDashboardData(): Promise<AdminDashboardData> {
  const overviewResult = await query<{
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

  const dailyResult = await query<{ day: string; successful: number; failed: number; active_users: number }>(
    `SELECT days.day::date::text AS day,
       COUNT(g.id) FILTER (WHERE g.status <> 'failed')::int AS successful,
       COUNT(g.id) FILTER (WHERE g.status = 'failed')::int AS failed,
       COUNT(DISTINCT g.user_id) FILTER (WHERE g.status <> 'failed')::int AS active_users
     FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, INTERVAL '1 day') AS days(day)
     LEFT JOIN generation_runs g ON g.created_at >= days.day AND g.created_at < days.day + INTERVAL '1 day'
     GROUP BY days.day ORDER BY days.day`,
  );

  const rolesResult = await query<{ role: string; users: number }>(
    `SELECT role, COUNT(*)::int AS users
     FROM users GROUP BY role ORDER BY users DESC, role`,
  );

  const usersResult = await query<{ email: string; role: string; status: string; generations: number; created_at: string }>(
    `SELECT u.email, u.role, u.status,
       (SELECT COUNT(*)::int FROM generation_runs g WHERE g.user_id = u.id AND g.status <> 'failed') AS generations,
       u.created_at
     FROM users u ORDER BY u.created_at DESC LIMIT 8`,
  );

  const errorsResult = await query<{ email: string; model: string; error_code: string | null; duration_ms: number | null; created_at: string }>(
    `SELECT u.email, g.model_id AS model, g.error_code, g.duration_ms, g.created_at
     FROM generation_runs g JOIN users u ON u.id = g.user_id
     WHERE g.status = 'failed' ORDER BY g.created_at DESC LIMIT 8`,
  );

  const overview = overviewResult.rows[0];
  return {
    overview: {
      users: overview.users,
      activeUsersToday: overview.active_users_today,
      generationsToday: overview.generations_today,
      failedToday: overview.failed_today,
      totalGenerations: overview.total_generations,
      activeAccounts: overview.active_accounts,
    },
    dailyUsage: dailyResult.rows.map((row) => ({ day: row.day, successful: row.successful, failed: row.failed, activeUsers: row.active_users })),
    roleDistribution: rolesResult.rows,
    recentUsers: usersResult.rows.map((row) => ({ email: row.email, role: row.role, status: row.status, generations: row.generations, createdAt: row.created_at })),
    recentErrors: errorsResult.rows.map((row) => ({ email: row.email, model: row.model, errorCode: row.error_code, durationMs: row.duration_ms, createdAt: row.created_at })),
  };
}
