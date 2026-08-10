import { open } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { getAgentDir, SessionManager, type Args } from "@earendil-works/pi-coding-agent";

type ResolvedSession =
  | { type: "path"; path: string }
  | { type: "local"; path: string }
  | { type: "global"; path: string; cwd: string }
  | { type: "not_found"; arg: string };

export function getDefaultSessionDirPath(cwd: string, agentDir = getAgentDir()): string {
  const safePath = `--${resolve(cwd)
    .replace(/^[/\\]/, "")
    .replace(/[/\\:]/g, "-")}--`;
  return join(agentDir, "sessions", safePath);
}

export function resolveSessionDir(cwd: string, sessionDir?: string): string {
  return sessionDir ? resolve(sessionDir) : getDefaultSessionDirPath(cwd);
}

async function listSessionFiles(dir: string): Promise<string[] | undefined> {
  try {
    return (await readdir(dir)).filter((file) => file.endsWith(".jsonl"));
  } catch {
    return undefined;
  }
}

function findFileBySessionId(files: string[], sessionId: string): string | undefined {
  const suffix = `_${sessionId}.jsonl`;
  return files.find((file) => file.endsWith(suffix));
}

function findFileBySessionPrefix(files: string[], prefix: string): string | undefined {
  return findFileBySessionId(files, prefix) ?? files.find((file) => file.includes(`_${prefix}`));
}

export async function findLocalSessionFileById(
  sessionId: string,
  cwd: string,
  sessionDir?: string,
  cachedFiles?: string[],
): Promise<string | undefined> {
  const dir = resolveSessionDir(cwd, sessionDir);
  const files = cachedFiles ?? (await listSessionFiles(dir));
  const match = files && findFileBySessionId(files, sessionId);
  return match ? join(dir, match) : undefined;
}

const HEADER_READ_BYTES = 8192;

async function readSessionHeaderCwd(path: string): Promise<string | undefined> {
  let fd;

  try {
    fd = await open(path, "r");
    const buffer = new Uint8Array(HEADER_READ_BYTES);
    const { bytesRead } = await fd.read(buffer, 0, HEADER_READ_BYTES, 0);
    const newlineIndex = buffer.indexOf(0x0a);
    const slice = newlineIndex >= 0 ? buffer.subarray(0, newlineIndex) : buffer.subarray(0, bytesRead);
    const header = JSON.parse(new TextDecoder().decode(slice));
    if (header?.type !== "session") return undefined;
    return typeof header.cwd === "string" ? header.cwd : undefined;
  } catch {
    return undefined;
  } finally {
    await fd?.close();
  }
}

