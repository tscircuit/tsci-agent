export function usage(): string {
  return `Usage:
  tsci-agent [options] [initial prompt...]
  tsci-agent do --prompt <prompt> [--dir <dir>] [--sandbox] [pi sdk options...]
  tsci-agent auth <login|logout|status> --openai

Commands:
  do    Run Pi through the SDK non-interactively with a human-readable event stream.
  auth  Manage provider authentication. Initially supports --openai.

Options:
  --continue, -c           Continue the most recent session.
  --resume, -r             Select a session to resume from a numbered list.
  --session <path|id>      Use a specific session file or partial UUID.
  --session-id <id>        Use an exact project session ID, creating it if missing.
  --fork <path|id>         Fork a session file or partial UUID into a new session.
  --session-dir <dir>      Directory for session storage and lookup.
  --no-session             Don't save session (ephemeral).

Options for "do":
  --prompt, -p <text>   Prompt to send to the agent.
  --dir, -C <dir>       Working directory. Defaults to the current directory.
  --sandbox             Run in a temporary copy of --dir. This protects the
                        original directory from ordinary writes, but is not a
                        security sandbox.
  --use-openai          Use the OpenAI subscription with the default supported model.

Supported Pi SDK options after "do":
  --model <model>       Model id, fuzzy id, or provider/model.
  --provider <name>     Provider for --model or --api-key.
  --thinking <level>    off, minimal, low, medium, high, xhigh
  --tools <list>        Comma-separated tool allowlist.
  --exclude-tools <l>   Comma-separated tool denylist.
  --no-tools            Disable all tools.
  --no-builtin-tools    Disable default built-in tools.
  --extension <path>    Load an explicit Pi extension.
  --no-extensions       Ambient extension discovery is already disabled.
  --no-skills           Ambient skill discovery is already disabled; tscircuit skill still loads.
  --no-context-files    Disable AGENTS.md/CLAUDE.md discovery.
  --api-key <key>       Runtime API key override. Use with --provider.

This CLI embeds Pi via the @earendil-works/pi-coding-agent SDK; it does not
require a global pi executable.`;
}
