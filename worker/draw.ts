export const GRID = 32;
export const FRAMES = 4;
export const TRANSPARENT = ".";

export type Op = {
  type: "ellipse" | "rect" | "triangle" | "line" | "bezier";
  color: string;
  points: number[];
  width: number;
};

export type Program = {
  palette: { char: string; hex: string }[];
  outline: string;
  base: Op[];
  details: Op[];
  frames: { behind: Op[]; front: Op[] }[];
};

type Grid = string[][];

const blank = (): Grid =>
  Array.from({ length: GRID }, () => Array<string>(GRID).fill(TRANSPARENT));

function put(g: Grid, x: number, y: number, ch: string) {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix >= 0 && ix < GRID && iy >= 0 && iy < GRID) g[iy][ix] = ch;
}

function rect(g: Grid, x0: number, y0: number, x1: number, y1: number, ch: string) {
  for (let y = Math.round(Math.min(y0, y1)); y <= Math.round(Math.max(y0, y1)); y++) {
    for (let x = Math.round(Math.min(x0, x1)); x <= Math.round(Math.max(x0, x1)); x++) {
      put(g, x, y, ch);
    }
  }
}

function ellipse(g: Grid, cx: number, cy: number, rx: number, ry: number, ch: string) {
  const a = Math.max(Math.abs(rx), 0.5);
  const b = Math.max(Math.abs(ry), 0.5);
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const u = (x + 0.5 - cx) / a;
      const v = (y + 0.5 - cy) / b;
      if (u * u + v * v <= 1) put(g, x, y, ch);
    }
  }
}

function triangle(
  g: Grid, ax: number, ay: number, lx: number, ly: number,
  rx: number, ry: number, ch: string,
) {
  const steps = Math.max(1, Math.round(Math.max(Math.abs(ly - ay), Math.abs(ry - ay))));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    rect(g, ax + (lx - ax) * t, ay + (ly - ay) * t, ax + (rx - ax) * t, ay + (ry - ay) * t, ch);
  }
}

function line(
  g: Grid, x0: number, y0: number, x1: number, y1: number, width: number, ch: string,
) {
  const steps = Math.max(1, Math.round(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  const w = Math.max(1, Math.round(width));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    rect(g, x, y, x + w - 1, y + w - 1, ch);
  }
}

function bezier(
  g: Grid, x0: number, y0: number, cx: number, cy: number,
  x1: number, y1: number, width: number, ch: string,
) {
  const w = Math.max(1, Math.round(width));
  for (let i = 0; i < 120; i++) {
    const t = i / 119;
    const mt = 1 - t;
    const x = mt * mt * x0 + 2 * mt * t * cx + t * t * x1;
    const y = mt * mt * y0 + 2 * mt * t * cy + t * t * y1;
    rect(g, x, y, x + w - 1, y + w - 1, ch);
  }
}

type Renderer = (g: Grid, p: number[], w: number, ch: string) => void;

const renderEllipse: Renderer = (g, p, _w, ch) => ellipse(g, p[0], p[1], p[2], p[3], ch);
const renderRect: Renderer = (g, p, _w, ch) => rect(g, p[0], p[1], p[2], p[3], ch);
const renderTriangle: Renderer = (g, p, _w, ch) =>
  triangle(g, p[0], p[1], p[2], p[3], p[4], p[5], ch);
const renderLine: Renderer = (g, p, w, ch) => line(g, p[0], p[1], p[2], p[3], w, ch);
const renderBezier: Renderer = (g, p, w, ch) =>
  bezier(g, p[0], p[1], p[2], p[3], p[4], p[5], w, ch);

const HANDLERS: Record<Op["type"], { minPoints: number; render: Renderer }> = {
  ellipse: { minPoints: 4, render: renderEllipse },
  rect: { minPoints: 4, render: renderRect },
  triangle: { minPoints: 6, render: renderTriangle },
  line: { minPoints: 4, render: renderLine },
  bezier: { minPoints: 6, render: renderBezier },
};

function isDrawable(op: Op | undefined, handler: { minPoints: number } | undefined): boolean {
  if (!op || typeof op !== "object" || !handler) return false;
  const color = op.color ?? "";
  const points = op.points ?? [];
  return !!color && color !== TRANSPARENT && points.length >= handler.minPoints;
}

function drawOps(g: Grid, ops: Op[] | undefined) {
  for (const op of ops ?? []) {
    const handler = HANDLERS[op?.type];
    if (!isDrawable(op, handler)) continue;
    handler.render(g, op.points, op.width || 1, op.color);
  }
}

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function touchesSilhouette(snap: Grid, x: number, y: number, ch: string): boolean {
  for (const [dx, dy] of NEIGHBOURS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || nx >= GRID || ny < 0 || ny >= GRID) continue;
    if (snap[ny][nx] !== TRANSPARENT && snap[ny][nx] !== ch) return true;
  }
  return false;
}

function outlineGrid(g: Grid, ch: string) {
  const snap = g.map((row) => row.slice());
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (snap[y][x] === TRANSPARENT && touchesSilhouette(snap, x, y, ch)) g[y][x] = ch;
    }
  }
}

export function renderProgram(program: Program): Grid[] {
  const outline = program.outline || "d";
  const frames: Grid[] = [];
  for (const spec of (program.frames ?? []).slice(0, FRAMES)) {
    const g = blank();
    drawOps(g, spec?.behind);
    drawOps(g, program.base);
    drawOps(g, spec?.front);
    outlineGrid(g, outline);
    drawOps(g, program.details);
    frames.push(g);
  }
  while (frames.length && frames.length < FRAMES) frames.push(frames[frames.length - 1]);
  return frames;
}
