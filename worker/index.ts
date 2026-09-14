import Anthropic from "@anthropic-ai/sdk";
import { GIFEncoder } from "gifenc";
import { FRAMES, GRID, TRANSPARENT, renderProgram, type Program } from "./draw";

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

const SYSTEM = `You are a pixel artist. Draw a ${GRID}x${GRID} sprite animation of ${FRAMES} frames for the given prompt, as a drawing program built from shape primitives.

Canvas: x runs 0..${GRID - 1} left to right, y runs 0..${GRID - 1} top to bottom. Keep the subject inside the canvas with a 1-2 pixel margin so the outline fits.

Build the subject from overlapping shapes, the way a pixel artist blocks in a sprite: ellipses for the skull, barrel, haunch and chest; triangles for ears, beaks and fins; thick lines for limbs; a bezier for a tail or anything that curves. Overlapping shapes merge into one silhouette, so prefer several overlapping blobs over one big rectangle.

Layering, in draw order:
- \`base\`: the static body and head. Drawn in every frame, so the subject stays
  identical frame to frame.
- \`frames[i].behind\`: drawn UNDER the base - far-side limbs, a tail passing
  behind the body.
- \`frames[i].front\`: drawn OVER the base - near-side limbs.
- The outline is then computed automatically by dilating the silhouette, in the
  \`outline\` palette color. Never draw the outline yourself: a hand-drawn outline
  lands inside the shape and reads as a stripe.
- \`details\`: drawn last, after the outline - eyes, nose, inner ear.

Animate by putting only what moves in \`frames\` (legs, wings), and everything that holds still in \`base\`. Give limbs a real swing: offset the foot end of each limb across frames, and put the near and far limbs in opposite phase so it reads as a gait rather than a hop.

Use a small palette of a few hex colors, each assigned a single lowercase letter (a-z), plus one darker shade for the outline. The character '${TRANSPARENT}' is reserved for transparency: never assign it a color.`;

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

async function generate(prompt: string, env: Env): Promise<GenerateResult> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const start = Date.now();
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 50000,
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
  } as any);
  const message = await stream.finalMessage();
  const elapsedMs = Date.now() - start;
  const block = message.content.find((b: any) => b.type === "text");
  if (!block) throw new Error("model returned no text block");
  const program = JSON.parse((block as any).text) as Program;
  const { input_tokens, output_tokens } = message.usage;
  const costUsd =
    (input_tokens * PRICE_PER_MTOK_INPUT + output_tokens * PRICE_PER_MTOK_OUTPUT) / 1_000_000;
  return { program, elapsedMs, costUsd };
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
