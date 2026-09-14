import Anthropic from "@anthropic-ai/sdk";
import { GIFEncoder } from "gifenc";
import { FRAMES, GRID, TRANSPARENT, renderProgram, type Program } from "./draw";
import PROMPT_TEMPLATE from "../prompt.txt";

const SCALE = 12;
const FRAME_MS = 160;
const MODEL = "claude-opus-5";
const PRICE_PER_MTOK_INPUT = 5.0;
const PRICE_PER_MTOK_OUTPUT = 25.0;

export interface Env {
  ANTHROPIC_API_KEY: string;
  SPRIGHTLY_API_KEY: string;
  BUCKET: R2Bucket;
  PUBLIC_BASE_URL: string;
}

const OP = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["ellipse", "rect", "triangle", "line", "bezier"] },
    color: { type: "string", minLength: 1, maxLength: 1, description: "a palette char" },
    points: {
      type: "array",
      description:
        "ellipse [cx,cy,rx,ry]; rect [x0,y0,x1,y1]; " +
        "triangle [apex_x,apex_y,left_x,left_y,right_x,right_y]; " +
        "line [x0,y0,x1,y1]; bezier [x0,y0,ctrl_x,ctrl_y,x1,y1]",
      items: { type: "number" },
    },
    width: { type: "number", description: "stroke thickness for line/bezier" },
  },
  required: ["type", "color", "points", "width"],
  additionalProperties: false,
} as const;

const SCHEMA = {
  type: "object",
  properties: {
    palette: {
      type: "array",
      items: {
        type: "object",
        properties: {
          char: { type: "string", minLength: 1, maxLength: 1 },
          hex: { type: "string", minLength: 7, maxLength: 7 },
        },
        required: ["char", "hex"],
        additionalProperties: false,
      },
    },
    outline: { type: "string", minLength: 1, maxLength: 1 },
    base: { type: "array", items: OP },
    details: { type: "array", items: OP },
    frames: {
      type: "array",
      items: {
        type: "object",
        properties: { behind: { type: "array", items: OP }, front: { type: "array", items: OP } },
        required: ["behind", "front"],
        additionalProperties: false,
      },
    },
  },
  required: ["palette", "outline", "base", "details", "frames"],
  additionalProperties: false,
} as const;

const SYSTEM = PROMPT_TEMPLATE.replace(/\{\{GRID\}\}/g, String(GRID))
  .replace(/\{\{GRID_MAX\}\}/g, String(GRID - 1))
  .replace(/\{\{FRAMES\}\}/g, String(FRAMES));

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const TRANSPARENT_INDEX = 0;

function buildPalette(program: Program) {
  const colors: [number, number, number][] = [[0, 0, 0]];
  const indexOf = new Map<string, number>();
  for (const { char, hex } of program.palette ?? []) {
    if (char === TRANSPARENT || indexOf.has(char)) continue;
    const h = hex.replace("#", "");
    colors.push([
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ]);
    indexOf.set(char, colors.length - 1);
  }
  return { colors, indexOf };
}

function upscale(grid: string[][], indexOf: Map<string, number>, size: number): Uint8Array {
  const pixels = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    const row = grid[Math.floor(y / SCALE)];
    for (let x = 0; x < size; x++) {
      pixels[y * size + x] = indexOf.get(row[Math.floor(x / SCALE)]) ?? TRANSPARENT_INDEX;
    }
  }
  return pixels;
}

function encodeGif(program: Program): Uint8Array {
  const { colors, indexOf } = buildPalette(program);
  const size = GRID * SCALE;
  const gif = GIFEncoder();
  for (const grid of renderProgram(program)) {
    gif.writeFrame(upscale(grid, indexOf, size), size, size, {
      palette: colors,
      delay: FRAME_MS,
      transparent: true,
      transparentIndex: TRANSPARENT_INDEX,
      dispose: 2,
    });
  }
  gif.finish();
  return gif.bytes();
}

interface GenerateResult {
  program: Program;
  elapsedMs: number;
  costUsd: number;
}

const MAX_DRAFTS = 3;

