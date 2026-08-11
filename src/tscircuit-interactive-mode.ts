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
const UTF8_DECODER = new TextDecoder();

export function replaceResumeCommandPi(text: string): string {
  return text.replace(/pi (?=--session)/, "tsci-agent ");
}

export function rebrandResumeChunk(chunk: string | Uint8Array): string | Uint8Array {
  const text = chunk instanceof Uint8Array ? UTF8_DECODER.decode(chunk) : chunk;
  return text.includes("To resume this session") ? replaceResumeCommandPi(text) : chunk;
}

type StdoutWrite = (chunk: string | Uint8Array, ...args: unknown[]) => boolean;

function installResumeCommandRebrand() {
  const originalWrite = process.stdout.write.bind(process.stdout);
  const wrappedWrite: StdoutWrite = (chunk, ...args) => {
    const rebranded = rebrandResumeChunk(chunk);
    return originalWrite(rebranded, ...(args as [BufferEncoding?, ((error?: Error | null) => void)?]));
  };
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
