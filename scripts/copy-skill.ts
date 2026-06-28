import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const source = join("node_modules", "skill");
const target = join("dist", "skill");

await rm(target, { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp(source, target, {
  recursive: true,
  filter: (path) => !path.includes("/.git") && !path.endsWith("/.bun-tag") && !path.endsWith("/.gitignore"),
});
