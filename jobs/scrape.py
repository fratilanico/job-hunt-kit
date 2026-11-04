#!/usr/bin/env python3
"""List stage: LinkedIn guest search + Reed, one query per target title from profile.yaml.
Usage: python3 jobs/scrape.py            -> data/discovery/jobs_list.json
Also the shared HTTP helpers (get, strip, _next_data) and the per-source detail readers used by details.py.
No sign-in, no cookies: LinkedIn's public guest endpoints and Reed's server-rendered pages only.
Keep it polite: LinkedIn guest throttles (HTTP 429 or a ~24.6 KB empty shell) if you burst it."""
import html, json, os, re, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote
sys.path.insert(0, os.path.dirname(__file__))
import config as C

def get(url, tries=4):
    """curl, not urllib (macOS system Python's urllib often fails SSL). Retries 429/5xx with backoff."""
    for i in range(tries):
        r = subprocess.run(["curl", "-sS", "-L", "--compressed", "--max-time", "30", "-A", C.UA,
                            "-H", "Accept-Language: en-GB,en;q=0.9", "-w", "\n%{http_code}", url], capture_output=True, text=True)
        body, _, code = r.stdout.rpartition("\n")
        if code == "200" and len(body) != 24633 and "_0x" not in body[:3000]:
            return body
        if code == "429" and "jobPosting" in url:
            time.sleep(20); continue
        if code in ("200", "429", "503", "502", "000"):
            time.sleep(3 * (i + 1) + 2); continue
        return ""
    return ""

