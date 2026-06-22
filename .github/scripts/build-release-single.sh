# #!/usr/bin/env bash
# # Build + collect release files for a NORMAL (single-project) repo.
# # Used by build-and-package.yml when is-monorepo=false.
# #
# # TEMPLATE / UNTESTED: no normal repo has an auto-release yet, so the exact
# # bundle naming is a guess based on the monorepo convention. Adjust the globs
# # below to match the real repo's release/ output when one adopts this.
# #
# # For a normal (non-monorepo) KEP repo the project — including its package.json —
# # lives in a "plugin" or "customization" folder, NOT the repo root. So the caller
# # sets project-dir to that folder (e.g. project-dir: "plugin") and points
# # version-package-path at "./plugin/package.json".
# #
# # Convention assumed (project dir = $PROJECT_DIR, e.g. "plugin" or "customization"):
# #   - built bundles:  $PROJECT_DIR/release/*.js  (required, >=1)
# #   - built styles:   $PROJECT_DIR/release/*.css (optional)
# #   - sample config:  $PROJECT_DIR/*.js.sample (optional -> *.js, .sample dropped)
# #
# # Produces:
# #   dist-release/  -> binary files for <name>_v<VERSION>.zip
# #   dist-src/      -> project source (no node_modules/dist/release) for the _src.zip
# #
# # Env: APP_TOOL_VERSION (required), PROJECT_DIR (required for single repos; default ".").
# set -euo pipefail

# : "${APP_TOOL_VERSION:?APP_TOOL_VERSION not set}"
# DIR="${PROJECT_DIR:-.}"

# # 1. Build
# echo "=== Building $DIR ==="
# (cd "$DIR" && pnpm install --frozen-lockfile && pnpm run build)

# # 2. Collect binary files into dist-release/
# mkdir -p dist-release
# shopt -s nullglob
# RELEASE_DIR="$DIR/release"

# # The build must have produced a release/ folder with files in it.
# # (-d check first so the ls -A doesn't run on a missing dir.)
# if [ ! -d "$RELEASE_DIR" ] || [ -z "$(ls -A "$RELEASE_DIR")" ]; then
#   echo "Release folder missing or empty: $RELEASE_DIR"; exit 1
# fi

# # Built JS bundles — copy every .js in release/, EXCEPT example.* templates
# # (those are shipped with the prefix dropped, see below).
# for JS in "$RELEASE_DIR"/*.js; do
#   [[ "$(basename "$JS")" == example.* ]] && continue
#   cp "$JS" dist-release/
# done

# # Built CSS bundles (optional) — same rule, skip example.* templates.
# for CSS in "$RELEASE_DIR"/*.css; do
#   [[ "$(basename "$CSS")" == example.* ]] && continue
#   cp "$CSS" dist-release/
# done

# # Sample configs: ship every *.js.sample, dropping the .sample suffix.
# for SAMPLE in "$DIR"/*.js.sample; do
#   cp "$SAMPLE" "dist-release/$(basename "$SAMPLE" .sample)"
# done

# # Example templates in release/ (optional): ship every example.* file with the
# # "example." prefix dropped, whatever the extension:
# #   example.config.json                         -> config.json
# #   example.monitoring_configuration_custom.js  -> monitoring_configuration_custom.js
# for EX in "$RELEASE_DIR"/example.*; do
#   NAME=$(basename "$EX")
#   cp "$EX" "dist-release/${NAME#example.}"
# done

# echo "Collected files:"
# ls -la dist-release

# # 3. Populate dist-src/ with the project source (no deps/build output).
# mkdir -p dist-src
# rsync -a --delete \
#   --exclude 'node_modules' --exclude 'node_modules/**' \
#   --exclude '.git' --exclude '.git/**' \
#   --exclude '.gitignore' \
#   --exclude '.DS_Store' \
#   --exclude 'dist' --exclude 'dist/**' \
#   --exclude 'release' --exclude 'release/**' \
#   "$DIR/" "dist-src/"
