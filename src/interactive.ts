import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  ModelRegistry,
  parseArgs,
  SettingsManager,
  type CreateAgentSessionRuntimeFactory,
} from "@earendil-works/pi-coding-agent";
import { reportDiagnostics } from "./diagnostics";
import { resolveRequestedModel } from "./model";
import { findTscircuitSkill } from "./paths";
import { createAuthStorage, createResourceLoaderOptions, createSessionOptionOverrides } from "./pi-sdk-options";
import { createSessionManager } from "./session";
import { TscircuitInteractiveMode } from "./tscircuit-interactive-mode";
import { registerTscircuitAiGatewayProvider, resolveDefaultModelArg } from "./tscircuit-ai-gateway";

export async function runInteractive(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  reportDiagnostics(parsed.diagnostics);

  if (parsed.diagnostics.some((diagnostic) => diagnostic.type === "error")) process.exit(1);

  const cwd = process.cwd();
  const agentDir = getAgentDir();
  const [skillPath, sessionManager] = await Promise.all([findTscircuitSkill(), createSessionManager(parsed, cwd, parsed.sessionDir)]);
  const authStorage = createAuthStorage(parsed);
  const modelRegistry = ModelRegistry.create(authStorage);
  registerTscircuitAiGatewayProvider(modelRegistry, sessionManager.getSessionId());
  const model = resolveRequestedModel(modelRegistry, parsed.provider, resolveDefaultModelArg(parsed.model));
  const settingsManager = SettingsManager.create(cwd, agentDir);

  const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      authStorage,
      modelRegistry,
      settingsManager,
      resourceLoaderOptions: createResourceLoaderOptions(cwd, parsed, skillPath),
    });

    return {
      ...(await createAgentSessionFromServices({
        services,
        sessionManager,
        sessionStartEvent,
        model,
        ...createSessionOptionOverrides(parsed),
      })),
      services,
      diagnostics: services.diagnostics,
    };
  };

  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd,
    agentDir,
    sessionManager,
  });

  const mode = new TscircuitInteractiveMode(runtime, {
    migratedProviders: [],
    modelFallbackMessage: runtime.modelFallbackMessage,
    initialMessage: parsed.messages.join(" ") || undefined,
    initialImages: [],
    initialMessages: [],
  });

  await mode.run();
}
