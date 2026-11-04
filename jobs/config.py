"""Shared config for every job script. Reads profile/profile.yaml (or $JOBKIT_PROFILE).
Nothing personal is hard-coded anywhere else in jobs/."""
import os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def load():
    path = os.environ.get("JOBKIT_PROFILE", os.path.join(ROOT, "profile", "profile.yaml"))
    if not os.path.exists(path):
        sys.exit(f"missing {path}: copy profile/profile.example.yaml to profile/profile.yaml (or run the onboarding)")
    try:
        import yaml
    except ImportError:
        sys.exit("PyYAML missing: python3 -m pip install -r requirements.txt")
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}

P = load()

def get(dotted, default=None):
    cur = P
    for k in dotted.split("."):
        if not isinstance(cur, dict) or k not in cur:
            return default
        cur = cur[k]
    return cur if cur is not None else default

DATA = os.path.join(ROOT, get("paths.data_dir", "data"))
RUNS = os.path.join(ROOT, get("paths.runs_dir", "runs"))
DISC = os.path.join(DATA, "discovery")
APPS_CSV = os.environ.get("APPS_CSV", os.path.join(DATA, "applications.csv"))
for d in (DATA, DISC, os.path.join(DATA, "batches")):
    os.makedirs(d, exist_ok=True)

def rx(words, default=r"(?!x)x"):
    """list of regex fragments -> one case-insensitive alternation (matches nothing when empty)."""
    words = [w for w in (words or []) if w]
    return re.compile("|".join(f"(?:{w})" for w in words) if words else default, re.I)

TITLES = get("targets.titles", []) or []
TITLE_INCLUDE = rx(get("targets.title_include") or [re.escape(t) for t in TITLES])
TITLE_EXCLUDE = rx(get("targets.title_exclude"))
GEO_OK = rx(get("location.allowed_geo"))
GEO_BAD = rx(get("location.blocked_geo"))
INDUSTRY_OUT = rx(get("targets.industries_out"))
AVOID = [c.lower() for c in get("targets.companies_avoid", []) or []]
REVIEW_FIRST = [c.lower() for c in get("targets.companies_review_first", []) or []]
POS = get("targets.score_positive", {}) or {}
NEG = get("targets.score_negative", {}) or {}
CAP = int(get("limits.company_cap", 2))
PERM_FLOOR = float(get("pay.perm_floor", 0) or 0)
DAY_FLOOR = float(get("pay.day_rate_floor", 0) or 0)
WANT_PERM = bool(get("employment.permanent", True))
WANT_CONTRACT = bool(get("employment.contract", False))
LI_LOCATION = get("location.linkedin_search_location", "United Kingdom")
BOARD_LOC = get("location.board_location_slug", "london")
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"

def ckey(name):
    """company key for the per-company cap (strips legal suffixes so 'Acme Ltd' == 'Acme')."""
    n = re.sub(r"[^a-z0-9]", "", (name or "").lower())
    return re.sub(r"(ltd|limited|inc|plc|group|uk|llp|gmbh)$", "", n)

def company_blocked(name):
    n = (name or "").lower()
    return any(a and a in n for a in AVOID)

def needs_review(name):
    n = (name or "").lower()
    return any(a and a in n for a in REVIEW_FIRST)

def pay_ok(text):
    """True unless the advertised pay is clearly under the floor. Unknown pay passes if unknown_pay_ok."""
    t = (text or "").lower().replace(",", "")
    vals = []
    for m in re.finditer(r"(?:£|\$|€|gbp|usd|eur)\s?(\d{2,6}(?:\.\d+)?)\s*(k)?", t):
        v = float(m.group(1)) * (1000 if m.group(2) else 1)
        vals.append(v)
    if not vals:
        return bool(get("pay.unknown_pay_ok", True))
    top = max(vals)
    if re.search(r"per hour|/hr|/hour|an hour|hourly|p/h", t) or top < 200:
        top *= 7.5  # hourly -> daily
    if re.search(r"per day|/day|a day|daily|p/d|pd\b", t) or top < 2000:   # daily rate
        if DAY_FLOOR > 0:
            return top >= DAY_FLOOR
        return PERM_FLOOR <= 0 or top * 220 >= PERM_FLOOR   # perm seeker: compare the annualised rate
    return PERM_FLOOR <= 0 or top >= PERM_FLOOR
