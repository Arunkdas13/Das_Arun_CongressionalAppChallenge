"""Generate the two fictional sample exports used by the "Try a sample" buttons.

The samples follow the real file layouts of a TikTok data download
(user_data_tiktok.json) and a Google Takeout YouTube history
(watch-history.json, search-history.json). Every creator, title and search
in them is invented. Run:  python3 scripts/make_samples.py
"""
import json, random, zipfile, os
from datetime import datetime, timedelta

OUT = os.path.join(os.path.dirname(__file__), "..", "docs", "samples")

NONPOL = {
    "food": ["3 ingredient pasta you can make tonight", "rating every gas station snack", "the crispiest smash burger at home", "college dorm ramen upgrade", "what I eat in a day as a runner", "testing viral cookie recipes"],
    "sports": ["best dunks from last night", "this catch should be illegal", "ranking every quarterback right now", "high school buzzer beater goes viral", "fantasy football waiver pickups week 2", "the craziest finish of the season"],
    "gaming": ["this build is broken", "speedrun world record attempt", "ranked grind until I hit diamond", "the hardest boss nobody talks about", "new update patch notes in 2 minutes"],
    "school": ["study with me 2 hours", "how I organize my notes", "SAT math trick that saved me", "rating my school lunch", "senior year vlog day 12"],
    "music": ["this song is stuck in my head", "guitar cover of a 2000s classic", "producer makes a beat from random sounds", "concert crowd sings every word"],
    "life": ["my dog reacts to his reflection", "room makeover on a budget", "sneaker unboxing", "gym day leg routine", "funniest fails this week", "thrift haul under 20 dollars"],
}
NONPOL_CREATORS = ["kitchenwithkai", "dunkdaily", "pixelgrind", "studywithnoor", "beatsbybeck", "pawsandplays", "thriftqueenjo", "gameday.gabe", "dormchef", "legdaylarry", "fanfavfails", "riffsbyray"]

# Fictional political creators. Week by week, the feed narrows toward the first three.
POL_CREATORS = ["hotseat.politics", "truthbomb.tv", "redline.rants", "capitol.cuts", "bluewave.briefs", "mainstreet.mara", "policynerd.paul", "thelocal.ledger", "factsfirst.fred", "the.daily.brief", "civics.in.60", "both.sides.ben", "statehouse.sam", "newsroom.nina"]
FUNNEL = ["hotseat.politics", "truthbomb.tv", "redline.rants"]

POL_TITLES = {
    "congress": ["Congress is a JOKE and this proves it", "the Speaker just lost it on live TV", "Democrats vs Republicans meltdown on the House floor", "House republicans and house democrats screaming match", "lawmakers caught lying again", "why the GOP and Democrats can't agree on anything"],
    "elections": ["midterms are RIGGED and nobody is talking about it", "the polls are a scam wake up", "new midterm polls are insane", "impeachment chaos in Congress explained", "the Supreme Court fight is getting unhinged", "voters are FURIOUS right now"],
    "immigration": ["border crisis is out of control", "the border wall fight explained", "ICE raids caught on camera", "they don't want you to know what's happening at the southern border", "immigration debate gets heated"],
    "foreign": ["Iran war powers vote CHAOS", "troops and Iran what is actually happening", "Israel and Gaza debate turns ugly", "Ukraine aid fight exposed", "China is coming for us"],
    "economy": ["grocery prices are a scam", "tariffs explained in 60 seconds", "egg prices are insane again", "inflation is destroying your paycheck", "the economy is a disaster and here's proof"],
    "taxes": ["they are coming for your taxes", "government shutdown chaos again", "the national debt is out of control"],
    "health": ["drug prices exposed", "Medicare fight gets nasty"],
    "people": ["the President just humiliated this senator", "this congresswoman DESTROYS the Speaker", "the governor freaks out at reporter", "senator caught on hot mic", "the Speaker owns the room"],
}
EXPLAINERS = {
    "war powers": ("foreign", ["what the war powers act actually does explained", "war powers vote count roll call breakdown"]),
    "ratepayer protection act": ("energy", ["what's in the ratepayer protection act explained", "how your electric bill gets set breakdown"]),
    "midterm polls new york": ("elections", ["how to read a poll explained", "new york midterm map explained"]),
}
NONPOL_SEARCH = ["easy pasta recipe", "nba trade rumors", "how to study for chem test", "best budget sneakers", "funny dog videos", "leg day workout", "minecraft seeds", "homecoming outfit ideas", "lofi study music", "fantasy football advice"]
POL_SEARCH = [("2026-08-24 21:10:00", "war powers"), ("2026-09-03 20:40:00", "ratepayer protection act"), ("2026-09-19 19:30:00", "midterm polls new york")]