def strip(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()

def _next_data(h):
    m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', h or "", re.S)
    return json.loads(m.group(1)) if m else {}

# ---------- LinkedIn (guest, public) ----------
def linkedin_list(q, page, remote=False, contract=False, window="r604800"):
    url = ("https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=%s&location=%s&f_TPR=%s%s%s&start=%d"
           % (quote(q), quote(C.LI_LOCATION), window, "&f_WT=2" if remote else "", "&f_JT=C" if contract else "", page * 10))
    out = []
    for card in re.findall(r"<li>(.*?)</li>", get(url), re.S):
        m = re.search(r"urn:li:jobPosting:(\d+)", card)
        if not m:
            continue
        t = re.search(r'class="base-search-card__title[^"]*">\s*(.*?)\s*</h3>', card, re.S)
        c = re.search(r'class="base-search-card__subtitle[^"]*">\s*(.*?)\s*</h4>', card, re.S)
        l = re.search(r'class="job-search-card__location[^"]*">\s*(.*?)\s*</span>', card, re.S)
        d = re.search(r'datetime="([\d-]+)"', card)
        out.append({"source": "linkedin", "id": m.group(1), "title": strip(t.group(1) if t else ""), "company": strip(c.group(1) if c else ""),
                    "location": strip(l.group(1) if l else ""), "posted": d.group(1) if d else "",
                    "url": "https://www.linkedin.com/jobs/view/%s/" % m.group(1), "rate_text": "", "snippet": "", "query": q,
                    "contract": contract})
    return out

def linkedin_detail(j):
    h = get("https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/%s" % j["id"])
    m = re.search(r'class="show-more-less-html__markup[^"]*">(.*?)</div>', h, re.S) or re.search(r'class="description__text[^"]*">(.*?)</section>', h, re.S)
    j["description"] = strip(m.group(1)) if m else ""
    crit = dict(re.findall(r'<h3 class="description__job-criteria-subheader">\s*(.*?)\s*</h3>\s*<span[^>]*>\s*(.*?)\s*</span>', h, re.S))
    j["seniority"] = strip(crit.get("Seniority level", ""))
    j["employment_type"] = strip(crit.get("Employment type", ""))
    sal = re.search(r'class="salary[^"]*"[^>]*>\s*(.*?)\s*<', h, re.S)
    if sal and not j.get("rate_text"):
        j["rate_text"] = strip(sal.group(1))
    # offsite-apply = the employer's own ATS (best interview conversion); otherwise Easy Apply
    j["easy_apply"] = "offsite-apply" not in h and bool(re.search(r"apply-button|Easy Apply", h))
    a = re.search(r'<code id="applyUrl"[^>]*>\s*<!--"(.*?)"-->', h, re.S)
    j["apply_url"] = html.unescape(a.group(1)) if a else j["url"]

# ---------- Reed (server-rendered JSON) ----------
def reed_list(q, page, contract=False):
    slug = re.sub(r"[^a-z0-9]+", "-", q.lower()).strip("-")
    h = get("https://www.reed.co.uk/jobs/%s%s-jobs-in-%s?dateCreatedOffSet=lastweek&pageno=%d" % ("contract-" if contract else "", slug, C.BOARD_LOC, page + 1))
    jobs = _next_data(h).get("props", {}).get("pageProps", {}).get("searchResults", {}).get("jobs", []) or []
    out = []
    for w in jobs:
        jd = w.get("jobDetail", {})
        if not jd.get("jobId"):
            continue
        sal = ""
        if jd.get("salaryFrom") or jd.get("salaryTo"):
            top = jd.get("salaryTo") or jd.get("salaryFrom") or 0   # salaryType codes are unreliable; infer the unit from size
            unit = "/hr" if top < 200 else "/day" if top < 2000 else "/yr"
            sal = "£%s-£%s%s" % (jd.get("salaryFrom"), jd.get("salaryTo"), unit)
        out.append({"source": "reed", "id": str(jd["jobId"]), "title": jd.get("jobTitle", ""), "company": jd.get("ouName", ""),
                    "location": jd.get("displayLocationName", ""), "posted": (jd.get("dateCreated") or "")[:10],
                    "url": "https://www.reed.co.uk" + (w.get("url") or "/jobs/x/%s" % jd["jobId"]).split("?")[0],
                    "rate_text": sal, "remote_flag": jd.get("remoteWorkingOption", ""), "snippet": jd.get("jobDescriptionSnippet", ""),
                    "easy_apply": jd.get("isEasyApply", False), "query": q, "contract": contract})
    return out

def reed_detail(j):
    h = get(j["url"])
    i = h.find('"consolidatedJobDetails":')
    desc, ext = "", ""
    if i > -1:
        seg = h[i + len('"consolidatedJobDetails":'):]
        depth, s = 0, seg.find("{")
        for k, ch in enumerate(seg[s:], s):
            depth += ch == "{"
            depth -= ch == "}"
            if depth == 0:
                break
        try:
            d = json.loads(seg[s:k + 1]).get("jobDetails", {})
            desc, ext = d.get("description", ""), d.get("externalUrl", "")
        except Exception:
            pass
    j["description"] = strip(desc) or j.get("snippet", "")
    j["apply_url"] = ext or j["url"]

SOURCES = {"linkedin": (linkedin_list, linkedin_detail), "reed": (reed_list, reed_detail)}

def run_list(kind, q):
    rows = []
    contract = kind.endswith("_contract")
    for p in range(3):
        try:
            if kind.startswith("li"):
                r = linkedin_list(q, p, remote=kind == "li_remote", contract=contract)
            else:
                r = reed_list(q, p, contract=contract)
        except Exception as e:
            print("ERR", kind, q, p, e, flush=True); break
        if not r:
            break
        rows += r
        time.sleep(1.2 if kind.startswith("li") else 0.3)
    print(f"{kind:12s} {q:40s} {len(rows)}", flush=True)
    return rows

def main():
    if not C.TITLES:
        sys.exit("profile.yaml targets.titles is empty")
    kinds = ["li", "li_remote", "reed"]
    if C.WANT_CONTRACT:
        kinds += ["li_contract", "reed_contract"]
    with ThreadPoolExecutor(3) as ex:
        res = list(ex.map(lambda a: run_list(*a), [(k, q) for q in C.TITLES for k in kinds]))
    seen = {}
    for r in sum(res, []):
        seen.setdefault(r["source"] + r["id"], r)
    rows = list(seen.values())
    json.dump(rows, open(os.path.join(C.DISC, "jobs_list.json"), "w"), indent=1)
    print("LIST DONE", len(rows), flush=True)

if __name__ == "__main__":
    main()
