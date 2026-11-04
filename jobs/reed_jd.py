#!/usr/bin/env python3
"""Print a Reed job's details + description from the page's embedded JSON (no sign-in needed).
Usage: python3 jobs/reed_jd.py <jobId> [...]"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
import scrape
for jid in sys.argv[1:]:
    j = {"url": f"https://www.reed.co.uk/jobs/x/{jid}", "snippet": ""}
    scrape.reed_detail(j)
    print("===", jid, "| apply:", j["apply_url"]); print(j["description"][:3000]); print()
