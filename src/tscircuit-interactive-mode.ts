import { InteractiveMode, type InteractiveModeOptions } from "@earendil-works/pi-coding-agent";
import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";

const COMPACT_HELP = "Ctrl-C interrupt | Ctrl-L/Ctrl-D clear/exit | / commands | ! bash | Ctrl-O more";
const EXPANDED_HELP = [
  "Ctrl-C to interrupt",
  "Ctrl-L to clear",
  "Ctrl-D to exit when input is empty",
  "/ for commands",
  "! to run bash",
  "Ctrl-O to expand tools and startup help",
].join("\n");
const ONBOARDING = "Ask tsci agent to create, inspect, debug, or refactor tscircuit boards and packages.";

export function replaceResumeCommandPi(text: string): string {
  return text.replace(/pi (?=--session)/, "tsci-agent ");
}

const UTF8_DECODER = new TextDecoder();

export function maybeRebrandResumeChunk(chunk: string | Uint8Array): string | Uint8Array {
  const text = typeof chunk === "string" ? chunk : UTF8_DECODER.decode(chunk);
  return text.includes("To resume this session") ? replaceResumeCommandPi(text) : chunk;
}

function installResumeCommandRebrand(): void {
  const originalWrite = process.stdout.write.bind(process.stdout);
  const wrappedWrite: typeof process.stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
    const rebranded = maybeRebrandResumeChunk(chunk);
    if (rebranded !== chunk) process.stdout.write = originalWrite;
    chunk = rebranded;
    return originalWrite(chunk, ...(args as [BufferEncoding?, ((error?: Error | null) => void)?]));
  }) as typeof process.stdout.write;
  process.stdout.write = wrappedWrite;
}

function getCompactWelcome(): string {
  return `tscircuit agent\n${COMPACT_HELP}\nPress Ctrl-O to show full startup help and loaded resources.\n\n${ONBOARDING}`;
}

function getExpandedWelcome(): string {
  return `tscircuit agent\n${EXPANDED_HELP}\n\n${ONBOARDING}`;
}

export class TscircuitInteractiveMode extends InteractiveMode {
  constructor(runtimeHost: AgentSessionRuntime, options: InteractiveModeOptions = {}) {
    super(runtimeHost, options);
    installResumeCommandRebrand();
  }

  override async init(): Promise<void> {
    await super.init();

    const mode = this as unknown as {
      builtInHeader?: {
        getCollapsedText?: () => string;
        getExpandedText?: () => string;
        setExpanded?: (expanded: boolean) => void;
        setText?: (text: string) => void;
      };
      toolOutputExpanded?: boolean;
      ui?: { requestRender?: () => void };
    };
    const header = mode.builtInHeader;
    if (!header) return;

    header.getCollapsedText = getCompactWelcome;
    header.getExpandedText = getExpandedWelcome;
    if (header.setExpanded) header.setExpanded(Boolean(mode.toolOutputExpanded));
    else header.setText?.(getCompactWelcome());
    mode.ui?.requestRender?.();
  }
}
