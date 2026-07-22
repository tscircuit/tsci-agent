import { expect, test } from "bun:test";
import { applyUseCodexShortcut } from "../src/do-command";
import { OPENAI_CODEX_DEFAULT_MODEL_REF } from "../src/openai-auth";

test("maps --use-codex to the default OpenAI Codex model", () => {
  expect(applyUseCodexShortcut(["--thinking", "high"], true)).toEqual(["--thinking", "high", "--model", OPENAI_CODEX_DEFAULT_MODEL_REF]);
  expect(() => applyUseCodexShortcut(["--model", "another-model"], true)).toThrow("--use-codex cannot be combined with --model.");
});
