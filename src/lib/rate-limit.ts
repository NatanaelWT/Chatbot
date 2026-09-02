import { createHash } from "node:crypto";
import { query } from "./db";

export async function checkRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const keyHash = createHash("sha256").update(key).digest("hex");
  const result = await query<{ request_count: number }>(
    `INSERT INTO rate_limits (key_hash, window_start, request_count)
     VALUES ($1, NOW(), 1)
     ON CONFLICT (key_hash) DO UPDATE SET
       request_count = CASE
         WHEN rate_limits.window_start < NOW() - ($2 * INTERVAL '1 second') THEN 1
         ELSE rate_limits.request_count + 1
       END,
       window_start = CASE
         WHEN rate_limits.window_start < NOW() - ($2 * INTERVAL '1 second') THEN NOW()
         ELSE rate_limits.window_start
       END
     RETURNING request_count`,
    [keyHash, windowSeconds],
  );
  return result.rows[0].request_count <= limit;
}

export function requestIp(request: Request): string {
  return request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}
