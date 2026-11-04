---
name: job-triage-and-routing
description: Decide which discovered jobs to apply to and how. Applies the user's floors, geography, scope, company cap and dedupe rules, reads the JD for hard requirements, and routes each job to a lane (headless ATS, browser, captcha batch, needs-user). Use after discovery and before any application.
---

# Triage and routing

`python3 jobs/score.py && python3 jobs/routes.py` does the mechanical part. Your job is the judgement the scripts
can't make, before a single CV is built or form opened.

## Per job, in this order

1. **Dedupe** (always, before anything else):
   `printf '<url or id>|<company>|<title>\n' | python3 jobs/dedupe.py`.
   - `SEEN-ID` or `SEEN-COMPANY+TITLE`: stop, log nothing new (or log `skipped-duplicate` naming the original row).
   - `CAP n`: at the company cap. Stop.
   Why three checks: reposts get new ids and slugs, one requisition appears on several boards and agencies, and
   browser-lane rows are logged under the ATS URL, so an id or URL match alone misses duplicates. Also grep the
   tracker for the company by parsed column, not a fuzzy grep. Count the cap only from rows whose status is exactly
   `submitted`.
2. **Company cap at the end client.** Parent and sister brands, an agency fronting a client, several agencies on one
   client role: they all count toward the same cap. Apply through one agency only per end-client role.
3. **Pay floor.** Check every pay source before opening a form: the board chip, the ATS sidebar or compensation block,
   the JD text, JSON-LD `baseSalary`. Units lie (per month vs per day; hourly converts at ~7.5 h/day). A band whose
   top is under the floor is a skip. Unknown pay is fine if `pay.unknown_pay_ok`. A required salary dropdown whose
   top option is under the floor: `skipped-salary`, never pick it.
4. **Geography and language.** Print the location and read it; "United Kingdom" tags on a country variant, "(m/w/d)",
   "CDI", a non-English JD, US-only remote: `skipped-geo` / `skipped-language`. Multi-country reqs: only the
   requisition for the user's country.
5. **Scope and hard requirements.** Read past the company blurb into the requirements. Titles lie. Legitimate skips:
   a stated degree they lack, N+ years their timeline doesn't support, clearance they don't hold, a named tool stack
   they can't use tomorrow, a professional qualification, another language, on-site only when they said never on-site.
   Don't skip for soft preferences.
6. **Default skips**: talent pools / "not a live vacancy", marketplace stubs (blank company, "up to £X" titles),
   gig-work data-labelling ads, internal-only jobs, `industries_out`, `companies_avoid`.
7. **Review-first companies** (`companies_review_first`) and any cap or floor override go to the user as a decision.
   One yes covers one row.

## Lanes (set by `routes.py`, ordered captcha-free first)

| Lane | What | How it is applied |
|---|---|---|
| `headless` | Ashby, most Greenhouse, Teamtailor, Lever, Recruitee, Pinpoint, aplitrak, Screenloop, Loxo, simple forms | `skills/apply-ats` (driver), in `data/batches/<date>-w*.json` |
| `browser` | LinkedIn Easy Apply, Reed, TotalJobs, Indeed, CV-Library, unresolved LinkedIn | `skills/apply-browser-extension` in the user's signed-in Chrome |
| `captcha-gated` | SmartRecruiters, Workable, BambooHR, JazzHR, Zoho, and every board where the driver met a captcha before (`data/captcha_hosts.txt`) | run while the user is at the computer: the driver opens a visible window and waits for them; else `needs-user-captcha` |
| `needs-user` | Workday, SuccessFactors, Taleo, iCIMS, Oracle, Phenom, Eightfold, Avature (accounts); review-first companies | listed in `data/NEEDS-USER.md` |
| `skip-cap` | over the company cap | nothing |

Before parking an account-gated or captcha-gated row, search the other boards for the same role: a recruiter repost,
a Greenhouse / Ashby URL or an agency mail-apply link often routes around it.

## Log every decision

Every triaged row gets a tracker row (skips included), or it resurfaces next run. Statuses: see
`skills/tracker-and-handoff`.
