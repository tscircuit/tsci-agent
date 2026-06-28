#!/usr/bin/env bun

import { ensurePiPackageDir } from "./pi-assets";
import { findPackageVersion } from "./paths";
import { usage } from "./usage";

ensurePiPackageDir();

async function runSmokeTestAssets(): Promise<void> {
  const { initTheme } = await import("@earendil-works/pi-coding-agent");
  initTheme("dark", false);
}

async function main() {
  const args = Bun.argv.slice(2);

  if (args[0] === "--help" || args[0] === "-h") {
    console.log(usage());
    process.exit(0);
  }

  if (args[0] === "--version" || args[0] === "-v") {
    console.log(await findPackageVersion());
    process.exit(0);
  }

  if (args[0] === "--smoke-test-assets") {
    await runSmokeTestAssets();
    console.log("ok");
    process.exit(0);
  }

  if (args[0] === "do") {
    const { runDoCommand } = await import("./do-command");
    await runDoCommand(args.slice(1));
    return;
  }

  const { runInteractive } = await import("./interactive");
  await runInteractive(args);
}

main().catch((error) => {
  console.error(`tsci-agent: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
