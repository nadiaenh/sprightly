#!/usr/bin/env bash

have gh || { info "gh not installed - skipping GitHub secrets"; return 0; }
gh auth status >/dev/null 2>&1 || gh auth login

[ -f .env ] && set -a && source .env && set +a

already_set=$(gh secret list 2>/dev/null | cut -f1 || echo "")
has_secret() { printf '%s\n' "$already_set" | grep -qx "$1"; }

set_secret() {
  local name=$1
  local value=$2
  local prompt=$3
  if has_secret "$name"; then
    info "$name already set in GitHub - leaving it alone"
    return 0
  fi
  if [ -z "$value" ]; then
    read -rp "    $prompt: " value
  fi
  if [ -z "$value" ]; then
    info "skipped $name (no value given)"
    return 0
  fi
  gh secret set "$name" --body "$value"
  ok "pushed $name"
}

if ! has_secret CLOUDFLARE_API_TOKEN; then
  info "Create a Cloudflare API token with exactly these permissions:"
  info "  Account | Workers Scripts      | Read + Write"
  info "  Account | Workers R2 Storage   | Read + Write"
  info "  Account | Account Settings     | Read"
  info "Use the 'Create Custom Token' option, not a preset template."
  info "  https://dash.cloudflare.com/profile/api-tokens"
fi
set_secret CLOUDFLARE_API_TOKEN "${CLOUDFLARE_API_TOKEN:-}" "Cloudflare API token"
set_secret CLOUDFLARE_ACCOUNT_ID "${CLOUDFLARE_ACCOUNT_ID:-}" "Cloudflare account id"
set_secret SPRIGHTLY_API_KEY "${SPRIGHTLY_API_KEY:-}" "sprightly API key"
set_secret SPRIGHTLY_URL "${SPRIGHTLY_URL:-}" "deployed worker URL"
