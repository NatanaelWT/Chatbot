import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getEnv } from "./env.ts";

export const GOOGLE_OAUTH_COOKIE = "routerchat_google_oauth";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_TOKEN_INFO_URL = "https://oauth2.googleapis.com/tokeninfo";
const TRANSACTION_SECONDS = 10 * 60;

type GoogleOAuthConfig = {
  appOrigin: string;
  callbackUrl: string;
  clientId: string;
  clientSecret: string;
};

export type GoogleOAuthTransaction = {
  state: string;
  verifier: string;
  nonce: string;
  createdAt: number;
};

export type GoogleIdentity = { subject: string; email: string };

export function redirectResponse(location: string | URL, status: 302 | 303 = 302): Response {
  return new Response(null, { status, headers: { Location: location.toString() } });
}

export function getGoogleOAuthConfig(): GoogleOAuthConfig {
  const { appUrl, googleClientId, googleClientSecret } = getEnv();
  let appOrigin: string;
  try {
    const url = new URL(appUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    appOrigin = url.origin;
  } catch {
    throw new Error("APP_URL tidak valid.");
  }
  if (!googleClientId || !googleClientSecret) throw new Error("Google OAuth belum dikonfigurasi.");
  return {
    appOrigin,
    callbackUrl: new URL("/api/auth/google/callback", appOrigin).toString(),
    clientId: googleClientId,
    clientSecret: googleClientSecret,
  };
}

export function createGoogleOAuthTransaction(): GoogleOAuthTransaction {
  return {
    state: randomBytes(32).toString("base64url"),
    verifier: randomBytes(48).toString("base64url"),
    nonce: randomBytes(32).toString("base64url"),
    createdAt: Date.now(),
  };
}

export function googleAuthorizationUrl(config: GoogleOAuthConfig, transaction: GoogleOAuthTransaction): string {
  const challenge = createHash("sha256").update(transaction.verifier).digest("base64url");
  const url = new URL(GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.callbackUrl,
    response_type: "code",
    scope: "openid email",
    state: transaction.state,
    nonce: transaction.nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return url.toString();
}

export function encodeGoogleOAuthTransaction(transaction: GoogleOAuthTransaction): string {
  return Buffer.from(JSON.stringify(transaction)).toString("base64url");
}

export function decodeGoogleOAuthTransaction(value: string | undefined): GoogleOAuthTransaction | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<GoogleOAuthTransaction>;
    const safe = (item: unknown) => typeof item === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(item);
    if (!safe(parsed.state) || !safe(parsed.verifier) || !safe(parsed.nonce)
      || typeof parsed.createdAt !== "number" || Date.now() - parsed.createdAt > TRANSACTION_SECONDS * 1000
      || parsed.createdAt > Date.now() + 60_000) return null;
    return parsed as GoogleOAuthTransaction;
  } catch {
    return null;
  }
}

export function googleOAuthCookie(value: string, secure: boolean, clear = false): string {
  return `${GOOGLE_OAUTH_COOKIE}=${clear ? "" : value}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : TRANSACTION_SECONDS}${secure ? "; Secure" : ""}`;
}

export function matchesOAuthState(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

export function isGmailAddress(email: string): boolean {
  return email.endsWith("@gmail.com");
}

export function validateGoogleIdentity(claims: Record<string, unknown>, clientId: string, nonce: string): GoogleIdentity | null {
  const issuerValid = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  const verified = claims.email_verified === true || claims.email_verified === "true";
  const expiresAt = Number(claims.exp);
  if (!issuerValid || claims.aud !== clientId || claims.nonce !== nonce || !verified
    || !Number.isFinite(expiresAt) || expiresAt * 1000 <= Date.now()
    || typeof claims.sub !== "string" || !claims.sub || !email) return null;
  return { subject: claims.sub, email };
}

export async function exchangeGoogleCode(code: string, transaction: GoogleOAuthTransaction, config: GoogleOAuthConfig): Promise<GoogleIdentity> {
  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.callbackUrl,
      grant_type: "authorization_code",
      code_verifier: transaction.verifier,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const token = await tokenResponse.json().catch(() => null) as { id_token?: unknown } | null;
  if (!tokenResponse.ok || typeof token?.id_token !== "string") throw new Error("Pertukaran kode Google gagal.");

  const infoResponse = await fetch(`${GOOGLE_TOKEN_INFO_URL}?id_token=${encodeURIComponent(token.id_token)}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const claims = await infoResponse.json().catch(() => null) as Record<string, unknown> | null;
  const identity = infoResponse.ok && claims ? validateGoogleIdentity(claims, config.clientId, transaction.nonce) : null;
  if (!identity) throw new Error("Identitas Google tidak valid.");
  return identity;
}
