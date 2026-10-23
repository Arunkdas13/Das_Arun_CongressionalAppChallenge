"""Download the latest public NYISO files into raw/ and rebuild docs/data/ny.json.
Runs on a schedule in GitHub Actions (.github/workflows/refresh.yml). No API key needed.

Usage: python3 scripts/fetch_ny.py
"""
import os, subprocess, sys, urllib.request
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "..", "raw")
BASE = "http://mis.nyiso.com/public/csv"


def get(url, dest):
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            data = r.read()
        with open(dest, "wb") as f:
            f.write(data)
        print("ok  ", url)
        return True
    except Exception as e:  # tomorrow's prices are not posted until late morning, so misses are normal
        print("miss", url, e)
        return False


def main():
    os.makedirs(RAW, exist_ok=True)
    for f in os.listdir(RAW):
        os.remove(os.path.join(RAW, f))
    today = datetime.now(ZoneInfo("America/New_York")).date()
    for k in range(-6, 2):  # last 6 days, today, tomorrow
        d = (today + timedelta(days=k)).strftime("%Y%m%d")
        get(f"{BASE}/damlbmp/{d}damlbmp_zone.csv", os.path.join(RAW, f"{d}damlbmp_zone.csv"))
    d = today.strftime("%Y%m%d")
    get(f"{BASE}/isolf/{d}isolf.csv", os.path.join(RAW, f"{d}isolf.csv"))
    for k in (-1, 0):
        d = (today + timedelta(days=k)).strftime("%Y%m%d")
        get(f"{BASE}/rtfuelmix/{d}rtfuelmix.csv", os.path.join(RAW, f"{d}rtfuelmix.csv"))
    subprocess.run([sys.executable, os.path.join(HERE, "build_ny.py"), RAW], check=True)


if __name__ == "__main__":
    main()
