import { InteractiveMode } from "@earendil-works/pi-coding-agent";

export function replaceTerminalTitlePi(title: string): string {
  return title.replace(/^π(?= - )/, "tsci-agent");
}

export function installTerminalTitleRebrand(mode: InteractiveMode): void {
  const terminal = (mode as unknown as { ui?: { terminal?: { setTitle?: (title: string) => void } } })?.ui?.terminal;
  const originalSetTitle = terminal?.setTitle?.bind(terminal);
  if (!terminal || !originalSetTitle) return;
  terminal.setTitle = (title: string) => originalSetTitle(replaceTerminalTitlePi(title));
}
