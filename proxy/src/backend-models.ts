import config from "./config.js";
import { log } from "./logger.js";
import { ALL_MODELS, type Model } from "./models.js";

const CACHE_TTL_MS = 60_000;

interface ModelsResponse {
  data?: Array<{ id?: string }>;
}

let cachedSupportedModels: Set<string> | null = null;
let cacheExpiresAt = 0;
let inflightFetch: Promise<Set<string> | null> | null = null;

function localSupportedModels(): Set<string> {
  return new Set(ALL_MODELS.map((model) => model.id));
}

function isFreePassthroughModel(modelId: string): boolean {
  return modelId === "openrouter/free" || modelId.endsWith(":free");
}

async function fetchBackendSupportedModels(): Promise<Set<string> | null> {
  try {
    const response = await fetch(`${config.backendUrl}/v1/models`, {
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      throw new Error(`Backend returned ${response.status}`);
    }

    const payload = (await response.json()) as ModelsResponse;
    const ids = (payload.data || [])
      .map((model) => model.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    if (ids.length === 0) {
      throw new Error("Backend returned an empty model list");
    }

    return new Set(ids);
  } catch (err) {
    log.warn(`Failed to refresh backend model list: ${err}`);
    return null;
  }
}

export function invalidateSupportedModelCache(): void {
  cachedSupportedModels = null;
  cacheExpiresAt = 0;
  inflightFetch = null;
}

export async function getSupportedModelIds(): Promise<Set<string>> {
  const now = Date.now();
  if (cachedSupportedModels && now < cacheExpiresAt) {
    return new Set(cachedSupportedModels);
  }

  if (!inflightFetch) {
    inflightFetch = fetchBackendSupportedModels()
      .then((supported) => {
        if (supported && supported.size > 0) {
          cachedSupportedModels = supported;
          cacheExpiresAt = Date.now() + CACHE_TTL_MS;
          return supported;
        }
        return cachedSupportedModels;
      })
      .finally(() => {
        inflightFetch = null;
      });
  }

  const supported = await inflightFetch;
  return new Set(supported || localSupportedModels());
}

export async function getAdvertisedModels(): Promise<Model[]> {
  const supported = await getSupportedModelIds();
  return ALL_MODELS.filter((model) => {
    return supported.has(model.id) || isFreePassthroughModel(model.id);
  });
}

export async function filterSupportedModels(models: string[]): Promise<string[]> {
  const supported = await getSupportedModelIds();
  return models.filter((model, index) => {
    return (
      (supported.has(model) || isFreePassthroughModel(model)) &&
      models.indexOf(model) === index
    );
  });
}
