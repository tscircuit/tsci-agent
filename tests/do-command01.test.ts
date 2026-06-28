import { expect, test } from "bun:test";
import { getTestCli } from "./fixtures/getTestCli";

test("runs the do command against the deterministic fake LLM", async () => {
  await using cli = await getTestCli();

  const result = await cli.do("Say hello from the tscircuit agent.");

  expect(result.exitCode).toBe(0);
  expect((await cli.getLastOutput()).trim().length).toBeGreaterThan(0);
  await expect(cli.getLastOutput()).resolves.not.toContain("FAKE_LLM:");
  await expect(cli.getLastStderr()).resolves.toContain("[agent] done");
}, 60_000);
