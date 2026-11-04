---
name: onboarding
description: Guided first-run setup for a new user of the job-hunt kit. Interviews them a few questions at a time, writes profile/profile.yaml, builds their CV from their existing one, lets them pick a CV theme, strengthens the profile and CV, then runs a first discovery pass and a shortlist for review. Use when profile/profile.yaml is missing, on /onboard, or when the user says "set me up" / "start".
---

# Onboarding

Goal: by the end, the user has `profile/profile.yaml`, `profile/cv-master.yaml`, `profile/cv.yaml`, a rendered CV PDF
they like, a voice sample, and a first shortlist to review. Nothing is applied to during onboarding.

## How to run the interview

- Ask **3 to 5 questions per turn**, grouped by topic, in plain English. Never a wall of 30 questions.
- Offer sensible defaults in brackets so they can answer "default". Accept "skip" and come back later.
- Check what you can yourself first (their CV file answers many questions; read it before asking).
- After each block, write what you have into `profile/profile.yaml` (start from `profile/profile.example.yaml`),
  so nothing is lost if the session stops. Keep the file valid YAML.
- Explain each block in one sentence: why it matters (for example "forms ask this on almost every application").
- Never invent an answer. Blank is fine; the apply skills will ask when a form needs it.

## Step 0. Prerequisites (check, don't lecture)

Run and report briefly: `node --version` (18+), `python3 --version`, `python3 -c "import yaml"`,
`ls node_modules/playwright` (else `npm install`), `pdftotext -v` (poppler; else `brew install poppler` /
`sudo apt install poppler-utils`), Google Chrome installed. Fix what you can with their OK.
Then `cp data/applications.template.csv data/applications.csv` if missing.

## Step 1. Their CV first

Ask them to drop their current CV (PDF or DOCX) into `profile/` and tell you the filename. Read it
(`pdftotext -layout` for PDF; for DOCX use `textutil -convert txt` on macOS or `pandoc`). Pull out name, contact,
roles, dates, employers, education, certifications, skills. Use it to pre-fill every later answer and only ask to
confirm or fill gaps.

## Step 2. Interview blocks (in this order)

1. **Identity and contact**: full name, preferred name, email they read (and whether you may read ATS verification
   codes from it: sets `limits.allow_reading_inbox_for_codes`), phone (store international, local and digits-only
   forms), LinkedIn URL, portfolio / GitHub (only sites they control).
2. **Location and work rights**: city and country, the exact location option forms should pick, right to work,
   sponsorship now / in future, status wording, citizenship (only if they want it used when a form asks literally).
3. **Ways of working**: remote / hybrid / on-site (and the rule for forms, e.g. tick Remote + Hybrid, never On-site),
   office days OK on hybrid roles, travel %, relocation.
4. **Type and pay**: permanent and/or contract, salary floor, day-rate floor, whether unstated pay is OK,
   the number to type into numeric salary fields, a one-sentence salary answer, notice period / earliest start.
5. **Targets**: target job titles (5 to 10, the words recruiters use), seniority, industries they want and
   ones they refuse, companies to avoid (current employer!), companies to always review first, extra employer
   boards they love (Greenhouse / Ashby / Lever slugs). Derive `title_include` / `title_exclude` and
   `score_positive` / `score_negative` from the CV and the targets, show them, adjust.
6. **Education, certifications, languages** (confirm from the CV).
7. **Standard screener answers**: right to work, relocation, driving licence, access to a vehicle, clearances held
   or obtainable, years of experience per main skill (compute from CV dates and show the maths), notice period,
   how they heard (default "Job board"), demographics (default "Prefer not to say"). Criminal-record style
   questions: ask only if they want a standing answer; otherwise those stay `needs-user-question`.
8. **Voice sample**: ask for 3 to 5 paragraphs they wrote themselves (emails, LinkedIn posts, a past cover
   letter they liked). Save to `profile/voice-sample.md`. Note their habits (sentence length, formality, words they use).
