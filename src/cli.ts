#!/usr/bin/env bun

import { constants } from "node:fs";
import { access, cp, mkdtemp, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AuthStorage,
  createAgentSession,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  DefaultResourceLoader,
  getAgentDir,
  InteractiveMode,
  ModelRegistry,
  parseArgs,
  SessionManager,
  SettingsManager,
  type AgentSessionEvent,
  type CreateAgentSessionRuntimeFactory,
} from "@earendil-works/pi-coding-agent";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface DoCommandOptions {
  prompt?: string;
  dir: string;
  sandbox: boolean;
  piArgs: string[];
}

async function exists(path: string, mode = constants.F_OK): Promise<boolean> {
  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
}

function candidatePackageRoots(): string[] {
  const roots = new Set<string>();

  // Source layout: <repo>/src/cli.ts. Built layout: <repo>/dist/cli.js.
  roots.add(resolve(__dirname, ".."));

  // If the compiled file is ever nested differently, walking upward still gives
  // us a chance to find bundled assets or dependency files.
  let current = __dirname;
  for (let i = 0; i < 8; i++) {
    roots.add(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  roots.add(process.cwd());
  return [...roots];
}

async function findPackageVersion(): Promise<string> {
  for (const root of candidatePackageRoots()) {
    const packageJsonPath = join(root, "package.json");
    if (!(await exists(packageJsonPath, constants.R_OK))) continue;
    try {
      const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
      if (packageJson?.name === "tsci-agent" && typeof packageJson.version === "string") {
        return packageJson.version;
      }
    } catch {
      // Try the next candidate root.
    }
  }
  return "0.0.0";
}

async function findTscircuitSkill(): Promise<string> {
  for (const root of candidatePackageRoots()) {
    const packageSkill = join(root, "node_modules", "skill", "SKILL.md");
    if (await exists(packageSkill, constants.R_OK)) return realpath(packageSkill);

    const bundledSkill = join(root, "dist", "skill", "SKILL.md");
    if (await exists(bundledSkill, constants.R_OK)) return realpath(bundledSkill);
  }

  throw new Error(
    "Could not find the tscircuit skill. Run `bun install` so github:tscircuit/skill " +
      "is available, then `bun run build` to bundle it into dist/skill.",
  );
}

function usage(): string {
  return `Usage:
  tsci-agent [--help] [--version] [initial prompt...]
  tsci-agent do --prompt <prompt> [--dir <dir>] [--sandbox] [pi sdk options...]

Commands:
  do    Run Pi through the SDK non-interactively with a human-readable event stream.

Options for "do":
  --prompt, -p <text>   Prompt to send to the agent.
  --dir, -C <dir>       Working directory. Defaults to the current directory.
  --sandbox             Run in a temporary copy of --dir. This protects the
                        original directory from ordinary writes, but is not a
                        security sandbox.

Supported Pi SDK options after "do":
  --model <model>       Model id, fuzzy id, or provider/model.
  --provider <name>     Provider for --model or --api-key.
  --thinking <level>    off, minimal, low, medium, high, xhigh
  --tools <list>        Comma-separated tool allowlist.
  --exclude-tools <l>   Comma-separated tool denylist.
  --no-tools            Disable all tools.
  --no-builtin-tools    Disable default built-in tools.
  --extension <path>    Load an explicit Pi extension.
  --no-extensions       Ambient extension discovery is already disabled.
  --no-skills           Ambient skill discovery is already disabled; tscircuit skill still loads.
  --no-context-files    Disable AGENTS.md/CLAUDE.md discovery.
  --api-key <key>       Runtime API key override. Use with --provider.

This CLI embeds Pi via the @earendil-works/pi-coding-agent SDK; it does not
require a global pi executable.`;
}

function readValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function parseDoCommand(args: string[]): DoCommandOptions {
  const options: DoCommandOptions = {
    dir: process.cwd(),
    sandbox: false,
    piArgs: [],
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--") {
      options.piArgs.push(...args.slice(i + 1));
      break;
    }

    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }

    if (arg === "--prompt" || arg === "-p") {
      options.prompt = readValue(args, i, arg);
      i++;
      continue;
    }

    if (arg.startsWith("--prompt=")) {
      options.prompt = arg.slice("--prompt=".length);
      continue;
    }

    if (arg === "--dir" || arg === "-C") {
      options.dir = readValue(args, i, arg);
      i++;
      continue;
    }

    if (arg.startsWith("--dir=")) {
      options.dir = arg.slice("--dir=".length);
      continue;
    }

    if (arg === "--sandbox") {
      options.sandbox = true;
      continue;
    }

    options.piArgs.push(arg);
  }

  if (!options.prompt) {
    throw new Error("`tsci-agent do` requires --prompt <text>.");
  }

  return options;
}

