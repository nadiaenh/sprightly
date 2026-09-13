#!/usr/bin/env bash

have python3 || fail "python3 not found"

[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet -r requirements.txt
ok "local renderer ready (.venv)"
