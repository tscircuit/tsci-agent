import { expect, test } from "bun:test";
import { AuthStorage } from "@earendil-works/pi-coding-agent";
import { OPENAI_CODEX_PROVIDER, runOpenAiCommand } from "../src/openai-auth";

test("runs the OpenAI Codex browser login flow through Pi auth storage", async () => {
  const authStorage = AuthStorage.inMemory();
  const openedUrls: string[] = [];
  const originalLogin = authStorage.login.bind(authStorage);
  authStorage.login = async (provider, callbacks) => {
    expect(provider).toBe(OPENAI_CODEX_PROVIDER);
    expect(
      await callbacks.onSelect({
        message: "Choose login method",
        options: [
          { id: "browser", label: "Browser" },
          { id: "device_code", label: "Device code" },
        ],
      }),
    ).toBe("browser");
    callbacks.onAuth({ url: "https://auth.openai.test/login" });
    authStorage.set(provider, {
      type: "oauth",
      access: "access-token",
      refresh: "refresh-token",
      expires: Date.now() + 60_000,
    });
  };

  try {
    await runOpenAiCommand(["login"], {
      authStorage,
      openBrowser: (url) => openedUrls.push(url),
      prompt: async () => "",
    });
  } finally {
    authStorage.login = originalLogin;
  }

  expect(openedUrls).toEqual(["https://auth.openai.test/login"]);
  expect(authStorage.get(OPENAI_CODEX_PROVIDER)?.type).toBe("oauth");
});
