#!/usr/bin/env sh
# Run all Cloudflare tunnels in parallel. Exits when any child exits so
# `pnpm tunnel` cleans up predictably. See infra/README.md for first-time setup.

set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
SHOP_CONFIG="${SHOP_CONFIG:-$HERE/shop.yml}"
AD_CONFIG="${AD_CONFIG:-$HERE/ad.yml}"
SGTM_CONFIG="${SGTM_CONFIG:-$HERE/sgtm.yml}"

if [ ! -f "$SHOP_CONFIG" ]; then
  echo "missing $SHOP_CONFIG — copy shop.yml.example and follow infra/README.md" >&2
  exit 1
fi
if [ ! -f "$AD_CONFIG" ]; then
  echo "missing $AD_CONFIG — copy ad.yml.example and follow infra/README.md" >&2
  exit 1
fi
if [ ! -f "$SGTM_CONFIG" ]; then
  echo "missing $SGTM_CONFIG — copy sgtm.yml.example and follow infra/README.md" >&2
  exit 1
fi
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared not on PATH — install per infra/README.md" >&2
  exit 1
fi

cloudflared tunnel --config "$SHOP_CONFIG" run &
SHOP_PID=$!
cloudflared tunnel --config "$AD_CONFIG" run &
AD_PID=$!
cloudflared tunnel --config "$SGTM_CONFIG" run &
SGTM_PID=$!

trap 'kill $SHOP_PID $AD_PID $SGTM_PID 2>/dev/null || true' INT TERM EXIT

# Exit when the first tunnel dies — treat one-down as fatal so the operator sees it.
wait -n
STATUS=$?
kill $SHOP_PID $AD_PID $SGTM_PID 2>/dev/null || true
exit $STATUS
