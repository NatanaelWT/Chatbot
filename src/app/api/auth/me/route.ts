import { getCurrentUser } from "@/lib/auth";
import { jsonError } from "@/lib/http";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError("Sesi tidak valid.", 401, "UNAUTHORIZED");
  return Response.json({ user });
}
