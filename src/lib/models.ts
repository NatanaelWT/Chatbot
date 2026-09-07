import { query } from "./db";
import { parseAllowedModels } from "./env";
import { listRouterModels, type RouterModel } from "./9router";

export type PublicModel = { id: string; name: string; provider: string | null };

function configuredModels(): string[] {
  return parseAllowedModels(process.env.ROUTER9_ALLOWED_MODELS);
}

function configuredAllowlist(): Set<string> {
  return new Set(configuredModels());
}

export async function syncAndListModels(signal?: AbortSignal): Promise<PublicModel[]> {
  const configured = configuredModels();
  if (configured.length === 0) return [];
  const available = await listRouterModels(signal);
  const availableById = new Map(available.map((model) => [model.id, model]));
  const selected = configured.flatMap((id) => {
    const model = availableById.get(id);
    return model ? [model] : [];
  });
  for (const model of selected) {
    await query(
      `INSERT INTO model_catalog (id, display_name, provider, enabled)
       VALUES ($1, $2, $3, TRUE)
       ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name,
         provider = EXCLUDED.provider, updated_at = NOW()`,
      [model.id, modelName(model), typeof model.owned_by === "string" ? model.owned_by : null],
    );
  }
  if (selected.length === 0) return [];
  const result = await query<PublicModel>(
    `SELECT id, display_name AS name, provider
     FROM model_catalog WHERE enabled = TRUE AND id = ANY($1::text[])`,
    [selected.map((model) => model.id)],
  );
  const modelsById = new Map(result.rows.map((model) => [model.id, model]));
  return configured.flatMap((id) => {
    const model = modelsById.get(id);
    return model ? [model] : [];
  });
}

function modelName(model: RouterModel): string {
  const value = typeof model.name === "string" ? model.name : model.id;
  return value.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export async function getEnabledModel(modelId: string) {
  if (!configuredAllowlist().has(modelId)) return null;
  const result = await query<{ id: string }>(
    "SELECT id FROM model_catalog WHERE id = $1 AND enabled = TRUE",
    [modelId],
  );
  return result.rows[0] ?? null;
}
