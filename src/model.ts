import { ModelRegistry } from "@earendil-works/pi-coding-agent";

type RegisteredModel = NonNullable<ReturnType<ModelRegistry["find"]>>;

export const OPENAI_ASTRA_MODEL = {
  id: "gpt-6-astra",
  name: "GPT-6 Astra",
  api: "openai-codex-responses",
  provider: "openai-codex",
  baseUrl: "https://chatgpt.com/backend-api",
  reasoning: true,
  thinkingLevelMap: { xhigh: "xhigh", max: "max", minimal: "low" },
  input: ["text", "image"],
  cost: {
    input: 10,
    output: 50,
    cacheRead: 1,
    cacheWrite: 12.5,
  },
  contextWindow: 1_050_000,
  maxTokens: 128_000,
} satisfies RegisteredModel;

function findModel(modelRegistry: ModelRegistry, provider: string, modelId: string): RegisteredModel | undefined {
  return (
    modelRegistry.find(provider, modelId) ??
    (provider === OPENAI_ASTRA_MODEL.provider && modelId === OPENAI_ASTRA_MODEL.id ? OPENAI_ASTRA_MODEL : undefined)
  );
}

function getModels(modelRegistry: ModelRegistry): RegisteredModel[] {
  const models = modelRegistry.getAll();
  return models.some((model) => model.provider === OPENAI_ASTRA_MODEL.provider && model.id === OPENAI_ASTRA_MODEL.id)
    ? models
    : [...models, OPENAI_ASTRA_MODEL];
}

export function resolveRequestedModel(modelRegistry: ModelRegistry, provider: string | undefined, modelArg: string | undefined) {
  if (!modelArg) return undefined;

  const slashIndex = modelArg.indexOf("/");
  if (slashIndex > 0) {
    const parsedProvider = modelArg.slice(0, slashIndex);
    const parsedModel = modelArg.slice(slashIndex + 1);
    const model = findModel(modelRegistry, parsedProvider, parsedModel);
    if (!model) throw new Error(`Could not find model ${parsedProvider}/${parsedModel}.`);
    return model;
  }

  if (provider) {
    const model = findModel(modelRegistry, provider, modelArg);
    if (!model) throw new Error(`Could not find model ${provider}/${modelArg}.`);
    return model;
  }

  const models = getModels(modelRegistry);
  const exactMatches = models.filter((model) => model.id === modelArg || model.name === modelArg);
  if (exactMatches.length === 1) return exactMatches[0];
  if (exactMatches.length > 1) {
    throw new Error(`Model "${modelArg}" is ambiguous. Use --model <provider>/<model>.`);
  }

  const fuzzyMatches = models.filter((model) => model.id.includes(modelArg) || model.name.includes(modelArg));
  if (fuzzyMatches.length === 1) return fuzzyMatches[0];
  if (fuzzyMatches.length > 1) {
    throw new Error(`Model "${modelArg}" is ambiguous. Use --model <provider>/<model>.`);
  }

  throw new Error(`Could not find model "${modelArg}".`);
}