9. **Job boards**: which they have accounts on and are signed in to in Chrome (LinkedIn, Indeed, Reed, TotalJobs,
   CV-Library, Glassdoor). Tell them: Claude never signs in or creates accounts; they sign in once in their own
   Chrome, and the browser lanes use that session. Install the Claude in Chrome extension if they use Claude Code.
10. **Autonomy**: explain the three levels and let them choose:
    - `draft_only`: Claude prepares CVs, letters and filled forms; the user submits.
    - `confirm_each`: Claude fills each form and shows it; submits only after their yes (default).
    - `submit_within_rules`: Claude submits when every rule passes; captchas, accounts and questions still come to them.
    Also: daily maximum, company cap (default 2), captcha wait time (default 10 min), notifications
    (agent session push = default; macOS banner fallback; Telegram optional, not recommended).

## Step 3. Build the CV content

1. Write `profile/cv-master.yaml`: same shape as `cv/sample-content.yaml`, holding **every** role, project and
   proof point from their CV plus anything they told you (more than fits on the page). Keep their facts exactly.
2. Write `profile/cv.yaml`: the base CV (best general version for their main target title), cut from the master.
   Follow `cv/README.md` rules: outcomes first, numbers only where true, no em dashes, no slop, bullets at most two lines.
3. `node cv/voice-lint.mjs profile/cv.yaml` and fix every error.

## Step 4. Pick a theme (show, don't describe)

1. `node cv/build.mjs --previews --content profile/cv.yaml --out-dir out/theme-previews --role "<main target title>" --seniority "<level>"`
   renders page 1 in all five themes plus `all-themes.png` side by side and prints the recommendation.
2. Show them `out/theme-previews/all-themes.png` (Read it, describe in one line each) with your recommendation and why
   (`recommendTheme` maps role family + seniority; director-level gets the calm variant).
3. Let them pick, and offer a custom accent (`--accent "#hex"`). Save `cv.theme` / `cv.accent` in the profile.
4. Build: `node cv/build.mjs --png`. The ATS check must pass. Read the PDF and page-1 PNG yourself before showing it.
5. If they apply in places that print in black and white, also build `--bw`.

## Step 5. Strengthen

Review profile + CV against their target roles and give **concrete, numbered recommendations**, for example:
- bullets that describe activity with no outcome (quote the bullet, suggest the question that would get the number);
- missing numbers they probably know (team size, budget, audience, before/after);
- headline and title alignment with the titles they are targeting;
- skill gaps versus 5 to 10 real job ads for their target title (run a quick `python3 jobs/li_guest.py r604800`
  or read a few JDs) and which gaps are real versus wording;
- LinkedIn headline and About section (draft both in their voice);
- portfolio gaps (one or two pieces of evidence worth adding);
- realistic floors given the ads you just read (say so plainly if a floor looks high or low).
Ask which to apply. Apply only those, re-lint, rebuild, show the PDF again.

## Step 6. Role-family variants for one-click boards

LinkedIn Easy Apply and similar boards use stored CVs, not per-job builds. Build 2 or 3 variants for their main
title families (`cv/out/cv-<family>.pdf`), list them in `cv.variants`, and tell them to upload those to LinkedIn
(and Reed / Indeed / TotalJobs) themselves.

## Step 7. First run (no applications)

1. `jobs/discover.sh` in the background; while it runs, explain what happens next.
2. When done, show the top 15 to 25 of `data/discovery/shortlist.csv` with score, pay, location, lane.
3. Ask them to mark yes / no / why. Use their reasons to tune `title_include`, `title_exclude`, `score_positive`,
   `score_negative`, floors. Re-run `python3 jobs/score.py && python3 jobs/routes.py`.
4. Write `data/handoff.md` with what is set up and what is next. Stop. Applying starts in the next session, on
   their word, using `skills/autopilot` or one job at a time.

## Done when

- `profile/profile.yaml` validates (`python3 -c "import sys; sys.path.insert(0,'jobs'); import config"` runs clean).
- `node cv/build.mjs` passes the ATS check and the user has said they like the CV.
- `profile/voice-sample.md` exists.
- A shortlist has been reviewed and the filters tuned.
