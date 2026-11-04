# CV design system

One HTML structure, five themes, every visual decision in a token file. The content (YAML) never changes between
themes, so switching theme can never lose or reorder text.

```
cv/
  base.css            layout only (A4 pages, cards, timeline, footer grid); no colours
  themes/<name>.css   tokens: colours, fonts, borders, glyphs, spacing  (terminal, editorial, boardroom, studio, clarity)
  themes/<name>.bw.css generated print-safe black-and-white override (node cv/build.mjs --emit-bw)
  themes/previews/    page 1 of the sample CV in every theme (+ all-themes.png), all passing the ATS check
  themes.mjs          theme catalogue + recommendTheme(role, seniority)
  build.mjs           YAML -> paginated HTML -> PDF (headless Chrome) -> ATS check
  ats-check.mjs       fails the build if the PDF is not ATS-safe
  tailor.mjs          per-job tailoring workspace, lint, build, report
  voice-lint.mjs      em dashes, slop phrases, vanity counts
  sample-content.yaml placeholder content showing the schema
```

## Themes

| Theme | Look | For |
|---|---|---|
| `terminal` | dark ground, green accent, monospace labels | engineering, AI, data, technical |
| `editorial` | white, near-black ink, oxblood accent, serif display + clean sans | communications, marketing, content, PR, director-level comms |
| `boardroom` | white, navy + slate, thin rules, generous space | finance, consulting, legal, operations, executive |
| `studio` | cobalt header band, geometric sans, rounded cards | product, design, creative, startup |
| `clarity` | light, high contrast, calm teal, larger type | healthcare, public sector, education, HR, people |

Fonts are system font stacks (Helvetica / Arial, Georgia / Palatino / Iowan, Avenir, Menlo, Segoe UI with
open-source fallbacks), so rendering is offline and deterministic. Chrome embeds the subsets in the PDF.

```
node cv/build.mjs                                   # profile/cv.yaml, theme from the profile
node cv/build.mjs --theme boardroom --bw --png      # black-and-white variant + page-1 PNG
node cv/build.mjs --accent "#1d4ed8"                # custom accent
node cv/build.mjs --role "Head of People" --seniority director   # theme + calm variant chosen for you
node cv/build.mjs --recommend "Product Designer"
node cv/build.mjs --previews --content profile/cv.yaml --out-dir out/theme-previews --role "<title>"
```

## Pagination ("fills each page, never overflows")

Content is cut into atoms (header, paragraphs, skill grid, each bullet, each job header...). A paginator places them
into fixed A4 pages in order, keeps headings with what follows, splits a long job or project across pages, and adds
a small running header on pages 2+. Anything that still doesn't fit is reported, and the ATS check fails. The build
prints each page's fill (`fill=0.97/0.94/0.15`); a last page under a third full is a hint to cut or add.

## ATS check (runs after every build)

`cv/ats-check.mjs` fails the build if:
- the page count exceeds `cv.max_pages` (default 3) or any page overflowed;
- `pdftotext -layout` lacks the name, email, phone, any section heading, or any job company / role / date;
- reading order puts a section's content before its heading, or headings out of order;
- a skill card's heading is not followed by its own body in reading order (side-by-side grids interleave, which is
  why skill cards are stacked rows);
- letter-spacing makes words extract as single letters ("S E N I O R");
- the PDF contains any image (text must be text; glow effects rasterise, so themes don't use them);
- there is an em dash; any font is not embedded (`pdffonts`); the file is over 2 MB.
Requires poppler (`pdfinfo`, `pdftotext`, `pdffonts`, `pdfimages`).

## CV writing rules

- **No em dashes.** Commas, colons, full stops.
- **No AI-slop phrasing**: proven track record, results-driven, leveraged, spearheaded, passionate, dynamic, robust,
  seamless, cutting-edge, synergy, "responsible for"... (`node cv/voice-lint.mjs <file>` has the full list).
- **No vanity counts.** "1,000 automated tests", commit counts, token counts, "40 microservices" say nothing to a
  hiring manager. Say what changed for the business: time saved, cost, error rate, revenue, adoption, risk removed.
- **Outcomes over activity.** "Cut month-end close from 9 days to 5" beats "Responsible for month-end close".
  Bold lead-in of two or three words, then the result, then how. Two lines maximum per bullet.
- **Numbers only when true**, and approximate honestly ("about 25%"). Never invent precision.
- **Conventional and human**: no arrows in text, no metric rails, no "ATS" or "keywords" sections, no self-graded
  claims. Standard headings (Profile / Summary, Skills, Experience, Education).
- **Searchable headline** that matches the role family they apply for; never a made-up title.
- **Tailor per JD** for every employer-ATS application (`skills/cv-tailor-per-job`): their words for the work,
  the strongest matching proof on page 1.
- **Render and look at the PDF after every edit.** A clean build log is not proof. Read the PDF / page-1 PNG and check
  alignment, wrapping, page breaks, stranded headings. A CV that looks off undoes its content.
- **Filename is neutral**: `First-Last-CV.pdf`, never the company name.
- When a CV changes, re-upload it on every board that stores a CV (LinkedIn, Reed, Indeed, TotalJobs, CV-Library):
  boards send the last uploaded copy by default.

## Content schema

See `sample-content.yaml`. Inline markup: `**Lead:**` bold lead-in, `[[94%]]` accent highlight (use sparingly).
Sections: `summary`, `skills` (+ `approach`, `tags`), `projects`, `experience` (with optional `subroles`), free-form
`sections`, `footer` (education / certifications / languages). Section titles can be renamed with `*_title`.
