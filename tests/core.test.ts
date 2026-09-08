import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { isAdminRole } from "../src/lib/roles.ts";
import { embeddedDataDir, isEmbeddedDatabaseUrl, parseAllowedModels } from "../src/lib/env.ts";
import { isGmailAddress, matchesOAuthState, redirectResponse, validateGoogleIdentity } from "../src/lib/google-auth.ts";
import { abortGeneration, clearGenerationAbort, registerGenerationAbort } from "../src/lib/generation-abort.ts";
import { isSameOrigin } from "../src/lib/security.ts";
import { RouterError, streamRouterChat } from "../src/lib/9router.ts";
import { parseJsonSseBuffer, parseSseBuffer, readJsonSseStream, readSseStream } from "../src/lib/sse.ts";

test("only the persisted admin role grants dashboard access", () => {
  assert.equal(isAdminRole("admin"), true);
  assert.equal(isAdminRole("user"), false);
  assert.equal(isAdminRole(undefined), false);
});

test("only the generation owner can stop an active provider request", () => {
  const controller = registerGenerationAbort("user-1", "request-1");
  assert.ok(controller);
  assert.equal(registerGenerationAbort("user-1", "request-1"), null);
  assert.equal(abortGeneration("user-2", "request-1"), false);
  assert.equal(controller.signal.aborted, false);
  assert.equal(abortGeneration("user-1", "request-1"), true);
  assert.equal(controller.signal.aborted, true);
  clearGenerationAbort("user-1", "request-1", controller);
  assert.equal(abortGeneration("user-1", "request-1"), false);
});

test("fresh schema has no monetization storage and accepts generations directly", async () => {
  const database = await PGlite.create();
  try {
    const schema = await readFile(new URL("../database/schema.sql", import.meta.url), "utf8");
    await database.exec(schema);
    await database.exec(schema);
    const obsoleteTables = await database.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
       AND table_name IN ('plans', 'subscriptions', 'quota_periods', 'usage_ledger', 'billing_events')`,
    );
    const obsoleteColumns = await database.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public'
       AND ((table_name = 'generation_runs' AND column_name IN ('quota_period_id', 'reserved_credits', 'charged_credits'))
         OR (table_name = 'model_catalog' AND column_name IN ('tier', 'input_rate', 'output_rate')))`,
    );
    assert.deepEqual(obsoleteTables.rows, []);
    assert.deepEqual(obsoleteColumns.rows, []);
    await database.exec(`
      INSERT INTO users (id, email) VALUES ('user-1', 'user@gmail.com');
      INSERT INTO conversations (id, user_id) VALUES ('chat-1', 'user-1');
      INSERT INTO messages (id, conversation_id, role, content_json, status) VALUES ('message-1', 'chat-1', 'assistant', '{"text":""}', 'streaming');
      INSERT INTO generation_runs (id, request_id, user_id, conversation_id, assistant_message_id, model_id, status) VALUES ('run-1', 'request-1', 'user-1', 'chat-1', 'message-1', 'model-1', 'running');
    `);
    assert.equal((await database.query<{ count: number }>("SELECT COUNT(*)::int AS count FROM generation_runs")).rows[0].count, 1);
  } finally {
    await database.close();
  }
});

