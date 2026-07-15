import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { getTestCli } from "./fixtures/getTestCli";

test("defaults the do command to the tscircuit AI gateway model", async () => {
  await using cli = await getTestCli();
  await cli.auth.writeToken("test-tsci-session-token");

  await writeFile(
    join(cli.agentDir, "models.json"),
    `${JSON.stringify(
      {
        providers: {
          fake: {
            baseUrl: "http://127.0.0.1:1/v1",
            api: "openai-completions",
            apiKey: "fake-key",
            models: [{ id: "fake-model", name: "Dead Fake Model" }],
          },
          "tscircuit-ai-gateway": {
            baseUrl: `${cli.fakeLlmApiUrl}/v1`,
            api: "openai-responses",
            apiKey: "fake-jwt",
            compat: {
              supportsDeveloperRole: false,
            },
            models: [
              {
                id: "openai/gpt-5.6-sol",
                name: "GPT-5.6 Sol via tscircuit AI Gateway",
                reasoning: true,
                input: ["text", "image"],
                contextWindow: 1050000,
                maxTokens: 128000,
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

  const result = await cli.do("Say hello from the tscircuit agent.", { model: false });

  expect(result.exitCode).toBe(0);
  expect((await cli.getLastLlmRequestHeaders())?.["x-conversation-id"]).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
  expect((await cli.getLastLlmRequestHeaders())?.authorization).toBe("Bearer test-tsci-session-token");
  expect(await cli.getLastLlmRequestBody()).toMatchObject({
    model: "openai/gpt-5.6-sol",
    stream: true,
    input: expect.any(Array),
  });
  expect(await cli.getLastLlmRequestBody()).not.toHaveProperty("messages");
  expect((await cli.getLastOutput()).trim().length).toBeGreaterThan(0);
  await expect(cli.getLastStderr()).resolves.toContain("[agent] done");
}, 60_000);
