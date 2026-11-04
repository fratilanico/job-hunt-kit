---
name: apply-ats
description: Apply to a job on an employer ATS (Greenhouse, Ashby, Lever, Teamtailor, Recruitee, Pinpoint, Workable, Screenloop, Loxo, aplitrak and simple company forms) with the Playwright driver jobs/apply.mjs. Probe, plan, dry run, verify, submit, with the captcha handoff to the user. Use for every job in the headless or captcha-gated lane.
---

# Apply on an employer ATS (driver `jobs/apply.mjs`)

Works the same in Claude Code and Codex. Uses the installed Google Chrome (falls back to Playwright's Chromium).

## Before the form

1. Triage and dedupe done (`skills/job-triage-and-routing`). Re-run `jobs/dedupe.py` on the resolved ATS URL and its
   job id: reposts carry the same ATS id under a new board URL.
2. Tailored CV built and, if the review policy says so, approved (`skills/cv-tailor-per-job`).
3. Read the questions without a browser where you can: Greenhouse
   `boards-api.greenhouse.io/v1/boards/<board>/jobs/<id>?questions=true` lists every question and option.

## Probe, plan, dry run, submit

```
node jobs/apply.mjs probe <url> [--click "Apply"] --out runs/<company-role>     # every field, option, button
node jobs/apply.mjs run runs/<company-role>/plan.json                            # dry run (submit: null)
```
plan.json:
```json
{"url": "https://job-boards.greenhouse.io/embed/job_app?for=<board>&token=<id>",
 "out": "runs/<company-role>",
 "job": "<Title> at <Company>",
 "steps": [
  {"fill": "First Name", "value": "<identity.first_name>"}, {"fill": "Last Name", "value": "<identity.last_name>"},
  {"fill": "Email", "value": "<identity.email>"}, {"fill": "Phone", "value": "<identity.phone_international>", "type": true},
  {"upload": {"index": 0}, "path": "out/<company-role>/<First>-<Last>-CV.pdf"},
  {"combobox": "Location (City)", "type": "<location.city>", "option": "<location.form_location_option>"},
  {"combobox": "Are you legally authorised to work", "option": "Yes"},
  {"check": "I have read the Privacy Notice"}
 ],
 "submit": null,
 "success": "thank you for applying|application (has been |was )?(submitted|received)|we('ve| have) received your application",
 "waitAfter": 15000,
 "track": {"csv": "data/batches/<date>-w<k>.csv", "title": "<Title>", "company": "<Company>", "vendor": "greenhouse", "note": "cv tailored out/<dir>"}}
```
Every value comes from `profile/profile.yaml` or the CV. Unknown answer: stop and ask (or park `needs-user-question`).

1. Dry run with `"submit": null`. **Read `state.png` and `state.json`**: every required field filled, every dropdown
   and radio showing the intended value, CV attached (chip visible in the PNG), no error text. Fix, re-run until clean.
2. Respect `autonomy`: `draft_only` stops here (leave the plan, log `needs-user-submit`); `confirm_each` shows the
   user the screenshot and the answers and waits for a yes; `submit_within_rules` continues.
3. Set `"submit": {"click": "Submit application"}` and run again (fills are idempotent).
4. Exit codes: 0 confirmed · 3 a step failed (`STEP FAILED` in log.txt) · 4 refused, a required field is empty (a
   feature) · 5 clicked but no success text: **read `after.png` and the NETWORK lines before deciding; never blind
   retry** (an application POST with 200/201 means it went through) · 7 captcha not solved in time · 1 fatal.
5. With `track` set the driver appends the batch row itself; otherwise append one line to
   `data/batches/<date>-<lane>.csv` yourself (`skills/tracker-and-handoff`).

Step escape hatches: `{"fill": ..., "type": true}` types keys (phone fields, React inputs that ignore fill),
`{"click": {"selector": "..."}}`, `{"js": "(()=>{ ... })()"}` (wrap multi-statement JS), `{"wait": 5000}`.
Add `"headed": true` for vendors that flag headless (Ashby), `"human": true` for human pacing.

## Captcha handoff (never solve a captcha)

The driver detects **visible** challenges only (reCAPTCHA checkbox or image challenge, hCaptcha, Cloudflare Turnstile,
"verify you are human" interstitials, sliders); invisible reCAPTCHA v3 badges are normal and ignored.
On detection during a submit run:
1. A headless run re-runs the plan in a **visible Chrome window** on the user's computer.
2. It prints `CAPTCHA_WAITING {"job":..,"url":..}` and writes `<out>/captcha_waiting.json`.
3. **You alert the user through your own session** the moment that line appears: Claude Code: PushNotification tool
   (or a clear message in the session they follow on the Claude phone app); Codex: a message in the task they follow.
   Text: job, link, "solve the captcha in the browser window on your computer, I'll continue automatically".
   A macOS banner fires as a local fallback; Telegram only if they configured it.
4. The driver polls every few seconds until the challenge is gone (timeout `captcha.wait_minutes`, default 10),
   then resumes filling and submits. On timeout it logs `needs-user-captcha`.
5. The host or board is remembered in `data/captcha_hosts.txt`, so `routes.py` sends it to the captcha batch next time.

So run submit plans in the background and watch the log:
`node jobs/apply.mjs run <plan> > runs/<dir>/stdout.txt 2>&1 &` then poll for `CAPTCHA_WAITING`, `RESULT`, `OUT`.
Run the `captcha-gated` batch only while the user is at the computer. Never click inside a captcha, never retry a
spam flag in a loop, never read a captcha "security code" from email.

Not visible to the driver: Greenhouse reCAPTCHA Enterprise that silently fails (`POST 428 captcha-failed` in the
NETWORK log, an 8-character code emailed). Check the dry-run log for `recaptcha/enterprise`; if present, run that board
headed with the user present, or park `needs-user-captcha`. Each failed attempt emails another code: don't retry.

## Vendor notes (durable lessons)

**Greenhouse**
- Use the embed URL `job-boards.greenhouse.io/embed/job_app?for=<board>&token=<id>` (EU boards: `job-boards.eu.greenhouse.io`).
- Resume = file input index 0; cover letter = `{"upload": {"selector": "#cover_letter"}}`. Add `{"wait": 4000}` before
  and `{"wait": 6000}` after the CV upload, or the form errors on `uploadFile`.
- Location: `combobox` with `type` = city and `option` = the full option text. Yes/No questions are react-select
  comboboxes (`combobox` with `option`). Multi-select chips read empty in the dump: check the PNG.
- Education school comboboxes may not list the exact university name: type a shorter form and pick the closest real option.
- Confirmation can briefly 503; re-check within 30 s. Success title "Thank you for applying".
- A required "certification / confidentiality" initials field is a legal signature: park `needs-user-question`.

**Ashby** (`jobs.ashbyhq.com/<org>/<uuid>/application`)
- Flags headless submits as spam: plans **must** set `"headed": true`. A `RECAPTCHA_SCORE_BELOW_THRESHOLD` / "flagged
  as possible spam" reply is worth **one** retry about 10 minutes later, still headed; then park
  `retry-ashby-spam-flag`. Repeated flags on one org: park it for the user's own browser.
- Upload the CV by its label ("Resume" / "CV") or `#_systemfield_resume`; never index 0 (that is "Autofill from resume").
  Re-check the PNG after upload: autofill can touch typed fields.
- Yes/No questions are often button pairs that don't appear in the field dump (only as `BUTTONS Yes | No`). Use real
  clicks (`{"click": {"selector": "button:text-is(\"Yes\") >> nth=0"}}`) or the `radio` step with the question text;
  a JS `.click()` can paint them selected while React state stays empty. Verify in the PNG.
- Location boxes are autocompletes: `{"combobox": "Start typing...", "type": "<city>", "option": "<location.ashby_location_option>"}`.
- Number-type phone fields strip a leading 0 and reject "+": use `identity.phone_digits_only`.
- Success text varies: use `successfully submitted|received your application|thanks for applying|thank you|thanks for your interest`
  and trust a `FormSubmitSuccess` in the NETWORK log. Never put generic words like "successfully" alone in the regex:
  page copy (and the spam message) can match.
- Pay is usually only in the page sidebar: read the PNG for the floor check.

**Lever** (`jobs.lever.co/<org>/<id>/apply`)
- hCaptcha can appear only at submit (`getcaptcha` in the log, no application POST): that's the handoff case.
- Wait 9-12 s after upload for the parser, then overwrite the email, current company and URL fields it fills wrongly.
  Leave a parser-set Location alone (retyping orphans a hidden field). Consent box toggles: click once, verify.
- Success "Application submitted".

**Teamtailor**
- Go straight to `<job-url>/applications/new` (the Apply modal has no fields and a honeypot).
- The cookie banner says "Decline all non-necessary cookies"; if it intercepts clicks, click it explicitly as step 1.
- Styled checkboxes ignore `check`: click `label[for="<id>"]`. Radio ids regenerate each load: select by name + value.
- The phone is an intl-tel widget preset to the country code: type local digits only.
- The uploader clears `input[type=file]` after upload, so the dump shows no file while the PNG shows the chip: verify
  visually, then `"force": true` is acceptable for that one reason.
- Success: redirect to `/thanks` or `/surveys?job_application_id=`. `/email_verification_needed` = not done yet
  (needs the emailed link: only with the user's inbox permission).

**Workable**: Cloudflare Turnstile at submit is common: captcha-gated lane. Phone is intl-tel (`.iti__selected-flag`,
then the country). Tick and verify the GDPR box. Success `?success`.
**SmartRecruiters**: slider captcha after a few loads: captcha-gated lane, user present only.
**Recruitee** `https://<org>.recruitee.com/o/<slug>/c/new`, success URL ends `/applied`.
**Pinpoint** `.../applications/new`, success `/applications/thanks`; answering right-to-work Yes can inject a required follow-up select.
**Screenloop**: click `button:text-is("Browse")` before the file input exists; phone by name `phoneNumber`; success `/submit/success`.
**Loxo**: real form is `<job-url>/form?source_type=app`; target inputs by `name`; success `/finish`.
**aplitrak / Broadbean** mail-apply links: one short form, no account, usually the fastest lane.
**BreezyHR**: append `/apply`; read question text from the PNG; its static error list is a template, ignore it.
**Account-gated** (Workday, SuccessFactors, Taleo, iCIMS, Oracle, Phenom, Eightfold, Avature, agency sites that create
an account on Apply): never attempt; `needs-user-account-<vendor>`.

## General form lessons

- SPA forms: start with `{"wait": 5000}`; fills before hydration are silently wiped.
- CV parsers misfill email, current employer and URLs: overwrite every parsed field from the profile and read back.
- Free-text boxes have hard limits (255 / 300 / 2,000 characters): count before pasting.
- Work type: tick what the profile allows (e.g. Remote + Hybrid), never On-site if `work_type.onsite` is false.
- Demographics: "Prefer not to say". Marketing, "keep my CV for future roles", SMS, "follow company": unticked unless
  the form will not submit without it (then note it in the tracker).
- Disability / adjustments with only Yes/No: answer from the profile (`screeners.adjustments_needed`).
- Never tick an untrue declaration (including "no AI was used in this application"): park it.
