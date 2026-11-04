#!/usr/bin/env python3
"""Merge batch CSVs into data/applications.csv with sequential ids (A1, A2, ...).
Usage: python3 jobs/merge_batches.py [batch.csv ...]     (default: every data/batches/*.csv not yet merged)
Batch rows have NO header and NO id: title,company,vendor,url,status,date,note
Rules: a later 'submitted' or definitive outcome overwrites a deferred / retry / needs-user row for the same URL;
a submitted row is never overwritten. Makes a dated backup first. Merged files are renamed merged-<name>.
Only merge your own batches, and only after every worker on them has finished."""
import csv, datetime, glob, os, re, shutil, sys
sys.path.insert(0, os.path.dirname(__file__))
import config as C

if not os.path.exists(C.APPS_CSV):
    shutil.copy(os.path.join(C.DATA, "applications.template.csv"), C.APPS_CSV)
rows = list(csv.reader(open(C.APPS_CSV, newline="", encoding="utf-8")))
head, body = rows[0], rows[1:]
n = max([int(m.group(1)) for r in body for m in [re.match(r"A(\d+)", r[0] if r else "")] if m] or [0])
have = {r[4].rstrip("/").lower(): r for r in body if len(r) > 4}
files = sys.argv[1:] or sorted(f for f in glob.glob(os.path.join(C.DATA, "batches", "*.csv")) if not os.path.basename(f).startswith("merged-"))
shutil.copy(C.APPS_CSV, C.APPS_CSV + ".bak-" + datetime.datetime.now().strftime("%Y%m%d-%H%M%S"))
added = updated = 0
for f in files:
    for r in csv.reader(open(f, newline="", encoding="utf-8")):
        if not r or r[0] == "title" or len(r) < 6:
            continue
        if re.match(r"A\d+$", r[0]):
            sys.exit(f"{f}: row starts with an id; batch rows are title,company,vendor,url,status,date,note")
        r = (r + [""] * 7)[:7]
        k = r[3].rstrip("/").lower()
        if k in have:
            old = have[k]
            if old[5].strip() != "submitted" and (r[4].startswith("submitted") or not r[4].startswith(("deferred", "retry"))):
                old[5], old[6], old[7] = r[4], r[5], r[6]; updated += 1
            continue
        n += 1; body.append([f"A{n}"] + r); have[k] = body[-1]; added += 1
    shutil.move(f, os.path.join(os.path.dirname(f), "merged-" + datetime.datetime.now().strftime("%H%M%S-") + os.path.basename(f)))
csv.writer(open(C.APPS_CSV, "w", newline="", encoding="utf-8")).writerows([head] + body)
sub = sum(1 for r in body if r[5].strip() == "submitted")
print(f"merged {added} new, updated {updated}; total rows {len(body)}, submitted {sub}, last id A{n}")
for r in body[-3:]:
    print("  ", ",".join(r)[:160])
