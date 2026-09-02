import path from "node:path";

const PGLITE_PREFIX = "pglite://";

export function parseAllowedModels(value: string | undefined): string[] {
  return [...new Set((value ?? "").split(",").map((model) => model.trim()).filter(Boolean))];
}

export function isEmbeddedDatabaseUrl(databaseUrl: string): boolean {
  return databaseUrl.startsWith(PGLITE_PREFIX);
}

export function embeddedDataDir(databaseUrl: string, cwd = process.cwd()): string {
  const configuredPath = databaseUrl.slice(PGLITE_PREFIX.length).trim();
  if (!configuredPath) throw new Error("Path DATABASE_URL PGlite wajib diisi.");
  return path.resolve(cwd, configuredPath);
}

function numberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function getEnv() {
  return {
    appUrl: process.env.APP_URL ?? "http://localhost:3000",
    googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    databaseUrl: process.env.DATABASE_URL ?? "",
    databaseSsl: process.env.DATABASE_SSL === "true",
    routerBaseUrl: (process.env.ROUTER9_BASE_URL ?? "").replace(/\/$/, ""),
    routerApiKey: process.env.ROUTER9_API_KEY ?? "",
    routerTimeoutMs: numberFromEnv("ROUTER9_TIMEOUT_MS", 120_000),
    sessionCookieSecure: process.env.SESSION_COOKIE_SECURE === "true",
  } as const;
}

export function requireEnv(name: keyof ReturnType<typeof getEnv>): string {
  const value = getEnv()[name];
  if (typeof value !== "string" || !value) {
    throw new Error(`${name} belum dikonfigurasi.`);
  }
  return value;
}
