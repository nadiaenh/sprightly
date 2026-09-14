#!/usr/bin/env python3
"""Integration check: ask the deployed worker for a sprite and verify the GIF.

Requires SPRIGHTLY_URL and SPRIGHTLY_API_KEY. Exits early (success) when they
are unset, so forks and PRs without secrets no-op instead of failing.
"""
import json
import os
import random
import sys
import urllib.request

URL = os.environ.get("SPRIGHTLY_URL")
API_KEY = os.environ.get("SPRIGHTLY_API_KEY")

COLOURS = ["pink", "blue", "green", "orange"]
ANIMALS = ["dolphin", "cat", "dog", "frog", "fox", "snake"]
ACTIONS = ["walking", "waving hello", "looking up and down"]

if not URL or not API_KEY:
    print("SPRIGHTLY_URL / SPRIGHTLY_API_KEY unset - nothing to check")
    sys.exit(0)

PROMPT = f"a {random.choice(COLOURS)} {random.choice(ANIMALS)} {random.choice(ACTIONS)}"


def post(prompt, api_key):
    request = urllib.request.Request(
        URL.rstrip("/") + "/generate",
        data=json.dumps({"prompt": prompt}).encode(),
        headers={
            "content-type": "application/json",
            "x-api-key": api_key,
            "user-agent": "sprightly/0.1",
        },
    )
    return urllib.request.urlopen(request)


try:
    post(PROMPT, "not-the-key")
    sys.exit("FAIL: worker accepted a bad API key - deployment is open to the world")
except urllib.error.HTTPError as err:
    if err.code != 401:
        sys.exit(f"FAIL: expected 401 for a bad key, got {err.code}")
print("ok: bad API key rejected")

with post(PROMPT, API_KEY) as response:
    result = json.load(response)
gif_url = result["url"]
print(f"ok: generated {gif_url}")

gif_request = urllib.request.Request(gif_url, headers={"user-agent": "sprightly/0.1"})
with urllib.request.urlopen(gif_request) as response:
    body = response.read()

if not body.startswith(b"GIF89a"):
    sys.exit(f"FAIL: {gif_url} is not a GIF (starts with {body[:8]!r})")
print(f"ok: {len(body)} byte GIF served from R2")

minutes, seconds = divmod(round(result["elapsed_ms"] / 1000), 60)
print(f"Ran for {minutes}m{seconds:02d}s on {result['model']} (${result['cost_usd']:.2f})")
print(f"Output: {gif_url}")

output_path = os.environ.get("GITHUB_OUTPUT")
if output_path:
    with open(output_path, "a") as f:
        f.write(f"gif_url={gif_url}\n")
        f.write(f"prompt={PROMPT}\n")
