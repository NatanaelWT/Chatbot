import { getEnv } from "./env";
import { readJsonSseStream } from "./sse";

export type RouterModel = {
  id: string;
  object?: string;
  owned_by?: string;
  [key: string]: unknown;
};

export class RouterError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "RouterError";
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

export async function* streamRouterChat(payload: Record<string, unknown>, signal?: AbortSignal): AsyncGenerator<RouterStreamEvent> {
  const { routerBaseUrl, routerTimeoutMs } = getEnv();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), routerTimeoutMs);
  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", onAbort, { once: true });
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
    for await (const event of readJsonSseStream(response.body)) yield event;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
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
