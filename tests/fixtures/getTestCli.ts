import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeLlmApiServer, type FakeLlmApiServer } from "./fake-llm-api/server";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..", "..");
const cliEntry = join(repoRoot, "src", "cli.ts");

export interface TestCli extends AsyncDisposable {
  cwd: string;
  agentDir: string;
  do(prompt: string, options?: { sandbox?: boolean; args?: string[] }): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  getLastOutput(): Promise<string>;
  getLastStderr(): Promise<string>;
  getLastSandboxDir(): Promise<string | undefined>;
  dispose(): Promise<void>;
  files: {
    ls(path: string): Promise<string[]>;
    read(path: string): Promise<string>;
    write(path: string, content: string): Promise<void>;
  };
}

function pathInCwd(cwd: string, path: string): string {
  return resolve(cwd, path);
}

async function writeModelsJson(agentDir: string, serverUrl: string) {
  await mkdir(agentDir, { recursive: true });
  await writeFile(
    join(agentDir, "models.json"),
    `${JSON.stringify(
      {
        providers: {
          fake: {
            baseUrl: `${serverUrl}/v1`,
            api: "openai-completions",
            apiKey: "fake-key",
            compat: {
              supportsDeveloperRole: false,
              supportsReasoningEffort: false,
              supportsUsageInStreaming: false,
              maxTokensField: "max_tokens",
            },
            models: [
              {
                id: "fake-model",
                name: "Fake Model",
                reasoning: false,
                input: ["text"],
                contextWindow: 128000,
                maxTokens: 4096,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              },
            ],
          },
        },
      },
      null,
      2,
    )}\n`,
  );
}

export async function getTestCli(): Promise<TestCli> {
  const cwd = await mkdtemp(join(tmpdir(), "tsci-agent-test-cwd-"));
  const agentDir = await mkdtemp(join(tmpdir(), "tsci-agent-test-agent-"));
  const fakeLlmApi: FakeLlmApiServer = await startFakeLlmApiServer();
  await writeModelsJson(agentDir, fakeLlmApi.url);

  let lastStdout = "";
  let lastStderr = "";
  let lastSandboxDir: string | undefined;
  const sandboxRoots = new Set<string>();

  async function doCommand(prompt: string, options: { sandbox?: boolean; args?: string[] } = {}) {
    const args = [
      cliEntry,
      "do",
      "--prompt",
      prompt,
      "--dir",
      cwd,
      "--model",
      "fake/fake-model",
      ...(options.sandbox ? ["--sandbox"] : []),
      ...(options.args ?? []),
    ];

    const child = Bun.spawn({
      cmd: [process.execPath, ...args],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: agentDir,
        PI_OFFLINE: "1",
        PI_SKIP_VERSION_CHECK: "1",
        PI_TELEMETRY: "0",
      },
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    lastStdout = stdout;
    lastStderr = stderr;

    const sandboxMatch = stderr.match(/^\[tsci-agent\] sandbox copy: .* -> (.*)$/m);
    lastSandboxDir = sandboxMatch?.[1]?.trim();
    if (lastSandboxDir) sandboxRoots.add(dirname(lastSandboxDir));

    return { exitCode, stdout, stderr };
  }

  let disposed = false;
  async function dispose() {
    if (disposed) return;
    disposed = true;
    await fakeLlmApi.stop();
    for (const sandboxRoot of sandboxRoots) {
      await rm(sandboxRoot, { recursive: true, force: true });
    }
    await rm(cwd, { recursive: true, force: true });
    await rm(agentDir, { recursive: true, force: true });
  }

  return {
    cwd,
    agentDir,
    do: doCommand,
    async getLastOutput() {
      return lastStdout;
    },
    async getLastStderr() {
      return lastStderr;
    },
    async getLastSandboxDir() {
      return lastSandboxDir;
    },
    dispose,
    async [Symbol.asyncDispose]() {
      await dispose();
    },
    files: {
      async ls(path: string) {
        return (await readdir(pathInCwd(cwd, path))).sort();
      },
      async read(path: string) {
        return readFile(pathInCwd(cwd, path), "utf8");
      },
      async write(path: string, content: string) {
        const absolutePath = pathInCwd(cwd, path);
        await mkdir(dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, content);
      },
    },
  };
}
