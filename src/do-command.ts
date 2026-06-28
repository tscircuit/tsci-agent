import { cp, mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  parseArgs,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { reportDiagnostics } from "./diagnostics";
import { resolveRequestedModel } from "./model";
import { findTscircuitSkill } from "./paths";
import { createAuthStorage, createResourceLoaderOptions, createSessionOptionOverrides } from "./pi-sdk-options";
import { renderEvent } from "./render-events";
import { usage } from "./usage";

interface DoCommandOptions {
  prompt?: string;
  dir: string;
  sandbox: boolean;
  piArgs: string[];
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

export async function runDoCommand(args: string[]): Promise<void> {
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
  const authStorage = createAuthStorage(parsed);
  const modelRegistry = ModelRegistry.create(authStorage);
  const model = resolveRequestedModel(modelRegistry, parsed.provider, parsed.model);
  const settingsManager = SettingsManager.create(cwd, agentDir);
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    ...createResourceLoaderOptions(cwd, parsed, skillPath),
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
    ...createSessionOptionOverrides(parsed),
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
