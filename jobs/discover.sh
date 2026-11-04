#!/usr/bin/env bash
# Discovery pass: list -> uk boards -> details -> employer ATS boards -> score -> routes.
# Usage: jobs/discover.sh [--no-boards]    (from anywhere; ~15-45 min depending on titles and throttling)
# Output: data/discovery/shortlist.{json,csv}, queue_today.json, captcha_batch.json, data/batches/<date>-w*.json
# Long-running: start it in the background and poll the log. Never run two at once (see .claude/skills/autopilot).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DISC="$(cd "$ROOT/jobs" && python3 -c 'import config; print(config.DISC)')" || exit 2; mkdir -p "$DISC"
LOCK="$DISC/.discover.lock"
if [ -e "$LOCK" ] && kill -0 "$(cat "$LOCK")" 2>/dev/null; then echo "discover already running (pid $(cat "$LOCK")); not starting a second one"; exit 3; fi
echo $$ > "$LOCK"; trap 'rm -f "$LOCK"' EXIT
step() { echo "[$(date '+%F %T')] $1"; shift; python3 "$@" > "$DISC/$(basename "$1" .py).log" 2>&1 || echo "  (stage failed, see $DISC/$(basename "$1" .py).log)"; tail -1 "$DISC/$(basename "$1" .py).log"; }
step list      "$ROOT/jobs/scrape.py"
step ukboards  "$ROOT/jobs/scrape_uk_boards.py"
step details   "$ROOT/jobs/details.py"
if [ "${1:-}" != "--no-boards" ]; then step boards "$ROOT/jobs/scrape_boards.py"; fi
step score     "$ROOT/jobs/score.py"
step routes    "$ROOT/jobs/routes.py"
echo "[$(date '+%F %T')] DONE"
