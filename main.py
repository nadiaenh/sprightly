#!/usr/bin/env python3
"""Prompt -> pixel-art GIF.

Claude returns a *drawing program* (shape primitives), not a pixel grid:
ellipses, triangles, thick lines and beziers, plus a palette. We execute
the program locally onto a GRID x GRID canvas, dilate the silhouette to
compute the outline, and assemble the frames into a GIF.

Emitting shapes rather than raw pixels keeps the output ~20x smaller, keeps
the subject consistent across frames (the body is drawn once, in `base`),
and makes row-length drift impossible.
"""
import argparse
import json
import os
import sys
import time

from PIL import Image

GRID = 32           # NxN pixels per frame
FRAMES = 4          # sprite sheet length
SCALE = 12          # upscale factor for viewability
FRAME_MS = 160      # ms per frame in the GIF
TRANSPARENT = "."   # reserved: never a palette color

MODEL = "claude-opus-5"
PRICE_PER_MTOK = {"claude-opus-5": (5.00, 25.00)}  # (input, output) $/million tokens

_OP = {
    "type": "object",
    "properties": {
        "type": {
            "type": "string",
            "enum": ["ellipse", "rect", "triangle", "line", "bezier"],
        },
        "color": {
            "type": "string",
            "minLength": 1,
            "maxLength": 1,
            "description": "a palette char",
        },
        "points": {
            "type": "array",
            "description": (
                "ellipse [cx,cy,rx,ry]; rect [x0,y0,x1,y1]; "
                "triangle [apex_x,apex_y,left_x,left_y,right_x,right_y]; "
                "line [x0,y0,x1,y1]; bezier [x0,y0,ctrl_x,ctrl_y,x1,y1]"
            ),
            "items": {"type": "number"},
        },
        "width": {
            "type": "number",
            "description": "stroke thickness for line/bezier; ignored otherwise",
        },
    },
    "required": ["type", "color", "points", "width"],
    "additionalProperties": False,
}

