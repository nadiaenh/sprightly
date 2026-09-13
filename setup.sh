#!/usr/bin/env bash
cd "$(dirname "$0")"
source scripts/common.sh

step "1. Install tools"
source scripts/homebrew.sh

step "2. Local renderer"
source scripts/python.sh

step "3. Cloudflare"
source scripts/cloudflare.sh

step "4. GitHub secrets"
source scripts/github.sh

step "Setup complete"
echo "  Generate a sprite against your deployment:"
echo ""
echo "    set -a && source .env && set +a"
echo "    python main.py \"a walking cat\""
echo ""
[ -n "${SPRIGHTLY_URL:-}" ] && echo "  Worker:    $SPRIGHTLY_URL"
echo "  Dashboard: https://dash.cloudflare.com/${CLOUDFLARE_ACCOUNT_ID:-}/workers/services/view/sprightly"
