import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runPromptInSandbox } from "../src/lib";
import { startFakeLlmApiServer } from "./fixtures/fake-llm-api/server";
import { writeTestModelsJson } from "./fixtures/getTestCli";

test("runPromptInSandbox returns output and sandbox file helpers", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "tsci-agent-lib-test-cwd-"));
  const agentDir = await mkdtemp(join(tmpdir(), "tsci-agent-lib-test-agent-"));
  const fakeLlmApi = await startFakeLlmApiServer();
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousOffline = process.env.PI_OFFLINE;
  const previousSkipVersionCheck = process.env.PI_SKIP_VERSION_CHECK;
  const previousTelemetry = process.env.PI_TELEMETRY;

  try {
    await writeTestModelsJson(agentDir, fakeLlmApi.url);
    process.env.PI_CODING_AGENT_DIR = agentDir;
    process.env.PI_OFFLINE = "1";
    process.env.PI_SKIP_VERSION_CHECK = "1";
    process.env.PI_TELEMETRY = "0";

    await mkdir(cwd, { recursive: true });
    await writeFile(join(cwd, "index.circuit.tsx"), `export default function Circuit() {\n  return <board width={10} height={10} />\n}\n`);

    await using result = await runPromptInSandbox(
      "Review this tscircuit project. First inspect the current directory with a tool and base your response only on those files.",
      { dir: cwd, piArgs: ["--model", "fake/fake-model"] },
    );

    expect(result.output).toContain("I inspected the project directory");
    expect(await result.files.ls()).toContain("index.circuit.tsx");
    await expect(result.files.read("index.circuit.tsx")).resolves.toContain("<board");
    await expect(readFile(join(result.sandboxDir, "index.circuit.tsx"), "utf8")).resolves.toContain("<board");
    await expect(readFile(join(cwd, "index.circuit.tsx"), "utf8")).resolves.toContain("<board");
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousOffline === undefined) delete process.env.PI_OFFLINE;
    else process.env.PI_OFFLINE = previousOffline;
    if (previousSkipVersionCheck === undefined) delete process.env.PI_SKIP_VERSION_CHECK;
    else process.env.PI_SKIP_VERSION_CHECK = previousSkipVersionCheck;
    if (previousTelemetry === undefined) delete process.env.PI_TELEMETRY;
    else process.env.PI_TELEMETRY = previousTelemetry;
    await fakeLlmApi.stop();
    await rm(cwd, { recursive: true, force: true });
    await rm(agentDir, { recursive: true, force: true });
  }
}, 60_000);