async function prepareWorkingDirectory(dir: string, sandbox: boolean): Promise<string> {
  const sourceDir = await realpath(resolve(dir));

  if (!sandbox) return sourceDir;

  const sandboxRoot = await mkdtemp(join(tmpdir(), "tsci-agent-"));
  const sandboxDir = join(sandboxRoot, "workspace");
  await cp(sourceDir, sandboxDir, {
    recursive: true,
    filter: (path) => !path.includes("/.git/"),
  });

  console.error(`[tsci-agent] sandbox copy: ${sourceDir} -> ${sandboxDir}`);
  console.error("[tsci-agent] sandbox is a temporary filesystem copy, not a security boundary.");
  return sandboxDir;
}

function stringifyForLog(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function renderEvent(event: AgentSessionEvent): void {
  switch (event.type) {
    case "agent_start":
      console.error("[agent] start");
      break;
    case "agent_end":
      console.error("\n[agent] done");
      break;
    case "turn_start":
      console.error("[turn] start");
      break;
    case "turn_end":
      console.error("\n[turn] end");
      break;
    case "message_update": {
      const update = event.assistantMessageEvent;
      if (update?.type === "text_delta") {
        process.stdout.write(update.delta ?? "");
      } else if (update?.type === "thinking_delta") {
        process.stderr.write(update.delta ?? "");
      }
      break;
    }
    case "tool_execution_start":
      console.error(`\n[tool] ${event.toolName} ${stringifyForLog(event.args)}`);
      break;
    case "tool_execution_update":
      break;
    case "tool_execution_end":
      console.error(`[tool] ${event.toolName} ${event.isError ? "failed" : "ok"}`);
      break;
    case "compaction_start":
      console.error(`[compaction] start ${event.reason}`);
      break;
    case "compaction_end":
      console.error(`[compaction] end ${event.aborted ? "aborted" : "done"}`);
      break;
    case "auto_retry_start":
      console.error(`[retry] attempt ${event.attempt}/${event.maxAttempts}: ${event.errorMessage}`);
      break;
    case "auto_retry_end":
      console.error(`[retry] ${event.success ? "recovered" : "failed"}`);
      break;
    default:
      break;
  }
}

function reportDiagnostics(diagnostics: Array<{ type: string; message: string }>) {
  for (const diagnostic of diagnostics) {
    const prefix = diagnostic.type === "error" ? "error" : diagnostic.type === "warning" ? "warning" : "info";
    console.error(`[${prefix}] ${diagnostic.message}`);
  }
}

function resolveRequestedModel(modelRegistry: ModelRegistry, provider: string | undefined, modelArg: string | undefined) {
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

async function runDoCommand(args: string[]): Promise<void> {
  const options = parseDoCommand(args);
  const prompt = options.prompt;
  if (!prompt) throw new Error("`tsci-agent do` requires --prompt <text>.");
  const cwd = await prepareWorkingDirectory(options.dir, options.sandbox);
  const skillPath = await findTscircuitSkill();
  const parsed = parseArgs(options.piArgs);
  reportDiagnostics(parsed.diagnostics);

  const fatalDiagnostics = parsed.diagnostics.filter((diagnostic) => diagnostic.type === "error");
  if (fatalDiagnostics.length > 0) process.exit(1);

  const agentDir = getAgentDir();
  const authStorage = AuthStorage.create();
  if (parsed.apiKey) {
    authStorage.setRuntimeApiKey(parsed.provider ?? "anthropic", parsed.apiKey);
  }
  const modelRegistry = ModelRegistry.create(authStorage);
  const model = resolveRequestedModel(modelRegistry, parsed.provider, parsed.model);
  const settingsManager = SettingsManager.create(cwd, agentDir);
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    additionalSkillPaths: [skillPath, ...resolveCliPaths(cwd, parsed.skills)],
    additionalExtensionPaths: resolveCliPaths(cwd, parsed.extensions),
    additionalPromptTemplatePaths: resolveCliPaths(cwd, parsed.promptTemplates),
    additionalThemePaths: resolveCliPaths(cwd, parsed.themes),
    // Keep tsci-agent deterministic and bundled: don't auto-discover ambient
    // extensions, but still load explicit additionalExtensionPaths from --extension.
    noExtensions: true,
    // Keep tsci-agent deterministic: don't auto-discover ambient skills, but
    // still load explicit additionalSkillPaths (the bundled tscircuit skill and
    // any user-provided --skill paths).
    noSkills: true,
    noPromptTemplates: parsed.noPromptTemplates,
    noThemes: parsed.noThemes,
    noContextFiles: parsed.noContextFiles,
    systemPrompt: parsed.systemPrompt,
    appendSystemPrompt: parsed.appendSystemPrompt,
  });
  await loader.reload();

  const { session, extensionsResult, modelFallbackMessage } = await createAgentSession({
    cwd,
    agentDir,
    authStorage,
    modelRegistry,
    settingsManager,
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(cwd),
    model,
    thinkingLevel: parsed.thinking,
    tools: parsed.tools,
    excludeTools: parsed.excludeTools,
    noTools: parsed.noTools ? "all" : parsed.noBuiltinTools ? "builtin" : undefined,
  });

  if (modelFallbackMessage) console.error(`[warning] ${modelFallbackMessage}`);
  reportDiagnostics(loader.getSkills().diagnostics);
  for (const error of extensionsResult.errors) {
    console.error(`[warning] extension ${error.path}: ${error.error}`);
  }

  await session.bindExtensions({});
  const unsubscribe = session.subscribe(renderEvent);

  try {
    console.error(`[session] ${session.sessionId} cwd=${cwd}`);
    await session.prompt(prompt, { expandPromptTemplates: true });
  } finally {
    unsubscribe();
    session.dispose();
  }
}

