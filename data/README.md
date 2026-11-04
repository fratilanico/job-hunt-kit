# data/

Everything in here is personal and git-ignored except this file and the template.

- `applications.csv`: the tracker. Create it once with `cp data/applications.template.csv data/applications.csv`.
- `discovery/`: output of `jobs/discover.sh` (job lists, descriptions, shortlist, queue).
- `batches/`: one CSV per worker or per session, merged into the tracker by `jobs/merge_batches.py`.
- `NEEDS-USER.md`: generated list of applications only you can finish (captcha, account, a question only you can answer).
- `handoff.md`: rolling brief written at the end of every session or tick.
