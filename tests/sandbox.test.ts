import { expect, test } from "bun:test";
import { getTestCli } from "./fixtures/getTestCli";

test("runs do --sandbox from a temporary copy while leaving the original workspace readable", async () => {
  await using cli = await getTestCli();
  await cli.files.write(
    "./index.circuit.tsx",
    `export default function Circuit() {\n  return <board width={10} height={10} />\n}\n`,
  );

  const result = await cli.do("Review this tscircuit project.", { sandbox: true });

  expect(result.exitCode).toBe(0);
  await expect(cli.getLastOutput()).resolves.toContain("Quick review of the tscircuit project");
  await expect(cli.getLastOutput()).resolves.not.toContain("FAKE_LLM:");
  await expect(cli.files.ls("./")).resolves.toContain("index.circuit.tsx");
  await expect(cli.files.read("./index.circuit.tsx")).resolves.toContain("<board");
}, 60_000);
