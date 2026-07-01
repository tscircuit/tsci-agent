import { expect, test } from "bun:test";
import { getTestCli } from "./fixtures/getTestCli";

test("prints login guidance when default gateway has no tsci token", async () => {
  await using cli = await getTestCli();

  const result = await cli.do("Say hello from the tscircuit agent.", { model: false });

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toBe('Use "tsci login" to login before using "tsci agent"\n');
  expect(await cli.getLastLlmRequestHeaders()).toBeUndefined();
}, 60_000);