test("migration removes legacy monetization storage without deleting chat history", async () => {
  const database = await PGlite.create();
  try {
    await database.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT, google_sub TEXT, role TEXT NOT NULL DEFAULT 'user', status TEXT NOT NULL DEFAULT 'active', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      CREATE TABLE model_catalog (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, provider TEXT, tier TEXT NOT NULL, input_rate NUMERIC NOT NULL, output_rate NUMERIC NOT NULL, supports_vision BOOLEAN NOT NULL DEFAULT FALSE, supports_tools BOOLEAN NOT NULL DEFAULT FALSE, supports_streaming BOOLEAN NOT NULL DEFAULT TRUE, enabled BOOLEAN NOT NULL DEFAULT TRUE, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      CREATE TABLE conversations (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL DEFAULT 'Chat baru', status TEXT NOT NULL DEFAULT 'active', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), parent_message_id TEXT REFERENCES messages(id), role TEXT NOT NULL, content_json JSONB NOT NULL, status TEXT NOT NULL DEFAULT 'complete', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      CREATE TABLE plans (id TEXT PRIMARY KEY);
      CREATE TABLE subscriptions (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), plan_id TEXT REFERENCES plans(id));
      CREATE TABLE quota_periods (id TEXT PRIMARY KEY, subscription_id TEXT REFERENCES subscriptions(id));
      CREATE TABLE generation_runs (id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL REFERENCES users(id), conversation_id TEXT NOT NULL REFERENCES conversations(id), assistant_message_id TEXT NOT NULL REFERENCES messages(id), model_id TEXT NOT NULL, quota_period_id TEXT REFERENCES quota_periods(id), input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, reserved_credits INTEGER NOT NULL DEFAULT 0, charged_credits INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, error_code TEXT, duration_ms INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), completed_at TIMESTAMPTZ);
      CREATE TABLE usage_ledger (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), generation_run_id TEXT REFERENCES generation_runs(id), credit_delta INTEGER NOT NULL);
      CREATE TABLE billing_events (id TEXT PRIMARY KEY);
      INSERT INTO users (id, email) VALUES ('user-1', 'user@gmail.com');
      INSERT INTO model_catalog (id, display_name, tier, input_rate, output_rate) VALUES ('model-1', 'Model 1', 'paid', 1, 2);
      INSERT INTO conversations (id, user_id) VALUES ('chat-1', 'user-1');
      INSERT INTO messages (id, conversation_id, role, content_json, status) VALUES
        ('prompt-1', 'chat-1', 'user', '{"text":"question"}', 'complete'),
        ('message-1', 'chat-1', 'assistant', '{"text":"saved"}', 'complete');
      INSERT INTO generation_runs (id, request_id, user_id, conversation_id, assistant_message_id, model_id, status) VALUES ('run-1', 'request-1', 'user-1', 'chat-1', 'message-1', 'model-1', 'complete');
    `);
    const schema = await readFile(new URL("../database/schema.sql", import.meta.url), "utf8");
    await database.exec(schema);
    const obsolete = await database.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'
       AND table_name IN ('plans', 'subscriptions', 'quota_periods', 'usage_ledger', 'billing_events')`,
    );
    const runs = await database.query<{ answer: string; parent_message_id: string | null }>(
      `SELECT m.content_json->>'text' AS answer, m.parent_message_id FROM generation_runs g JOIN messages m ON m.id = g.assistant_message_id WHERE g.id = 'run-1'`,
    );
    assert.equal(obsolete.rows[0].count, 0);
    assert.deepEqual(runs.rows, [{ answer: "saved", parent_message_id: "prompt-1" }]);
  } finally {
    await database.close();
  }
});

test("Google identity accepts only valid verified Gmail claims for this OAuth client", () => {
  const claims = {
    iss: "https://accounts.google.com",
    aud: "client-id",
    nonce: "expected-nonce",
    sub: "google-subject",
    email: "User.Name@gmail.com",
    email_verified: true,
    exp: Math.floor(Date.now() / 1000) + 300,
  };
  assert.deepEqual(validateGoogleIdentity(claims, "client-id", "expected-nonce"), {
    subject: "google-subject",
    email: "user.name@gmail.com",
  });
  assert.equal(validateGoogleIdentity({ ...claims, aud: "other-client" }, "client-id", "expected-nonce"), null);
  assert.equal(validateGoogleIdentity({ ...claims, nonce: "other-nonce" }, "client-id", "expected-nonce"), null);
  assert.equal(validateGoogleIdentity({ ...claims, email_verified: false }, "client-id", "expected-nonce"), null);
  assert.equal(isGmailAddress("user@gmail.com"), true);
  assert.equal(isGmailAddress("user@example.com"), false);
  assert.equal(matchesOAuthState("valid-state", "valid-state"), true);
  assert.equal(matchesOAuthState("valid-state", "other-state"), false);
  const redirect = redirectResponse("http://localhost:3000/", 303);
  redirect.headers.append("Set-Cookie", "oauth=test");
  assert.equal(redirect.headers.get("set-cookie"), "oauth=test");
});

test("configured model order keeps the first allowlisted model as default", () => {
  assert.deepEqual(parseAllowedModels(" Max, Fast, Max, Reasoning "), ["Max", "Fast", "Reasoning"]);
  assert.deepEqual(parseAllowedModels("  "), []);
});

test("SSE parser keeps incomplete blocks for the next network chunk", () => {
  const parsed = parseSseBuffer('event: delta\ndata: {"content":"hi"}\n\nevent: done\ndata:');
  assert.deepEqual(parsed.messages, [{ event: "delta", data: { content: "hi" } }]);
  assert.equal(parsed.remainder, "event: done\ndata:");
  assert.deepEqual(parseSseBuffer('event: done\ndata: {"status":"complete"}', true), {
    messages: [{ event: "done", data: { status: "complete" } }],
    remainder: "",
  });
});

test("client SSE stops at done without waiting for the connection to close", async () => {
  let canceled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('event: done\ndata: {"status":"complete"}\n\n'));
    },
    cancel() { canceled = true; },
  });
  const messages: unknown[] = [];
  await readSseStream(new Response(stream), (message) => messages.push(message));
  assert.deepEqual(messages, [{ event: "done", data: { status: "complete" } }]);
  assert.equal(canceled, true);
});

test("provider SSE stops at DONE without waiting for the connection to close", async () => {
  let canceled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"selesai"}}]}\n\ndata: [DONE]\n\n'));
    },
    cancel() { canceled = true; },
  });
  const events = [];
  for await (const event of readJsonSseStream(stream)) events.push(event);
  assert.equal(parseJsonSseBuffer("data: [DONE]\n\n").done, true);
  assert.equal(events.length, 1);
  assert.equal(canceled, true);
});

