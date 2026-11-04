#!/usr/bin/env python3
"""Fast LinkedIn freshness sweep (public guest endpoint, no sign-in). Titles only; read JDs with details.py or tailor.mjs.
Usage: python3 jobs/li_guest.py [r3600|r86400|r604800]   (posted in the last hour / day / week; default r86400)
Pick the window from the gap since the last sweep; sweeps under ~15 minutes apart find nothing new.
Prints only ids not already in the tracker or the seen-ids file, and remembers them."""
import json, os, re, sys, time
from urllib.parse import quote
sys.path.insert(0, os.path.dirname(__file__))
import config as C, scrape

WIN = sys.argv[1] if len(sys.argv) > 1 else "r86400"
seen_p = os.path.join(C.DISC, "li_seen_ids.json")
seen = set(json.load(open(seen_p))) if os.path.exists(seen_p) else set()
if os.path.exists(C.APPS_CSV):
    seen |= set(re.findall(r"(?<!\d)(\d{9,11})(?!\d)", open(C.APPS_CSV, encoding="utf-8", errors="ignore").read()))
new = {}
for kw in C.TITLES:
    url = (f"https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords={quote(kw)}"
           f"&location={quote(C.LI_LOCATION)}&f_TPR={WIN}&start=0")
    body = scrape.get(url)
    parts = re.split(r'data-entity-urn="urn:li:jobPosting:(\d+)"', body or "")
    for i in range(1, len(parts), 2):
        jid, blk = parts[i], parts[i + 1]
        t = re.search(r'base-search-card__title">\s*(.*?)\s*</h3>', blk, re.S)
        c = re.search(r'base-search-card__subtitle">\s*(?:<a[^>]*>)?\s*(.*?)\s*(?:</a>)?\s*</h4>', blk, re.S)
        l = re.search(r'job-search-card__location">\s*(.*?)\s*</span>', blk, re.S)
        if jid not in seen:
            new.setdefault(jid, {"title": scrape.strip(t.group(1)) if t else "?", "company": scrape.strip(c.group(1)) if c else "",
                                 "loc": scrape.strip(l.group(1)) if l else "", "kw": kw})
    time.sleep(1.5)
for jid, c in new.items():
    flag = "" if C.TITLE_INCLUDE.search(c["title"]) and not C.TITLE_EXCLUDE.search(c["title"]) else "  (title filter: out)"
    print(f'{jid} | {c["title"][:60]} | {c["company"][:30]} | {c["loc"][:28]}{flag}')
print(len(new), "new ids")
json.dump(sorted(seen | set(new)), open(seen_p, "w"))
