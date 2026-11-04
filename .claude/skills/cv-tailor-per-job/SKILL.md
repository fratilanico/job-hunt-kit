---
name: cv-tailor-per-job
description: Build a CV tailored to one job description before every application that is NOT a one-click board apply (employer ATS such as Greenhouse, Ashby, Lever, Teamtailor, Workday, and direct email applications). Extracts the JD's must-haves and vocabulary, rebuilds headline, summary, skill boxes and proof order from the master CV only, lints voice and facts, renders, runs the ATS check, and writes a tailoring report with gaps.
---

# Per-job CV tailoring

One-click board applies (LinkedIn Easy Apply etc.) use the 2-3 role-family variants instead (`skills/cv-tailoring`).
Everything else gets this.

## 1. Workspace

```
node cv/tailor.mjs init --company "<Company>" --role "<exact title>" --jd-url <url>
#   or --jd-file path / --jd-text "..."
```
Creates `out/<company>-<role>/` with `jd.txt`, `jd-analysis.yaml` (to fill) and `cv.yaml` (copy of the base CV).
Greenhouse, Ashby, Lever and LinkedIn URLs are read through their public APIs. If `jd.txt` is thin (the script warns),
read the posting in the browser and paste the text in.

## 2. Analyse the JD (fill `jd-analysis.yaml`)

- `role_title`: their exact title. `seniority`, `domain`.
- `must_haves`: the top 6-8 requirements in their words. For each, `proof:` = where the tailored CV proves it
  (role + bullet), or `gap: true` with a `note`. Never leave a placeholder; the lint fails on unmapped must-haves.
- `nice_to_haves`, `vocabulary` (their words for the work), `headline_family`.

## 3. Rebuild `cv.yaml` from the master pool (`profile/cv-master.yaml`)

- **Headline**: their role-title family, as close to their title as is honest for the user's actual experience
  (a real title they held or a plain description of the work; never a title they never had at that level).
- **Summary**: two short paragraphs that answer the must-haves in order, using their vocabulary, with the
  strongest numbers.
- **Skill boxes**: rename to their language; keep the content true.
- **Projects and bullets**: reorder and swap from the master pool so the strongest matching proof is on page 1-2.
  Drop what doesn't serve this role. Keep employers, dates, titles exactly as in the master.
- **Only facts present in the master.** Never invent metrics, employers, tools, dates or responsibilities. If a
  must-have has no proof, it stays a gap in the report; don't paper over it with vague wording.

## 4. Lint, render, check

```
node cv/tailor.mjs lint  out/<company>-<role>      # voice (em dashes, slop, vanity counts) + facts vs master + unmapped must-haves
node cv/tailor.mjs build out/<company>-<role>      # theme from the profile (or recommended), ATS check, report
```
The fact check fails on any number, employer, date, role, project or education line not in the master.
Output: `out/<company>-<role>/<First>-<Last>-CV.pdf` (neutral filename, never the company) and
`tailoring-report.md` (must-have -> proof map, gaps, what changed, warnings).

Read the PDF before using it. Fix anything that looks off and rebuild.

## 5. Review policy

`build` prints `USER REVIEW REQUIRED` or not. Default: the user reviews the first 5 tailored CVs, then every 5th
(sampled), and always when `autonomy` is not `submit_within_rules`. When review is required, show the PDF and the
report's gaps and wait for an OK before the application uses it.

## 6. Use it

Upload `out/<company>-<role>/<First>-<Last>-CV.pdf` in the apply plan. Record in the tracker note which CV was sent
(`cv tailored out/<dir>`), so a later question about "which CV did they get" has an answer.
