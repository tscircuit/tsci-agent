import semver from "semver";

const LATEST_VERSION_URL = "https://registry.npmjs.org/tsci-agent/latest";
const DEFAULT_TIMEOUT_MS = 10_000;

export interface TsciAgentRelease {
  version: string;
}

interface VersionCheckOptions {
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

export function isNewerTsciAgentVersion(candidateVersion: string, currentVersion: string): boolean {
  if (!currentVersion || currentVersion === "0.0.0" || !candidateVersion || candidateVersion === "0.0.0") {
    return false;
  }

  try {
    return semver.gt(candidateVersion, currentVersion);
  } catch {
    return false;
  }
}

export async function checkForTsciAgentUpdate(
  currentVersion: string,
  options: VersionCheckOptions = {},
): Promise<TsciAgentRelease | undefined> {
  if (!currentVersion || currentVersion === "0.0.0" || process.env.TSCI_AGENT_SKIP_VERSION_CHECK || process.env.PI_OFFLINE) {
    return undefined;
  }

  try {
    const response = await (options.fetch ?? globalThis.fetch)(LATEST_VERSION_URL, {
      headers: {
        accept: "application/json",
        "User-Agent": `tsci-agent/${currentVersion}`,
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!response.ok) return undefined;

    const data = (await response.json()) as { version?: unknown };
    if (typeof data.version !== "string" || !isNewerTsciAgentVersion(data.version, currentVersion)) return undefined;

    return { version: data.version.trim() };
  } catch {
    return undefined;
  }
}
