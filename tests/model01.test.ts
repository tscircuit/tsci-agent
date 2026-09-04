import { expect, test } from "bun:test";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { OPENAI_ASTRA_MODEL, resolveRequestedModel } from "../src/model";

test("resolves GPT-6 Astra before the upstream Pi registry includes it", () => {
  const modelRegistry = {
    find: () => undefined,
    getAll: () => [],
  } as unknown as ModelRegistry;

  expect(resolveRequestedModel(modelRegistry, undefined, "openai-codex/gpt-6-astra")).toEqual(OPENAI_ASTRA_MODEL);
  expect(resolveRequestedModel(modelRegistry, "openai-codex", "gpt-6-astra")).toEqual(OPENAI_ASTRA_MODEL);
  expect(resolveRequestedModel(modelRegistry, undefined, "gpt-6-astra")).toEqual(OPENAI_ASTRA_MODEL);

  const upstreamAstra = { ...OPENAI_ASTRA_MODEL, name: "Upstream GPT-6 Astra" };
  const updatedRegistry = {
    find: (provider: string, modelId: string) =>
      provider === upstreamAstra.provider && modelId === upstreamAstra.id ? upstreamAstra : undefined,
    getAll: () => [upstreamAstra],
  } as unknown as ModelRegistry;

  expect(resolveRequestedModel(updatedRegistry, undefined, "openai-codex/gpt-6-astra")).toBe(upstreamAstra);
  expect(resolveRequestedModel(updatedRegistry, undefined, "gpt-6-astra")).toBe(upstreamAstra);
});
