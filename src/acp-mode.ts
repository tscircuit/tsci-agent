import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import {
  agent,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type AgentContext,
  type CancelNotification,
  type CloseSessionRequest,
  type CloseSessionResponse,
  type ContentBlock,
  type InitializeRequest,
  type InitializeResponse,
  type LoadSessionRequest,
  type LoadSessionResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptRequest,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type ResumeSessionRequest,
  type ResumeSessionResponse,
  type SessionConfigOption,
  type SessionConfigSelectOption,
  type SessionUpdate,
  type SetSessionConfigOptionRequest,
  type SetSessionConfigOptionResponse,
  type SetSessionModeRequest,
  type SetSessionModeResponse,
  type StopReason,
  type PermissionOption,
  type ToolKind,
} from "@agentclientprotocol/sdk";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  parseArgs,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
  type Args,
  type AuthStorage,
  type ExtensionAPI,
  type ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { reportDiagnostics } from "./diagnostics";
import { resolveRequestedModel } from "./model";
import { findPackageVersion, findTscircuitSkill } from "./paths";
import { createAuthStorage, createResourceLoaderOptions, createSessionOptionOverrides } from "./pi-sdk-options";
import { registerTscircuitAiGatewayProvider, resolveDefaultModelArg } from "./tscircuit-ai-gateway";

