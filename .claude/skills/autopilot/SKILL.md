---
name: autopilot
description: Run one job-hunting tick (manual, or every 30 minutes from a scheduled task) - collision check, merge stale batches, discovery, triage, tailoring, applying within the user's autonomy setting, merge, needs-user list, handoff. Use for /tick, "keep applying", scheduled runs, or a daily run.
---

# Autopilot tick

Respect `autonomy` above everything here: `draft_only` never submits; `confirm_each` needs the user present to say
yes per application (a scheduled unattended tick then only discovers, triages and prepares); `submit_within_rules`
submits when every AGENTS.md rule passes.

## 0. Collision check (always first)

Two sessions (a daily run and a 30-minute tick, or two windows) share discovery files, batches and the browser
session. A double fan-out means genuinely duplicate applications to real employers.
```
pgrep -fl "jobs/discover.sh" ; cat data/discovery/.discover.lock 2>/dev/null
ls -lt data/batches/ | head
```
- If a discovery run is live: don't start another, don't fan out workers on its batches, don't merge. You may still
  work browser lanes on rows nobody else holds, or stand down and write a one-line handoff.
- If the owning session is gone (lock PID dead, no log progress for ~30 min), it's an orphan: wait for or finish it.
- Note the time. A laptop that sleeps freezes a tick rather than ending it; after any long wait compare `date` with
  your start and re-check for collisions.

## 1. Fold in leftovers

Merge any unmerged batch CSVs from a tick that died (`ls data/batches/*.csv`), then read `data/handoff.md` and any
answers the user left to parked decisions.

## 2. Discovery (background)

If the last full discovery is older than ~3 hours: `jobs/discover.sh > data/discovery/run.log 2>&1 &` and note the PID.
Never wait on it in the foreground; it takes 15-45 minutes (longer if the details stage is throttled; a single
`detail N` line for minutes is backoff, not a hang). To wait, poll for the final `DONE` line or the PID with `kill -0`.
Don't relaunch within ~3-4 hours of an empty run: same inventory. Between full runs: `python3 jobs/li_guest.py r3600`.

## 3. Triage and apply, in this order

1. **Headless lane** (captcha-free employer ATS): `data/batches/<date>-w*.json`. Per job: triage + dedupe, tailor the CV
   (`skills/cv-tailor-per-job`), cover note only if asked, then `skills/apply-ats`. Subagents can work one batch file
   each in parallel; give each the batch path, its worker number, and tell it to read AGENTS.md and the apply-ats skill.
2. **Browser lane** (user's signed-in Chrome): Easy Apply with the role-family variant, Reed, TotalJobs, Indeed;
   resolve `unresolved` LinkedIn rows into employer ATS URLs and send those to the headless lane.
3. **Captcha batch** (`data/discovery/captcha_batch.json`): only while the user is at the computer (they said so, or
   they answered a message in the last few minutes). Otherwise leave it; it shows in `NEEDS-USER.md`.
4. Daily caps: `limits.daily_max`, `limits.easy_apply_daily`, company cap. Stop when reached.

## 4. Close out

`python3 jobs/merge_batches.py <your batch files>` → `python3 jobs/needs_user.py` → rewrite `data/handoff.md`
(`skills/tracker-and-handoff`). Final message: submitted this tick, total submitted, new needs-user items (with the
captcha ones first, since they take two minutes each), anything broken.

## Scheduling

- Claude Code desktop: a scheduled task every 30 minutes with the prompt "Run the autopilot skill in
  <repo path>". Click "Run now" once so its tool permissions are approved while you watch.
- Codex: a recurring task with the same prompt.
- Unattended runs may have actions denied by the permission system (final submits, typing codes). A denial is a stop:
  park the row with a specific status for a live session. Never work around it; after two denials in a tick, stop.
- Don't sweep more often than every ~15 minutes, and don't widen the search just to have something to do.
