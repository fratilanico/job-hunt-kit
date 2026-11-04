#!/usr/bin/env python3
"""Employer ATS boards + remote-job APIs. Usage: python3 jobs/scrape_boards.py   -> data/discovery/boards.json + boards_all.json
Employer-direct applications convert to interviews far better than aggregator one-click applies, so this is worth running daily.
Boards swept: profile targets.company_boards, plus every Greenhouse / Ashby / Lever / Workable slug ever seen in the tracker
(the list grows by itself as you apply)."""
import html, json, os, re, subprocess, sys
from urllib.parse import quote
sys.path.insert(0, os.path.dirname(__file__))
import config as C, scrape

def jget(url, method="GET", data=None):
    cmd = ["curl", "-sS", "-L", "--compressed", "--max-time", "40", "-A", C.UA, "-H", "Accept: application/json"]
    if method == "POST":
        cmd += ["-X", "POST", "-H", "Content-Type: application/json", "--data", json.dumps(data or {})]
    r = subprocess.run(cmd + [url], capture_output=True, text=True)
    try: return json.loads(r.stdout)
    except Exception: return None

def row(src, jid, title, company, loc, url, desc="", sal="", posted=""):
    return {"source": src, "id": str(jid), "title": scrape.strip(title), "company": scrape.strip(company), "location": scrape.strip(loc),
            "url": url, "description": scrape.strip(desc)[:20000], "rate_text": sal, "posted": (posted or "")[:10]}

def remotive():
    out = []
    for q in C.TITLES[:6]:
        for j in (jget("https://remotive.com/api/remote-jobs?search=%s&limit=100" % quote(q)) or {}).get("jobs", []):
            out.append(row("remotive", j["id"], j["title"], j["company_name"], j.get("candidate_required_location", ""), j["url"], j.get("description", ""), j.get("salary", ""), j.get("publication_date", "")))
    return out

def himalayas():
    out = []
    for q in C.TITLES[:6]:
        for j in (jget("https://himalayas.app/jobs/api?q=%s&limit=100" % quote(q)) or {}).get("jobs", []):
            out.append(row("himalayas", j.get("guid") or j.get("applicationLink"), j.get("title", ""), j.get("companyName", ""), ", ".join(j.get("locationRestrictions") or ["Worldwide"]), j.get("applicationLink", ""), j.get("description", ""), "", str(j.get("pubDate", ""))))
    return out

def greenhouse(slug):
    d = jget("https://boards-api.greenhouse.io/v1/boards/%s/jobs?content=true" % slug) or {}
    return [row("greenhouse:" + slug, j["id"], j["title"], slug, (j.get("location") or {}).get("name", ""), j["absolute_url"], html.unescape(j.get("content", "")), "", j.get("updated_at", "")) for j in d.get("jobs", [])]
def lever(slug):
    d = jget("https://api.lever.co/v0/postings/%s?mode=json" % slug) or []
    return [row("lever:" + slug, j["id"], j["text"], slug, (j.get("categories") or {}).get("location", ""), j["hostedUrl"], j.get("descriptionPlain", "")) for j in d if isinstance(j, dict)]
def ashby(slug):
    d = jget("https://api.ashbyhq.com/posting-api/job-board/%s?includeCompensation=true" % slug) or {}
    return [row("ashby:" + slug, j["id"], j["title"], slug, (j.get("location") or "") + (" (remote)" if j.get("isRemote") else ""), j["jobUrl"], j.get("descriptionPlain", ""), (j.get("compensation") or {}).get("compensationTierSummary", "") or "", j.get("publishedAt", "")) for j in d.get("jobs", [])]
def workable(slug):
    d = jget("https://apply.workable.com/api/v3/accounts/%s/jobs" % slug, "POST", {"query": "", "location": [], "department": [], "worktype": [], "remote": []}) or {}
    return [row("workable:" + slug, j["shortcode"], j["title"], slug, ", ".join(filter(None, [(j.get("location") or {}).get("city", ""), (j.get("location") or {}).get("country", "")])), "https://apply.workable.com/%s/j/%s/" % (slug, j["shortcode"]), "", "", j.get("published", "")) for j in d.get("results", [])]

ATS_RE = {"greenhouse": r"(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io/(?:embed/job_app\?for=)?([a-z0-9-]+)", "ashby": r"jobs\.ashbyhq\.com/([A-Za-z0-9.-]+)",
          "lever": r"jobs\.(?:eu\.)?lever\.co/([a-z0-9-]+)", "workable": r"apply\.workable\.com/([a-z0-9-]+)"}
FNS = {"greenhouse": greenhouse, "ashby": ashby, "lever": lever, "workable": workable}

def boards():
    txt = ""
    for f in (C.APPS_CSV, os.path.join(C.DISC, "queue_today.json")):
        try: txt += open(f, encoding="utf-8", errors="ignore").read()
        except OSError: pass
    pairs = {(k, m.lower()) for k, p in ATS_RE.items() for m in re.findall(p, txt, re.I) if m.lower() not in ("embed", "api", "v1", "jobs")}
    out = []
    for k, slug in sorted(pairs):
        r = FNS[k](slug)
        if r: out += r; print("board", k, slug, len(r), flush=True)
    for slug in C.get("targets.company_boards", []) or []:
        for fn in (greenhouse, ashby, lever, workable):
            r = fn(slug)
            if r: out += r; print("board", fn.__name__, slug, len(r), flush=True); break
    return out

if __name__ == "__main__":
    allr = []
    for fn in (remotive, himalayas, boards):
        try:
            r = fn(); print(fn.__name__, len(r), flush=True); allr += r
        except Exception as e:
            print("ERR", fn.__name__, e, flush=True)
    keep = [j for j in allr if C.TITLE_INCLUDE.search(j["title"]) and not C.TITLE_EXCLUDE.search(j["title"])]
    seen = {}
    for j in keep:
        seen.setdefault(j["source"] + j["id"], j)
    json.dump(list(seen.values()), open(os.path.join(C.DISC, "boards.json"), "w"), indent=1)
    json.dump(allr, open(os.path.join(C.DISC, "boards_all.json"), "w"))
    print("BOARDS DONE kept", len(seen), "of", len(allr), flush=True)
