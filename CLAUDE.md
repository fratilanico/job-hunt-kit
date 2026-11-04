@AGENTS.md

## Claude Code specifics

- Skills live in `.claude/skills/` (also reachable as `skills/`). Slash commands: `/onboard`, `/discover`, `/tick`, `/tailor`.
- First use: if `profile/profile.yaml` is missing, run `/onboard` (the onboarding skill) before anything else.
- Long-running commands (`jobs/discover.sh`, `apply.mjs` runs that might hit a captcha) go in the background
  (`run_in_background`), then watch the log. When a run log shows `CAPTCHA_WAITING`, send the user a push notification
  (PushNotification tool when available, otherwise a clear message in this session) with the job and link.
- Browser lanes use the Claude in Chrome extension (`mcp__claude-in-chrome__*`) or the desktop app's Browser pane
  (`mcp__Claude_Browser__*`). The extension can upload files only from the project folder or the session scratchpad:
  copy the CV PDF there first.
- Read a PDF or PNG with the Read tool to look at a rendered CV before it is used anywhere.
- A permission denial or a refused submit is a stop sign: park the row with a specific status, never retry it in a loop.
  `"force": true` in a plan is only for the documented case of an uploader that clears its file input after upload,
  and only after `state.png` shows the attached file.
