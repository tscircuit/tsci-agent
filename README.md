# tsci-agent

`tsci-agent` is a Bun/TypeScript command-line program built on the [Pi coding agent SDK](https://pi.dev/docs/latest/sdk). It embeds Pi and loads the `tscircuit` Agent Skill from `github:tscircuit/skill`, so the agent starts with tscircuit- and `tsci`-specific workflows available.

## Install

```bash
bun install
```

## Develop

```bash
bun run dev
```

Run the interactive SDK-backed agent:

```bash
bun run dev -- "Create a minimal tscircuit LED board"
```

No global `pi` executable is required.

## `do` command

Use `do` for a non-interactive SDK run that prints a human-readable stream of agent activity:

```bash
tsci-agent do --prompt "Create a minimal tscircuit LED board" --dir ./somedir
```

Sandbox mode runs in a temporary copy of the target directory:

```bash
tsci-agent do --prompt "Try this refactor" --dir ./somedir --sandbox
```

`--sandbox` protects the original directory from ordinary writes by using a copy, but it is not a security boundary or container.

## Build

```bash
bun run build
./dist/cli.js --help
```

The build bundles the Pi SDK code into a JavaScript entrypoint at `dist/cli.js` (not a native binary) and copies `github:tscircuit/skill` into `dist/skill`, so the packaged CLI does not need a global `pi` executable or the skill installed as a runtime dependency.

## Test

```bash
bun test
```

Tests use `tests/fixtures/getTestCli.ts`, which starts a local fake OpenAI-compatible LLM server and runs the CLI in a temporary workspace with a temporary Pi config directory.

## How it works

The CLI imports `@earendil-works/pi-coding-agent` directly and creates SDK sessions with a `DefaultResourceLoader` that points at `dist/skill/SKILL.md`. The `do` command subscribes to SDK session events and renders assistant text plus tool progress.
