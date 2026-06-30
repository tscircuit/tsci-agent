import type { ModelRegistry } from "@earendil-works/pi-coding-agent";

export const TSCIRCUIT_AI_GATEWAY_PROVIDER = "tscircuit-ai-gateway";
export const TSCIRCUIT_AI_GATEWAY_MODEL = "openai/gpt-5.5";
export const TSCIRCUIT_AI_GATEWAY_MODEL_REF = `${TSCIRCUIT_AI_GATEWAY_PROVIDER}/${TSCIRCUIT_AI_GATEWAY_MODEL}`;

export function registerTscircuitAiGatewayProvider(modelRegistry: ModelRegistry, conversationId: string): void {
  const existingModel = modelRegistry.find(TSCIRCUIT_AI_GATEWAY_PROVIDER, TSCIRCUIT_AI_GATEWAY_MODEL);
  if (existingModel) {
    existingModel.headers = {
      ...existingModel.headers,
      "x-conversation-id": conversationId,
    };
    return;
  }

  modelRegistry.registerProvider(TSCIRCUIT_AI_GATEWAY_PROVIDER, {
    baseUrl: "https://aigateway.tscircuit.com",
    api: "openai-completions",
    apiKey: "$TSCIRCUIT_JWT",
    headers: {
      "x-conversation-id": conversationId,
    },
    models: [
      {
        id: TSCIRCUIT_AI_GATEWAY_MODEL,
        name: "GPT-5.5 via tscircuit AI Gateway",
        reasoning: false,
        input: ["text", "image"],
        contextWindow: 1000000,
        maxTokens: 32768,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          supportsUsageInStreaming: false,
          maxTokensField: "max_completion_tokens",
        },
      },
    ],
  });
}

export function resolveDefaultModelArg(modelArg: string | undefined): string {
  return modelArg ?? TSCIRCUIT_AI_GATEWAY_MODEL_REF;
}
