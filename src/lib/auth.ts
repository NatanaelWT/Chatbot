import { cookies } from "next/headers";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { query, withTransaction } from "./db";
import { getEnv } from "./env";
import { impersonationDenial } from "./impersonation-policy";

export const SESSION_COOKIE = "routerchat_session";
const SESSION_DAYS = 30;

export type User = { id: string; email: string; role: "user" | "admin"; status: "active" | "suspended" };
export type AuthSession = { user: User; impersonator: User | null };

type GoogleUserRow = User & { google_sub: string | null };
type AuthSessionRow = User & {
  impersonator_id: string | null;
  impersonator_email: string | null;
  impersonator_role: "user" | "admin" | null;
  impersonator_status: "active" | "suspended" | null;
};

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

async function currentSessionToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

export async function createSession(userId: string): Promise<string> {
  const token = newSessionToken();
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

export async function getCurrentSession(): Promise<AuthSession | null> {
  const token = await currentSessionToken();
  if (!token) return null;
  const result = await query<AuthSessionRow>(
    `SELECT u.id, u.email, u.role, u.status,
       actor.id AS impersonator_id, actor.email AS impersonator_email,
       actor.role AS impersonator_role, actor.status AS impersonator_status
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN users actor ON actor.id = s.impersonator_user_id
     WHERE s.token_hash = $1 AND s.expires_at > NOW()
       AND ((s.impersonator_user_id IS NULL AND u.status = 'active')
         OR (s.impersonator_user_id IS NOT NULL AND actor.role = 'admin' AND actor.status = 'active'))`,
    [hashSessionToken(token)],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    user: { id: row.id, email: row.email, role: row.impersonator_id ? "user" : row.role, status: row.status },
    impersonator: row.impersonator_id ? {
      id: row.impersonator_id,
      email: row.impersonator_email!,
      role: row.impersonator_role!,
      status: row.impersonator_status!,
    } : null,
  };
}

export async function getCurrentUser(): Promise<User | null> {
  const session = await getCurrentSession();
  return session?.user.status === "active" ? session.user : null;
}

export async function deleteCurrentSession(): Promise<void> {
  const token = await currentSessionToken();
  if (!token) return;
  await withTransaction(async (client) => {
    const deleted = await client.query<{ id: string; user_id: string; impersonator_user_id: string | null }>(
      "DELETE FROM sessions WHERE token_hash = $1 RETURNING id, user_id, impersonator_user_id",
      [hashSessionToken(token)],
    );
    const session = deleted.rows[0];
    if (session?.impersonator_user_id) {
      await client.query(
        "INSERT INTO audit_logs (id, user_id, action, metadata) VALUES ($1, $2, 'admin.impersonation_ended', $3)",
        [randomUUID(), session.impersonator_user_id, { targetUserId: session.user_id, sessionId: session.id, reason: "logout" }],
      );
    }
  });
}

export class ImpersonationError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ImpersonationError";
  }
}

export async function startImpersonation(targetUserId: string): Promise<string> {
  const token = await currentSessionToken();
  if (!token) throw new ImpersonationError("UNAUTHENTICATED");
  const nextToken = newSessionToken();
  await withTransaction(async (client) => {
    const sessionResult = await client.query<{
      id: string;
      user_id: string;
      impersonator_user_id: string | null;
      role: string;
      status: string;
    }>(
      `SELECT s.id, s.user_id, s.impersonator_user_id, u.role, u.status
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > NOW() FOR UPDATE`,
      [hashSessionToken(token)],
    );
    const session = sessionResult.rows[0];
    if (!session) throw new ImpersonationError("UNAUTHENTICATED");
    if (session.impersonator_user_id) throw new ImpersonationError("ALREADY_IMPERSONATING");

    const targetResult = await client.query<User>(
      "SELECT id, email, role, status FROM users WHERE id = $1 FOR UPDATE",
      [targetUserId],
    );
    const target = targetResult.rows[0] ?? null;
    const denial = impersonationDenial(
      { id: session.user_id, role: session.role, status: session.status },
      target,
    );
    if (denial) throw new ImpersonationError(denial);

    await client.query(
      "UPDATE sessions SET user_id = $2, impersonator_user_id = $3, token_hash = $4 WHERE id = $1",
      [session.id, targetUserId, session.user_id, hashSessionToken(nextToken)],
    );
    await client.query(
      "INSERT INTO audit_logs (id, user_id, action, metadata) VALUES ($1, $2, 'admin.impersonation_started', $3)",
      [randomUUID(), session.user_id, { targetUserId, targetEmail: target!.email, sessionId: session.id }],
    );
  });
  return nextToken;
}

export async function stopImpersonation(): Promise<string> {
  const token = await currentSessionToken();
  if (!token) throw new ImpersonationError("UNAUTHENTICATED");
  const nextToken = newSessionToken();
  await withTransaction(async (client) => {
    const sessionResult = await client.query<{
      id: string;
      user_id: string;
      impersonator_user_id: string | null;
    }>(
      `SELECT id, user_id, impersonator_user_id FROM sessions
       WHERE token_hash = $1 AND expires_at > NOW() FOR UPDATE`,
      [hashSessionToken(token)],
    );
    const session = sessionResult.rows[0];
    if (!session) throw new ImpersonationError("UNAUTHENTICATED");
    if (!session.impersonator_user_id) throw new ImpersonationError("NOT_IMPERSONATING");
    const actorResult = await client.query<{ role: string; status: string }>(
      "SELECT role, status FROM users WHERE id = $1 FOR UPDATE",
      [session.impersonator_user_id],
    );
    const actor = actorResult.rows[0];
    if (actor?.role !== "admin" || actor.status !== "active") throw new ImpersonationError("ACTOR_NOT_ADMIN");

    await client.query(
      "UPDATE sessions SET user_id = $2, impersonator_user_id = NULL, token_hash = $3 WHERE id = $1",
      [session.id, session.impersonator_user_id, hashSessionToken(nextToken)],
    );
    await client.query(
      "INSERT INTO audit_logs (id, user_id, action, metadata) VALUES ($1, $2, 'admin.impersonation_ended', $3)",
      [randomUUID(), session.impersonator_user_id, { targetUserId: session.user_id, sessionId: session.id, reason: "returned" }],
    );
  });
  return nextToken;
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
