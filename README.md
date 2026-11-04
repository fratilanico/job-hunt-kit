# job-hunt-kit

A toolkit you run with an AI coding agent (Claude Code or Codex) to find jobs, tailor your CV and cover letters,
and apply at scale, without giving up control. The agent does the searching, reading, form-filling and logging;
you decide how much it may submit on its own, and you handle anything that needs a human (captchas, accounts,
legal declarations).

Nothing personal lives in this repo. Your details go into `profile/`, your tracker into `data/`, your CVs into
`out/`; all of those are git-ignored.

## What it does

- **Discovery**: searches LinkedIn (public job pages), Reed, remote boards and the career pages of companies you
  name, reads each job description, and filters by your rules: titles, location, work rights, salary or day-rate
  floor, remote/hybrid, perm/contract, industries and companies to avoid.
- **Triage and routing**: dedupes against everything you've already applied to (max 2 applications per company by
  default) and sorts jobs into lanes: apply headless on an employer ATS, apply in your browser, captcha batch,
  needs you.
- **CV**: one master CV, five clean themes, an ATS check on every PDF, and a per-job tailored CV built only from
  facts you've given it. Gaps are marked, never invented.
- **Apply**: a Playwright driver for employer ATSs (Greenhouse, Ashby, Lever, Teamtailor and more) and skills for
  applying in your own signed-in Chrome (LinkedIn Easy Apply, Indeed, Reed, TotalJobs).
- **Tracker**: every decision logged to `data/applications.csv`, a running `data/NEEDS-USER.md` of what needs you,
  and a handoff note so the next session picks up where the last one stopped.

## Quick start

You need a Mac or Linux machine (Windows with WSL works for most of it).

