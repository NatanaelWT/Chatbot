import { cookies } from "next/headers";
import { createSession, findOrCreateGoogleUser, setSessionCookie } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { decodeGoogleOAuthTransaction, exchangeGoogleCode, getGoogleOAuthConfig, GOOGLE_OAUTH_COOKIE, googleOAuthCookie, isGmailAddress, matchesOAuthState, redirectResponse } from "@/lib/google-auth";
import { checkRateLimit, requestIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

type AuthError = "configuration" | "denied" | "gmail_required" | "invalid" | "rate_limited" | "suspended";

function errorRedirect(request: Request, error: AuthError, appOrigin?: string): Response {
  const url = new URL("/", appOrigin ?? new URL(request.url).origin);
  url.searchParams.set("auth_error", error);
  const response = redirectResponse(url, 303);
  response.headers.append("Set-Cookie", googleOAuthCookie("", getEnv().sessionCookieSecure, true));
  return response;
}

export async function GET(request: Request) {
  let config: ReturnType<typeof getGoogleOAuthConfig>;
  try {
    config = getGoogleOAuthConfig();
  } catch {
    return errorRedirect(request, "configuration");
  }

  const url = new URL(request.url);
  const transaction = decodeGoogleOAuthTransaction((await cookies()).get(GOOGLE_OAUTH_COOKIE)?.value);
  const state = url.searchParams.get("state");
  if (!transaction || !state || !matchesOAuthState(transaction.state, state)) {
    return errorRedirect(request, "invalid", config.appOrigin);
  }
  if (url.searchParams.get("error")) return errorRedirect(request, "denied", config.appOrigin);
  const code = url.searchParams.get("code");
  if (!code) return errorRedirect(request, "invalid", config.appOrigin);
  if (!(await checkRateLimit(`google-callback:${requestIp(request)}`, 30, 900))) {
    return errorRedirect(request, "rate_limited", config.appOrigin);
  }

  try {
    const identity = await exchangeGoogleCode(code, transaction, config);
    if (!isGmailAddress(identity.email)) return errorRedirect(request, "gmail_required", config.appOrigin);
    const user = await findOrCreateGoogleUser(identity.email, identity.subject);
    if (user.status !== "active") return errorRedirect(request, "suspended", config.appOrigin);
    const token = await createSession(user.id);
    const response = redirectResponse(new URL("/", config.appOrigin), 303);
    response.headers.append("Set-Cookie", googleOAuthCookie("", getEnv().sessionCookieSecure, true));
    return setSessionCookie(response, token);
  } catch (error) {
    console.error("Google authentication failed", error instanceof Error ? error.message : "Unknown error");
    return errorRedirect(request, "invalid", config.appOrigin);
  }
}
