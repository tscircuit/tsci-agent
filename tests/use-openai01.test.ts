import { expect, test } from "bun:test";
import { applyUseOpenAiShortcut } from "../src/do-command";
import { OPENAI_DEFAULT_MODEL_REF } from "../src/openai-auth";

test("maps --use-openai to the default OpenAI model", () => {
  expect(applyUseOpenAiShortcut(["--thinking", "high"], true)).toEqual(["--thinking", "high", "--model", OPENAI_DEFAULT_MODEL_REF]);
  expect(() => applyUseOpenAiShortcut(["--model", "another-model"], true)).toThrow("--use-openai cannot be combined with --model.");
});
