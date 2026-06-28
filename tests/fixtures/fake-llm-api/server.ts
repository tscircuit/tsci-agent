import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const responsesDir = join(__dirname, "responses");

export interface FakeLlmApiServer {
  url: string;
  stop(): Promise<void>;
}

interface CachedResponse {
  inputSummary: string;
  match: string;
  output: string;
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

function summarizeInput(input: string): string {
  const normalized = input.replace(/\s+/g, " ").trim();
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
    if (typeof parsed.match === "string" && typeof parsed.output === "string") {
      responses.push(parsed);
    }
  }

  return responses;
}

async function generateWithOpenAi(input: string): Promise<CachedResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(`No cached fake LLM response matched ${JSON.stringify(input)} and OPENAI_API_KEY is not set.`);
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.FAKE_LLM_GENERATE_MODEL ?? "gpt-5-mini-2025-08-07",
      messages: [
        {
          role: "system",
          content:
            "You are generating a deterministic fixture response for tsci-agent tests. Keep the answer short and stable.",
        },
        { role: "user", content: input },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI fallback failed: ${response.status} ${await response.text()}`);
  }

  const json = await response.json();
  const output = json?.choices?.[0]?.message?.content;
  if (typeof output !== "string" || output.length === 0) {
    throw new Error(`OpenAI fallback returned no content: ${JSON.stringify(json)}`);
  }

  const cached = { inputSummary: summarizeInput(input), match: input, output };
  await writeFile(join(responsesDir, `response-${Date.now()}.json`), `${JSON.stringify(cached, null, 2)}\n`);
  return cached;
}

async function findBestResponse(input: string): Promise<CachedResponse> {
  const responses = await loadCachedResponses();
  let best: { response: CachedResponse; score: number } | undefined;

  for (const response of responses) {
    const score = scoreMatch(input, response.match);
    if (!best || score > best.score) best = { response, score };
  }

  if (best && best.score >= 0.5) return best.response;
  return generateWithOpenAi(input);
}

function openAiChunk(content: string, finishReason: string | null = null) {
  return {
    id: "chatcmpl-fake",
    object: "chat.completion.chunk",
    created: 1,
    model: "fake-model",
    choices: [{ index: 0, delta: content ? { content } : {}, finish_reason: finishReason }],
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

export async function startFakeLlmApiServer(): Promise<FakeLlmApiServer> {
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/health") {
        return Response.json({ ok: true });
      }

      if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
        try {
          const body = await request.json();
          const input = getLastUserText(body);
          const response = await findBestResponse(input);

          if (body?.stream) return streamOpenAiText(response.output);

          return Response.json({
            id: "chatcmpl-fake",
            object: "chat.completion",
            created: 1,
            model: "fake-model",
            choices: [{ index: 0, message: { role: "assistant", content: response.output }, finish_reason: "stop" }],
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
    async stop() {
      await server.stop(true);
    },
  };
}
