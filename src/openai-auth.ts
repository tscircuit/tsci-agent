import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { AuthStorage } from "@earendil-works/pi-coding-agent";

export const OPENAI_CODEX_PROVIDER = "openai-codex";
export const OPENAI_DEFAULT_MODEL = "gpt-5.6-terra";
export const OPENAI_DEFAULT_MODEL_REF = `${OPENAI_CODEX_PROVIDER}/${OPENAI_DEFAULT_MODEL}`;

interface OpenAiAuthStorage {
  get(provider: string): ReturnType<AuthStorage["get"]>;
  login(provider: string, callbacks: Parameters<AuthStorage["login"]>[1]): Promise<void>;
  logout(provider: string): void;
}

interface OpenAiCommandDependencies {
  authStorage?: OpenAiAuthStorage;
  openBrowser?: (url: string) => void;
  prompt?: (message: string, signal?: AbortSignal) => Promise<string>;
}

function openBrowser(url: string): void {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]];

  spawn(command, args, { detached: true, stdio: "ignore" })
    .on("error", () => {})
    .unref();
}

async function promptInTerminal(message: string, signal?: AbortSignal): Promise<string> {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return signal ? await terminal.question(`${message} `, { signal }) : await terminal.question(`${message} `);
  } finally {
    terminal.close();
  }
}

export async function runAuthCommand(args: string[], dependencies: OpenAiCommandDependencies = {}): Promise<void> {
  const action = args[0];
  const providerFlag = args[1];
  if (!action || !["login", "logout", "status"].includes(action) || providerFlag !== "--openai" || args.length !== 2) {
    throw new Error("Usage: tsci-agent auth <login|logout|status> --openai");
  }

  const authStorage = dependencies.authStorage ?? AuthStorage.create();

  if (action === "status") {
    const credential = authStorage.get(OPENAI_CODEX_PROVIDER);
    console.log(
      credential?.type === "oauth" ? "OpenAI credentials are stored." : "Not logged in to OpenAI. Run `tsci-agent auth login --openai`.",
    );
    return;
  }

  if (action === "logout") {
    const wasLoggedIn = authStorage.get(OPENAI_CODEX_PROVIDER)?.type === "oauth";
    authStorage.logout(OPENAI_CODEX_PROVIDER);
    console.log(wasLoggedIn ? "Logged out of OpenAI." : "Already logged out of OpenAI.");
    return;
  }

  const launchBrowser = dependencies.openBrowser ?? openBrowser;
  const prompt = dependencies.prompt ?? promptInTerminal;
  const promptAbort = new AbortController();

  try {
    await authStorage.login(OPENAI_CODEX_PROVIDER, {
      onAuth: ({ url, instructions }) => {
        console.log(`Open this URL to log in:\n${url}`);
        if (instructions) console.log(instructions);
        launchBrowser(url);
      },
      onDeviceCode: ({ verificationUri, userCode }) => {
        console.log(`Open ${verificationUri} and enter code ${userCode}.`);
        launchBrowser(verificationUri);
      },
      onPrompt: ({ message, placeholder }) => prompt(placeholder ? `${message} (${placeholder})` : message, promptAbort.signal),
      onProgress: (message) => console.log(message),
      onManualCodeInput: () =>
        prompt("Complete login in your browser, or paste the authorization code / redirect URL:", promptAbort.signal),
      onSelect: async ({ options }) => options.find((option) => option.id === "browser")?.id ?? options[0]?.id,
      signal: promptAbort.signal,
    });
  } finally {
    promptAbort.abort();
  }

  console.log("Logged in to OpenAI. Your credentials were stored by Pi.");
}
