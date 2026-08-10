import { expect, test } from "bun:test";
import type { Args } from "@earendil-works/pi-coding-agent";
import { createSessionManager } from "../src/session";
import { getPersistedSessionFixture } from "./fixtures/getPersistedSession";

test("--session resumes an existing session by id instead of creating a new one", async () => {
  await using fixture = await getPersistedSessionFixture();

  const resumed = await createSessionManager({ session: fixture.sessionId } as Args, fixture.cwd, fixture.sessionDir);

  expect(resumed.getSessionId()).toBe(fixture.sessionId);
  expect(resumed.getSessionFile()).toBe(fixture.sessionManager.getSessionFile());
  expect(resumed.getEntries().filter((entry) => entry.type === "message")).toHaveLength(2);
});
