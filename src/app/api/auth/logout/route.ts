import { clearSessionCookie, deleteCurrentSession } from "@/lib/auth";
import { isSameOrigin, jsonError } from "@/lib/http";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonError("Origin tidak diizinkan.", 403, "FORBIDDEN");
  await deleteCurrentSession();
  return clearSessionCookie(Response.json({ ok: true }));
}
