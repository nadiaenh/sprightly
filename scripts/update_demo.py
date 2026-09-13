#!/usr/bin/env python3
"""Append this week's generated GIF to the README's Demo section."""

import sys

url = sys.argv[1]
prompt = sys.argv[2]

with open("README.md") as f:
    readme = f.read()
if "## Demo" not in readme:
    sys.exit("no ## Demo section found in README.md")

entry = f'\n<p align="center"><img src="{url}" alt="sprightly output: {prompt}" width="256"></p>\n'
with open("README.md", "a") as f:
    f.write(entry)
