import { cookies } from "next/headers";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { query, withTransaction } from "./db";
import { getEnv } from "./env";

export const SESSION_COOKIE = "routerchat_session";
const SESSION_DAYS = 30;

type User = { id: string; email: string; role: "user" | "admin"; status: "active" | "suspended" };

type UserRow = User;
type GoogleUserRow = User & { google_sub: string | null };

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await query(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)",
    [randomUUID(), userId, hashSessionToken(token), expiresAt],
  );
  return token;
}

export function setSessionCookie(response: Response, token: string): Response {
  const { sessionCookieSecure } = getEnv();
  const value = `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 24 * 60 * 60}${sessionCookieSecure ? "; Secure" : ""}`;
  response.headers.append("Set-Cookie", value);
  return response;
}

export function clearSessionCookie(response: Response): Response {
  response.headers.append("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return response;
}

export async function getCurrentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const result = await query<UserRow>(
    `SELECT u.id, u.email, u.role, u.status
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > NOW() AND u.status = 'active'`,
    [hashSessionToken(token)],
  );
  return result.rows[0] ?? null;
}

export async function deleteCurrentSession(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await query("DELETE FROM sessions WHERE token_hash = $1", [hashSessionToken(token)]);
}

export async function findOrCreateGoogleUser(email: string, googleSubject: string): Promise<User> {
  return withTransaction(async (client) => {
    const matches = await client.query<GoogleUserRow>(
      `SELECT id, email, google_sub, role, status FROM users
       WHERE google_sub = $1 OR email = $2 FOR UPDATE`,
      [googleSubject, email],
    );
    const subjectUser = matches.rows.find((user) => user.google_sub === googleSubject);
    const emailUser = matches.rows.find((user) => user.email === email);
    if (subjectUser && emailUser && subjectUser.id !== emailUser.id) {
      throw new Error("GOOGLE_IDENTITY_CONFLICT");
    }
    const existing = subjectUser ?? emailUser;
    if (existing) {
      if (existing.google_sub && existing.google_sub !== googleSubject) {
        throw new Error("GOOGLE_IDENTITY_CONFLICT");
      }
      const updated = await client.query<User>(
        `UPDATE users SET email = $2, google_sub = $3 WHERE id = $1
         RETURNING id, email, role, status`,
        [existing.id, email, googleSubject],
      );
      return updated.rows[0];
    }

    const userId = randomUUID();
    const result = await client.query<User>(
      `INSERT INTO users (id, email, google_sub) VALUES ($1, $2, $3)
       RETURNING id, email, role, status`,
      [userId, email, googleSubject],
    );
    return result.rows[0];
  });
}
