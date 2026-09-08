import { getEnv } from "./env.ts";
import { readJsonSseStream } from "./sse.ts";

export type RouterModel = {
  id: string;
  object?: string;
  owned_by?: string;
  [key: string]: unknown;
};

export class RouterError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "RouterError";
    this.status = status;
  }
}

function routerHeaders(): HeadersInit {
  const { routerApiKey, routerBaseUrl } = getEnv();
  if (!routerBaseUrl || !routerApiKey) throw new RouterError(503, "Provider AI belum dikonfigurasi.");
  return { Authorization: `Bearer ${routerApiKey}`, "Content-Type": "application/json" };
}

async function readError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const json = JSON.parse(text) as { error?: { message?: string } | string };
    if (typeof json.error === "string") return json.error;
    if (json.error?.message) return json.error.message;
  } catch {
    // Keep the provider response private; expose only a short generic error.
  }
  return `Provider AI mengembalikan HTTP ${response.status}.`;
}

export async function listRouterModels(signal?: AbortSignal): Promise<RouterModel[]> {
  const { routerBaseUrl, routerTimeoutMs } = getEnv();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), routerTimeoutMs);
  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(`${routerBaseUrl}/models`, { headers: routerHeaders(), signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new RouterError(response.status, await readError(response));
    const json = (await response.json()) as { data?: RouterModel[] };
    return Array.isArray(json.data) ? json.data.filter((model) => typeof model.id === "string") : [];
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export type RouterStreamEvent = Record<string, unknown>;

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503]);

function providerEventError(event: RouterStreamEvent): RouterError | null {
  const value = event.error;
  if (!value) return null;
  const error = typeof value === "object" ? value as Record<string, unknown> : {};
  const rawCode = error.status ?? error.code;
  let status = typeof rawCode === "number" && rawCode >= 400 && rawCode <= 599 ? rawCode : 502;
  const code = typeof rawCode === "string" ? rawCode.toLowerCase() : "";
  if (code.includes("rate") || code.includes("quota")) status = 429;
  else if (code.includes("auth") || code.includes("key")) status = 401;
  else if (code.includes("timeout")) status = 504;
  const message = status === 429
    ? "Provider AI sedang membatasi permintaan. Coba lagi sesaat."
    : status === 401 || status === 403
      ? "Autentikasi provider AI ditolak. Hubungi administrator."
      : "Provider AI gagal memproses jawaban.";
  return new RouterError(status, message);
}

function normalizeRouterError(error: unknown): unknown {
  if (error instanceof RouterError || (error instanceof Error && error.name === "AbortError")) return error;
  return new RouterError(502, "Provider AI tidak dapat dihubungi.");
}

async function* streamRouterChatAttempt(
  payload: Record<string, unknown>,
  signal: AbortSignal | undefined,
): AsyncGenerator<RouterStreamEvent> {
  const { routerBaseUrl, routerTimeoutMs } = getEnv();
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const resetIdleTimeout = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, routerTimeoutMs);
  };
  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  resetIdleTimeout();
  try {
    const response = await fetch(`${routerBaseUrl}/chat/completions`, {
      method: "POST",
      headers: routerHeaders(),
      body: JSON.stringify({ ...payload, stream: true }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new RouterError(response.status, await readError(response));
    if (!response.body) throw new RouterError(502, "Stream provider AI kosong.");
    for await (const event of readJsonSseStream(response.body)) {
      resetIdleTimeout();
      yield event;
    }
  } catch (error) {
    if (timedOut) throw new RouterError(504, "Provider AI terlalu lama tidak mengirim jawaban.");
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function* streamRouterChat(payload: Record<string, unknown>, signal?: AbortSignal): AsyncGenerator<RouterStreamEvent> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let hasContent = false;
    try {
      for await (const event of streamRouterChatAttempt(payload, signal)) {
        const eventError = providerEventError(event);
        if (eventError) throw eventError;
        if (extractDelta(event)) hasContent = true;
        yield event;
      }
      if (!hasContent) throw new RouterError(502, "Provider AI tidak mengirim jawaban.");
      return;
    } catch (error) {
      if (signal?.aborted) throw error;
      const normalized = normalizeRouterError(error);
      if (attempt === 0 && !hasContent && normalized instanceof RouterError && RETRYABLE_STATUSES.has(normalized.status)) continue;
      throw normalized;
    }
  }
}

export function extractDelta(event: RouterStreamEvent): string {
  const choices = Array.isArray(event.choices) ? event.choices : [];
  const first = choices[0] as { delta?: { content?: unknown }; message?: { content?: unknown } } | undefined;
  const content = first?.delta?.content ?? first?.message?.content;
  return typeof content === "string" ? content : "";
}

export function extractUsage(event: RouterStreamEvent): { input: number; output: number } {
  const usage = event.usage as { prompt_tokens?: unknown; completion_tokens?: unknown } | undefined;
  return {
    input: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : 0,
    output: typeof usage?.completion_tokens === "number" ? usage.completion_tokens : 0,
  };
}