const MODEL_CONFIG_ID = "model";
const THINKING_CONFIG_ID = "thinkingLevel";
const ACP_PERMISSION_OPTIONS = [
  { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
  { optionId: "reject-once", name: "Reject once", kind: "reject_once" },
] satisfies PermissionOption[];

type PiThinkingLevel = NonNullable<Args["thinking"]>;
type PiImageContent = { type: "image"; data: string; mimeType: string };

interface AcpSharedResources {
  parsed: Args;
  agentDir: string;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  skillPath: string;
  sessionDir?: string;
}

interface AcpSessionState {
  session: AgentSession;
  sessionManager: SessionManager;
  cwd: string;
  cancel?: () => void;
  client?: AgentContext;
  promptAbortController?: AbortController;
}

function mapToolKind(toolName: string): ToolKind {
  switch (toolName) {
    case "read":
    case "ls":
      return "read";
    case "bash":
      return "execute";
    case "edit":
    case "write":
      return "edit";
    case "grep":
    case "find":
      return "search";
    default:
      return "other";
  }
}

function mapStopReason(reason: string | undefined): StopReason {
  switch (reason) {
    case "aborted":
      return "cancelled";
    case "length":
      return "max_tokens";
    case "error":
      return "refusal";
    default:
      return "end_turn";
  }
}

function isAvailableThinkingLevel(session: AgentSession, value: string): value is PiThinkingLevel {
  return session.getAvailableThinkingLevels().some((level) => level === value);
}

async function requestAcpToolPermission(
  state: AcpSessionState | undefined,
  sessionId: string,
  event: ToolCallEvent,
): Promise<{ block: true; reason: string } | undefined> {
  const client = state?.client;
  const signal = state?.promptAbortController?.signal;
  if (!state || !client || !signal) {
    return { block: true, reason: "No active ACP client is available to approve this tool call." };
  }
  if (signal.aborted) return { block: true, reason: "Tool permission request was cancelled." };

  let onAbort: (() => void) | undefined;
  const aborted = new Promise<undefined>((resolve) => {
    onAbort = () => resolve(undefined);
    if (signal.aborted) resolve(undefined);
    else signal.addEventListener("abort", onAbort, { once: true });
  });

  try {
    const request = client.request<RequestPermissionResponse, RequestPermissionRequest>(methods.client.session.requestPermission, {
      sessionId,
      toolCall: {
        toolCallId: event.toolCallId,
        title: event.toolName,
        name: event.toolName,
        kind: mapToolKind(event.toolName),
        status: "pending",
        rawInput: event.input,
      },
      options: ACP_PERMISSION_OPTIONS,
    });
    const response = await Promise.race([request, aborted]);
    if (!response) {
      return { block: true, reason: "Tool permission request was cancelled." };
    }
    const outcome = response.outcome;
    if (outcome.outcome === "cancelled") return { block: true, reason: "Tool permission request was cancelled." };

    const selectedOption = ACP_PERMISSION_OPTIONS.find((option) => option.optionId === outcome.optionId);
    switch (selectedOption?.kind) {
      case "allow_once":
        return undefined;
      case "reject_once":
        return { block: true, reason: "Tool call rejected by the user." };
      default:
        return { block: true, reason: "The ACP client returned an unknown permission choice." };
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { block: true, reason: `ACP permission request failed: ${reason}` };
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

function extractPromptContent(prompt: ContentBlock[]): { text: string; images: PiImageContent[] } {
  const textParts: string[] = [];
  const images: PiImageContent[] = [];

  for (const block of prompt) {
    if (block.type === "text") {
      textParts.push(block.text);
    } else if (block.type === "image") {
      images.push({ type: "image", data: block.data, mimeType: block.mimeType });
    }
  }

  return { text: textParts.join("\n"), images };
}

function mapEventToUpdate(event: AgentSessionEvent, messageId: string): SessionUpdate | undefined {
  switch (event.type) {
    case "message_update": {
      const update = event.assistantMessageEvent;
      if (update?.type === "text_delta" && update.delta) {
        return { sessionUpdate: "agent_message_chunk", messageId, content: { type: "text", text: update.delta } };
      }
      if (update?.type === "thinking_delta" && update.delta) {
        return { sessionUpdate: "agent_thought_chunk", messageId, content: { type: "text", text: update.delta } };
      }
      return undefined;
    }
    case "tool_execution_start":
      return {
        sessionUpdate: "tool_call",
        toolCallId: event.toolCallId,
        title: event.toolName,
        name: event.toolName,
        kind: mapToolKind(event.toolName),
        status: "pending",
        rawInput: event.args,
      };
    case "tool_execution_end":
      return {
        sessionUpdate: "tool_call_update",
        toolCallId: event.toolCallId,
        status: event.isError ? "failed" : "completed",
        rawOutput: event.result,
      };
    default:
      return undefined;
  }
}

function mapPiContentBlock(block: { type: "text"; text: string } | PiImageContent): ContentBlock {
  if (block.type === "text") return { type: "text", text: block.text };
  return { type: "image", data: block.data, mimeType: block.mimeType };
}

function mapPiContent(content: string | ({ type: "text"; text: string } | PiImageContent)[] | null | undefined): ContentBlock[] {
  if (content == null) return [];
  if (Array.isArray(content)) return content.map(mapPiContentBlock);
  return [{ type: "text", text: content }];
}

async function replayAcpSessionHistory(state: AcpSessionState, sessionId: string, client: AgentContext): Promise<void> {
  const notify = (update: SessionUpdate) => client.notify(methods.client.session.update, { sessionId, update });
  const pendingToolCalls = new Set<string>();
  const entries = state.sessionManager.getBranch();

  for (const [index, entry] of entries.entries()) {
    const messageId = `${sessionId}:${index}`;

    if (entry.type === "custom_message") {
      if (!entry.display) continue;
      for (const content of mapPiContent(entry.content)) {
        await notify({ sessionUpdate: "agent_message_chunk", messageId, content });
      }
      continue;
    }

    if (entry.type !== "message") continue;

    const message = entry.message;

    if (message.role === "user") {
      for (const content of mapPiContent(message.content)) {
        await notify({
          sessionUpdate: "user_message_chunk",
          messageId,
          content,
        });
      }
      continue;
    }

    if (message.role === "assistant") {
      const blocks = Array.isArray(message.content) ? message.content : [];
      for (const block of blocks) {
        if (block.type === "text") {
          await notify({
            sessionUpdate: "agent_message_chunk",
            messageId,
            content: mapPiContentBlock(block),
          });
        } else if (block.type === "thinking") {
          await notify({
            sessionUpdate: "agent_thought_chunk",
            messageId,
            content: { type: "text", text: block.thinking },
          });
        } else if (block.type === "toolCall") {
          pendingToolCalls.add(block.id);
          await notify({
            sessionUpdate: "tool_call",
            toolCallId: block.id,
            title: block.name,
            name: block.name,
            kind: mapToolKind(block.name),
            status: "pending",
            rawInput: block.arguments,
          });
        }
      }
      continue;
    }

    if (message.role === "toolResult") {
      if (!pendingToolCalls.has(message.toolCallId)) continue;
      pendingToolCalls.delete(message.toolCallId);
      await notify({
        sessionUpdate: "tool_call_update",
        toolCallId: message.toolCallId,
        status: message.isError ? "failed" : "completed",
        content: mapPiContent(message.content).map((content) => ({ type: "content", content })),
      });
      continue;
    }

    if (message.role === "custom" && message.display) {
      for (const content of mapPiContent(message.content)) {
        await notify({
          sessionUpdate: "agent_message_chunk",
          messageId,
          content,
        });
      }
      continue;
    }

    if (message.role === "bashExecution") {
      const toolCallId = `${sessionId}:bash:${index}`;
      await notify({
        sessionUpdate: "tool_call",
        toolCallId,
        title: message.command,
        name: "bash",
        kind: "execute",
        status: "pending",
        rawInput: { command: message.command },
      });
      await notify({
        sessionUpdate: "tool_call_update",
        toolCallId,
        status: message.cancelled || message.exitCode !== 0 ? "failed" : "completed",
        rawOutput: message.output,
      });
    }
  }

  for (const toolCallId of pendingToolCalls) {
    await notify({
      sessionUpdate: "tool_call_update",
      toolCallId,
      status: "failed",
      rawOutput: "No tool result was saved for this call.",
    });
  }
}

async function buildAcpSessionState(
  resources: AcpSharedResources,
  sessionManager: SessionManager,
  cwd: string,
  model: ReturnType<typeof resolveRequestedModel>,
): Promise<AcpSessionState> {
  registerTscircuitAiGatewayProvider(resources.modelRegistry, sessionManager.getSessionId());

  const settingsManager = SettingsManager.create(cwd, resources.agentDir);
  let state: AcpSessionState | undefined;
  const extensionFactories = [
    {
      name: "acp-permissions",
      factory: (pi: ExtensionAPI) => {
        pi.on("tool_call", async (event) => {
          if (!["bash", "edit", "write"].includes(event.toolName)) return;
          return requestAcpToolPermission(state, sessionManager.getSessionId(), event);
        });
      },
    },
  ];
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: resources.agentDir,
    settingsManager,
    extensionFactories,
    ...createResourceLoaderOptions(cwd, resources.parsed, resources.skillPath),
  });
  await loader.reload();

  const { session } = await createAgentSession({
    cwd,
    agentDir: resources.agentDir,
    authStorage: resources.authStorage,
    modelRegistry: resources.modelRegistry,
    settingsManager,
    resourceLoader: loader,
    sessionManager,
    model,
    ...createSessionOptionOverrides(resources.parsed),
  });
  state = { session, sessionManager, cwd };
  await session.bindExtensions({ mode: "rpc" });

  return state;
}

async function createAcpSession(resources: AcpSharedResources, cwd: string): Promise<AcpSessionState> {
  const sessionManager = SessionManager.create(cwd, resources.sessionDir);
  registerTscircuitAiGatewayProvider(resources.modelRegistry, sessionManager.getSessionId());
  const model = resolveRequestedModel(resources.modelRegistry, resources.parsed.provider, resolveDefaultModelArg(resources.parsed.model));
  return buildAcpSessionState(resources, sessionManager, cwd, model);
}

async function resumeAcpSession(resources: AcpSharedResources, sessionId: string, cwd: string): Promise<AcpSessionState> {
  const sessions = await SessionManager.list(cwd, resources.sessionDir);
  const match = sessions.find((entry) => entry.id === sessionId);
  if (!match) throw new Error(`Session not found: ${sessionId}`);
  const sessionManager = SessionManager.open(match.path, resources.sessionDir);
  return buildAcpSessionState(resources, sessionManager, match.cwd || cwd, undefined);
}

class AcpBridge {
  private readonly sessions = new Map<string, AcpSessionState>();

  constructor(private readonly resources: AcpSharedResources) {}

  initialize(_params: InitializeRequest, version: string): InitializeResponse {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image: true },
        sessionCapabilities: { resume: {}, close: {} },
      },
      agentInfo: { name: "tsci-agent", version },
    };
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    const state = await createAcpSession(this.resources, params.cwd);
    const sessionId = state.session.sessionId;
    this.sessions.set(sessionId, state);
    return { sessionId, configOptions: this.buildConfigOptions(state) };
  }

  async resumeSession(params: ResumeSessionRequest): Promise<ResumeSessionResponse> {
    const state = await resumeAcpSession(this.resources, params.sessionId, params.cwd);
    this.sessions.set(params.sessionId, state);
    return { configOptions: this.buildConfigOptions(state) };
  }

  async loadSession(params: LoadSessionRequest, client: AgentContext): Promise<LoadSessionResponse> {
    const state = await resumeAcpSession(this.resources, params.sessionId, params.cwd);
    this.sessions.set(params.sessionId, state);
    try {
      await replayAcpSessionHistory(state, params.sessionId, client);
    } catch (error) {
      this.sessions.delete(params.sessionId);
      state.session.dispose();
      throw error;
    }
    return { configOptions: this.buildConfigOptions(state) };
  }

  async setSessionMode(_params: SetSessionModeRequest): Promise<SetSessionModeResponse> {
    return {};
  }

  async setSessionConfigOption(params: SetSessionConfigOptionRequest): Promise<SetSessionConfigOptionResponse> {
    const state = this.sessions.get(params.sessionId);
    if (!state) throw new Error(`Session not found: ${params.sessionId}`);
    if (typeof params.value !== "string") throw new Error("Config option expects a string value.");

    if (params.configId === MODEL_CONFIG_ID) {
      const model = resolveRequestedModel(this.resources.modelRegistry, undefined, params.value);
      if (model) await state.session.setModel(model);
    } else if (params.configId === THINKING_CONFIG_ID) {
      if (!isAvailableThinkingLevel(state.session, params.value)) {
        throw new Error(`Unsupported thinking level for the current model: ${params.value}`);
      }
      state.session.setThinkingLevel(params.value);
    }

    return { configOptions: this.buildConfigOptions(state) };
  }

  async prompt(params: PromptRequest, client: AgentContext): Promise<PromptResponse> {
    const state = this.sessions.get(params.sessionId);
    if (!state) throw new Error(`Session not found: ${params.sessionId}`);

    const { text, images } = extractPromptContent(params.prompt);
    const messageId = randomUUID();

    registerTscircuitAiGatewayProvider(this.resources.modelRegistry, state.session.sessionId);

    const notify = (update: SessionUpdate) => client.notify(methods.client.session.update, { sessionId: params.sessionId, update });
    if (state.promptAbortController) throw new Error(`Session already has an active prompt: ${params.sessionId}`);
    const promptAbortController = new AbortController();
    state.client = client;
    state.promptAbortController = promptAbortController;

    const pendingNotifies: Promise<void>[] = [];
    let cancelled = false;
    state.cancel = () => {
      cancelled = true;
      promptAbortController.abort();
    };

    let unsubscribe = () => {};
    try {
      await notify({ sessionUpdate: "user_message_chunk", content: { type: "text", text } });
      unsubscribe = state.session.subscribe((event) => {
        const update = mapEventToUpdate(event, messageId);
        if (update) pendingNotifies.push(notify(update));
      });
      await state.session.prompt(text, { images, source: "rpc" });
    } finally {
      state.cancel = undefined;
      state.client = undefined;
      state.promptAbortController = undefined;
      unsubscribe();
    }

    await Promise.allSettled(pendingNotifies);

    const lastAssistant = [...state.session.messages].reverse().find((message) => message.role === "assistant");
    return { stopReason: cancelled ? "cancelled" : mapStopReason(lastAssistant?.stopReason) };
  }

  async cancel(params: CancelNotification): Promise<void> {
    const state = this.sessions.get(params.sessionId);
    if (!state) return;
    state.cancel?.();
    state.promptAbortController?.abort();
    await state.session.abort();
  }

  async closeSession(params: CloseSessionRequest): Promise<CloseSessionResponse> {
    const state = this.sessions.get(params.sessionId);
    if (!state) return {};
    this.sessions.delete(params.sessionId);
    state.promptAbortController?.abort();
    await state.session.abort();
    state.session.dispose();
    return {};
  }

  async dispose(): Promise<void> {
    for (const state of this.sessions.values()) {
      state.promptAbortController?.abort();
      await state.session.abort().catch(() => {});
      state.session.dispose();
    }
    this.sessions.clear();
  }

  private buildConfigOptions(state: AcpSessionState): SessionConfigOption[] {
    const currentModel = state.session.model;
    const currentModelRef = currentModel ? `${currentModel.provider}/${currentModel.id}` : undefined;

    const modelChoices = this.resources.modelRegistry.getAvailable().map((model) => ({
      value: `${model.provider}/${model.id}`,
      name: model.name,
    }));

    const modelOptions: SessionConfigSelectOption[] = currentModelRef
      ? [{ value: currentModelRef, name: currentModel?.name ?? currentModelRef }]
      : [];

    for (const choice of modelChoices) {
      if (choice.value !== currentModelRef) {
        modelOptions.push(choice);
      }
    }

    const modelOption: SessionConfigOption = {
      type: "select",
      id: MODEL_CONFIG_ID,
      name: "Model",
      category: "model",
      currentValue: currentModelRef ?? modelChoices[0]?.value ?? "",
      options: modelOptions,
    };

    const currentThinking = state.session.thinkingLevel;
    const thinkingOption: SessionConfigOption = {
      type: "select",
      id: THINKING_CONFIG_ID,
      name: "Thinking",
      category: "thought_level",
      currentValue: currentThinking,
      options: state.session.getAvailableThinkingLevels().map((level) => ({ value: level, name: level })),
    };

    return [modelOption, thinkingOption];
  }
}

