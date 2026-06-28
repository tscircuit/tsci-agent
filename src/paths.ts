import { constants } from "node:fs";
import { access, readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function exists(path: string, mode = constants.F_OK): Promise<boolean> {
  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
}

export function candidatePackageRoots(): string[] {
  const roots = new Set<string>();

  // Source layout: <repo>/src/*.ts. Built layout: <repo>/dist/cli.js.
  roots.add(resolve(__dirname, ".."));

  // If the compiled file is ever nested differently, walking upward still gives
  // us a chance to find bundled assets or dependency files.
  let current = __dirname;
  for (let i = 0; i < 8; i++) {
    roots.add(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  roots.add(process.cwd());
  return [...roots];
}

export async function findPackageVersion(): Promise<string> {
  for (const root of candidatePackageRoots()) {
    const packageJsonPath = join(root, "package.json");
    if (!(await exists(packageJsonPath, constants.R_OK))) continue;

    try {
      const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
      if (packageJson?.name === "tsci-agent" && typeof packageJson.version === "string") {
        return packageJson.version;
      }
    } catch {
      // Try the next candidate root.
    }
  }

  return "0.0.0";
}

export async function findTscircuitSkill(): Promise<string> {
  for (const root of candidatePackageRoots()) {
    const packageSkill = join(root, "node_modules", "skill", "SKILL.md");
    if (await exists(packageSkill, constants.R_OK)) return realpath(packageSkill);

    const bundledSkill = join(root, "dist", "skill", "SKILL.md");
    if (await exists(bundledSkill, constants.R_OK)) return realpath(bundledSkill);
  }

  throw new Error(
    "Could not find the tscircuit skill. Run `bun install` so github:tscircuit/skill " +
      "is available, then `bun run build` to bundle it into dist/skill.",
  );
}

export function resolveCliPaths(cwd: string, paths: string[] | undefined): string[] {
  return paths?.map((path) => (path.startsWith(".") || path.startsWith("/") ? resolve(cwd, path) : path)) ?? [];
}
