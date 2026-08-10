import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";

export interface PersistedSessionFixture extends AsyncDisposable {
  cwd: string;
  sessionDir: string;
  sessionManager: SessionManager;
  sessionId: string;
  dispose(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

export async function getPersistedSessionFixture(): Promise<PersistedSessionFixture> {
  const cwd = await mkdtemp(join(tmpdir(), "tsci-agent-test-session-cwd-"));
  const sessionDir = await mkdtemp(join(tmpdir(), "tsci-agent-test-session-dir-"));
  const sessionManager = SessionManager.create(cwd, sessionDir);
  sessionManager.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });
  sessionManager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "hi" }],
    api: "openai-responses",
    provider: "fake",
    model: "fake-model",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  });

  const dispose = async () => {
    await rm(cwd, { recursive: true, force: true });
    await rm(sessionDir, { recursive: true, force: true });
  };

  return {
    cwd,
    sessionDir,
    sessionManager,
    sessionId: sessionManager.getSessionId(),
    dispose,
    [Symbol.asyncDispose]: dispose,
  };
}
