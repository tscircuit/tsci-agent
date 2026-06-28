import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PI_PACKAGE_NAME = "@earendil-works/pi-coding-agent";

function hasPiAssets(packageDir: string): boolean {
  return (
    existsSync(join(packageDir, "package.json")) &&
    (existsSync(join(packageDir, "src", "modes", "interactive", "theme", "dark.json")) ||
      existsSync(join(packageDir, "dist", "modes", "interactive", "theme", "dark.json")) ||
      existsSync(join(packageDir, "theme", "dark.json")))
  );
}

function addNodeModuleCandidates(candidates: Set<string>, start: string): void {
  let current = resolve(start);

  for (let i = 0; i < 12; i++) {
    candidates.add(join(current, "node_modules", PI_PACKAGE_NAME));

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function candidatePiPackageDirs(): string[] {
  const candidates = new Set<string>();

  // Normal package-manager layouts: pi is an installed dependency of tsci-agent
  // or is hoisted into a parent node_modules directory.
  addNodeModuleCandidates(candidates, __dirname);
  addNodeModuleCandidates(candidates, process.cwd());

  return [...candidates];
}

/**
 * Pi resolves built-in themes and other runtime assets from PI_PACKAGE_DIR.
 * Bun bundles JavaScript only, so point Pi at its installed package directory
 * before any @earendil-works/pi-coding-agent module is imported.
 */
export function ensurePiPackageDir(): void {
  if (process.env.PI_PACKAGE_DIR) return;

  const packageDir = candidatePiPackageDirs().find(hasPiAssets);
  if (packageDir) {
    process.env.PI_PACKAGE_DIR = packageDir;
  }
}
