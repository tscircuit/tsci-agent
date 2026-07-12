import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

export interface SandboxFiles {
  /** Return an absolute path inside the sandbox workspace. */
  path(path: string): string;
  /** List a directory inside the sandbox workspace. */
  ls(path?: string): Promise<string[]>;
  /** Read a UTF-8 file inside the sandbox workspace. */
  read(path: string): Promise<string>;
  /** Write a UTF-8 file inside the sandbox workspace, creating parent directories. */
  write(path: string, content: string): Promise<void>;
}

export interface RunPromptInSandboxOptions {
  /** Directory to copy into the sandbox. Defaults to process.cwd(). */
  dir?: string;
  /** Additional Pi SDK CLI-style args, for example ["--model", "openai/gpt-4.1"]. */
  piArgs?: string[];
  /** Observe raw Pi SDK session events while the prompt runs. */
  onEvent?: (event: AgentSessionEvent) => void;
}

export interface SandboxPromptResult extends AsyncDisposable {
  /** Assistant text emitted by the run. */
  output: string;
  /** Original directory copied into the sandbox. */
  originalDir: string;
  /** Temporary workspace directory where the prompt ran. */
  sandboxDir: string;
  /** Pi SDK session id used for the run. */
  sessionId: string;
  /** Convenience helpers scoped to sandboxDir. */
  files: SandboxFiles;
  /** Remove the temporary sandbox directory. Safe to call more than once. */
  dispose(): Promise<void>;
}

function ensurePiPackageDir(): void {
  if (process.env.PI_PACKAGE_DIR) return;

  const packageJsonUrl = import.meta.resolve("@earendil-works/pi-coding-agent/package.json");
  process.env.PI_PACKAGE_DIR = dirname(fileURLToPath(packageJsonUrl));
}

function pathInSandbox(sandboxDir: string, path = "."): string {
  return resolve(sandboxDir, path);
}

function createSandboxFiles(sandboxDir: string): SandboxFiles {
  return {
    path(path: string) {
      return pathInSandbox(sandboxDir, path);
    },
    async ls(path = ".") {
      return (await readdir(pathInSandbox(sandboxDir, path))).sort();
    },
    async read(path: string) {
      return readFile(pathInSandbox(sandboxDir, path), "utf8");
    },
    async write(path: string, content: string) {
      const absolutePath = pathInSandbox(sandboxDir, path);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content);
    },
  };
}

/**
 * Run a prompt against a temporary copy of a workspace and return helpers for
 * inspecting that sandbox after the agent finishes.
 *
 * The sandbox is a filesystem copy, not a security boundary. Call dispose(), or
 * use `await using`, to remove the temporary files when you are done reading them.
 */
export async function runPromptInSandbox(prompt: string, options: RunPromptInSandboxOptions = {}): Promise<SandboxPromptResult> {
  ensurePiPackageDir();

  const { prepareWorkingDirectory, runAgentPrompt } = await import("./do-command");
  const prepared = await prepareWorkingDirectory(options.dir ?? process.cwd(), true, false);
  let disposed = false;

  async function dispose() {
    if (disposed) return;
    disposed = true;
    await rm(prepared.sandboxRoot ?? dirname(prepared.cwd), { recursive: true, force: true });
  }

  const outputParts: string[] = [];
  const onEvent = (event: AgentSessionEvent) => {
    if (event.type === "message_update") {
      const update = event.assistantMessageEvent;
      if (update?.type === "text_delta") outputParts.push(update.delta ?? "");
    }
    options.onEvent?.(event);
  };

  try {
    const run = await runAgentPrompt({
      prompt,
      dir: prepared.cwd,
      sandbox: false,
      piArgs: options.piArgs,
      report: false,
      onEvent,
    });

    return {
      output: outputParts.join(""),
      originalDir: prepared.sourceDir,
      sandboxDir: prepared.cwd,
      sessionId: run.sessionId,
      files: createSandboxFiles(prepared.cwd),
      dispose,
      async [Symbol.asyncDispose]() {
        await dispose();
      },
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
