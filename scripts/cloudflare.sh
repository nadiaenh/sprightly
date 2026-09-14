#!/usr/bin/env bash

have pnpm || fail "pnpm not found (needed for wrangler)"
have openssl || fail "openssl not found"

pnpm install --silent
ok "node dependencies installed"

[ -f .env ] && set -a && source .env && set +a

wrangler() { pnpm exec wrangler "$@"; }

wrangler whoami >/dev/null 2>&1 || wrangler login
ok "authenticated to cloudflare"

if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  CLOUDFLARE_ACCOUNT_ID=$(wrangler whoami 2>/dev/null | grep -oE '[0-9a-f]{32}' | head -1 || true)
fi
if [ -z "$CLOUDFLARE_ACCOUNT_ID" ]; then
  info "Account id: open the Cloudflare dashboard, press CMD+K, and type"
  info "'copy account id' - the palette copies it straight to your clipboard."
  info "  https://dash.cloudflare.com"
  read -rp "    Cloudflare account id: " CLOUDFLARE_ACCOUNT_ID
fi
[ -n "$CLOUDFLARE_ACCOUNT_ID" ] || fail "a Cloudflare account id is required"
export CLOUDFLARE_ACCOUNT_ID
ok "account $CLOUDFLARE_ACCOUNT_ID"

bucket=$(grep -E '^bucket_name' wrangler.toml | head -1 | cut -d'"' -f2)
r2_home="https://dash.cloudflare.com/${CLOUDFLARE_ACCOUNT_ID}/r2/overview"

if wrangler r2 bucket info "$bucket" >/dev/null 2>&1; then
  info "r2 bucket $bucket already exists"
elif wrangler r2 bucket create "$bucket" >/dev/null 2>&1; then
  ok "created r2 bucket $bucket"
else
  info "Could not create the bucket. R2 usually needs enabling first - it asks"
  info "for a payment method even though this project fits the \$0 free tier."
  info "  $r2_home"
  read -rp "    Press enter once R2 is enabled to retry... " _
  wrangler r2 bucket create "$bucket" >/dev/null 2>&1 && ok "created r2 bucket $bucket" || fail "still could not create bucket '$bucket'"
fi

if ! grep -qE '^PUBLIC_BASE_URL = "https' wrangler.toml; then
  settings_url="https://dash.cloudflare.com/${CLOUDFLARE_ACCOUNT_ID}/r2/default/buckets/${bucket}/settings"
  info "Turn on public access for '$bucket': Settings > Public access >"
  info "allow the r2.dev subdomain. Copy the https://pub-<hash>.r2.dev URL."
  info "  $settings_url"
  read -rp "    Public R2 URL: " public_url
  [ -n "$public_url" ] || fail "a public R2 URL is required to return links"
  tmp=$(mktemp)
  sed "s|^PUBLIC_BASE_URL = .*|PUBLIC_BASE_URL = \"${public_url%/}\"|" wrangler.toml >"$tmp"
  mv "$tmp" wrangler.toml
  ok "recorded public R2 URL"
else
  info "public R2 URL already set in wrangler.toml"
fi

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  info "Anthropic API key: https://console.anthropic.com/settings/keys"
  read -rsp "    Anthropic API key: " ANTHROPIC_API_KEY; echo
  [ -n "$ANTHROPIC_API_KEY" ] || fail "an Anthropic API key is required"
else
  info "reusing ANTHROPIC_API_KEY from .env"
fi

if [ -z "${SPRIGHTLY_API_KEY:-}" ]; then
  SPRIGHTLY_API_KEY=$(openssl rand -hex 24)
  ok "generated SPRIGHTLY_API_KEY"
else
  info "reusing SPRIGHTLY_API_KEY from .env"
fi

cat >.env <<EOF
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY
SPRIGHTLY_API_KEY=$SPRIGHTLY_API_KEY
CLOUDFLARE_ACCOUNT_ID=$CLOUDFLARE_ACCOUNT_ID
EOF
chmod 600 .env
ok "wrote .env (git-ignored)"

SPRIGHTLY_URL=$(wrangler deploy 2>&1 | grep -oE 'https://[a-zA-Z0-9.-]+\.workers\.dev' | head -1)
[ -n "$SPRIGHTLY_URL" ] || fail "deploy did not report a worker URL"
export SPRIGHTLY_URL
ok "deployed $SPRIGHTLY_URL"

existing_secrets=$(wrangler secret list 2>/dev/null || echo "")
for secret in ANTHROPIC_API_KEY SPRIGHTLY_API_KEY; do
  if printf '%s' "$existing_secrets" | grep -q "\"$secret\""; then
    info "worker secret $secret already set"
  else
    printf '%s' "${!secret}" | wrangler secret put "$secret" >/dev/null
    ok "stored worker secret $secret"
  fi
done

printf 'SPRIGHTLY_URL=%s\n' "$SPRIGHTLY_URL" >>.env
