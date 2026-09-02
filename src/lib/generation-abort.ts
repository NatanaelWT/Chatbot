type GenerationAbortGlobals = typeof globalThis & {
  routerChatGenerationAborts?: Map<string, AbortController>;
};

function key(userId: string, requestId: string): string {
  return `${userId}\0${requestId}`;
}

function controllers(): Map<string, AbortController> {
  // ponytail: Cancellation is process-local; use shared coordination when deploying multiple app instances.
  const globals = globalThis as GenerationAbortGlobals;
  globals.routerChatGenerationAborts ??= new Map();
  return globals.routerChatGenerationAborts;
}

export function registerGenerationAbort(userId: string, requestId: string): AbortController | null {
  const generationKey = key(userId, requestId);
  if (controllers().has(generationKey)) return null;
  const controller = new AbortController();
  controllers().set(generationKey, controller);
  return controller;
}

export function abortGeneration(userId: string, requestId: string): boolean {
  const controller = controllers().get(key(userId, requestId));
  if (!controller) return false;
  controller.abort();
  return true;
}

export function clearGenerationAbort(userId: string, requestId: string, controller: AbortController): void {
  const generationKey = key(userId, requestId);
  if (controllers().get(generationKey) === controller) controllers().delete(generationKey);
}
