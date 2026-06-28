import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

function stringifyForLog(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function renderEvent(event: AgentSessionEvent): void {
  switch (event.type) {
    case "agent_start":
      console.error("[agent] start");
      break;
    case "agent_end":
      console.error("\n[agent] done");
      break;
    case "turn_start":
      console.error("[turn] start");
      break;
    case "turn_end":
      console.error("\n[turn] end");
      break;
    case "message_update": {
      const update = event.assistantMessageEvent;
      if (update?.type === "text_delta") {
        process.stdout.write(update.delta ?? "");
      } else if (update?.type === "thinking_delta") {
        process.stderr.write(update.delta ?? "");
      }
      break;
    }
    case "tool_execution_start":
      console.error(`\n[tool] ${event.toolName} ${stringifyForLog(event.args)}`);
      break;
    case "tool_execution_update":
      break;
    case "tool_execution_end":
      console.error(`[tool] ${event.toolName} ${event.isError ? "failed" : "ok"}`);
      break;
    case "compaction_start":
      console.error(`[compaction] start ${event.reason}`);
      break;
    case "compaction_end":
      console.error(`[compaction] end ${event.aborted ? "aborted" : "done"}`);
      break;
    case "auto_retry_start":
      console.error(`[retry] attempt ${event.attempt}/${event.maxAttempts}: ${event.errorMessage}`);
      break;
    case "auto_retry_end":
      console.error(`[retry] ${event.success ? "recovered" : "failed"}`);
      break;
    default:
      break;
  }
}
