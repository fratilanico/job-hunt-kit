#!/usr/bin/env python3
"""Build the apply queue: shortlist.json -> queue_today.json + per-worker batch files.
Usage: python3 jobs/routes.py [--workers 3] [--per 8]

Each job gets a resolved apply URL, a vendor and a lane:
  headless       captcha-free employer ATS (Ashby, most Greenhouse, Teamtailor, Lever, Recruitee, Pinpoint, aplitrak...)
                 -> batches/<date>-w<k>.json for the headless driver (jobs/apply.mjs)
  browser        board flows that need the user's signed-in browser (LinkedIn Easy Apply, Reed, TotalJobs, Indeed)
  captcha-gated  vendors/boards known to show a captcha -> data/discovery/captcha_batch.json, run only while the
                 user is at the computer (driver opens a visible window and waits for them), else needs-user-captcha
  needs-user     account-gated portals (Workday, SuccessFactors, Taleo, iCIMS, Oracle...) and companies_review_first
Order inside every lane: captcha-free vendors first, then score. The per-company cap is applied across ALL lanes."""
import csv, datetime, json, os, re, subprocess, sys
from collections import Counter
from urllib.parse import urlparse, parse_qs, unquote
sys.path.insert(0, os.path.dirname(__file__))
import config as C

W = int(sys.argv[sys.argv.index("--workers") + 1]) if "--workers" in sys.argv else 3
PER = int(sys.argv[sys.argv.index("--per") + 1]) if "--per" in sys.argv else 8
CAPTCHA_FREE_ORDER = ["ashby", "greenhouse", "teamtailor", "lever", "recruitee", "pinpoint", "aplitrak", "screenloop", "loxo", "other"]
ACCOUNT_GATED = ("workday", "successfactors", "taleo", "icims", "oracle", "phenom", "eightfold", "avature", "jobvite-account")
CAPTCHA_VENDORS = ("smartrecruiters", "workable", "bamboohr", "zoho", "jazzhr", "breezy-captcha")

def vendor(u):
    h, p = urlparse(u).netloc.lower(), urlparse(u).path.lower()
    for key, name in (("greenhouse.io", "greenhouse"), ("ashbyhq.com", "ashby"), ("lever.co", "lever"), ("teamtailor.com", "teamtailor"),
                      ("recruitee.com", "recruitee"), ("pinpointhq.com", "pinpoint"), ("workable.com", "workable"), ("bamboohr.com", "bamboohr"),
                      ("myworkday", "workday"), ("successfactors", "successfactors"), ("sapsf", "successfactors"), ("smartrecruiters", "smartrecruiters"),
                      ("taleo", "taleo"), ("icims", "icims"), ("oraclecloud", "oracle"), ("phenom", "phenom"), ("eightfold", "eightfold"),
                      ("avature", "avature"), ("zohorecruit", "zoho"), ("applytojob.com", "jazzhr"), ("aplitrak", "aplitrak"), ("screenloop", "screenloop"),
                      ("loxo.co", "loxo"), ("linkedin.com", "easyapply"), ("reed.co.uk", "reed"), ("totaljobs.com", "totaljobs"), ("cwjobs", "totaljobs"),
                      ("indeed.", "indeed"), ("cv-library", "cvlibrary")):
        if key in h:
            return name
    return "other"

def final_url(u):
    """Unwrap LinkedIn's externalApply ?url= wrapper and follow redirects to the landing URL."""
    try:
        q = parse_qs(urlparse(u).query).get("url")
        if q: u = unquote(q[0])
        r = subprocess.run(["curl", "-sIL", "--max-time", "20", "-A", C.UA, "-o", "/dev/null", "-w", "%{url_effective}", u], capture_output=True, text=True)
        return r.stdout.strip() or u
    except Exception:
        return u

def norm(t): return re.sub(r"[^a-z0-9 ]", " ", (t or "").lower())
def toks(t): return {w for w in norm(t).split() if len(w) > 2 and w not in ("the", "and", "for", "senior", "lead", "ltd", "limited", "group", "inc", "plc")}
def sim(a, b):
    A, B = toks(a), toks(b); return len(A & B) / max(1, len(A | B))

boards = json.load(open(os.path.join(C.DISC, "boards_all.json"))) if os.path.exists(os.path.join(C.DISC, "boards_all.json")) else []
by_comp = {}
for r in boards:
    if r.get("source", "").split(":")[0] in ("greenhouse", "ashby", "lever"):
        by_comp.setdefault(norm(r["company"]).strip(), []).append(r)
cache_p = os.path.join(C.DISC, "company_boards.json")
cache = json.load(open(cache_p)) if os.path.exists(cache_p) else {}

