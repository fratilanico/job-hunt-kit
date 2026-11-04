#!/usr/bin/env python3
"""Check candidates against the tracker BEFORE building a CV or opening a form.
Usage: printf '<id or url>|<company>|<title>\n...' | python3 jobs/dedupe.py
Output per line: NEW | SEEN-ID <row>:<status> | SEEN-COMPANY+TITLE | CAP n (n submitted at this company; cap from profile)
Why all three: reposts get new ids, the same req shows on several boards, and browser-lane rows are logged under the
ATS URL, so an id or URL match alone misses duplicates. The cap counts only rows whose status is exactly 'submitted'."""
import csv, os, re, sys
sys.path.insert(0, os.path.dirname(__file__))
import config as C

rows = list(csv.reader(open(C.APPS_CSV, encoding="utf-8")))[1:] if os.path.exists(C.APPS_CSV) else []
def norm(s): return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()
IDS, SUB, TITLES = {}, {}, set()
for r in rows:
    if len(r) < 7: continue
    for m in re.findall(r"(?<!\d)(\d{7,12})(?!\d)", " ".join(r)):   # ids anywhere in the row, notes included
        IDS.setdefault(m, (r[0], r[5]))
    for m in re.findall(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", " ".join(r).lower()):  # Ashby / Lever uuids
        IDS.setdefault(m, (r[0], r[5]))
    c = C.ckey(r[2])
    if r[5].strip() == "submitted": SUB[c] = SUB.get(c, 0) + 1
    TITLES.add((c, norm(r[1])))

def check(ref, company, title):
    out = []
    for i in re.findall(r"(?<!\d)\d{7,12}(?!\d)|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", (ref or "").lower()):
        if i in IDS: out.append(f"SEEN-ID {IDS[i][0]}:{IDS[i][1]}")
    c = C.ckey(company)
    if (c, norm(title)) in TITLES: out.append("SEEN-COMPANY+TITLE")
    n = SUB.get(c, 0)
    if n >= C.CAP: out.append(f"CAP {n}")
    elif n: out.append(f"cap {n}/{C.CAP}")
    if C.company_blocked(company): out.append("AVOID")
    return " | ".join(out) or "NEW"

if __name__ == "__main__":
    for line in sys.stdin:
        p = [x.strip() for x in line.strip().split("|")]
        if not p[0] and len(p) < 2: continue
        p += ["", "", ""]
        print(f"{p[1][:24]:24s} {p[2][:40]:40s} -> {check(p[0], p[1], p[2])}")
