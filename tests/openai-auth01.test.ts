import { expect, test } from "bun:test";
import { AuthStorage } from "@earendil-works/pi-coding-agent";
import { OPENAI_CODEX_PROVIDER, runAuthCommand } from "../src/openai-auth";

test("reports and removes stored OpenAI credentials", async () => {
  const authStorage = AuthStorage.inMemory({
    [OPENAI_CODEX_PROVIDER]: {
      type: "oauth",
      access: "secret-access-token",
      refresh: "secret-refresh-token",
      expires: Date.now() + 60_000,
    },
  });
  const output: string[] = [];
  const originalLog = console.log;
  console.log = (...values) => output.push(values.join(" "));

  try {
    await runAuthCommand(["status", "--openai"], { authStorage });
    await runAuthCommand(["logout", "--openai"], { authStorage });
    await runAuthCommand(["status", "--openai"], { authStorage });
  } finally {
    console.log = originalLog;
  }

  expect(output).toEqual([
    "OpenAI credentials are stored.",
    "Logged out of OpenAI.",
    "Not logged in to OpenAI. Run `tsci-agent auth login --openai`.",
  ]);
  expect(authStorage.get(OPENAI_CODEX_PROVIDER)).toBeUndefined();
});
