import { expect, test } from "bun:test";
import { AuthStorage } from "@earendil-works/pi-coding-agent";
import { OPENAI_CODEX_PROVIDER, runAuthCommand } from "../src/openai-auth";

test("reports and removes stored OpenAI Codex credentials", async () => {
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
    await runAuthCommand(["status", OPENAI_CODEX_PROVIDER], { authStorage });
    await runAuthCommand(["logout", OPENAI_CODEX_PROVIDER], { authStorage });
    await runAuthCommand(["status", OPENAI_CODEX_PROVIDER], { authStorage });
  } finally {
    console.log = originalLog;
  }

  expect(output).toEqual([
    "OpenAI Codex credentials are stored.",
    "Logged out of OpenAI Codex.",
    "Not logged in to OpenAI Codex. Run `tsci-agent auth login openai-codex`.",
  ]);
  expect(authStorage.get(OPENAI_CODEX_PROVIDER)).toBeUndefined();
});
