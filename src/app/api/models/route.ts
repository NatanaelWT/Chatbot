import { getCurrentUser } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { syncAndListModels } from "@/lib/models";
import { RouterError } from "@/lib/9router";

export async function GET(request: Request) {
  if (!(await getCurrentUser())) return jsonError("Sesi tidak valid.", 401, "UNAUTHORIZED");
  try {
    return Response.json({ models: await syncAndListModels(request.signal) });
  } catch (error) {
    const message = error instanceof RouterError ? error.message : "Daftar model tidak tersedia.";
    return jsonError(message, 502, "ROUTER_UNAVAILABLE");
  }
}
