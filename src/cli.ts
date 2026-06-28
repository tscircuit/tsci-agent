#!/usr/bin/env bun

import { runDoCommand } from "./do-command";
import { runInteractive } from "./interactive";
import { findPackageVersion } from "./paths";
import { usage } from "./usage";

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

  if (args[0] === "do") {
    await runDoCommand(args.slice(1));
    return;
  }

  await runInteractive(args);
}

main().catch((error) => {
  console.error(`tsci-agent: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