test("provider stream accepts an OpenAI finish reason when DONE is omitted", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(
        'data: {"choices":[{"delta":{"content":"selesai"},"finish_reason":null}]}\n\n' +
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
        'data: {"choices":[],"usage":{"completion_tokens":1}}\n\n',
      ));
      controller.close();
    },
  });
  const events = [];
  for await (const event of readJsonSseStream(stream)) events.push(event);
  assert.equal(events.length, 3);
  assert.equal((events[2].usage as { completion_tokens: number }).completion_tokens, 1);
});

test("provider stream rejects a connection closed without a completion signal", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"belum selesai"}}]}\n\n'));
      controller.close();
    },
  });
  await assert.rejects(async () => {
    for await (const event of readJsonSseStream(stream)) assert.ok(event);
  }, /sebelum penanda selesai/);
});

test("provider idle timeout is reported without doubling the wait", async () => {
  const originalFetch = globalThis.fetch;
  const originalBaseUrl = process.env.ROUTER9_BASE_URL;
  const originalApiKey = process.env.ROUTER9_API_KEY;
  const originalTimeout = process.env.ROUTER9_TIMEOUT_MS;
  process.env.ROUTER9_BASE_URL = "https://provider.test/v1";
  process.env.ROUTER9_API_KEY = "test-key";
  process.env.ROUTER9_TIMEOUT_MS = "10";
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
  };
  try {
    const stream = streamRouterChat({ model: "test", messages: [] });
    await assert.rejects(() => stream.next(), (error: unknown) => error instanceof RouterError && error.status === 504);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) delete process.env.ROUTER9_BASE_URL; else process.env.ROUTER9_BASE_URL = originalBaseUrl;
    if (originalApiKey === undefined) delete process.env.ROUTER9_API_KEY; else process.env.ROUTER9_API_KEY = originalApiKey;
    if (originalTimeout === undefined) delete process.env.ROUTER9_TIMEOUT_MS; else process.env.ROUTER9_TIMEOUT_MS = originalTimeout;
  }
});

test("provider chat retries one transient failure before content", async () => {
  const originalFetch = globalThis.fetch;
  const originalBaseUrl = process.env.ROUTER9_BASE_URL;
  const originalApiKey = process.env.ROUTER9_API_KEY;
  process.env.ROUTER9_BASE_URL = "https://provider.test/v1";
  process.env.ROUTER9_API_KEY = "test-key";
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return Response.json({ error: { message: "temporarily unavailable" } }, { status: 503 });
    return new Response('data: {"choices":[{"delta":{"content":"selesai"}}]}\n\ndata: [DONE]\n\n');
  };
  try {
    const events = [];
    for await (const event of streamRouterChat({ model: "test", messages: [] })) events.push(event);
    assert.equal(calls, 2);
    assert.equal(events.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) delete process.env.ROUTER9_BASE_URL; else process.env.ROUTER9_BASE_URL = originalBaseUrl;
    if (originalApiKey === undefined) delete process.env.ROUTER9_API_KEY; else process.env.ROUTER9_API_KEY = originalApiKey;
  }
});

test("provider SSE errors never become empty successful answers", async () => {
  const originalFetch = globalThis.fetch;
  const originalBaseUrl = process.env.ROUTER9_BASE_URL;
  const originalApiKey = process.env.ROUTER9_API_KEY;
  process.env.ROUTER9_BASE_URL = "https://provider.test/v1";
  process.env.ROUTER9_API_KEY = "test-key";
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response('data: {"error":{"code":"rate_limit_exceeded"}}\n\ndata: [DONE]\n\n');
  };
  try {
    const stream = streamRouterChat({ model: "test", messages: [] });
    await assert.rejects(() => stream.next(), (error: unknown) => error instanceof RouterError && error.status === 429);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) delete process.env.ROUTER9_BASE_URL; else process.env.ROUTER9_BASE_URL = originalBaseUrl;
    if (originalApiKey === undefined) delete process.env.ROUTER9_API_KEY; else process.env.ROUTER9_API_KEY = originalApiKey;
  }
});

test("same-origin validation honors the public Host header and rejects cross-site requests", () => {
  const localRequest = new Request("http://localhost:3000/api/chat", {
    headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
  });
  const crossSiteRequest = new Request("http://localhost:3000/api/chat", {
    headers: { host: "localhost:3000", origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
  });
  assert.equal(isSameOrigin(localRequest), true);
  assert.equal(isSameOrigin(crossSiteRequest), false);
});

test("embedded database URLs resolve to a local persistent path", () => {
  assert.equal(isEmbeddedDatabaseUrl("pglite://./.routerchat/pgdata"), true);
  assert.equal(isEmbeddedDatabaseUrl("postgresql://localhost/routerchat"), false);
  assert.match(embeddedDataDir("pglite://./.routerchat/pgdata"), /[\\/]\.routerchat[\\/]pgdata$/);
});
