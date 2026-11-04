#!/usr/bin/env python3
"""Detail stage: fetch descriptions + apply routes for title-matched rows. Resumable (keeps descriptions already fetched).
Usage: python3 jobs/details.py   (reads data/discovery/jobs_list.json, writes jobs.json)
Reed: 6 workers. LinkedIn guest: 1 worker, 2.5 s apart (it 429s otherwise). A long pause on one row is backoff, not a hang."""
import json, os, sys, time, threading
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(__file__))
import config as C, scrape

lst = os.path.join(C.DISC, "jobs_list.json"); full = os.path.join(C.DISC, "jobs.json")
jobs = json.load(open(lst))
have = {(j["source"], j["id"]): j for j in json.load(open(full))} if os.path.exists(full) else {}
for j in jobs:
    h = have.get((j["source"], j["id"]))
    if h and h.get("description"):
        j.update({k: h[k] for k in ("description", "apply_url", "easy_apply", "seniority", "employment_type", "rate_text") if k in h})
todo = [j for j in jobs if not j.get("description") and C.TITLE_INCLUDE.search(j["title"]) and not C.TITLE_EXCLUDE.search(j["title"])
        and not (C.GEO_BAD.search(j.get("location", "")) and not C.GEO_OK.search(j.get("location", ""))) and not C.company_blocked(j.get("company"))]
reed = [j for j in todo if j["source"] == "reed"]; li = [j for j in todo if j["source"] == "linkedin"]
print(f"details todo: reed {len(reed)}, linkedin {len(li)} (of {len(jobs)})", flush=True)
lock = threading.Lock(); done = [0]
def save():
    json.dump(jobs, open(full + ".tmp", "w"), indent=1); os.replace(full + ".tmp", full)
def one(j):
    try: scrape.SOURCES[j["source"]][1](j)
    except Exception as e: j["err"] = str(e)
    with lock:
        done[0] += 1
        if done[0] % 25 == 0: save(); print("detail", done[0], "/", len(todo), flush=True)
with ThreadPoolExecutor(6) as ex:
    list(ex.map(one, reed))
save()
for j in li:
    one(j); time.sleep(2.5)
save(); print("DETAILS DONE", flush=True)
