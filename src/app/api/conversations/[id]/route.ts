import { getCurrentUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { isSameOrigin, jsonError, parseJsonBody } from "@/lib/http";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return jsonError("Sesi tidak valid.", 401, "UNAUTHORIZED");
  const { id } = await context.params;
  const conversation = await query(
    `SELECT id, title, status, created_at, updated_at
     FROM conversations WHERE id = $1 AND user_id = $2 AND status <> 'deleted'`,
    [id, user.id],
  );
  if (!conversation.rows[0]) return jsonError("Percakapan tidak ditemukan.", 404, "NOT_FOUND");
  const messages = await query(
    `SELECT id, parent_message_id, role, content_json, status, created_at
     FROM messages WHERE conversation_id = $1 ORDER BY created_at`,
    [id],
  );
  return Response.json({ conversation: conversation.rows[0], messages: messages.rows });
}

export async function PATCH(request: Request, context: RouteContext) {
  if (!isSameOrigin(request)) return jsonError("Origin tidak diizinkan.", 403, "FORBIDDEN");
  const user = await getCurrentUser();
  if (!user) return jsonError("Sesi tidak valid.", 401, "UNAUTHORIZED");
  const body = await parseJsonBody(request);
  if (!body || typeof body !== "object") return jsonError("Data tidak valid.");
  const title = typeof (body as { title?: unknown }).title === "string" ? (body as { title: string }).title.trim().slice(0, 100) : undefined;
  const status = (body as { status?: unknown }).status;
  if (!title && status !== "active" && status !== "archived") return jsonError("Judul atau status tidak valid.");
  const { id } = await context.params;
  const result = await query(
    `UPDATE conversations SET title = COALESCE($3, title), status = COALESCE($4, status), updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND status <> 'deleted'
     RETURNING id, title, status, created_at, updated_at`,
    [id, user.id, title ?? null, status === "active" || status === "archived" ? status : null],
  );
  if (!result.rows[0]) return jsonError("Percakapan tidak ditemukan.", 404, "NOT_FOUND");
  return Response.json({ conversation: result.rows[0] });
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!isSameOrigin(request)) return jsonError("Origin tidak diizinkan.", 403, "FORBIDDEN");
  const user = await getCurrentUser();
  if (!user) return jsonError("Sesi tidak valid.", 401, "UNAUTHORIZED");
  const { id } = await context.params;
  const result = await query(
    `UPDATE conversations SET status = 'deleted', updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND status <> 'deleted' RETURNING id`,
    [id, user.id],
  );
  if (!result.rows[0]) return jsonError("Percakapan tidak ditemukan.", 404, "NOT_FOUND");
  return Response.json({ ok: true });
}
