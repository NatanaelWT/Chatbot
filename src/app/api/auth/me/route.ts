import { getCurrentSession } from "@/lib/auth";
import { jsonError } from "@/lib/http";

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return jsonError("Sesi tidak valid.", 401, "UNAUTHORIZED");
  return Response.json({ user: session.user, impersonating: session.impersonator !== null });
}
