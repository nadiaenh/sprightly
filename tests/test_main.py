"""Self-check for the drawing-program renderer. Run: python tests/test_main.py"""
import json
import os
import sys
import tempfile

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from main import FRAMES, GRID, TRANSPARENT, frames_to_gif, palette_of, render_program

PROGRAM = {
    "palette": [{"char": "o", "hex": "#ff9933"}, {"char": "d", "hex": "#663311"}],
    "outline": "d",
    "base": [{"type": "ellipse", "color": "o", "points": [16, 16, 6, 4], "width": 1}],
    "details": [],
    "frames": [
        {
            "behind": [],
            "front": [
                {"type": "line", "color": "o", "points": [12 + i, 20, 12 + i, 26], "width": 2}
            ],
        }
        for i in range(FRAMES)
    ],
}


def test_render_shape_and_outline():
    frames = render_program(PROGRAM)
    assert len(frames) == FRAMES, len(frames)
    for frame in frames:
        assert len(frame) == GRID
        assert all(len(row) == GRID for row in frame)

    body = frames[0]
    assert body[16][16] == "o", "ellipse should fill its centre"
    assert "d" in "".join(body), "expected a computed outline"
    for y in range(GRID):
        for x in range(GRID):
            if body[y][x] != "d":
                continue
            neighbours = [
                body[y + dy][x + dx]
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
                if 0 <= x + dx < GRID and 0 <= y + dy < GRID
            ]
            assert any(n not in (TRANSPARENT, "d") for n in neighbours), (
                f"outline cell ({x},{y}) touches no fur - it must sit on the "
                "silhouette's edge, never float inside it"
            )


def test_frames_differ_and_gif_roundtrips():
    frames = render_program(PROGRAM)
    assert frames[0] != frames[-1], "legs should move between frames"

    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "out.gif")
        frames_to_gif(palette_of(PROGRAM), frames, path)
        img = Image.open(path)
        assert img.n_frames == FRAMES
        assert img.size == (GRID * 12, GRID * 12)


def test_reserved_transparent_char_never_becomes_a_color():
    program = json.loads(json.dumps(PROGRAM))
    program["palette"].append({"char": TRANSPARENT, "hex": "#000000"})
    assert TRANSPARENT not in palette_of(program)


if __name__ == "__main__":
    test_render_shape_and_outline()
    test_frames_differ_and_gif_roundtrips()
    test_reserved_transparent_char_never_becomes_a_color()
    print("ok")