1. Install:
   - [Claude Code](https://claude.com/claude-code) (desktop app or CLI), or Codex
   - Node.js 18+ and Python 3: `python3 -m pip install -r requirements.txt` (just PyYAML)
   - Google Chrome, plus the **Claude in Chrome** extension if you use Claude Code (for browser applies and CV uploads)
   - poppler for the CV check: `brew install poppler` (Mac) or `sudo apt install poppler-utils`
2. Clone this repo and run `npm install` inside it.
3. Open the folder in Claude Code and type `/onboard`. In Codex, say "set me up".

Onboarding is an interview, a few questions at a time: contact details, location and right to work, remote or
hybrid, perm or contract, your salary or day-rate floor, notice period, the titles and seniority you want,
industries and companies to avoid, links (LinkedIn, portfolio, GitHub), education and certifications, standard
screener answers, a sample of your own writing (so cover notes sound like you), which job boards you're signed
into, and how much the agent may do on its own. Drop your current CV (PDF or Word) into `profile/` when asked; the
agent reads it, so you don't retype your history.

Then it writes `profile/profile.yaml`, builds your CV, shows you page 1 in all five themes side by side, suggests
improvements you can accept or reject, and runs one discovery pass. You get a shortlist to review. **Nothing is
applied to during onboarding.**

## Day to day

| Command (Claude Code) | What it does |
|---|---|
| `/discover` | run discovery in the background (15-45 min) and show the shortlist |
| `/tailor <job url>` | build a CV tailored to one job, with a report of what changed and which requirements you don't meet |
| `/tick` | one full round: discover, triage, tailor, apply within your rules, log, hand off |

In Codex, ask for the same thing in words ("run discovery", "tailor my CV for <url>", "run an autopilot tick").

You can schedule `/tick` every 30 minutes (Claude Code desktop scheduled tasks, or a Codex recurring task). Each
tick first checks that no other run is active, so two sessions never apply to the same job twice.

### How much it does on its own

Set `autonomy` in `profile/profile.yaml`:

- `draft_only`: prepares everything, submits nothing. You review and click.
- `confirm_each`: fills each form, shows you a screenshot and the answers, waits for your yes. **(Default.)**
- `submit_within_rules`: submits on its own when every rule passes. Tailored CVs: you still review the first 5,
  then every 5th.

## CVs

`cv/build.mjs` renders your CV (from `profile/cv.yaml`) to PDF in one of five themes:

| Theme | Feel |
|---|---|
| `clarity` | plain and bright: healthcare, public sector, education, HR, people roles |
| `boardroom` | navy and serif: finance, consulting, legal, operations, executive roles |
| `editorial` | magazine-style serif: communications, marketing, content, PR |
| `studio` | crisp blue: product, design, creative, startup roles |
| `terminal` | dark: engineering, AI, data, technical roles |

Every theme has a black-and-white variant (`--bw`) and takes a custom accent colour (`--accent "#hex"`). Senior
roles get a calmer variant automatically. Previews are in `cv/themes/previews/`.

```
node cv/build.mjs --theme clarity                # PDF from profile/cv.yaml
node cv/build.mjs --recommend --role "Head of Communications" --seniority senior
node cv/ats-check.mjs path/to/cv.pdf             # check any PDF
```

Every build runs the ATS check: page count, nothing cut off, text extracts in the right order with your name,
contact details, headings, job titles, companies and dates, no images, fonts embedded, no em dashes, under 2 MB.
Details and CV writing rules: `cv/README.md`.

**Per-job tailoring** (`cv/tailor.mjs`, skill `cv-tailor-per-job`) reads the job ad, pulls out the 6-8
must-haves, and rebuilds your headline, summary, bullet order and skill headings from your master CV only. A lint
step blocks any number, employer or claim that isn't in your master, and the report lists the requirements you
don't meet. Output: `out/<company>-<role>/` with a neutrally named `Firstname-Lastname-CV.pdf` and
`tailoring-report.md`. One-click board applies (Easy Apply and similar) use 2-3 pre-built role-family variants
instead.

## Captchas: you solve them, the agent waits

The agent never solves a captcha. When one appears:

1. The driver switches to a **visible Chrome window on your computer** and keeps the form filled.
2. The agent alerts you: a push notification from your Claude Code session (or a message in the session you follow
   on the Claude phone app), or a task message in Codex. It says which job and "solve the captcha in the browser
   window on your computer, I'll continue automatically". A macOS notification is the local fallback.
3. You solve it **on the computer** (or over remote desktop). Your phone only alerts you.
4. The agent notices the captcha is gone, finishes the form and submits. If nobody solves it within 10 minutes
   (`captcha.wait_minutes`), the job is logged `needs-user-captcha` and appears in `data/NEEDS-USER.md`.

To keep this rare, captcha-free sites (Ashby, most Greenhouse boards, Teamtailor, LinkedIn Easy Apply) go first,
and sites known to show captchas are batched for when you're at the computer.

## Safety rules

The full list is in `AGENTS.md`. In short, the agent will never:

- solve or bypass a captcha or bot check;
- create an account, sign in, or type a password for you (you sign in to boards once in your own Chrome);
- submit without your standing go-ahead (`autonomy`);
- give an answer that isn't true, round up your experience, or tick a declaration on your behalf;
- read your email, except verification codes from application systems and only if you switch that on;
- send messages to recruiters or anyone else.

## Privacy

`profile/`, `data/`, `out/`, `runs/`, `letters/*.txt`, `.env` and any cookie or session files are git-ignored.
If you fork this repo, check `git status` before every commit. If you set an optional Telegram alert, the token
goes in `.env`, never in the profile.

## Known limits

- Indeed and CV-Library block scripted searching; use them through your own browser.
- TotalJobs and some boards currently block scripted listing too (the script returns nothing rather than failing).
- LinkedIn's public job pages hide "apply on company site" links; those jobs are resolved in your browser.
- Account-based portals (Workday, SuccessFactors, Taleo, iCIMS and similar) are always left for you.

## Layout

```
AGENTS.md / CLAUDE.md   operating manual and safety rules for the agent
.claude/skills/         one skill per task (also reachable as skills/)
.claude/commands/       /onboard /discover /tailor /tick
profile/                your details (templates only in git)
cv/                     CV design system, ATS check, tailoring
jobs/                   discovery, scoring, routing, apply driver, tracker tools
letters/                cover-letter guide and example
data/                   tracker template (your data stays local)
```
