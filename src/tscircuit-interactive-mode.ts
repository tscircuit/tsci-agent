import { DynamicBorder, InteractiveMode, type InteractiveModeOptions, type AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import { Spacer, Text, type Component } from "@earendil-works/pi-tui";
import { checkForTsciAgentUpdate, type TsciAgentRelease } from "./version-check";

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

const warning = (text: string) => `\x1b[33m${text}\x1b[39m`;
const muted = (text: string) => `\x1b[2m${text}\x1b[22m`;
const bold = (text: string) => `\x1b[1m${text}\x1b[22m`;

function getCompactWelcome(): string {
  return `tscircuit agent\n${COMPACT_HELP}\nPress Ctrl-O to show full startup help and loaded resources.\n\n${ONBOARDING}`;
}

function getExpandedWelcome(): string {
  return `tscircuit agent\n${EXPANDED_HELP}\n\n${ONBOARDING}`;
}

export class TscircuitInteractiveMode extends InteractiveMode {
  constructor(
    runtimeHost: AgentSessionRuntime,
    options: InteractiveModeOptions = {},
    private readonly tsciAgentVersion = "0.0.0",
  ) {
    super(runtimeHost, options);
  }

  override async init(): Promise<void> {
    await super.init();

    checkForTsciAgentUpdate(this.tsciAgentVersion).then((release) => {
      if (release) this.showTsciAgentUpdateNotification(release);
    });

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

  showTsciAgentUpdateNotification(release: TsciAgentRelease): void {
    const mode = this as unknown as {
      chatContainer?: { addChild: (component: Component) => void };
      ui?: { requestRender?: () => void };
    };
    if (!mode.chatContainer) return;

    const message = `${bold(warning("Update Available"))}\n` + `${muted(`New tsci-agent version ${release.version} is available`)}`;

    mode.chatContainer.addChild(new Spacer(1));
    mode.chatContainer.addChild(new DynamicBorder(warning));
    mode.chatContainer.addChild(new Text(message, 1, 0));
    mode.chatContainer.addChild(new DynamicBorder(warning));
    mode.ui?.requestRender?.();
  }
}
