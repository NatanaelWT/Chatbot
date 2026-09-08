import { ImpersonationError, setSessionCookie, startImpersonation, stopImpersonation } from "@/lib/auth";
import { isSameOrigin, jsonError, parseJsonBody } from "@/lib/http";

function impersonationError(error: unknown): Response {
  if (!(error instanceof ImpersonationError)) throw error;
  if (error.code === "UNAUTHENTICATED") return jsonError("Sesi tidak valid.", 401, "UNAUTHORIZED");
  if (error.code === "TARGET_NOT_FOUND") return jsonError("Akun tujuan tidak tersedia.", 404, "NOT_FOUND");
  if (error.code === "ALREADY_IMPERSONATING" || error.code === "NOT_IMPERSONATING") {
    return jsonError("Status impersonasi sudah berubah. Muat ulang halaman.", 409, "CONFLICT");
  }
  return jsonError("Akun tersebut tidak dapat diakses melalui impersonasi.", 403, "FORBIDDEN");
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonError("Origin tidak diizinkan.", 403, "FORBIDDEN");
  const body = await parseJsonBody(request);
  const userId = body && typeof body === "object" && typeof (body as { userId?: unknown }).userId === "string"
    ? (body as { userId: string }).userId.trim()
    : "";
  if (!userId || userId.length > 128) return jsonError("User ID tidak valid.", 400, "BAD_REQUEST");
  try {
    const token = await startImpersonation(userId);
    return setSessionCookie(Response.json({ ok: true }), token);
  } catch (error) {
    return impersonationError(error);
  }
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) return jsonError("Origin tidak diizinkan.", 403, "FORBIDDEN");
  try {
    const token = await stopImpersonation();
    return setSessionCookie(Response.json({ ok: true }), token);
  } catch (error) {
    return impersonationError(error);
  }
}
