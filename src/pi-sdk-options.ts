import { AuthStorage, type Args } from "@earendil-works/pi-coding-agent";
import { resolveCliPaths } from "./paths";
import { getTscircuitSessionToken, TSCI_LOGIN_MESSAGE } from "./tsci-auth";
import { TSCIRCUIT_AI_GATEWAY_PROVIDER } from "./tscircuit-ai-gateway";

export function resolveRuntimeApiKeyProvider(parsed: Args): string {
  if (parsed.provider) return parsed.provider;

  const slashIndex = parsed.model?.indexOf("/") ?? -1;
  if (slashIndex > 0) return parsed.model!.slice(0, slashIndex);

  return TSCIRCUIT_AI_GATEWAY_PROVIDER;
}

export function createAuthStorage(parsed: Args): AuthStorage {
  const authStorage = AuthStorage.create();
  if (parsed.apiKey) {
    authStorage.setRuntimeApiKey(resolveRuntimeApiKeyProvider(parsed), parsed.apiKey);
  }

  const token = getTscircuitSessionToken();
  if (token) {
    authStorage.setRuntimeApiKey(TSCIRCUIT_AI_GATEWAY_PROVIDER, token);
  } else if (resolveRuntimeApiKeyProvider(parsed) === TSCIRCUIT_AI_GATEWAY_PROVIDER && !parsed.apiKey) {
    throw new Error(TSCI_LOGIN_MESSAGE);
  }

  return authStorage;
}

export function createResourceLoaderOptions(cwd: string, parsed: Args, skillPath: string) {
  return {
    additionalSkillPaths: [skillPath, ...resolveCliPaths(cwd, parsed.skills)],
    additionalExtensionPaths: resolveCliPaths(cwd, parsed.extensions),
    additionalPromptTemplatePaths: resolveCliPaths(cwd, parsed.promptTemplates),
    additionalThemePaths: resolveCliPaths(cwd, parsed.themes),

    // Keep tsci-agent deterministic and bundled: don't auto-discover ambient
    // extensions/skills, but still load explicit resource paths from CLI flags.
    noExtensions: true,
    noSkills: true,

    noPromptTemplates: parsed.noPromptTemplates,
    noThemes: parsed.noThemes,
    noContextFiles: parsed.noContextFiles,
    systemPrompt: parsed.systemPrompt,
    appendSystemPrompt: parsed.appendSystemPrompt,
  };
}

export function createSessionOptionOverrides(parsed: Args) {
  return {
    thinkingLevel: parsed.thinking,
    tools: parsed.tools,
    excludeTools: parsed.excludeTools,
    noTools: parsed.noTools ? ("all" as const) : parsed.noBuiltinTools ? ("builtin" as const) : undefined,
  };
}
