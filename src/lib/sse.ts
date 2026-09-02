export type SseMessage = { event: string; data: unknown };
export type JsonSseEvent = Record<string, unknown>;
type JsonSseResult = { events: JsonSseEvent[]; done: boolean; remainder: string };

export function parseSseBuffer(buffer: string, flush = false): { messages: SseMessage[]; remainder: string } {
  const blocks = buffer.split(/\r?\n\r?\n/);
  const remainder = flush ? "" : blocks.pop() ?? "";
  if (flush && blocks.at(-1) === "") blocks.pop();
  const messages = blocks.flatMap((block) => {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) data.push(line.slice(5).trim());
    }
    if (!data.length) return [];
    try {
      return [{ event, data: JSON.parse(data.join("\n")) as unknown }];
    } catch {
      return [];
    }
  });
  return { messages, remainder };
}

export function parseJsonSseBuffer(buffer: string, flush = false): JsonSseResult {
  const blocks = buffer.split(/\r?\n\r?\n/);
  const remainder = flush ? "" : blocks.pop() ?? "";
  if (flush && blocks.at(-1) === "") blocks.pop();
  const events: JsonSseEvent[] = [];
  let done = false;
  for (const block of blocks) {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
    if (!data) continue;
    if (data === "[DONE]") {
      done = true;
      break;
    }
    try {
      events.push(JSON.parse(data) as JsonSseEvent);
    } catch {
      // Ignore non-JSON provider keepalive frames.
    }
  }
  return { events, done, remainder };
}

export async function* readJsonSseStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<JsonSseEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  try {
    while (true) {
      const { done: streamEnded, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !streamEnded });
      const parsed = parseJsonSseBuffer(buffer, streamEnded);
      buffer = parsed.remainder;
      for (const event of parsed.events) yield event;
      if (parsed.done) {
        finished = true;
        await reader.cancel().catch(() => undefined);
        break;
      }
      if (streamEnded) {
        finished = true;
        break;
      }
    }
  } finally {
    if (!finished) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function readSseStream(response: Response, onMessage: (message: SseMessage) => void) {
  if (!response.body) throw new Error("Stream respons kosong.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const parsed = parseSseBuffer(buffer, done);
      buffer = parsed.remainder;
      parsed.messages.forEach(onMessage);
      if (parsed.messages.some((message) => message.event === "done")) {
        await reader.cancel().catch(() => undefined);
        break;
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}
