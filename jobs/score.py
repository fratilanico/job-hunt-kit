#!/usr/bin/env python3
"""Filter + score every discovered job against profile.yaml, drop anything already in the tracker.
Usage: python3 jobs/score.py   -> data/discovery/shortlist.json + shortlist.csv (best first)
Filters: title include/exclude, geography, industries_out, companies_avoid, pay floor, English-only.
Score: + score_positive phrases, - score_negative phrases, + title match, + remote/hybrid fit."""
import csv, json, os, re, sys
sys.path.insert(0, os.path.dirname(__file__))
import config as C

def load(name):
    p = os.path.join(C.DISC, name)
    return json.load(open(p)) if os.path.exists(p) else []

NON_EN = re.compile(r"\((m|w|f|d)/(m|w|f|d)(/(m|w|f|d))?\)|\(all genders\)|\bcdi\b|\bh/f\b|\bwir suchen\b|\bnous recherchons\b|\bbuscamos\b", re.I)

def reasons_out(j):
    t, loc, d = j.get("title", ""), j.get("location", "") or "", (j.get("description") or j.get("snippet") or "")
    if not C.TITLE_INCLUDE.search(t) or C.TITLE_EXCLUDE.search(t): return "title"
    if C.GEO_BAD.search(loc) and not C.GEO_OK.search(loc): return "geo"
    if loc and not C.GEO_OK.search(loc) and not j["source"].startswith(("linkedin", "reed", "totaljobs", "cwjobs", "hays")): return "geo"
    if C.get("location.english_only", True) and NON_EN.search(t + " " + d[:600]): return "language"
    if C.INDUSTRY_OUT.pattern != "(?!x)x" and C.INDUSTRY_OUT.search(t + " " + (j.get("company") or "") + " " + d[:1500]): return "industry"
    if C.company_blocked(j.get("company")): return "company-avoid"
    if not C.pay_ok((j.get("rate_text") or "") + " " + d[:400]): return "pay-floor"
    if not C.get("work_type.onsite", True) and re.search(r"\b(fully on-?site|5 days (a week )?in (the )?office|office based only|no remote)\b", d, re.I): return "onsite-only"
    if j.get("contract") and not C.WANT_CONTRACT: return "type"
    if not C.WANT_PERM and not j.get("contract") and re.search(r"\bpermanent\b", d[:800], re.I) and not re.search(r"\bcontract\b", d[:800], re.I): return "type"
    return None

def score(j):
    d = ((j.get("title") or "") + "\n" + (j.get("description") or j.get("snippet") or "")).lower()
    sc, why, gaps = 0, [], []
    for k, w in C.POS.items():
        if re.search(k, d, re.I): sc += int(w); why.append(k[:20])
    for k, w in C.NEG.items():
        if re.search(k, d, re.I): sc -= int(w); gaps.append(k[:20])
    t = (j.get("title") or "").lower()
    if any(x.lower() in t for x in C.TITLES): sc += 6; why.append("title")
    if re.search(r"\bremote\b", (j.get("location") or "") + " " + d[:600]) and C.get("work_type.remote", True): sc += 1
    if re.search(r"\bhybrid\b", d[:1500]) and C.get("work_type.hybrid", True): sc += 1
    if not (j.get("description") or j.get("snippet")): sc -= 3; gaps.append("no-description")
    return sc, why, gaps

def main():
    rows = load("jobs.json") or load("jobs_list.json")
    rows += load("jobs_uk_boards.json") + load("boards.json")
    done_urls, done_ids = set(), set()
    if os.path.exists(C.APPS_CSV):
        blob = open(C.APPS_CSV, encoding="utf-8", errors="ignore").read()
        done_ids = set(re.findall(r"(?<!\d)(\d{7,12})(?!\d)", blob))
        done_urls = {r.get("url", "").rstrip("/").lower() for r in csv.DictReader(open(C.APPS_CSV, encoding="utf-8", errors="ignore"))}
    seen, out, drop = set(), [], {}
    for j in rows:
        key = re.sub(r"\W", "", (j.get("title", "") + j.get("company", "")).lower())
        if key in seen: continue
        seen.add(key)
        if j["url"].rstrip("/").lower() in done_urls or (j.get("id") in done_ids and j["source"] in ("linkedin", "reed")):
            drop["already-logged"] = drop.get("already-logged", 0) + 1; continue
        why_out = reasons_out(j)
        if why_out:
            drop[why_out] = drop.get(why_out, 0) + 1; continue
        s, why, gaps = score(j)
        out.append({"score": s, "title": j["title"], "company": j.get("company", ""), "location": j.get("location", ""), "rate": j.get("rate_text", ""),
                    "source": j["source"], "url": j["url"], "apply_url": j.get("apply_url", j["url"]), "easy_apply": j.get("easy_apply", False),
                    "posted": j.get("posted", ""), "contract": j.get("contract", False), "fit": " ".join(why), "gaps": " ".join(gaps),
                    "review_first": C.needs_review(j.get("company")), "description": (j.get("description") or j.get("snippet") or "")[:6000]})
    out.sort(key=lambda r: -r["score"])
    json.dump(out, open(os.path.join(C.DISC, "shortlist.json"), "w"), indent=1)
    cols = ["score", "title", "company", "location", "rate", "source", "url", "posted", "fit", "gaps"]
    with open(os.path.join(C.DISC, "shortlist.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, cols, extrasaction="ignore"); w.writeheader(); w.writerows(out)
    print(len(out), "shortlisted; dropped", drop)
    for r in out[:40]:
        print(f'{r["score"]:>3} | {r["title"][:50]:50s} | {r["company"][:24]:24s} | {r["location"][:24]:24s} | {r["rate"][:16]:16s} | {r["source"]}')

if __name__ == "__main__":
    main()
