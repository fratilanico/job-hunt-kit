---
name: job-discovery
description: Find fresh, relevant job postings for the user across LinkedIn (public guest search), Reed, TotalJobs/CWJobs, Hays, remote-job APIs, employer ATS boards (Greenhouse, Ashby, Lever, Workable), and in-browser sweeps of Indeed and CV-Library. Use for "find jobs", a discovery pass, or before a tick has anything to apply to.
---

# Job discovery

## The pipeline (`jobs/discover.sh`)

| Stage | Script | Output (in `data/discovery/`) |
|---|---|---|
| list | `scrape.py` | `jobs_list.json`: LinkedIn guest search (on-site, remote, contract if wanted) + Reed, one query per `targets.titles` |
| uk boards | `scrape_uk_boards.py` | `jobs_uk_boards.json`: TotalJobs, CWJobs, Hays (contract) |
| details | `details.py` | `jobs.json`: descriptions + apply routes for title-matched rows (resumable) |
| boards | `scrape_boards.py` | `boards.json`: remote APIs + every employer ATS board in the tracker + `targets.company_boards` |
| score | `score.py` | `shortlist.json/.csv`: filtered (title, geo, language, industry, avoid list, pay floor) and scored |
| routes | `routes.py` | `queue_today.json`, `captcha_batch.json`, `data/batches/<date>-w*.json` |

Run it in the background (`jobs/discover.sh > data/discovery/run.log 2>&1 &`) and keep working; it takes 15 to 45
minutes. It refuses to start if another run holds the lock. Fast freshness check between full runs:
`python3 jobs/li_guest.py r3600` (last hour), `r86400` (day), `r604800` (week).

## What works and what doesn't (learned the hard way)

- **Employer ATS boards beat aggregators.** In a long real run every interview came from applications made on the
  employer's own ATS (Ashby, Greenhouse, Teamtailor), none from hundreds of one-click aggregator applies. Spend effort
  on finding employer-direct postings; treat one-click boards as extra volume.
- When a sweep surfaces a company that fits, list its **whole ATS board** (add the slug to `targets.company_boards`).
  It often has roles no keyword search returned.
- **LinkedIn guest endpoint** (`/jobs-guest/jobs/api/seeMoreJobPostings/search`) works with plain curl and no
  session. Throttling shows as HTTP 429, a fixed ~24.6 KB empty shell, or an obfuscated `_0x...` script page:
  back off (the helpers retry with pauses), keep ~1-2 s between calls, don't run sweeps less than ~15 minutes apart.
  Run it from the shell, not from a signed-in tab (inside a tab it returns empty).
- LinkedIn guest job pages mark employer-site applies (`offsite-apply`) but hide the URL behind sign-in. Those rows
  come out `unresolved`; `routes.py` tries to match them to the company's own Greenhouse / Ashby / Lever board, and
  the rest are resolved in the browser lane (open the job signed in, read the Apply link).
- Pick the time window from the gap since the last sweep. Thin filters get padded with old irrelevant ids, so always
  dedupe against the tracker and `li_seen_ids.json` before counting anything as new.
- Rotate keyword families rather than rephrasing; near-identical phrasings return the same ids.
- **Reed**: listing and job pages embed JSON (`__NEXT_DATA__`, `consolidatedJobDetails`), readable without sign-in.
  `python3 jobs/reed_jd.py <id>` prints a JD. Reposts keep the numeric id but change slug and title.
- **TotalJobs / CWJobs** sit behind Akamai: a small budget works (about 8 searches and 10-15 job reads, ~2.5 s apart),
  a burst gets a tiny 403 for minutes to hours. If `scrape_uk_boards.py` returns 0 everywhere, the wall is up: search
  in the browser instead (open a `www.totaljobs.com` search page, then fetch further searches from inside that page;
  job pages only load when reached from a search page).
- **Indeed** blocks curl (Cloudflare). In the user's browser: search `uk.indeed.com/jobs?q=..&l=..&fromage=3`, read
  cards from `a[data-jk]`; the JD is in the `sanitizedJobDescription` JSON string. Budget about 5-8 fetches per
  session; a "Security Check" page means stop Indeed for the session (never try to pass it).
- **CV-Library** also walls curl (403 + "Enable JavaScript"). In the browser, fetch `/<slug>-jobs-in-<city>?posted=3`
  same-origin, ids from `href="/job/(\d{8,10})/"`, sequentially ~1 s apart.
- **Public ATS APIs** for triage without a browser: Greenhouse `boards-api.greenhouse.io/v1/boards/<board>/jobs/<id>?questions=true`
  (lists every question and option), Ashby `api.ashbyhq.com/posting-api/job-board/<org>?includeCompensation=true`,
  Lever `api.lever.co/v0/postings/<org>/<id>`, Workable `apply.workable.com/api/v1/jobs/<shortcode>/form`.
  Ashby pay is often only in the page sidebar, not the API.
- Resolve short links (`grnh.se`, job-ad trackers) with `curl -sL -o /dev/null -w '%{url_effective}'`.
- Time of day matters: weekday mornings carry the fresh postings; late night and weekends are thin.
- We do **not** use LinkedIn's internal signed-in API. It was used once and dropped (terms-of-service and account risk).

## After discovery

Hand over to `skills/job-triage-and-routing`. Show the user the shortlist when they are present; in a scheduled
tick, go straight to triage.
