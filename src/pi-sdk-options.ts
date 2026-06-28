import { AuthStorage, type Args } from "@earendil-works/pi-coding-agent";
import { resolveCliPaths } from "./paths";

export function createAuthStorage(parsed: Args): AuthStorage {
  const authStorage = AuthStorage.create();
  if (parsed.apiKey) {
    authStorage.setRuntimeApiKey(parsed.provider ?? "anthropic", parsed.apiKey);
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
