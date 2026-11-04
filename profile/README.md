# profile/

Your personal files. Everything here except the templates and this README is git-ignored.

| File | What | Made by |
|---|---|---|
| `profile.yaml` | contact, location and rights, floors, targets, screener answers, autonomy | onboarding, from `profile.example.yaml` |
| `cv-master.yaml` | every fact and proof point you have, more than fits on a CV | onboarding, from your CV and `cv-source.example.md` |
| `cv.yaml` | your base CV content (same structure as `cv/sample-content.yaml`) | onboarding |
| `voice-sample.md` | a few paragraphs you wrote yourself, for cover-letter voice | you |
| your old CV (PDF/DOCX) | dropped here so the agent can read it | you |

Easiest path: run `/onboard` (or tell Codex "set me up") and let the agent fill these in with you.
To edit by hand, copy `profile.example.yaml` to `profile.yaml`; every field is commented.
Another location: set `JOBKIT_PROFILE=/path/to/profile.yaml`.