async function findGlobalSessionFileById(sessionArg: string, sessionDir?: string): Promise<{ path: string; cwd: string } | undefined> {
  const sessionsRoot = sessionDir ? resolve(sessionDir) : join(getAgentDir(), "sessions");

  let dirs: string[];
  if (sessionDir) {
    dirs = [sessionsRoot];
  } else {
    try {
      dirs = (await readdir(sessionsRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(sessionsRoot, entry.name));
    } catch {
      dirs = [];
    }
  }

  const filesByDir = await Promise.all(dirs.map(async (dir) => ({ dir, files: await listSessionFiles(dir) })));

  for (const { dir, files } of filesByDir) {
    const match = files && findFileBySessionPrefix(files, sessionArg);
    if (!match) continue;
    const path = join(dir, match);
    const cwd = await readSessionHeaderCwd(path);
    if (cwd) return { path, cwd };
  }
  return undefined;
}

export async function findLocalSessionByExactId(
  sessionId: string,
  cwd: string,
  sessionDir?: string,
  cachedFiles?: string[],
): Promise<{ type: "local"; path: string } | undefined> {
  const path = await findLocalSessionFileById(sessionId, cwd, sessionDir, cachedFiles);
  return path ? { type: "local", path } : undefined;
}

export async function resolveSessionPath(
  sessionArg: string,
  cwd: string,
  sessionDir?: string,
  cachedFiles?: string[],
): Promise<ResolvedSession> {
  if (sessionArg.includes("/") || sessionArg.includes("\\") || sessionArg.endsWith(".jsonl")) {
    return { type: "path", path: resolve(cwd, sessionArg) };
  }

  const dir = resolveSessionDir(cwd, sessionDir);
  const files = cachedFiles ?? (await listSessionFiles(dir));
  const localFile = files && findFileBySessionPrefix(files, sessionArg);
  if (localFile) return { type: "local", path: join(dir, localFile) };

  const globalMatch = await findGlobalSessionFileById(sessionArg, sessionDir);
  if (globalMatch) return { type: "global", ...globalMatch };

  const localSessions = await SessionManager.list(cwd, sessionDir);
  const localMatch = localSessions.find((s) => s.id === sessionArg) ?? localSessions.find((s) => s.id.startsWith(sessionArg));
  if (localMatch) return { type: "local", path: localMatch.path };

  return { type: "not_found", arg: sessionArg };
}

export function promptConfirm(message: string): Promise<boolean> {
  return new Promise((resolvePrompt) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolvePrompt(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

function promptInput(message: string): Promise<string> {
  return new Promise((resolvePrompt) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(message, (answer) => {
      rl.close();
      resolvePrompt(answer);
    });
  });
}

async function selectSessionInteractively(cwd: string, sessionDir?: string): Promise<string | null> {
  const sessions = await SessionManager.list(cwd, sessionDir);
  const allSessions = sessions.length > 0 ? sessions : await SessionManager.listAll(sessionDir);
  if (allSessions.length === 0) return null;

  for (const [index, session] of allSessions.entries()) {
    const name = session.name ? `${session.name} - ` : "";
    console.log(`  ${index + 1}. ${name}${session.id} (${session.cwd || cwd})`);
  }

  const answer = await promptInput("Select a session to resume (number, or blank to cancel): ");
  const selectedIndex = Number.parseInt(answer.trim(), 10) - 1;
  if (Number.isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= allSessions.length) return null;
  return allSessions[selectedIndex].path;
}

function openSessionOrExit(path: string, sessionDir?: string): SessionManager {
  try {
    return SessionManager.open(path, sessionDir);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
}

function forkSessionOrExit(sourcePath: string, cwd: string, sessionDir?: string, sessionId?: string): SessionManager {
  try {
    return SessionManager.forkFrom(sourcePath, cwd, sessionDir, { id: sessionId });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
}

export async function createSessionManager(parsed: Args, cwd: string, sessionDir?: string): Promise<SessionManager> {
  if (parsed.noSession) {
    return SessionManager.inMemory(cwd, parsed.sessionId !== undefined ? { id: parsed.sessionId } : undefined);
  }

  const cachedFiles = await listSessionFiles(resolveSessionDir(cwd, sessionDir));

  if (parsed.fork) {
    if (parsed.sessionId) {
      const existingTarget = await findLocalSessionByExactId(parsed.sessionId, cwd, sessionDir, cachedFiles);
      if (existingTarget) {
        throw new Error(`Session already exists with id '${parsed.sessionId}'`);
      }
    }
    const resolved = await resolveSessionPath(parsed.fork, cwd, sessionDir, cachedFiles);
    switch (resolved.type) {
      case "path":
      case "local":
      case "global":
        return forkSessionOrExit(resolved.path, cwd, sessionDir, parsed.sessionId);
      case "not_found":
        throw new Error(`No session found matching '${resolved.arg}'`);
    }
  }

  if (parsed.session) {
    const resolved = await resolveSessionPath(parsed.session, cwd, sessionDir, cachedFiles);
    switch (resolved.type) {
      case "path":
      case "local":
        return openSessionOrExit(resolved.path, sessionDir);
      case "global": {
        console.log(`Session found in different project: ${resolved.cwd}`);
        const shouldFork = await promptConfirm("Fork this session into current directory?");
        if (!shouldFork) throw new Error("Aborted.");
        return forkSessionOrExit(resolved.path, cwd, sessionDir);
      }
      case "not_found":
        throw new Error(`No session found matching '${resolved.arg}'`);
    }
  }

  if (parsed.resume) {
    const selectedPath = await selectSessionInteractively(cwd, sessionDir);
    if (!selectedPath) throw new Error("No session selected");
    return SessionManager.open(selectedPath, sessionDir);
  }

  if (parsed.continue) {
    return SessionManager.continueRecent(cwd, sessionDir);
  }

  if (parsed.sessionId) {
    const existingSession = await findLocalSessionByExactId(parsed.sessionId, cwd, sessionDir, cachedFiles);
    if (existingSession) {
      return SessionManager.open(existingSession.path, sessionDir);
    }
    console.error(`Warning: No project session found with id '${parsed.sessionId}'; creating a new session with that id.`);
  }

  return SessionManager.create(cwd, sessionDir, { id: parsed.sessionId });
}
