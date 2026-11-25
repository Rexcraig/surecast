#!/bin/bash
# Publish the iPhone app's current web files to occhiphoto.com/surecast/ for friends (no install needed).
# Needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (Workers Scripts + Routes Edit) in the environment.
set -euo pipefail
cd "$(dirname "$0")"
SRC=../SureCast/web
OUT=public/surecast
rm -rf public && mkdir -p "$OUT"
cp "$SRC"/index.html "$SRC"/*.js "$OUT/"
# Home-screen icon for Safari "Add to Home Screen" (the app gets its icon from Xcode instead).
sips -z 180 180 ../SureCast/Assets.xcassets/AppIcon.appiconset/icon-1024.png --out "$OUT/apple-touch-icon.png" >/dev/null
sed -i '' 's#<title>SureCast</title>#<title>SureCast</title>\n<link rel="apple-touch-icon" href="apple-touch-icon.png">\n<meta name="apple-mobile-web-app-title" content="SureCast">#' "$OUT/index.html"
: "${CLOUDFLARE_ACCOUNT_ID:?set CLOUDFLARE_ACCOUNT_ID}" "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN}"
npx --yes wrangler deploy
