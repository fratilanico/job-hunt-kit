#!/usr/bin/env python3
"""Regenerate data/NEEDS-USER.md from the tracker: everything only the user can finish, grouped by what it needs.
Usage: python3 jobs/needs_user.py   (today's rows first, then the full open backlog)"""
import csv, datetime, os, re, sys
sys.path.insert(0, os.path.dirname(__file__))
import config as C

D = datetime.date.today().isoformat()
rows = list(csv.reader(open(C.APPS_CSV, encoding="utf-8")))[1:] if os.path.exists(C.APPS_CSV) else []
open_rows = [r for r in rows if len(r) > 7 and r[5].startswith(("needs-user", "retry", "deferred"))]
GROUPS = [("Captcha: open the link, the form is described in the note (two minutes each)", r"captcha"),
          ("Account or sign-in needed (Workday, SuccessFactors, Oracle, board sign-ins)", r"account|login|signin|workday|successfactors|oracle|taleo|icims"),
          ("A question only you can answer (or a legal declaration / signature)", r"question|declaration|signature|nda"),
          ("Your review-first companies or a cap / floor override", r"review|cap|floor|decision"),
          ("Retries and deferred", r"^retry|^deferred"), ("Other", r".")]
def group(r):
    for name, rx in GROUPS:
        if re.search(rx, r[5]): return name
line = lambda r: f"- [ ] {r[2]}, {r[1]}: {r[4]}\n  {r[0]} `{r[5]}` {r[7][:200]}"
out = [f"# Needs you ({D})", "", f"{len(open_rows)} open. Each one is blocked by something Claude must not do for you (captcha, password, a declaration) or by a rule you set.", "",
       f"## New today ({sum(1 for r in open_rows if r[6] == D)})", ""] + [line(r) for r in open_rows if r[6] == D] + [""]
for name, _ in GROUPS:
    g = [r for r in open_rows if group(r) == name]
    if g: out += [f"## {name} ({len(g)})", ""] + [line(r) for r in g] + [""]
open(os.path.join(C.DATA, "NEEDS-USER.md"), "w").write("\n".join(out))
print(f"{len(open_rows)} open -> data/NEEDS-USER.md")
