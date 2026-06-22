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
shopt -s nullglob
for PKG_DIR in packages/*/; do
  PKG=$(basename "$PKG_DIR")
  RELEASE_DIR="packages/$PKG/release"

  # The build must have produced a release/ folder with files in it.
  # (-d check first so the ls -A doesn't run on a missing dir.)
  if [ ! -d "$RELEASE_DIR" ] || [ -z "$(ls -A "$RELEASE_DIR")" ]; then
    echo "Release folder missing or empty for $PKG: $RELEASE_DIR"; exit 1
  fi

  # Built JS bundles — copy every .js the package emitted, EXCEPT example.*
  # templates (those are shipped with the prefix dropped, see below).
  for JS in "$RELEASE_DIR"/*.js; do
    [[ "$(basename "$JS")" == example.* ]] && continue
    cp "$JS" dist-release/
  done

  # Built CSS bundles (optional) — same rule, skip example.* templates.
  for CSS in "$RELEASE_DIR"/*.css; do
    [[ "$(basename "$CSS")" == example.* ]] && continue
    cp "$CSS" dist-release/
  done

  # Sample configs: ship every *.js.sample (top-level of the package),
  # dropping the .sample suffix so it ships ready to edit.
  for SAMPLE in "packages/$PKG"/*.js.sample; do
    cp "$SAMPLE" "dist-release/$(basename "$SAMPLE" .sample)"
  done

  # Example templates in release/ (optional): ship every example.* file with the
  # "example." prefix dropped, whatever the extension:
  #   example.config.json                         -> config.json
  #   example.monitoring_configuration_custom.js  -> monitoring_configuration_custom.js
  for EX in "$RELEASE_DIR"/example.*; do
    NAME=$(basename "$EX")
    cp "$EX" "dist-release/${NAME#example.}"
  done
done

# App-template ZIPs (kintone app-template exports) committed under release-assets/ (optional).
for APP_TEMPLATE in release-assets/*_app-template.zip; do
  cp "$APP_TEMPLATE" dist-release/
done

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
