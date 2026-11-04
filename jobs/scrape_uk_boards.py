#!/usr/bin/env python3
"""UK boards beyond LinkedIn and Reed: TotalJobs + CWJobs (StepStone stack, preloaded JSON) and Hays.
Usage: python3 jobs/scrape_uk_boards.py   -> data/discovery/jobs_uk_boards.json (same row schema as scrape.py)
Listing only. TotalJobs sits behind Akamai: a small budget works, a burst gets a tiny 403 "Access Denied" for a while.
If every query returns 0, the board is walling curl today; use the browser lane (skills/job-discovery) instead."""
import json, os, re, sys, time
from urllib.parse import quote
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(__file__))
import config as C, scrape

def stepstone(site, q, contract, page):
    slug = re.sub(r"[^a-z0-9]+", "-", q.lower()).strip("-")
    url = f"https://www.{site}/jobs{'/contract' if contract else ''}/{slug}/in-{C.BOARD_LOC}?radius=30&page={page + 1}"
    h = scrape.get(url) or ""
    def walk(o):
        if isinstance(o, dict):
            if isinstance(o.get("items"), list) and o["items"] and isinstance(o["items"][0], dict) and "title" in o["items"][0]:
                return o["items"]
            for v in o.values():
                r = walk(v)
                if r: return r
        return None
    items = []
    for m in re.finditer(r'window\.__PRELOADED_STATE__\["[^"]+"\]\s*=\s*', h):
        end = h.find("</script>", m.end())
        try: d = json.loads(h[m.end():end].strip().rstrip(";"))
        except Exception: continue
        items = walk(d) or []
        if items: break
    return [{"source": site.split(".")[0], "id": str(it.get("id")), "title": it.get("title", ""), "company": it.get("companyName", ""),
             "location": it.get("location", ""), "posted": (it.get("datePosted") or "")[:10], "url": (it.get("url") or "").split("?")[0],
             "rate_text": it.get("salary") or "", "remote_flag": it.get("workFromHome") or "", "snippet": it.get("textSnippet") or "",
             "contract": bool(contract), "query": q} for it in items]

def hays(q, page):
    slug = re.sub(r"[^a-z0-9]+", "-", q.lower()).strip("-")
    h = scrape.get(f"https://www.hays.co.uk/job-search/{slug}-jobs-in-{C.BOARD_LOC}?q={quote(q)}&location={quote(C.BOARD_LOC)}&page={page + 1}")
    out = []
    for m in re.finditer(r'<a[^>]+href="(https://www\.hays\.co\.uk/job-detail/[^"]+)"[^>]*>(.*?)</a>', h or "", re.S):
        t = scrape.strip(m.group(2))
        if t and len(t) <= 120:
            out.append({"source": "hays", "id": m.group(1).rstrip("/").split("/")[-1], "title": t, "company": "Hays", "location": C.BOARD_LOC.title(),
                        "posted": "", "url": m.group(1), "rate_text": "", "snippet": "", "contract": True, "query": q})
    return out

def run(kind, q, contract):
    rows = []
    for p in range(2):
        try: r = hays(q, p) if kind == "hays" else stepstone(kind, q, contract, p)
        except Exception as e: print("ERR", kind, q, p, e, flush=True); break
        if not r: break
        rows += r; time.sleep(2.5)
    print(f"{kind:16s} {q:36s} {'contract' if contract else 'all':8s} {len(rows)}", flush=True)
    return rows

if __name__ == "__main__":
    modes = [False] + ([True] if C.WANT_CONTRACT else [])
    jobs = [(k, q, c) for q in C.TITLES for k in ("totaljobs.com", "cwjobs.co.uk") for c in modes]
    if C.WANT_CONTRACT:
        jobs += [("hays", q, True) for q in C.TITLES]
    with ThreadPoolExecutor(2) as ex:
        res = list(ex.map(lambda a: run(*a), jobs))
    seen = {}
    for r in sum(res, []):
        seen.setdefault(r["url"].lower(), r)
    json.dump(list(seen.values()), open(os.path.join(C.DISC, "jobs_uk_boards.json"), "w"), indent=1)
    print("UK BOARDS DONE", len(seen), flush=True)
