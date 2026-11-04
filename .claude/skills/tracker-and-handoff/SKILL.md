---
name: tracker-and-handoff
description: Log every application decision to the tracker (data/applications.csv) via batch CSVs, merge them safely, regenerate the needs-user list, and write the end-of-session handoff. Use after any application, skip, or park, and at the end of every session or tick.
---

# Tracker and handoff

## Tracker

`data/applications.csv` (create from `data/applications.template.csv`):
`id,title,company,vendor,url,status,date,note` with ids `A1, A2, ...`. The URL is column 5 (index 4).

**Never edit the tracker directly during a run.** Append to a batch file, then merge:
- batch rows have **no header and no id**: `title,company,vendor,url,status,date,note` (quote fields with commas).
- one batch file per worker or lane: `data/batches/<date>-w<k>.csv`, `<date>-browser.csv`, `<date>-captcha.csv`.
- `python3 jobs/merge_batches.py [files]` assigns ids, backs up the tracker, and renames merged files `merged-*`.
  Merge only your own batches, only after every worker on them has finished (it renames every unmerged batch it is
  given). Afterwards check the last rows it prints.
- A later definitive outcome overwrites a deferred / retry / needs-user row for the same URL; a `submitted` row is
  never overwritten.

## Status vocabulary

| Status | Meaning |
|---|---|
| `submitted` | confirmed (confirmation page, redirect, application POST, status on the job page, or email receipt) |
| `already-applied` | the board or ATS says so |
| `skipped-<reason>` | geo, language, salary, scope, hard-requirement, degree, onsite, duplicate, company-cap, industry |
| `needs-user-captcha` | captcha not solved in time; URL and what is filled in the note |
| `needs-user-account-<vendor>` / `needs-user-login-<board>` | account or sign-in needed |
| `needs-user-question` | a question or declaration only the user can answer (note the question) |
| `needs-user-otp` | email code needed and inbox reading not allowed |
| `needs-user-submit` | `draft_only` / awaiting confirmation; plan path in the note |
| `needs-user-review` | review-first company, cap or floor override decision |
| `deferred-<reason>` | e.g. `deferred-easyapply-limit`; try again later |
| `retry-<reason>` | e.g. `retry-ashby-spam-flag`, `retry-unconfirmed` (read after.png before retrying) |
| `failed-<cause>` | driver or board failure that won't fix itself |
| `closed` | posting gone |

Log **every** triaged row, skips included, or it comes back next run. The note says which CV (variant or tailored
dir) and letter went out, the run dir for anything parked, and any non-standard answer given.

## Needs-user list

`python3 jobs/needs_user.py` rebuilds `data/NEEDS-USER.md` from the tracker: today's rows first, then the open backlog
grouped by what they need. Show it to the user at the end of a session when it has new rows. If a form lacked fields
the JD asked for (written answers), draft them into `data/drafts/<company>.md` for the user.

## Handoff (`data/handoff.md`)

Rewrite at the end of every session or tick (re-read it first; another session may have written since):
- submitted this session (title, company, lane) and running total;
- parked and why; new `NEEDS-USER.md` rows;
- what discovery ran (time windows, boards) and when the next run is due;
- boards walled or signed out; anything that broke and the run dir;
- live background processes (PID, log path), if any;
- new vendor quirks learned (also add them to the relevant skill file: promote lessons into skills and scripts,
  not just notes).
