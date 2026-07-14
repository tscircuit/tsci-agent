import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const responsesDir = join(__dirname, "responses");

export interface FakeLlmApiServer {
  url: string;
  failNextChatCompletion(status: number, body: unknown): void;
  getLastRequestHeaders(): Record<string, string> | undefined;
  stop(): Promise<void>;
}

interface CachedResponse {
  inputSummary: string;
  match: string;
  phase?: "initial" | "tool-result";
  output?: string;
  outputTemplate?: string;
  toolCall?: {
    name: string;
    args: unknown;
  };
}

function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item) return String((item as { text: unknown }).text ?? "");
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function getLastUserText(body: any): string {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return extractText(messages[i].content);
  }
  return JSON.stringify(body).slice(0, 1000);
}

function getLastToolText(body: any): string | undefined {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "tool") return extractText(messages[i].content);
  }
  return undefined;
}

function words(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

function scoreMatch(input: string, candidate: string): number {
  if (input.includes(candidate) || candidate.includes(input)) return 10_000 + Math.min(input.length, candidate.length);

  const a = words(input);
  const b = words(candidate);
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const word of a) if (b.has(word)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

function normalizeVolatileText(input: string): string {
  return input
    .replace(/\/private\/var\/folders\/[^\s]+\/tsci-agent-[^\s]+\/workspace/g, "<sandbox-workspace>")
    .replace(/\/var\/folders\/[^\s]+\/tsci-agent-[^\s]+\/workspace/g, "<sandbox-workspace>")
    .replace(/\/tmp\/tsci-agent-[^\s]+\/workspace/g, "<sandbox-workspace>")
    .replace(/^total \d+$/gm, "total <blocks>")
    .replace(/^[dl-][rwx@-]+\s+\d+\s+\S+\s+\S+\s+\d+\s+\w+\s+\d+\s+\d+:\d+\s+(.+)$/gm, "$1");
}

function summarizeInput(input: string): string {
  const normalized = normalizeVolatileText(input).replace(/\s+/g, " ").trim();
  const hash = createHash("md5").update(normalized).digest("hex").slice(0, 8);
  const start = normalized.slice(0, 10);
  const end = normalized.slice(-50);
  return `${start}...${hash}...${end}`;
}

async function loadCachedResponses(): Promise<CachedResponse[]> {
  await mkdir(responsesDir, { recursive: true });
  const files = (await readdir(responsesDir)).filter((file) => /^response-.*\.json$/.test(file)).sort();
  const responses: CachedResponse[] = [];

  for (const file of files) {
    const parsed = JSON.parse(await readFile(join(responsesDir, file), "utf8"));
    if (
      typeof parsed.match === "string" &&
      (typeof parsed.output === "string" || typeof parsed.outputTemplate === "string" || parsed.toolCall)
    ) {
      responses.push(parsed);
    }
  }

  return responses;
}

function cacheKeyFor(input: string, toolText: string | undefined): { key: string; phase: "initial" | "tool-result" } {
  if (!toolText) return { key: normalizeVolatileText(input), phase: "initial" };
  return {
    key: normalizeVolatileText(`${input}\n\nTool result:\n${toolText}`),
    phase: "tool-result",
  };
}

function parseToolArgs(value: unknown): unknown {
  if (typeof value !== "string") return value ?? {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

async function writeCachedResponse(response: CachedResponse): Promise<void> {
  await mkdir(responsesDir, { recursive: true });
  await writeFile(join(responsesDir, `response-${Date.now()}.json`), `${JSON.stringify(response, null, 2)}\n`);
}

async function generateWithOpenAi(cacheKey: string, phase: "initial" | "tool-result", body: any): Promise<CachedResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(`No cached fake LLM response matched ${JSON.stringify(cacheKey)} and OPENAI_API_KEY is not set.`);
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.FAKE_LLM_GENERATE_MODEL ?? "gpt-5-mini-2025-08-07",
      messages: body.messages,
      tools: body.tools,
      tool_choice: body.tool_choice,
      max_completion_tokens: 1200,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI fallback failed: ${response.status} ${await response.text()}`);
  }

  const json = await response.json();
  const message = json?.choices?.[0]?.message;
  const toolCall = message?.tool_calls?.[0];

  let cached: CachedResponse;
  if (toolCall?.function?.name) {
    cached = {
      inputSummary: summarizeInput(cacheKey),
      match: cacheKey,
      phase,
      toolCall: {
        name: toolCall.function.name,
        args: parseToolArgs(toolCall.function.arguments),
      },
    };
  } else {
    const output = message?.content;
    if (typeof output !== "string" || output.length === 0) {
      throw new Error(`OpenAI fallback returned neither content nor tool call: ${JSON.stringify(json)}`);
    }
    cached = {
      inputSummary: summarizeInput(cacheKey),
      match: cacheKey,
      phase,
      output: normalizeVolatileText(output),
    };
  }

  await writeCachedResponse(cached);
  return cached;
}

async function findBestResponse(input: string, toolText: string | undefined, body: any): Promise<CachedResponse> {
  const { key, phase } = cacheKeyFor(input, toolText);
  const responses = (await loadCachedResponses()).filter((response) => (response.phase ?? "initial") === phase);
  let best: { response: CachedResponse; score: number } | undefined;

  for (const response of responses) {
    const normalizedMatch = normalizeVolatileText(response.match);
    if (normalizedMatch === key) return response;
    const score = phase === "initial" ? scoreMatch(key, normalizedMatch) : 0;
    if (!best || score > best.score) best = { response, score };
  }

  if (phase === "initial" && best && best.score >= 0.5) return best.response;
  return generateWithOpenAi(key, phase, body);
}

function renderCachedResponse(response: CachedResponse, toolText: string | undefined): string {
  if (response.outputTemplate) {
    return response.outputTemplate.replaceAll("{{toolText}}", toolText ?? "");
  }
  if (response.output) return response.output;
  throw new Error(`Cached response for ${JSON.stringify(response.match)} has no output.`);
}

function openAiChunk(content: string, finishReason: string | null = null) {
  return {
    id: "chatcmpl-fake",
    object: "chat.completion.chunk",
    created: 1,
    model: "fake-model",
    choices: [{ index: 0, delta: content ? { role: "assistant", content } : {}, finish_reason: finishReason }],
  };
}

function streamOpenAiText(output: string): Response {
  const encoder = new TextEncoder();
  const chunks = output.match(/.{1,24}/gs) ?? [output];
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(openAiChunk(chunk))}\n\n`));
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(openAiChunk("", "stop"))}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

function streamOpenAiToolCall(name: string, args: unknown): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            id: "chatcmpl-fake",
            object: "chat.completion.chunk",
            created: 1,
            model: "fake-model",
            choices: [
              {
                index: 0,
                delta: {
                  role: "assistant",
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_fake_ls",
                      type: "function",
                      function: { name, arguments: JSON.stringify(args) },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          })}\n\n`,
        ),
      );
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(openAiChunk("", "tool_calls"))}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

function openAiToolCallResponse(name: string, args: unknown): Response {
  return Response.json({
    id: "chatcmpl-fake",
    object: "chat.completion",
    created: 1,
    model: "fake-model",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_fake_ls",
              type: "function",
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
  });
}

export async function startFakeLlmApiServer(): Promise<FakeLlmApiServer> {
  let lastRequestHeaders: Record<string, string> | undefined;
  let nextChatCompletionFailure: { status: number; body: unknown } | undefined;

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/health") {
        return Response.json({ ok: true });
      }

      if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
        try {
          lastRequestHeaders = Object.fromEntries(request.headers.entries());
          if (nextChatCompletionFailure) {
            const failure = nextChatCompletionFailure;
            nextChatCompletionFailure = undefined;
            return Response.json(failure.body, { status: failure.status });
          }

          const body = await request.json();
          const input = getLastUserText(body);
          const toolText = getLastToolText(body);
          const response = await findBestResponse(input, toolText, body);

          if (response.toolCall) {
            return body?.stream
              ? streamOpenAiToolCall(response.toolCall.name, response.toolCall.args)
              : openAiToolCallResponse(response.toolCall.name, response.toolCall.args);
          }

          const output = renderCachedResponse(response, toolText);

          if (body?.stream) return streamOpenAiText(output);

          return Response.json({
            id: "chatcmpl-fake",
            object: "chat.completion",
            created: 1,
            model: "fake-model",
            choices: [{ index: 0, message: { role: "assistant", content: output }, finish_reason: "stop" }],
          });
        } catch (error) {
          return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
        }
      }

      return Response.json({ error: `Unhandled fake LLM route: ${request.method} ${url.pathname}` }, { status: 404 });
    },
  });

  return {
    url: `http://${server.hostname}:${server.port}`,
    failNextChatCompletion(status, body) {
      nextChatCompletionFailure = { status, body };
    },
    getLastRequestHeaders() {
      return lastRequestHeaders;
    },
    async stop() {
      await server.stop(true);
    },
  };
}
