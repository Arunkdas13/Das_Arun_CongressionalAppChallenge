"""Add other U.S. grid regions from the EIA Hourly Electric Grid Monitor (Form EIA-930).

Outside New York there is no free public hourly price, so for these regions Kilowhen times loads by
expected emissions instead: the average pounds of CO2 per MWh at each hour over the last 7 days,
computed from EIA's hourly generation by fuel. Peak hours come from EIA's day-ahead demand forecast.

Needs a free API key from https://www.eia.gov/opendata/register.php stored as the EIA_API_KEY
secret (GitHub) or environment variable.  Usage: EIA_API_KEY=... python3 scripts/fetch_eia.py
"""
import json, os, sys, urllib.parse, urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "docs", "data")
API = "https://api.eia.gov/v2/electricity/rto"

# respondent code, display name, local time zone
REGIONS = [
    ("CISO", "California (CAISO)", "America/Los_Angeles"),
    ("ERCO", "Texas (ERCOT)", "America/Chicago"),
    ("PJM", "Mid-Atlantic and Midwest (PJM)", "America/New_York"),
    ("MISO", "Central U.S. (MISO)", "America/Chicago"),
    ("ISNE", "New England (ISO-NE)", "America/New_York"),
    ("SWPP", "Great Plains (SPP)", "America/Chicago"),
    ("FPL", "Florida Power & Light", "America/New_York"),
    ("SOCO", "Southern Company", "America/Chicago"),
    ("TVA", "Tennessee Valley Authority", "America/Chicago"),
    ("DUK", "Duke Energy Carolinas", "America/New_York"),
    ("BPAT", "Pacific Northwest (BPA)", "America/Los_Angeles"),
    ("PACE", "PacifiCorp East", "America/Denver"),
]
FUEL = {"COL": "Coal", "NG": "Natural Gas", "OIL": "Oil", "NUC": "Nuclear", "WAT": "Hydro", "WND": "Wind", "SUN": "Solar", "OTH": "Other", "BAT": "Battery"}
LB = {"Coal": 2200, "Natural Gas": 900, "Oil": 1700, "Other": 900}


def get(route, params):
    q = [("api_key", os.environ["EIA_API_KEY"]), ("frequency", "hourly"), ("data[0]", "value"), ("length", "5000")] + params
    url = f"{API}/{route}/data/?" + urllib.parse.urlencode(q)
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.load(r)["response"]["data"]


def region_file(code, name, tz):
    z = ZoneInfo(tz)
    end = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0) + timedelta(hours=48)
    start = end - timedelta(days=10)
    fmt = "%Y-%m-%dT%H"
    gen = get("fuel-type-data", [("facets[respondent][]", code), ("start", start.strftime(fmt)), ("end", end.strftime(fmt))])
    dem = get("region-data", [("facets[respondent][]", code), ("facets[type][]", "DF"), ("start", start.strftime(fmt)), ("end", end.strftime(fmt))])

    by_hour = defaultdict(lambda: defaultdict(float))  # utc hour -> fuel -> MW
    for r in gen:
        if r.get("value") is None:
            continue
        by_hour[r["period"]][FUEL.get(r["fueltype"], "Other")] += max(0.0, float(r["value"]))
    mix, profile = [], defaultdict(list)
    for period, fuels in sorted(by_hour.items()):
        t = datetime.strptime(period, fmt).replace(tzinfo=timezone.utc).astimezone(z)
        total = sum(fuels.values())
        if total <= 0:
            continue
        mix.append({"date": t.strftime("%Y-%m-%d"), "hour": t.hour, "mw": {k: round(v, 1) for k, v in fuels.items()}})
        profile[t.hour].append(sum(v * LB.get(k, 0) for k, v in fuels.items()) / total)
    typical = {h: sum(v) / len(v) for h, v in profile.items() if v}

    load = defaultdict(dict)
    for r in dem:
        if r.get("value") is None:
            continue
        t = datetime.strptime(r["period"], fmt).replace(tzinfo=timezone.utc).astimezone(z)
        load[t.strftime("%Y-%m-%d")][t.hour] = float(r["value"])

    today = datetime.now(z).date()
    days = [(today + timedelta(days=k)).strftime("%Y-%m-%d") for k in (0, 1)]
    signal, load_out = {}, {}
    for d in days:
        if len(typical) == 24:
            signal[d] = [round(typical[h], 1) for h in range(24)]
        if len(load.get(d, {})) == 24:
            load_out[d] = [load[d][h] for h in range(24)]
    return {
        "region": code, "regionName": name, "timezone": tz,
        "source": "U.S. Energy Information Administration, Hourly Electric Grid Monitor (Form EIA-930)",
        "sourceUrl": "https://www.eia.gov/electricity/gridmonitor/",
        "built": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "signalKind": "co2", "signalUnit": "lb CO2/MWh", "defaultZone": code,
        "zones": [{"id": code, "name": name, "area": "Whole balancing area"}],
        "days": [d for d in days if d in signal],
        "signal": {code: signal}, "load": {code: load_out} if load_out else {}, "mix": mix[-72:],
    }


def main():
    reg_path = os.path.join(DATA, "regions.json")
    regions = json.load(open(reg_path))
    keep = [r for r in regions["regions"] if r["id"] == "ny"]
    for code, name, tz in REGIONS:
        try:
            data = region_file(code, name, tz)
            if not data["days"]:
                print("skip", code, "not enough data")
                continue
            fn = f"us-{code.lower()}.json"
            json.dump(data, open(os.path.join(DATA, fn), "w"), separators=(",", ":"))
            keep.append({"id": code.lower(), "name": name, "file": fn, "kind": "co2"})
            print("ok", code)
        except Exception as e:
            print("fail", code, e, file=sys.stderr)
    regions["regions"] = keep
    json.dump(regions, open(reg_path, "w"), indent=2)


if __name__ == "__main__":
    main()
