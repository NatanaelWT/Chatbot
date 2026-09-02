import { randomUUID } from "node:crypto";
import { getCurrentUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { isSameOrigin, jsonError, parseJsonBody } from "@/lib/http";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError("Sesi tidak valid.", 401, "UNAUTHORIZED");
  const result = await query(
    `SELECT id, title, status, created_at, updated_at
     FROM conversations
     WHERE user_id = $1 AND status <> 'deleted'
       AND EXISTS (SELECT 1 FROM messages WHERE messages.conversation_id = conversations.id)
     ORDER BY updated_at DESC LIMIT 100`,
    [user.id],
  );
  return Response.json({ conversations: result.rows });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonError("Origin tidak diizinkan.", 403, "FORBIDDEN");
  const user = await getCurrentUser();
  if (!user) return jsonError("Sesi tidak valid.", 401, "UNAUTHORIZED");
  const body = await parseJsonBody(request);
  const title = body && typeof body === "object" && typeof (body as { title?: unknown }).title === "string"
    ? (body as { title: string }).title.trim().slice(0, 100) || "Chat baru"
    : "Chat baru";
  const result = await query(
    `INSERT INTO conversations (id, user_id, title) VALUES ($1, $2, $3)
     RETURNING id, title, status, created_at, updated_at`,
    [randomUUID(), user.id, title],
  );
  return Response.json({ conversation: result.rows[0] }, { status: 201 });
}