def build(seed, start, weeks, per_day, pol_start, pol_end):
    rnd = random.Random(seed)
    views, searches = [], []
    vid = 7400000000000000000 + seed * 1000000
    for day in range(weeks * 7):
        d0 = start + timedelta(days=day)
        progress = day / (weeks * 7 - 1)
        pol_share = pol_start + (pol_end - pol_start) * progress
        funnel_share = 0.15 + 0.7 * progress  # share of political videos from the 3 funnel creators
        n = rnd.randint(per_day - 15, per_day + 15)
        t = d0.replace(hour=rnd.choice([15, 16, 19, 20, 21]), minute=rnd.randint(0, 59), second=rnd.randint(0, 59))
        for _ in range(n):
            t += timedelta(seconds=rnd.randint(12, 70))
            vid += rnd.randint(1, 999)
            if rnd.random() < pol_share:
                creator = rnd.choice(FUNNEL) if rnd.random() < funnel_share else rnd.choice(POL_CREATORS[3:])
                # narrowing topics: early weeks spread, late weeks concentrated
                pool = list(POL_TITLES) if progress < 0.4 else ["congress", "elections", "people", "immigration", "foreign", "congress", "people", "elections"]
                title = rnd.choice(POL_TITLES[rnd.choice(pool)])
            else:
                cat = rnd.choice(list(NONPOL))
                creator = rnd.choice(NONPOL_CREATORS)
                title = rnd.choice(NONPOL[cat])
            views.append((t, creator, title, vid))
        for _ in range(rnd.randint(1, 4)):
            searches.append((d0.replace(hour=rnd.randint(14, 22), minute=rnd.randint(0, 59)), rnd.choice(NONPOL_SEARCH)))
    # political searches followed by videos the user went looking for
    for ts, q in POL_SEARCH:
        st = datetime.strptime(ts, "%Y-%m-%d %H:%M:%S")
        if not (start <= st < start + timedelta(days=weeks * 7)):
            continue
        searches.append((st, q))
        topic, titles = EXPLAINERS[q]
        for i, title in enumerate(titles * 2):
            vid += 17
            views.append((st + timedelta(minutes=2 + i * 2), rnd.choice(["policynerd.paul", "civics.in.60", "both.sides.ben", "factsfirst.fred"]), title, vid))
    views.sort(key=lambda v: v[0])
    searches.sort(key=lambda s: s[0])
    return views, searches


def tiktok():
    views, searches = build(1, datetime(2026, 8, 17), 6, 70, 0.08, 0.30)
    data = {
        "Profile": {"Profile Information": {"ProfileMap": {"userName": "sample.user", "note": "Fictional sample account created for Spoonfed"}}},
        "Activity": {
            "Video Browsing History": {"VideoList": [
                {"Date": t.strftime("%Y-%m-%d %H:%M:%S"), "Link": f"https://www.tiktok.com/@{c}/video/{v}", "Title": title} for t, c, title, v in views]},
            "Search History": {"SearchList": [{"Date": t.strftime("%Y-%m-%d %H:%M:%S"), "SearchTerm": q} for t, q in searches]},
        },
    }
    with open(os.path.join(OUT, "tiktok-sample.json"), "w") as f:
        json.dump(data, f, indent=1)
    with zipfile.ZipFile(os.path.join(OUT, "tiktok-sample.zip"), "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("user_data_tiktok.json", json.dumps(data, indent=1))
    return len(views), len(searches)


def youtube():
    views, searches = build(2, datetime(2026, 8, 24), 5, 22, 0.12, 0.35)
    watch = [{"header": "YouTube", "title": f"Watched {title}", "titleUrl": f"https://www.youtube.com/watch?v=s{v % 10**10}",
              "subtitles": [{"name": c, "url": f"https://www.youtube.com/@{c}"}],
              "time": t.strftime("%Y-%m-%dT%H:%M:%S.000Z"), "products": ["YouTube"], "activityControls": ["YouTube watch history"]}
             for t, c, title, v in reversed(views)]
    search = [{"header": "YouTube", "title": f"Searched for {q}", "titleUrl": "https://www.youtube.com/results?search_query=" + q.replace(" ", "+"),
               "time": t.strftime("%Y-%m-%dT%H:%M:%S.000Z"), "products": ["YouTube"], "activityControls": ["YouTube search history"]}
              for t, q in reversed(searches)]
    with open(os.path.join(OUT, "youtube-sample.json"), "w") as f:
        json.dump({"watch-history.json": watch, "search-history.json": search}, f, indent=1)
    with zipfile.ZipFile(os.path.join(OUT, "youtube-sample.zip"), "w", zipfile.ZIP_DEFLATED) as z:
        base = "Takeout/YouTube and YouTube Music/history/"
        z.writestr(base + "watch-history.json", json.dumps(watch, indent=1))
        z.writestr(base + "search-history.json", json.dumps(search, indent=1))
    return len(views), len(searches)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    print("tiktok", tiktok())
    print("youtube", youtube())
