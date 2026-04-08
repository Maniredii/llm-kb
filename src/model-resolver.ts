import { getModels, type Model } from "@mariozechner/pi-ai";
import { AuthStorage } from "@mariozechner/pi-coding-agent";

/**
 * Map from Anthropic model IDs to OpenRouter equivalents.
 */
const ANTHROPIC_TO_OPENROUTER: Record<string, string> = {
  "claude-haiku-4-5": "anthropic/claude-haiku-4.5",
  "claude-sonnet-4-6": "anthropic/claude-sonnet-4.6",
  "claude-sonnet-4-5": "anthropic/claude-sonnet-4.5",
  "claude-sonnet-4-0": "anthropic/claude-sonnet-4",
  "claude-opus-4-5": "anthropic/claude-opus-4.5",
};

/** Providers to try, in priority order */
const PROVIDERS = ["anthropic", "openrouter"] as const;

/**
 * Resolve a model by ID, checking which provider actually has credentials.
 *
 * Priority:
 * 1. Anthropic direct (if API key available)
 * 2. OpenRouter (maps model ID to openrouter equivalent)
 *
 * Returns undefined if no provider has credentials for the model.
 */
export async function resolveModel(
  modelId: string,
  authStorage?: AuthStorage
): Promise<Model<any> | undefined> {
  const storage = authStorage ?? AuthStorage.create();

  // Try Anthropic first
  const anthropicKey = await storage.getApiKey("anthropic");
  if (anthropicKey) {
    const model = getModels("anthropic").find((m) => m.id === modelId);
    if (model) return model;
  }

  // Try OpenRouter
  const openrouterKey = await storage.getApiKey("openrouter");
  if (openrouterKey) {
    // Map anthropic model ID to openrouter equivalent
    const orId = ANTHROPIC_TO_OPENROUTER[modelId] ?? modelId;
    const model = getModels("openrouter").find((m) => m.id === orId);
    if (model) return model;
  }

  return undefined;
}

/**
 * Get an API key from whichever provider is available.
 * Tries anthropic first, then openrouter.
 */
export async function resolveApiKey(
  authStorage?: AuthStorage
): Promise<{ key: string; provider: string } | undefined> {
  const storage = authStorage ?? AuthStorage.create();

  for (const provider of PROVIDERS) {
    const key = await storage.getApiKey(provider);
    if (key) return { key, provider };
  }

  return undefined;
}
