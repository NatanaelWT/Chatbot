import { getEnv } from "@/lib/env";
import { createGoogleOAuthTransaction, encodeGoogleOAuthTransaction, getGoogleOAuthConfig, googleAuthorizationUrl, googleOAuthCookie, redirectResponse } from "@/lib/google-auth";
import { checkRateLimit, requestIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

function configurationError(request: Request): Response {
  const url = new URL("/", request.url);
  url.searchParams.set("auth_error", "configuration");
  return Response.redirect(url, 302);
}

export async function GET(request: Request) {
  let config: ReturnType<typeof getGoogleOAuthConfig>;
  try {
    config = getGoogleOAuthConfig();
  } catch {
    return configurationError(request);
  }

  if (new URL(request.url).origin !== config.appOrigin) {
    return Response.redirect(new URL("/api/auth/google", config.appOrigin), 302);
  }
  if (!(await checkRateLimit(`google-auth:${requestIp(request)}`, 20, 900))) {
    const url = new URL("/", config.appOrigin);
    url.searchParams.set("auth_error", "rate_limited");
    return Response.redirect(url, 302);
  }

  const transaction = createGoogleOAuthTransaction();
  const response = redirectResponse(googleAuthorizationUrl(config, transaction));
  response.headers.append("Set-Cookie", googleOAuthCookie(encodeGoogleOAuthTransaction(transaction), getEnv().sessionCookieSecure));
  return response;
}
