#!/usr/bin/env python3
"""Append this week's generated GIF to the README's Demo section."""

import sys
from datetime import date

url = sys.argv[1]
prompt = sys.argv[2]
model = sys.argv[3]
elapsed_ms = float(sys.argv[4])
cost_usd = float(sys.argv[5])

with open("README.md") as f:
    readme = f.read()
if "## Demo" not in readme:
    sys.exit("no ## Demo section found in README.md")

when = date.today().strftime("%b %d, %Y")
minutes, seconds = divmod(round(elapsed_ms / 1000), 60)
caption = f'"{prompt}" on {when} by {model} ({minutes}m{seconds:02d}s, ${cost_usd:.2f})'
entry = f'\n<p>{caption}</p>\n<p><img src="{url}" alt="sprightly output: {prompt}" width="128"></p>\n'
with open("README.md", "a") as f:
    f.write(entry)
