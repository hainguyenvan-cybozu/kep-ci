#!/usr/bin/env bash
# Build + collect release files for a MONOREPO (packages/*) following the KEP
# convention. Used by build-and-package.yml when is-monorepo=true.
#
# Convention (per package under packages/*):
#   - built bundle:   packages/<pkg>/release/<pkg>_v<VERSION>.js   (required)
#   - built styles:   packages/<pkg>/release/<pkg>_v<VERSION>.css  (optional)
#   - sample config:  packages/<pkg>/<pkg>-configuration.js.sample (optional -> shipped as <pkg>-configuration.js)
#   - app templates:  release-assets/*_app-template.zip            (optional, repo-level)
#
# Produces:
#   dist-release/   -> binary files for <name>_v<VERSION>.zip
#   dist-src/<pkg>  -> each package's source (no node_modules/dist/release) for the _src.zip
#
# Env: APP_TOOL_VERSION (required).
set -euo pipefail

: "${APP_TOOL_VERSION:?APP_TOOL_VERSION not set}"

# 1. Build every package
for PKG_DIR in packages/*/; do
  PKG=$(basename "$PKG_DIR")
  echo "=== Building $PKG ==="
  (cd "$PKG_DIR" && pnpm install --frozen-lockfile && pnpm run build)
done

# 2. Collect binary files into dist-release/
mkdir -p dist-release
for PKG_DIR in packages/*/; do
  PKG=$(basename "$PKG_DIR")

  # Built JS bundle (required)
  JS="packages/$PKG/release/${PKG}_v${APP_TOOL_VERSION}.js"
  if [ ! -f "$JS" ]; then
    echo "No built JS bundle found for $PKG at $JS"; exit 1
  fi
  cp "$JS" dist-release/

  # Built CSS bundle (optional — only emitted when the package imports CSS)
  CSS="packages/$PKG/release/${PKG}_v${APP_TOOL_VERSION}.css"
  if [ -f "$CSS" ]; then
    cp "$CSS" dist-release/
  fi

  # Sample configuration, dropping the .sample suffix so it ships ready to edit.
  SAMPLE="packages/$PKG/${PKG}-configuration.js.sample"
  if [ -f "$SAMPLE" ]; then
    cp "$SAMPLE" "dist-release/${PKG}-configuration.js"
  fi
done

# App-template ZIPs (kintone app-template exports) committed under release-assets/ (optional).
shopt -s nullglob
APP_TEMPLATES=(release-assets/*_app-template.zip)
if [ ${#APP_TEMPLATES[@]} -gt 0 ]; then
  cp "${APP_TEMPLATES[@]}" dist-release/
fi

echo "Collected files:"
ls -la dist-release

# 3. Populate dist-src/<pkg> with each package's source (no deps/build output).
for PKG_DIR in packages/*/; do
  PKG=$(basename "$PKG_DIR")
  mkdir -p "dist-src/$PKG"
  rsync -a --delete \
    --exclude 'node_modules' --exclude 'node_modules/**' \
    --exclude '.git' --exclude '.git/**' \
    --exclude '.gitignore' \
    --exclude '.DS_Store' \
    --exclude 'dist' --exclude 'dist/**' \
    --exclude 'release' --exclude 'release/**' \
    "packages/$PKG/" "dist-src/$PKG/"
done
