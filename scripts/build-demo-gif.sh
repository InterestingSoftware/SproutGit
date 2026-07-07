#!/usr/bin/env bash
# Regenerates website/public/demo.gif from the WebdriverIO demo-gif spec.
#
# Prerequisites: the app must be built (`pnpm --filter app build`), and
# `ffmpeg` must be on PATH (`brew install ffmpeg`).
#
# Usage: ./scripts/build-demo-gif.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Mirrors e2e/helpers/screenshots.ts's PLATFORM_FOLDER logic — captured
# frames are nested under a platform subfolder named for the OS that ran
# the capture (mac/windows/linux), not necessarily "mac".
case "$(uname -s)" in
  Darwin) PLATFORM_FOLDER="mac" ;;
  MINGW*|MSYS*|CYGWIN*) PLATFORM_FOLDER="windows" ;;
  *) PLATFORM_FOLDER="linux" ;;
esac

FRAMES_DIR="$ROOT_DIR/e2e/test-results/demo-gif-frames/$PLATFORM_FOLDER/demo"
OUT_GIF="$ROOT_DIR/website/public/demo.gif"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "==> Capturing frames via WebdriverIO"
rm -rf "$ROOT_DIR/e2e/test-results/demo-gif-frames"
(cd "$ROOT_DIR/e2e" && pnpm demo-gif-frames)

# name:duration(seconds) — pacing for each captured beat. Edit alongside
# demo-gif.spec.ts's frame() calls if the story there changes.
FRAMES=(
  "01-graph-initial:1.4"
  "02-new-worktree-dialog:0.6"
  "03-new-worktree-typed:0.6"
  "04-worktree-auth-created:0.7"
  "05-worktree-dashboard-created:0.7"
  "06-worktree-notif-created:0.9"
  "07-agent-auth-start:0.7"
  "08-agent-auth-progress:1.3"
  "09-agent-dashboard-start:0.7"
  "10-agent-dashboard-progress:1.3"
  "11-agent-notif-progress:1.3"
  "12-three-agents-parallel:1.6"
  "13-diff-review:1.8"
  "14-graph-merged:0.8"
  "15-graph-merged-hold:1.8"
)

LIST="$WORK_DIR/frames.txt"
: > "$LIST"
for entry in "${FRAMES[@]}"; do
  name="${entry%%:*}"
  dur="${entry##*:}"
  echo "file '$FRAMES_DIR/$name.png'" >> "$LIST"
  echo "duration $dur" >> "$LIST"
done
# The concat demuxer ignores the last entry's duration unless the final file
# is repeated once more without one.
last_name="${FRAMES[-1]%%:*}"
echo "file '$FRAMES_DIR/$last_name.png'" >> "$LIST"

echo "==> Generating palette"
ffmpeg -y -f concat -safe 0 -i "$LIST" \
  -vf "fps=12,scale=880:-1:flags=lanczos,palettegen=stats_mode=diff" \
  "$WORK_DIR/palette.png"

echo "==> Encoding GIF"
ffmpeg -y -f concat -safe 0 -i "$LIST" -i "$WORK_DIR/palette.png" \
  -lavfi "fps=12,scale=880:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3" \
  "$OUT_GIF"

echo "==> Done: $OUT_GIF ($(du -h "$OUT_GIF" | cut -f1))"