function resolveCliPaths(cwd: string, paths: string[] | undefined): string[] {
  return paths?.map((path) => (path.startsWith(".") || path.startsWith("/") ? resolve(cwd, path) : path)) ?? [];
}

async function runInteractive(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  reportDiagnostics(parsed.diagnostics);

  if (parsed.diagnostics.some((diagnostic) => diagnostic.type === "error")) process.exit(1);

  const cwd = process.cwd();
  const agentDir = getAgentDir();
  const skillPath = await findTscircuitSkill();
  const authStorage = AuthStorage.create();
  if (parsed.apiKey) {
    authStorage.setRuntimeApiKey(parsed.provider ?? "anthropic", parsed.apiKey);
  }
  const modelRegistry = ModelRegistry.create(authStorage);
  const model = resolveRequestedModel(modelRegistry, parsed.provider, parsed.model);
  const settingsManager = SettingsManager.create(cwd, agentDir);

  const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      authStorage,
      modelRegistry,
      settingsManager,
      resourceLoaderOptions: {
        additionalSkillPaths: [skillPath, ...resolveCliPaths(cwd, parsed.skills)],
        additionalExtensionPaths: resolveCliPaths(cwd, parsed.extensions),
        additionalPromptTemplatePaths: resolveCliPaths(cwd, parsed.promptTemplates),
        additionalThemePaths: resolveCliPaths(cwd, parsed.themes),
        // Keep tsci-agent deterministic and bundled: don't auto-discover ambient
        // extensions, but still load explicit additionalExtensionPaths from --extension.
        noExtensions: true,
        // Keep tsci-agent deterministic: don't auto-discover ambient skills, but
        // still load explicit additionalSkillPaths (the bundled tscircuit skill
        // and any user-provided --skill paths).
        noSkills: true,
        noPromptTemplates: parsed.noPromptTemplates,
        noThemes: parsed.noThemes,
        noContextFiles: parsed.noContextFiles,
        systemPrompt: parsed.systemPrompt,
        appendSystemPrompt: parsed.appendSystemPrompt,
      },
    });
    return {
      ...(await createAgentSessionFromServices({
        services,
        sessionManager,
        sessionStartEvent,
        model,
        thinkingLevel: parsed.thinking,
        tools: parsed.tools,
        excludeTools: parsed.excludeTools,
        noTools: parsed.noTools ? "all" : parsed.noBuiltinTools ? "builtin" : undefined,
      })),
      services,
      diagnostics: services.diagnostics,
    };
  };

  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd,
    agentDir,
    sessionManager: SessionManager.create(cwd, parsed.sessionDir),
  });

  const mode = new InteractiveMode(runtime, {
    migratedProviders: [],
    modelFallbackMessage: runtime.modelFallbackMessage,
    initialMessage: parsed.messages.join(" ") || undefined,
    initialImages: [],
    initialMessages: [],
  });

  await mode.run();
}

async function main() {
  const args = Bun.argv.slice(2);

  if (args[0] === "--help" || args[0] === "-h") {
    console.log(usage());
    process.exit(0);
  }

  if (args[0] === "--version" || args[0] === "-v") {
    console.log(await findPackageVersion());
    process.exit(0);
  }

  if (args[0] === "do") {
    await runDoCommand(args.slice(1));
    return;
  }

  await runInteractive(args);
}

main().catch((error) => {
  console.error(`tsci-agent: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