def probe_board(company):
    """Try the company's own Greenhouse / Ashby / Lever board by guessed slug (public APIs, cached)."""
    key = norm(company).strip()
    if key in cache: return cache[key]
    base = re.sub(r"\b(uk|plc|ltd|limited|inc|group|technologies|technology|consulting)\b", "", key).strip()
    slugs = list(dict.fromkeys(s for c in (base, key) if c for s in (c.replace(" ", ""), c.replace(" ", "-"), c.split(" ")[0])))
    found = []
    for slug in slugs:
        for name, url in (("greenhouse", f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs"), ("ashby", f"https://api.ashbyhq.com/posting-api/job-board/{slug}"),
                          ("lever", f"https://api.lever.co/v0/postings/{slug}?mode=json")):
            try: d = json.loads(subprocess.run(["curl", "-s", "--max-time", "15", "-A", C.UA, url], capture_output=True, text=True).stdout)
            except Exception: continue
            rows = d.get("jobs") if isinstance(d, dict) else d if isinstance(d, list) else None
            for x in rows or []:
                u = x.get("absolute_url") or x.get("jobUrl") or x.get("hostedUrl") or ""
                loc = (x.get("location") or {}).get("name", "") if isinstance(x.get("location"), dict) else str(x.get("location") or (x.get("categories") or {}).get("location", ""))
                if u: found.append({"title": x.get("title") or x.get("text") or "", "url": u, "location": loc})
        if found: break
    cache[key] = found; json.dump(cache, open(cache_p, "w"))
    return found

def resolve_board(company, title):
    cands = by_comp.get(norm(company).strip()) or probe_board(company)
    ok = [r for r in cands if sim(r["title"], title) >= 0.7 and (not r.get("location") or C.GEO_OK.search(r["location"]))]
    return max(ok, key=lambda r: sim(r["title"], title))["url"] if ok else None

def captcha_known():
    p = os.path.join(C.DATA, "captcha_hosts.txt")   # apply.mjs appends hosts/boards where it met a captcha
    extra = C.get("routing.captcha_boards", []) or []
    return {l.strip().lower() for l in (open(p).read().splitlines() if os.path.exists(p) else []) + extra if l.strip()}

def main():
    rows = list(csv.DictReader(open(C.APPS_CSV, encoding="utf-8", errors="ignore"))) if os.path.exists(C.APPS_CSV) else []
    done_urls = {re.sub(r"/application$", "", r["url"].rstrip("/").lower()) for r in rows}
    per_company = Counter(C.ckey(r["company"]) for r in rows if r["status"].strip() == "submitted")
    done_titles = [(C.ckey(r["company"]), r["title"]) for r in rows if r["status"].startswith(("submitted", "skipped", "closed", "needs", "already"))]
    shortlist = json.load(open(os.path.join(C.DISC, "shortlist.json")))
    gated = captcha_known()
    queue, qcomp = [], Counter()
    for j in shortlist:
        comp = j["company"].strip(); ck = C.ckey(comp)
        if any(c == ck and sim(t, j["title"]) >= 0.75 for c, t in done_titles): continue
        item = {k: j.get(k) for k in ("title", "company", "location", "score", "source", "rate", "contract")}
        item["post_url"] = j["url"]; item["desc"] = (j.get("description") or "")[:6000]
        if j["source"] == "linkedin" and j.get("easy_apply"):
            item["apply_url"], item["vendor"] = j["url"], "easyapply"
        elif j["source"] == "linkedin" and j.get("apply_url") and "linkedin.com" not in j["apply_url"]:
            item["apply_url"] = final_url(j["apply_url"]); item["vendor"] = vendor(item["apply_url"])
        elif j["source"] == "linkedin":
            u = resolve_board(comp, j["title"])
            item["apply_url"], item["vendor"] = (u, vendor(u)) if u else (j["url"], "unresolved")  # employer-site apply hidden behind sign-in: resolve in the browser lane
        else:
            u = j.get("apply_url") or j["url"]
            item["apply_url"] = final_url(u) if u != j["url"] else u; item["vendor"] = vendor(item["apply_url"])
        if re.sub(r"/application$", "", item["apply_url"].rstrip("/").lower()) in done_urls: continue
        host = urlparse(item["apply_url"]).netloc.lower()
        board = (re.search(r"(?:for=|greenhouse\.io/|ashbyhq\.com/|lever\.co/)([\w.-]+)", item["apply_url"]) or [None, ""])[1].lower()
        if per_company[ck] + qcomp[ck] >= C.CAP: item["lane"] = "skip-cap"
        elif j.get("review_first"): item["lane"] = "needs-user"; item["why"] = "companies_review_first"
        elif item["vendor"] in ACCOUNT_GATED: item["lane"] = "needs-user"; item["why"] = f"account-{item['vendor']}"
        elif item["vendor"] in CAPTCHA_VENDORS or host in gated or (board and board in gated): item["lane"] = "captcha-gated"
        elif item["vendor"] in ("easyapply", "reed", "totaljobs", "indeed", "cvlibrary", "unresolved"): item["lane"] = "browser"
        else: item["lane"] = "headless"
        if item["lane"] != "skip-cap": qcomp[ck] += 1
        queue.append(item)
    rank = lambda q: (CAPTCHA_FREE_ORDER.index(q["vendor"]) if q["vendor"] in CAPTCHA_FREE_ORDER else 99, -q["score"])
    queue.sort(key=lambda q: (["headless", "browser", "captcha-gated", "needs-user", "skip-cap"].index(q["lane"]), rank(q)))
    json.dump(queue, open(os.path.join(C.DISC, "queue_today.json"), "w"), indent=1)
    json.dump([q for q in queue if q["lane"] == "captcha-gated"], open(os.path.join(C.DISC, "captcha_batch.json"), "w"), indent=1)
    headless = [q for q in queue if q["lane"] == "headless"][: W * PER]
    day = datetime.date.today().isoformat(); bdir = os.path.join(C.DATA, "batches")
    for w in range(W):
        json.dump(headless[w::W], open(os.path.join(bdir, f"{day}-w{w}.json"), "w"), indent=1)
    print("queue", len(queue), dict(Counter(q["lane"] for q in queue)), dict(Counter(q["vendor"] for q in queue)))
    print("batches", {w: len(headless[w::W]) for w in range(W)}, "->", f"data/batches/{day}-w*.json")
    for q in queue[:50]:
        print(f'{q["lane"][:13]:13s} {q["vendor"][:12]:12s} {q["score"]:>3} | {q["title"][:46]:46s} | {q["company"][:22]:22s} | {q["apply_url"][:60]}')

if __name__ == "__main__":
    main()
