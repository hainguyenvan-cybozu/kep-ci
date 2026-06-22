#!/usr/bin/env bash
# Build + collect release files for a NORMAL (single-project) repo.
# Used by build-and-package.yml when is-monorepo=false.
#
# TEMPLATE / UNTESTED: no normal repo has an auto-release yet, so the exact
# bundle naming is a guess based on the monorepo convention. Adjust the globs
# below to match the real repo's release/ output when one adopts this.
#
# Convention assumed (project dir = $PROJECT_DIR, default "."):
#   - built bundles:  $PROJECT_DIR/release/*_v<VERSION>.js  (required, >=1)
#   - built styles:   $PROJECT_DIR/release/*_v<VERSION>.css (optional)
#   - sample config:  $PROJECT_DIR/*-configuration.js.sample (optional -> *-configuration.js)
#
# Produces:
#   dist-release/  -> binary files for <name>_v<VERSION>.zip
#   dist-src/      -> project source (no node_modules/dist/release) for the _src.zip
#
# Env: APP_TOOL_VERSION (required), PROJECT_DIR (optional, default ".").
set -euo pipefail

: "${APP_TOOL_VERSION:?APP_TOOL_VERSION not set}"
DIR="${PROJECT_DIR:-.}"

# 1. Build
echo "=== Building $DIR ==="
(cd "$DIR" && pnpm install --frozen-lockfile && pnpm run build)

# 2. Collect binary files into dist-release/
mkdir -p dist-release
shopt -s nullglob

JS_FILES=("$DIR"/release/*_v"${APP_TOOL_VERSION}".js)
if [ ${#JS_FILES[@]} -eq 0 ]; then
  echo "No built JS bundle found in $DIR/release for v${APP_TOOL_VERSION}"; exit 1
fi
cp "${JS_FILES[@]}" dist-release/

CSS_FILES=("$DIR"/release/*_v"${APP_TOOL_VERSION}".css)
if [ ${#CSS_FILES[@]} -gt 0 ]; then
  cp "${CSS_FILES[@]}" dist-release/
fi

SAMPLES=("$DIR"/*-configuration.js.sample)
for SAMPLE in "${SAMPLES[@]}"; do
  BASE=$(basename "$SAMPLE" .sample)
  cp "$SAMPLE" "dist-release/$BASE"
done

echo "Collected files:"
ls -la dist-release

# 3. Populate dist-src/ with the project source (no deps/build output).
mkdir -p dist-src
rsync -a --delete \
  --exclude 'node_modules' --exclude 'node_modules/**' \
  --exclude '.git' --exclude '.git/**' \
  --exclude '.gitignore' \
  --exclude '.DS_Store' \
  --exclude 'dist' --exclude 'dist/**' \
  --exclude 'release' --exclude 'release/**' \
  "$DIR/" "dist-src/"
