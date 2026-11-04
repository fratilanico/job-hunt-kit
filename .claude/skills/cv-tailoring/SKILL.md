---
name: cv-tailoring
description: Maintain the user's base CV and role-family variants with the CV design system (5 themes, ATS check). Use when editing the base CV, changing theme or accent, building the 2-3 variants used for one-click boards, or fixing a CV that failed the ATS check. For per-job tailoring before an employer-ATS application use cv-tailor-per-job.
---

# CV tailoring (base CV and variants)

Read `cv/README.md` first: rules, themes, ATS check.

## Files

- `profile/cv-master.yaml`: every proof point (the pool). Facts only the user confirmed.
- `profile/cv.yaml`: the base CV, cut from the master.
- `cv/out/cv-<family>.pdf`: role-family variants for one-click boards, listed in `profile.yaml` `cv.variants`.

## Edit loop (every time)

1. Edit YAML (never the PDF). Keep facts identical to the master; only selection, order and wording change.
2. `node cv/voice-lint.mjs profile/cv.yaml` until clean.
3. `node cv/build.mjs --png` (theme from the profile). The ATS check must pass.
4. **Look at it**: Read the PDF and `-p1.png`. Check: nothing clipped, headings not stranded at a page foot,
   dates aligned, no ragged grid, last page not nearly empty. Fix and rebuild.
5. Show the user the PDF when they are present. A CV goes out only after they have seen one built from this content.

## Theme choice

`node cv/build.mjs --recommend "<title>" --seniority <level>` explains the pick. Senior and director roles get the
calm variant (accent only on rules and headings). Offer `--bw` for anything that may be printed. Custom accent:
`--accent "#hex"`; check contrast in the PNG.

## Role-family variants (for LinkedIn Easy Apply and other stored-CV boards)

Boards like LinkedIn Easy Apply send a stored CV, so per-job rebuilds don't apply there. Build 2-3 variants for the
user's main title families (headline, summary and skill-box names tuned to each family, same facts):
`node cv/build.mjs --content profile/cv-<family>.yaml --out cv/out/cv-<family>.pdf`.
The user uploads them to each board. When picking a stored CV on a board, choose by exact filename and upload date,
never by position (lists are ordered by last use).

## When the ATS check fails

| Failure | Fix |
|---|---|
| pages exceed limit / overflow | cut the weakest bullets, merge old roles into one line, drop tags; don't shrink fonts |
| heading missing from text | the heading text is probably empty or renamed in YAML; check `*_title` |
| skill card body separated | keep skill cards as stacked rows (base.css does); don't reintroduce side-by-side grids |
| letter-spaced text | reduce `--label-tracking` / `--name-tracking` in the theme to 0.5px or less |
| image in PDF | a CSS effect rasterised (box-shadow glow, filter, gradient text); remove it from the theme |
| em dash | replace in the YAML |
| fonts not embedded | use a system font stack from the existing themes |