SCHEMA = {
    "type": "object",
    "properties": {
        "palette": {
            "type": "array",
            "description": "assigns each hex color '#RRGGBB' a single letter",
            "items": {
                "type": "object",
                "properties": {
                    "char": {"type": "string", "minLength": 1, "maxLength": 1},
                    "hex": {"type": "string", "minLength": 7, "maxLength": 7},
                },
                "required": ["char", "hex"],
                "additionalProperties": False,
            },
        },
        "outline": {
            "type": "string",
            "minLength": 1,
            "maxLength": 1,
            "description": "palette char used for the computed outline",
        },
        "base": {
            "type": "array",
            "description": "shapes drawn in every frame (body, head) - the static subject",
            "items": _OP,
        },
        "details": {
            "type": "array",
            "description": "shapes drawn after the outline pass (eyes, nose) so they stay crisp",
            "items": _OP,
        },
        "frames": {
            "type": "array",
            "description": "per-frame shapes; 'behind' draws under the base, 'front' over it",
            "items": {
                "type": "object",
                "properties": {
                    "behind": {"type": "array", "items": _OP},
                    "front": {"type": "array", "items": _OP},
                },
                "required": ["behind", "front"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["palette", "outline", "base", "details", "frames"],
    "additionalProperties": False,
}

SYSTEM = f"""You are a pixel artist. Draw a {GRID}x{GRID} sprite animation of {FRAMES} frames for the given prompt, as a drawing program built from shape primitives.

Canvas: x runs 0..{GRID - 1} left to right, y runs 0..{GRID - 1} top to bottom. Keep the subject inside the canvas with a 1-2 pixel margin so the outline fits.

Build the subject from overlapping shapes, the way a pixel artist blocks in a sprite: ellipses for the skull, barrel, haunch and chest; triangles for ears, beaks and fins; thick lines for limbs; a bezier for a tail or anything that curves. Overlapping shapes merge into one silhouette, so prefer several overlapping blobs over one big rectangle.

Layering, in draw order:
- `base`: the static body and head. Drawn in every frame, so the subject stays
  identical frame to frame.
- `frames[i].behind`: drawn UNDER the base - far-side limbs, a tail passing
  behind the body.
- `frames[i].front`: drawn OVER the base - near-side limbs.
- The outline is then computed automatically by dilating the silhouette, in the
  `outline` palette color. Never draw the outline yourself: a hand-drawn outline
  lands inside the shape and reads as a stripe.
- `details`: drawn last, after the outline - eyes, nose, inner ear.

Animate by putting only what moves in `frames` (legs, wings), and everything that holds still in `base`. Give limbs a real swing: offset the foot end of each limb across frames, and put the near and far limbs in opposite phase so it reads as a gait rather than a hop.

Style: cute chibi, not realistic. The head is oversized - 40-60% of the subject's height - sitting on a small, stubby, rounded body; limbs are short and thick, never thin sticks. Pick whichever facing reads best for the subject and its animation - front-facing, three-quarters, or a clean side profile for something that walks or runs - and keep it centered in the frame. In `details`, give it one or two big round eyes (one if in profile, each 2-3px across) with a single 1px white highlight dot offset toward one corner, and a small blush oval in a soft pink on each cheek. Keep every shape rounded - prefer ellipses over rects and square corners.

Use a small palette of 4-6 hex colors, each assigned a single lowercase letter (a-z), plus one darker shade for the outline. Favor soft, saturated, harmonious colors (pastels or clean flat tones) over muddy or clashing ones, and always include a light pink for the blush. The character '{TRANSPARENT}' is reserved for transparency: never assign it a color."""


def _blank():
    return [[TRANSPARENT] * GRID for _ in range(GRID)]


def _put(grid, x, y, ch):
    x, y = int(round(x)), int(round(y))
    if 0 <= x < GRID and 0 <= y < GRID:
        grid[y][x] = ch


def _rect(grid, x0, y0, x1, y1, ch):
    for y in range(int(round(min(y0, y1))), int(round(max(y0, y1))) + 1):
        for x in range(int(round(min(x0, x1))), int(round(max(x0, x1))) + 1):
            _put(grid, x, y, ch)


def _ellipse(grid, cx, cy, rx, ry, ch):
    rx, ry = max(abs(rx), 0.5), max(abs(ry), 0.5)
    for y in range(GRID):
        for x in range(GRID):
            if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1.0:
                _put(grid, x, y, ch)


def _triangle(grid, ax, ay, lx, ly, rx, ry, ch):
    steps = max(1, int(round(max(abs(ly - ay), abs(ry - ay)))))
    for i in range(steps + 1):
        t = i / steps
        _rect(grid, ax + (lx - ax) * t, ay + (ly - ay) * t,
              ax + (rx - ax) * t, ay + (ry - ay) * t, ch)


def _line(grid, x0, y0, x1, y1, width, ch):
    steps = max(1, int(round(max(abs(x1 - x0), abs(y1 - y0)))))
    w = max(1, int(round(width)))
    for i in range(steps + 1):
        t = i / steps
        x, y = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
        _rect(grid, x, y, x + w - 1, y + w - 1, ch)


def _bezier(grid, x0, y0, cx, cy, x1, y1, width, ch):
    w = max(1, int(round(width)))
    for i in range(120):
        t = i / 119
        x = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t**2 * x1
        y = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t**2 * y1
        _rect(grid, x, y, x + w - 1, y + w - 1, ch)


_HANDLERS = {
    "ellipse": (4, lambda g, p, w, ch: _ellipse(g, p[0], p[1], p[2], p[3], ch)),
    "rect": (4, lambda g, p, w, ch: _rect(g, p[0], p[1], p[2], p[3], ch)),
    "triangle": (6, lambda g, p, w, ch: _triangle(g, *p[:6], ch)),
    "line": (4, lambda g, p, w, ch: _line(g, p[0], p[1], p[2], p[3], w, ch)),
    "bezier": (6, lambda g, p, w, ch: _bezier(g, *p[:6], w, ch)),
}


def draw_ops(grid, ops):
    """Execute a list of shape ops onto the grid, skipping malformed ones."""
    for op in ops:
        handler = _HANDLERS.get(op.get("type"))
        color = op.get("color") or ""
        points = op.get("points") or []
        if handler is None or not color or color == TRANSPARENT:
            continue
        min_points, render = handler
        if len(points) < min_points:
            continue
        try:
            render(grid, points, op.get("width") or 1, color)
        except (TypeError, ValueError):
            continue


def _touches_silhouette(snapshot, x, y, ch):
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nx, ny = x + dx, y + dy
        if 0 <= nx < GRID and 0 <= ny < GRID:
            if snapshot[ny][nx] not in (TRANSPARENT, ch):
                return True
    return False


def outline_grid(grid, ch):
    """Dilate: any transparent cell touching the silhouette becomes outline.

    Derived from the silhouette rather than drawn by hand, so the outline
    always sits on the edge and never inside the body.
    """
    snapshot = [row[:] for row in grid]
    for y in range(GRID):
        for x in range(GRID):
            if snapshot[y][x] == TRANSPARENT and _touches_silhouette(snapshot, x, y, ch):
                grid[y][x] = ch


def render_program(program):
    """Run a drawing program into a list of frames (each a list of row strings)."""
    outline_ch = program.get("outline") or "d"
    base = program.get("base") or []
    details = program.get("details") or []
    per_frame = program.get("frames") or [{}]

    frames = []
    for spec in per_frame[:FRAMES]:
        grid = _blank()
        draw_ops(grid, spec.get("behind") or [])
        draw_ops(grid, base)
        draw_ops(grid, spec.get("front") or [])
        outline_grid(grid, outline_ch)
        draw_ops(grid, details)
        frames.append(["".join(row) for row in grid])

    while len(frames) < FRAMES:
        frames.append(frames[-1])
    return frames


def frames_to_gif(palette, frames, path):
    images = []
    for frame in frames:
        img = Image.new("RGBA", (GRID, GRID), (0, 0, 0, 0))
        for y, row in enumerate(frame):
            for x, char in enumerate(row):
                if char == TRANSPARENT or char not in palette:
                    continue
                hex_color = palette[char].lstrip("#")
                r, g, b = (int(hex_color[i : i + 2], 16) for i in (0, 2, 4))
                img.putpixel((x, y), (r, g, b, 255))
        images.append(img.resize((GRID * SCALE, GRID * SCALE), Image.NEAREST))

    images[0].save(
        path,
        save_all=True,
        append_images=images[1:],
        duration=FRAME_MS,
        loop=0,
        disposal=2,
    )


def generate_program(prompt):
    import anthropic

    client = anthropic.Anthropic()
    start = time.time()
    with client.messages.stream(
        model=MODEL,
        max_tokens=50000,
        system=SYSTEM,
        messages=[{"role": "user", "content": prompt}],
        output_config={"format": {"type": "json_schema", "schema": SCHEMA}},
    ) as stream:
        response = stream.get_final_message()
    elapsed_ms = (time.time() - start) * 1000
    text = next(b.text for b in response.content if b.type == "text")
    price_in, price_out = PRICE_PER_MTOK[MODEL]
    cost_usd = (
        response.usage.input_tokens * price_in + response.usage.output_tokens * price_out
    ) / 1_000_000
    return json.loads(text), {"elapsed_ms": elapsed_ms, "cost_usd": cost_usd}


def print_summary(elapsed_ms, model, cost_usd, output):
    minutes, seconds = divmod(round(elapsed_ms / 1000), 60)
    print(f"Ran for {minutes}m{seconds:02d}s on {model} (${cost_usd:.2f})")
    print(f"Output: {output}")


def palette_of(program):
    return {
        entry["char"]: entry["hex"]
        for entry in program.get("palette") or []
        if entry.get("char") != TRANSPARENT
    }


def run_local(prompt, out_path):
    program, meta = generate_program(prompt)
    frames_to_gif(palette_of(program), render_program(program), out_path)
    print_summary(meta["elapsed_ms"], MODEL, meta["cost_usd"], out_path)
    return out_path


def run_remote(prompt, url, api_key):
    import urllib.request

    request = urllib.request.Request(
        url.rstrip("/") + "/generate",
        data=json.dumps({"prompt": prompt}).encode(),
        headers={
            "content-type": "application/json",
            "x-api-key": api_key,
            "user-agent": "sprightly/0.1",
        },
    )
    with urllib.request.urlopen(request) as response:
        data = json.load(response)
    print_summary(data["elapsed_ms"], data["model"], data["cost_usd"], data["url"])
    return data["url"]


def main():
    parser = argparse.ArgumentParser(description="Prompt -> pixel-art GIF")
    parser.add_argument("prompt", help="what to draw, or a .json program with --program")
    parser.add_argument("output", nargs="?", default="sprite.gif")
    parser.add_argument(
        "--local",
        action="store_true",
        help="render locally with ANTHROPIC_API_KEY instead of the deployed worker",
    )
    parser.add_argument(
        "--program",
        action="store_true",
        help="treat the argument as a saved drawing program and render it, no API call",
    )
    args = parser.parse_args()

    if args.program:
        with open(args.prompt) as f:
            program = json.load(f)
        frames_to_gif(palette_of(program), render_program(program), args.output)
        print(f"Saved {args.output}")
        return

    if args.local:
        print(f"Drawing {args.prompt!r} locally...")
        run_local(args.prompt, args.output)
        return

    url, api_key = os.environ.get("SPRIGHTLY_URL"), os.environ.get("SPRIGHTLY_API_KEY")
    if not url or not api_key:
        sys.exit(
            "SPRIGHTLY_URL and SPRIGHTLY_API_KEY must be set to use the deployed "
            "worker (both are printed by ./setup.sh), or pass --local to render here."
        )
    print(f"Drawing {args.prompt!r} on {url}...")
    run_remote(args.prompt, url, api_key)


if __name__ == "__main__":
    main()
