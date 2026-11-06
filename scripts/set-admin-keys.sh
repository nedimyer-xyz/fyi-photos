#!/usr/bin/env bash
# Store the admin's Tumblr app keys in Vercel, then redeploy.
#   bash scripts/set-admin-keys.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# If the same text was pasted several times in a row, keep one copy.
dedupe() {
  python3 -c '
import sys
s = sys.argv[1].strip()
for n in range(1, len(s) // 2 + 1):
    if len(s) % n == 0 and s[:n] * (len(s) // n) == s:
        s = s[:n]; break
print(s)' "$1"
}

ask() {
  local label=$1 v
  read -rsp "$label (paste once, then press Enter): " v; echo >&2
  v=$(dedupe "$v")
  [ -n "$v" ] || { echo "✗ Nothing pasted" >&2; exit 1; }
  echo "  ✓ got ${#v} characters, ending …${v: -4}" >&2
  printf '%s' "$v"
}

echo "Copy the keys for the \"fyi.photos admin\" app from https://www.tumblr.com/oauth/apps"
echo "(nothing shows while you paste — that's normal)"
CID=$(ask "OAuth Consumer Key")
CSEC=$(ask "Secret Key")

for name in TUMBLR_CLIENT_ID TUMBLR_CLIENT_SECRET; do
  npx --yes vercel@latest env rm "$name" production --yes >/dev/null 2>&1 || true
done
printf '%s' "$CID"  | npx --yes vercel@latest env add TUMBLR_CLIENT_ID production >/dev/null 2>&1
printf '%s' "$CSEC" | npx --yes vercel@latest env add TUMBLR_CLIENT_SECRET production >/dev/null 2>&1
echo "✓ Keys saved in Vercel. Redeploying (about a minute)…"
npx --yes vercel@latest deploy --prod --yes >/dev/null 2>&1
echo "✓ Done. Open https://fyi-photos-admin.vercel.app and click Log in with Tumblr."