export async function runAcpMode(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  reportDiagnostics(parsed.diagnostics);
  if (parsed.diagnostics.some((diagnostic) => diagnostic.type === "error")) process.exit(1);

  const agentDir = getAgentDir();
  const skillPath = await findTscircuitSkill();
  const authStorage = createAuthStorage(parsed);
  const modelRegistry = ModelRegistry.create(authStorage);

  const version = await findPackageVersion();
  const bridge = new AcpBridge({ parsed, agentDir, authStorage, modelRegistry, skillPath, sessionDir: parsed.sessionDir });

  const stream = ndJsonStream(Writable.toWeb(process.stdout), Bun.stdin.stream());

  const app = agent({ name: "tsci-agent" })
    .onRequest(methods.agent.initialize, (ctx) => bridge.initialize(ctx.params, version))
    .onRequest(methods.agent.session.new, (ctx) => bridge.newSession(ctx.params))
    .onRequest(methods.agent.session.load, (ctx) => bridge.loadSession(ctx.params, ctx.client))
    .onRequest(methods.agent.session.resume, (ctx) => bridge.resumeSession(ctx.params))
    .onRequest(methods.agent.session.setMode, (ctx) => bridge.setSessionMode(ctx.params))
    .onRequest(methods.agent.session.setConfigOption, (ctx) => bridge.setSessionConfigOption(ctx.params))
    .onRequest(methods.agent.session.prompt, (ctx) => bridge.prompt(ctx.params, ctx.client))
    .onRequest(methods.agent.session.close, (ctx) => bridge.closeSession(ctx.params))
    .onNotification(methods.agent.session.cancel, (ctx) => bridge.cancel(ctx.params));

  const connection = app.connect(stream);

  let disposed = false;
  const disposeOnce = async () => {
    if (disposed) return;
    disposed = true;
    await bridge.dispose();
  };

  process.on("SIGINT", () => void disposeOnce().finally(() => process.exit(130)));
  process.on("SIGTERM", () => void disposeOnce().finally(() => process.exit(143)));

  await connection.closed;
  await disposeOnce();
}
