"""Turn raw NYISO CSV files into docs/data/ny.json for the app.

Input folder (default: raw/) may contain any of:
  YYYYMMDDdamlbmp_zone.csv        day-ahead zonal prices (full file or just Time Stamp, Name, LBMP columns)
  YYYYMMDDisolf.csv               load forecast (the newest one is used)
  YYYYMMDDrtfuelmix*.csv          real-time fuel mix (5-minute or hourly rows; averaged per hour)

Usage: python3 scripts/build_ny.py [raw_folder]
"""
import csv, glob, json, os, re, sys
from collections import defaultdict
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "docs", "data", "ny.json")

ZONES = [  # NYISO load zones inside New York (external proxies like PJM and H Q are left out)
    ("HUD VL", "Hudson Valley", "Zone G: Rockland, Orange, Putnam, Dutchess, Ulster and parts of Westchester"),
    ("MILLWD", "Millwood", "Zone H: northern Westchester"),
    ("DUNWOD", "Dunwoodie", "Zone I: southern Westchester"),
    ("N.Y.C.", "New York City", "Zone J: the five boroughs"),
    ("LONGIL", "Long Island", "Zone K: Nassau and Suffolk"),
    ("CAPITL", "Capital", "Zone F: Albany and the Capital Region"),
    ("CENTRL", "Central", "Zone C: Syracuse and central New York"),
    ("GENESE", "Genesee", "Zone B: Rochester area"),
    ("WEST", "West", "Zone A: Buffalo and western New York"),
    ("MHK VL", "Mohawk Valley", "Zone E: Utica and the Mohawk Valley"),
    ("NORTH", "North", "Zone D: the North Country"),
]
ZONE_IDS = {z[0] for z in ZONES}
LOAD_COLS = {"Capitl": "CAPITL", "Centrl": "CENTRL", "Dunwod": "DUNWOD", "Genese": "GENESE", "Hud Vl": "HUD VL", "Longil": "LONGIL",
             "Mhk Vl": "MHK VL", "Millwd": "MILLWD", "N.Y.C.": "N.Y.C.", "North": "NORTH", "West": "WEST", "NYISO": "NYISO"}


def parse_ts(s):
    s = s.strip().strip('"')
    for fmt in ("%m/%d/%Y %H:%M:%S", "%m/%d/%Y %H:%M"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            pass
    raise ValueError("bad timestamp " + s)


def read_rows(path):
    with open(path, newline="") as f:
        text = f.read().replace("```", "").strip()
    rows = list(csv.reader(text.splitlines()))
    return rows[0], [r for r in rows[1:] if r and r[0].strip()]


def build(raw):
    price = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    for p in sorted(glob.glob(os.path.join(raw, "*damlbmp_zone*.csv"))):
        head, rows = read_rows(p)
        i_ts, i_name = head.index("Time Stamp"), head.index("Name")
        i_lbmp = [i for i, h in enumerate(head) if h.startswith("LBMP")][0]
        for r in rows:
            name = r[i_name].strip()
            if name not in ZONE_IDS:
                continue
            ts = parse_ts(r[i_ts])
            price[name][ts.strftime("%Y-%m-%d")][ts.hour].append(float(r[i_lbmp]))

    load = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    lf = sorted(glob.glob(os.path.join(raw, "*isolf*.csv")))
    if lf:
        head, rows = read_rows(lf[-1])
        head = [h.strip().strip('"') for h in head]
        for r in rows:
            ts = parse_ts(r[0])
            for i, h in enumerate(head[1:], start=1):
                z = LOAD_COLS.get(h)
                if z and i < len(r) and r[i].strip():
                    load[z][ts.strftime("%Y-%m-%d")][ts.hour].append(float(r[i]))

    mixacc = defaultdict(lambda: defaultdict(list))  # (date,hour) -> fuel -> [MW]
    for p in sorted(glob.glob(os.path.join(raw, "*rtfuelmix*.csv"))):
        head, rows = read_rows(p)
        i_ts, i_f, i_mw = head.index("Time Stamp"), head.index("Fuel Category"), head.index("Gen MW")
        for r in rows:
            if len(r) <= i_mw or not r[i_mw].strip():
                continue
            ts = parse_ts(r[i_ts])
            mixacc[(ts.strftime("%Y-%m-%d"), ts.hour)][r[i_f].strip()].append(float(r[i_mw]))

    def full_days(d):
        return {date: [round(sum(v[h]) / len(v[h]), 2) for h in range(24)] for date, v in d.items() if all(v.get(h) for h in range(24))}

    price_out = {z: full_days(price[z]) for z in price}
    days = sorted({d for z in price_out for d in price_out[z]})
    load_out = {z: full_days(load[z]) for z in load}
    mix = []
    for (date, hour), fuels in sorted(mixacc.items()):
        mix.append({"date": date, "hour": hour, "mw": {f: round(sum(v) / len(v), 1) for f, v in fuels.items()}})

    return {
        "region": "NYISO",
        "regionName": "New York",
        "timezone": "America/New_York",
        "source": "New York Independent System Operator (NYISO), public market data: day-ahead zonal LBMP, ISO load forecast, real-time fuel mix",
        "sourceUrl": "https://www.nyiso.com/energy-market-operational-data",
        "built": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "priceUnit": "$/MWh",
        "defaultZone": "HUD VL",
        "zones": [{"id": z, "name": n, "area": a} for z, n, a in ZONES if z in price_out],
        "days": days,
        "price": price_out,
        "load": {z: v for z, v in load_out.items() if v},
        "mix": mix,
    }


if __name__ == "__main__":
    raw = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "raw")
    data = build(raw)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"days {data['days']}  zones {len(data['zones'])}  load zones {len(data['load'])}  mix hours {len(data['mix'])}")
