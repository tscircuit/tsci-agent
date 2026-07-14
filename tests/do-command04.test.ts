import { expect, test } from "bun:test";
import { getTestCli } from "./fixtures/getTestCli";

test("reports model request failures and exits non-zero", async () => {
  await using cli = await getTestCli();
  cli.failNextLlmRequest(401, {
    result: null,
    success: false,
    errors: [{ code: 10000, message: "Authentication error" }],
    messages: [],
  });

  const result = await cli.do("This request should fail.");

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("401 status code");
  expect(result.stderr).toContain("[agent] failed");
  expect(result.stderr).not.toContain("[agent] done");
});
