import { ModelRegistry } from "@earendil-works/pi-coding-agent";

export function resolveRequestedModel(modelRegistry: ModelRegistry, provider: string | undefined, modelArg: string | undefined) {
  if (!modelArg) return undefined;

  const slashIndex = modelArg.indexOf("/");
  if (slashIndex > 0) {
    const parsedProvider = modelArg.slice(0, slashIndex);
    const parsedModel = modelArg.slice(slashIndex + 1);
    const model = modelRegistry.find(parsedProvider, parsedModel);
    if (!model) throw new Error(`Could not find model ${parsedProvider}/${parsedModel}.`);
    return model;
  }

  if (provider) {
    const model = modelRegistry.find(provider, modelArg);
    if (!model) throw new Error(`Could not find model ${provider}/${modelArg}.`);
    return model;
  }

  const exactMatches = modelRegistry.getAll().filter((model) => model.id === modelArg || model.name === modelArg);
  if (exactMatches.length === 1) return exactMatches[0];
  if (exactMatches.length > 1) {
    throw new Error(`Model "${modelArg}" is ambiguous. Use --model <provider>/<model>.`);
  }

  const fuzzyMatches = modelRegistry.getAll().filter((model) => model.id.includes(modelArg) || model.name.includes(modelArg));
  if (fuzzyMatches.length === 1) return fuzzyMatches[0];
  if (fuzzyMatches.length > 1) {
    throw new Error(`Model "${modelArg}" is ambiguous. Use --model <provider>/<model>.`);
  }

  throw new Error(`Could not find model "${modelArg}".`);
}