const PREVIEW_TOOL = {
  name: "preview",
  description:
    "Render the current draft as a pixel-art image so you can check it before deciding whether to submit. Calling this uses up one of your limited drafts.",
  input_schema: SCHEMA,
};

const SUBMIT_TOOL = {
  name: "submit",
  description: "Finalize and submit the drawing program. This ends the task.",
  input_schema: SCHEMA,
};

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function firstFramePreviewGif(program: Program): Uint8Array {
  const { colors, indexOf } = buildPalette(program);
  const size = GRID * SCALE;
  const gif = GIFEncoder();
  const frame = renderProgram(program)[0];
  if (frame) {
    gif.writeFrame(upscale(frame, indexOf, size), size, size, {
      palette: colors,
      transparent: true,
      transparentIndex: TRANSPARENT_INDEX,
    });
  }
  gif.finish();
  return gif.bytes();
}

async function generate(prompt: string, env: Env): Promise<GenerateResult> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const start = Date.now();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const messages: any[] = [{ role: "user", content: prompt }];
  let draftCount = 0;
  let finalProgram: Program | null = null;

  while (!finalProgram) {
    const allowPreview = draftCount < MAX_DRAFTS - 1;
    const tools = allowPreview ? [PREVIEW_TOOL, SUBMIT_TOOL] : [SUBMIT_TOOL];

    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 50000,
      system: SYSTEM,
      messages,
      tools,
      tool_choice: { type: "any" },
    } as any);
    const message = await stream.finalMessage();

    totalInputTokens += message.usage.input_tokens;
    totalOutputTokens += message.usage.output_tokens;

    const toolUses = message.content.filter((b: any) => b.type === "tool_use") as any[];
    if (toolUses.length === 0) throw new Error("model returned no tool call");

    messages.push({ role: "assistant", content: message.content });

    const submitUse = toolUses.find((b) => b.name === "submit");
    if (submitUse) {
      finalProgram = submitUse.input as Program;
      break;
    }

    // Every tool_use block needs a matching tool_result before the next
    // request, so respond to all preview calls in this turn, not just one.
    const resultBlocks = toolUses.map((toolUse) => {
      draftCount++;
      const gifBytes = firstFramePreviewGif(toolUse.input as Program);
      const isLastPreview = draftCount >= MAX_DRAFTS - 1;
      return {
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/gif", data: toBase64(gifBytes) },
          },
          {
            type: "text",
            text: isLastPreview
              ? "This was your last preview. Call submit with your final program next."
              : "Here is your draft rendered. Call submit if it's good, or call preview again with a revised program.",
          },
        ],
      };
    });
    messages.push({ role: "user", content: resultBlocks });
  }

  const elapsedMs = Date.now() - start;
  const costUsd =
    (totalInputTokens * PRICE_PER_MTOK_INPUT + totalOutputTokens * PRICE_PER_MTOK_OUTPUT) /
    1_000_000;
  return { program: finalProgram, elapsedMs, costUsd };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/generate" || request.method !== "POST") {
      return Response.json({ error: "POST /generate" }, { status: 404 });
    }
    if (!timingSafeEqual(request.headers.get("x-api-key") ?? "", env.SPRIGHTLY_API_KEY)) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    let prompt: string;
    try {
      prompt = ((await request.json()) as { prompt?: string }).prompt?.trim() ?? "";
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }
    if (!prompt) return Response.json({ error: "prompt is required" }, { status: 400 });
    if (prompt.length > 500) {
      return Response.json({ error: "prompt too long" }, { status: 400 });
    }

    try {
      const { program, elapsedMs, costUsd } = await generate(prompt, env);
      const gif = encodeGif(program);
      const key = `${crypto.randomUUID()}.gif`;
      await env.BUCKET.put(key, gif, {
        httpMetadata: { contentType: "image/gif", cacheControl: "public, max-age=31536000" },
      });
      return Response.json({
        url: `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}`,
        model: MODEL,
        elapsed_ms: elapsedMs,
        cost_usd: costUsd,
      });
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 502 });
    }
  },
};
