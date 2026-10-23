"""Add new House roll call votes to docs/data/house-votes.json.

Reads the House Clerk's public XML files (clerk.house.gov/evs/<year>/roll<NNN>.xml),
keeps final-passage style votes, and guesses a topic from the title using the same
keyword lists the site uses. Always check the new entries by hand: a null topic means
the title alone didn't say what the bill covers.

Usage:
  python3 scripts/refresh_votes.py 2026 315 340     # year, first roll, last roll
"""
import json, os, re, sys, urllib.request
import xml.etree.ElementTree as ET

ROOT = os.path.join(os.path.dirname(__file__), "..", "docs", "data")
KEEP = re.compile(r"^(On Passage|On Agreeing to the Resolution|On Motion to Suspend the Rules and (Pass|Agree|Concur)|On Motion to Table|On Concurring|On Motion to Concur|On Overriding the Veto)", re.I)
SKIP = re.compile(r"(Ordering the Previous Question|Motion to Recommit|Agreeing to the Amendment|Journal|Adjourn)", re.I)


def topic_for(title, topics):
    text = " " + re.sub(r"[^a-z0-9'.+\- ]+", " ", title.lower()) + " "
    for t in topics["topics"]:
        if any(" " + k + " " in text for k in t["keywords"]):
            return t["id"]
    return None


def parse(xml_text, topics):
    root = ET.fromstring(xml_text)
    meta = root.find("vote-metadata")
    q = (meta.findtext("vote-question") or "").strip()
    if SKIP.search(q) or not KEEP.search(q):
        return None
    bill = (meta.findtext("legis-num") or "").strip()
    desc = (meta.findtext("vote-desc") or "").strip() or bill
    date = meta.findtext("action-date")  # e.g. 16-Sep-2026
    from datetime import datetime
    d = datetime.strptime(date.strip(), "%d-%b-%Y").strftime("%Y-%m-%d")
    totals = meta.find("vote-totals/totals-by-vote")
    yea = int(totals.findtext("yea-total") or 0)
    nay = int(totals.findtext("nay-total") or 0)
    bill = re.sub(r"\bH R\b", "H.R.", bill).replace("H RES", "H.Res.").replace("H J RES", "H.J.Res.").replace("H CON RES", "H.Con.Res.").replace("S J RES", "S.J.Res.")
    bill = re.sub(r"^S (\d+)", r"S. \1", bill)
    return {"date": d, "roll": int(meta.findtext("rollcall-num")), "bill": bill, "title": desc, "topic": topic_for(desc, topics), "yea": yea, "nay": nay}


def main(year, first, last):
    topics = json.load(open(os.path.join(ROOT, "topics.json")))
    path = os.path.join(ROOT, "house-votes.json")
    data = json.load(open(path))
    have = {v["roll"] for v in data["votes"] if v["date"].startswith(str(year))}
    added = 0
    for n in range(first, last + 1):
        if n in have:
            continue
        url = f"https://clerk.house.gov/evs/{year}/roll{n:03d}.xml"
        try:
            xml_text = urllib.request.urlopen(url, timeout=20).read()
        except Exception as e:
            print("skip", n, e)
            continue
        v = parse(xml_text, topics)
        if v:
            data["votes"].append(v)
            added += 1
            print("added", n, v["bill"], v["title"][:60], v["topic"])
    data["votes"].sort(key=lambda v: (v["date"], v["roll"]), reverse=True)
    json.dump(data, open(path, "w"), indent=2)
    print(f"{added} votes added")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3]))
