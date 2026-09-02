import { randomUUID } from "node:crypto";
import { getCurrentUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { abortGeneration, clearGenerationAbort, registerGenerationAbort } from "@/lib/generation-abort";
import { isAbortError, isSameOrigin, jsonError, parseJsonBody } from "@/lib/http";
import { getEnabledModel } from "@/lib/models";
import { checkRateLimit } from "@/lib/rate-limit";
import { extractDelta, extractUsage, RouterError, streamRouterChat } from "@/lib/9router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MESSAGE_LENGTH = 20_000;
const MAX_CONTEXT_MESSAGES = 40;
const MAX_CONTEXT_BYTES = 40_000;
const MAX_OUTPUT_TOKENS = 2_048;

type ContextRow = { role: "user" | "assistant" | "system"; content_json: { text?: unknown } };
type StartResult = {
  runId: string;
  assistantMessageId: string;
  context: Array<{ role: string; content: string }>;
};

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil([...text].length / 4));
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) return jsonError("Origin tidak diizinkan.", 403, "FORBIDDEN");
  const user = await getCurrentUser();
  if (!user) return jsonError("Sesi tidak valid.", 401, "UNAUTHORIZED");
  const requestId = new URL(request.url).searchParams.get("requestId");
  if (!requestId || !/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)) return jsonError("Request ID tidak valid.");
  if (!abortGeneration(user.id, requestId)) return jsonError("Generasi tidak ditemukan.", 404, "NOT_FOUND");
  return Response.json({ ok: true });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonError("Origin tidak diizinkan.", 403, "FORBIDDEN");
  const user = await getCurrentUser();
  if (!user) return jsonError("Sesi tidak valid.", 401, "UNAUTHORIZED");
  if (user.role !== "admin" && !(await checkRateLimit(`chat:${user.id}`, 30, 60))) {
    return jsonError("Terlalu banyak pesan.", 429, "RATE_LIMITED");
  }
  const body = await parseJsonBody(request);
  if (!body || typeof body !== "object") return jsonError("Data tidak valid.");
  const input = body as Record<string, unknown>;
  if (typeof input.conversationId !== "string" || typeof input.model !== "string" || typeof input.message !== "string") {
    return jsonError("Percakapan, model, dan pesan wajib diisi.");
  }
  const message = input.message.trim();
  if (!message || message.length > MAX_MESSAGE_LENGTH) return jsonError(`Pesan harus 1–${MAX_MESSAGE_LENGTH} karakter.`);
  const requestId = typeof input.requestId === "string" && /^[a-zA-Z0-9_-]{8,100}$/.test(input.requestId)
    ? input.requestId
    : randomUUID();
  const model = await getEnabledModel(input.model);
  if (!model) return jsonError("Model tidak tersedia.", 400, "MODEL_NOT_ALLOWED");

  const providerAbortController = registerGenerationAbort(user.id, requestId);
  if (!providerAbortController) return jsonError("Permintaan ini sedang diproses.", 409, "DUPLICATE_REQUEST");
  let started: StartResult;
  try {
    started = await startGeneration(user.id, input.conversationId, model.id, message, requestId);
  } catch (error) {
    clearGenerationAbort(user.id, requestId, providerAbortController);
    if (error instanceof Error && error.message === "NOT_FOUND") return jsonError("Percakapan tidak ditemukan.", 404, "NOT_FOUND");
    if (error instanceof Error && error.message === "DUPLICATE") return jsonError("Permintaan ini sudah diproses.", 409, "DUPLICATE_REQUEST");
    console.error("Could not start generation", error);
    return jsonError("Pesan tidak dapat diproses.", 500, "INTERNAL_ERROR");
  }

  const encoder = new TextEncoder();
  const inputTokensEstimate = started.context.reduce((total, item) => total + estimateTokens(item.content), 0);
  const abortProvider = () => providerAbortController.abort();
  if (request.signal.aborted) providerAbortController.abort();
  else request.signal.addEventListener("abort", abortProvider, { once: true });
  const stream = new ReadableStream({
    async start(controller) {
      const startedAt = Date.now();
      let answer = "";
      let inputTokens = 0;
      let outputTokens = 0;
      let streamError: unknown;
      const send = (event: string, data: unknown) => {
        try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { /* Client disconnected; settlement must continue. */ }
      };
      send("meta", { requestId, messageId: started.assistantMessageId });
      try {
        for await (const event of streamRouterChat(
          { model: model.id, messages: started.context, max_tokens: MAX_OUTPUT_TOKENS, stream_options: { include_usage: true } },
          providerAbortController.signal,
        )) {
          const delta = extractDelta(event);
          if (delta) {
            answer += delta;
            send("delta", { content: delta });
          }
          const usage = extractUsage(event);
          inputTokens = Math.max(inputTokens, usage.input);
          outputTokens = Math.max(outputTokens, usage.output);
        }
      } catch (error) {
        streamError = error;
      }

      const aborted = providerAbortController.signal.aborted || isAbortError(streamError);
      const status = streamError ? (answer ? "partial" : "failed") : aborted ? "partial" : "complete";
      const effectiveInput = inputTokens || inputTokensEstimate;
      const effectiveOutput = outputTokens || estimateTokens(answer);
      const errorCode = aborted ? "ABORTED" : streamError instanceof RouterError ? `ROUTER_${streamError.status}` : streamError ? "STREAM_ERROR" : null;
      try {
        await finishGeneration({
          ...started,
          answer,
          status,
          errorCode,
          inputTokens: effectiveInput,
          outputTokens: effectiveOutput,
          durationMs: Date.now() - startedAt,
        });
        if (streamError && !aborted) send("error", { message: streamError instanceof RouterError ? streamError.message : "Koneksi AI terputus." });
        send("done", { status, usage: { inputTokens: effectiveInput, outputTokens: effectiveOutput } });
      } catch (error) {
        console.error("Could not finish generation", error);
        send("error", { message: "Jawaban selesai, tetapi pencatatan penggunaan gagal." });
      } finally {
        request.signal.removeEventListener("abort", abortProvider);
        clearGenerationAbort(user.id, requestId, providerAbortController);
        try { controller.close(); } catch { /* Stream already canceled by the client. */ }
      }
    },
    cancel() {
      providerAbortController.abort();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}


async function startGeneration(userId: string, conversationId: string, modelId: string, message: string, requestId: string): Promise<StartResult> {
  return withTransaction(async (client) => {
    const conversation = await client.query<{ id: string; title: string }>(
      "SELECT id, title FROM conversations WHERE id = $1 AND user_id = $2 AND status = 'active' FOR UPDATE",
      [conversationId, userId],
    );
    if (!conversation.rows[0]) throw new Error("NOT_FOUND");
    const duplicate = await client.query("SELECT id FROM generation_runs WHERE request_id = $1", [requestId]);
    if (duplicate.rows[0]) throw new Error("DUPLICATE");
    const history = await client.query<ContextRow>(
      `SELECT role, content_json FROM (
         SELECT role, content_json, created_at FROM messages
         WHERE conversation_id = $1 AND role IN ('user', 'assistant', 'system') AND status IN ('complete', 'partial')
         ORDER BY created_at DESC LIMIT $2
       ) recent ORDER BY created_at`,
      [conversationId, MAX_CONTEXT_MESSAGES],
    );
    const allContext = [...history.rows.map((row) => ({ role: row.role, content: typeof row.content_json.text === "string" ? row.content_json.text : "" })), { role: "user", content: message }];
    const context: Array<{ role: string; content: string }> = [];
    let remainingBytes = MAX_CONTEXT_BYTES;
    for (let index = allContext.length - 1; index >= 0 && remainingBytes > 0; index -= 1) {
      const item = allContext[index];
      const content = Buffer.byteLength(item.content, "utf8") <= remainingBytes ? item.content : Buffer.from(item.content).subarray(-remainingBytes).toString("utf8").replace(/^\uFFFD+/, "");
      context.unshift({ role: item.role, content });
      remainingBytes -= Buffer.byteLength(content, "utf8");
    }
    const stale = await client.query<{ assistant_message_id: string }>(
      `UPDATE generation_runs SET status = 'failed', error_code = 'STALE_REQUEST', completed_at = NOW()
       WHERE user_id = $1 AND status = 'running' AND created_at < NOW() - INTERVAL '10 minutes'
       RETURNING assistant_message_id`,
      [userId],
    );
    for (const run of stale.rows) {
      await client.query("UPDATE messages SET status = 'failed' WHERE id = $1", [run.assistant_message_id]);
    }
    const userMessageId = randomUUID();
    const assistantMessageId = randomUUID();
    const runId = randomUUID();
    await client.query(
      `INSERT INTO messages (id, conversation_id, role, content_json, status) VALUES
       ($1, $2, 'user', $3, 'complete'), ($4, $2, 'assistant', $5, 'streaming')`,
      [userMessageId, conversationId, { text: message }, assistantMessageId, { text: "" }],
    );
    await client.query(
      `INSERT INTO generation_runs
       (id, request_id, user_id, conversation_id, assistant_message_id, model_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'running')`,
      [runId, requestId, userId, conversationId, assistantMessageId, modelId],
    );
    const title = conversation.rows[0].title === "Chat baru" ? message.replace(/\s+/g, " ").slice(0, 60) : conversation.rows[0].title;
    await client.query("UPDATE conversations SET title = $2, updated_at = NOW() WHERE id = $1", [conversationId, title]);
    return { runId, assistantMessageId, context };
  });
}

async function finishGeneration(input: StartResult & {
  answer: string;
  status: "complete" | "partial" | "failed";
  errorCode: string | null;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}): Promise<void> {
  await withTransaction(async (client) => {
    const updated = await client.query(
      `UPDATE generation_runs SET input_tokens = $2, output_tokens = $3,
         status = $4, error_code = $5, duration_ms = $6, completed_at = NOW()
       WHERE id = $1 AND status = 'running' RETURNING id`,
      [input.runId, input.inputTokens, input.outputTokens, input.status, input.errorCode, input.durationMs],
    );
    if (!updated.rows[0]) return;
    await client.query(
      "UPDATE messages SET content_json = $2, status = $3 WHERE id = $1",
      [input.assistantMessageId, { text: input.answer }, input.status],
    );
  });
}
