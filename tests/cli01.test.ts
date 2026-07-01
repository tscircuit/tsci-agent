import { expect, test } from "bun:test";

test("sets the Pi skip version check flag by default", async () => {
  const child = Bun.spawn({
    cmd: [process.execPath, "src/cli.ts", "--version"],
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      PI_SKIP_VERSION_CHECK: "",
    },
  });

  const [stderr, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");
});
