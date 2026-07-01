import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const TSCI_LOGIN_MESSAGE = 'Use "tsci login" to login before using "tsci agent"';

function getDefaultTscircuitConfigPath(): string {
  const name = "tscircuit-nodejs";

  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Preferences", name, "config.json");
  }

  if (process.platform === "win32") {
    const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
    return join(appData, name, "Config", "config.json");
  }

  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(configHome, name, "config.json");
}

function getTscircuitConfigPath(): string {
  if (process.env.TSCIRCUIT_CONFIG_DIR) return join(process.env.TSCIRCUIT_CONFIG_DIR, "config.json");
  return getDefaultTscircuitConfigPath();
}

function readJsonObject(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

export function getTscircuitSessionToken(): string | undefined {
  if (process.env.TSCIRCUIT_JWT?.trim()) return process.env.TSCIRCUIT_JWT.trim();

  const config = readJsonObject(getTscircuitConfigPath());
  const token = config?.sessionToken;
  return typeof token === "string" && token.trim() ? token.trim() : undefined;
}
