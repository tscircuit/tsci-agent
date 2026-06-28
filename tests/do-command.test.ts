import { expect, test } from "bun:test";
import { getTestCli } from "./fixtures/getTestCli";

test("runs the do command against the deterministic fake LLM", async () => {
  await using cli = await getTestCli();

  const result = await cli.do("Say hello from the tscircuit agent.");

  expect(result.exitCode).toBe(0);
  await expect(cli.getLastOutput()).resolves.toContain("FAKE_LLM: Hello from the tscircuit agent.");
  await expect(cli.getLastStderr()).resolves.toContain("[agent] done");
});
