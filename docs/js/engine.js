/* Spoonfed analysis engine.
 * Runs entirely in the browser (and in Node for tests). No network calls, no AI.
 * Input: parsed export files. Output: a plain report object the page draws.
 */
(function (root) {
  "use strict";

  const CHOSEN_WINDOW_MIN = 30; // a video counts as chosen if a matching search happened up to 30 minutes before it
  const STOP = new Set(["the", "and", "for", "with", "what", "this", "that", "from", "your", "about", "just", "how", "why", "are", "was", "you", "new", "act", "its", "into", "they", "them", "does", "explained", "actually", "really", "here", "there", "have", "has", "will", "news", "video", "videos"]);

  /* ---------- text helpers ---------- */
  function norm(s) { return " " + String(s || "").toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9'.+\- ]+/g, " ").replace(/\s+/g, " ").trim() + " "; }
  function hasPhrase(text, phrase) { return text.indexOf(" " + phrase + " ") !== -1; }
  function tokens(s) { return norm(s).trim().split(" ").filter(w => w.length > 3 && !STOP.has(w)); }

  /* ---------- parsing ---------- */
  function parseDate(s) {
    if (!s) return null;
    // TikTok uses "YYYY-MM-DD HH:MM:SS" in UTC; YouTube uses ISO strings.
    const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? s.replace(" ", "T") + "Z" : s;
    const d = new Date(iso);
    return isNaN(d) ? null : d;
  }

  function handleFromUrl(url) {
    const m = String(url || "").match(/\/@([A-Za-z0-9._-]+)/);
    return m ? m[1].toLowerCase() : null;
  }

  // Walk any JSON tree and collect arrays of objects that look like TikTok history rows.
  function walk(node, visit) {
    if (Array.isArray(node)) { visit(node); node.forEach(n => walk(n, visit)); }
    else if (node && typeof node === "object") Object.values(node).forEach(n => walk(n, visit));
  }

  function parseTikTok(json) {
    const views = [], searches = [];
    walk(json, arr => {
      if (!arr.length || typeof arr[0] !== "object" || arr[0] === null) return;
      const k = arr[0];
      const dateKey = "Date" in k ? "Date" : ("date" in k ? "date" : null);
      if (!dateKey) return;
      if ("Link" in k || "VideoLink" in k || "link" in k) {
        arr.forEach(r => {
          const url = r.Link || r.VideoLink || r.link;
          const t = parseDate(r[dateKey]);
          if (!t) return;
          views.push({ t, url, creator: handleFromUrl(url), title: r.Title || r["Post title"] || r.PostTitle || r.title || "" });
        });
      } else if ("SearchTerm" in k || "searchTerm" in k) {
        arr.forEach(r => { const t = parseDate(r[dateKey]); if (t) searches.push({ t, q: r.SearchTerm || r.searchTerm || "" }); });
      }
    });
    return { platform: "TikTok", views, searches };
  }

  function parseYouTube(watch, search) {
    const views = [], searches = [];
    (watch || []).forEach(r => {
      if (!r || typeof r.title !== "string") return;
      if (r.details && JSON.stringify(r.details).indexOf("Ads") !== -1) return; // skip ads
      if (!r.title.startsWith("Watched ")) return;
      const t = parseDate(r.time); if (!t) return;
      const sub = (r.subtitles && r.subtitles[0]) || {};
      views.push({ t, url: r.titleUrl, creator: (sub.name || handleFromUrl(sub.url) || "").toLowerCase() || null, title: r.title.slice(8) });
    });
    (search || []).forEach(r => {
      if (!r || typeof r.title !== "string" || !r.title.startsWith("Searched for ")) return;
      const t = parseDate(r.time); if (t) searches.push({ t, q: r.title.slice(13) });
    });
    return { platform: "YouTube", views, searches };
  }

  /** files: [{name, json}] — any mix of a TikTok export or YouTube Takeout history files. */
  function parseFiles(files) {
    let watch = null, search = null, tiktok = null;
    for (const f of files) {
      const name = f.name.toLowerCase();
      if (name.endsWith("watch-history.json")) watch = f.json;
      else if (name.endsWith("search-history.json")) search = f.json;
      else if (Array.isArray(f.json) && f.json.length && f.json[0].header === "YouTube") {
        if (String(f.json[0].title).startsWith("Searched for ")) search = f.json; else watch = f.json;
      } else if (f.json && typeof f.json === "object") tiktok = f.json;
    }
    let out;
    if (watch || search) out = parseYouTube(watch, search);
    else if (tiktok) out = parseTikTok(tiktok);
    else throw new Error("No watch history found. Upload the TikTok file named user_data_tiktok.json, or the YouTube files watch-history.json and search-history.json (or the whole zip).");
    if (!out.views.length) throw new Error("The file was read, but it has no watched videos in it. Check that you chose JSON format and included your activity or history when you requested the download.");
    out.views.sort((a, b) => a.t - b.t);
    out.searches.sort((a, b) => a.t - b.t);
    return out;
  }

  /* ---------- classification ---------- */
  function classify(title, rules) {
    const text = norm(title);
    const topics = rules.topics.topics.filter(tp => tp.keywords.length && tp.keywords.some(k => hasPhrase(text, k))).map(tp => tp.id);
    const person = rules.topics.people.keywords.some(k => hasPhrase(text, k));
    if (person && !topics.length) topics.push("people");
    const political = topics.length > 0;
    let conflict = 0, explain = 0;
    if (political) {
      rules.tone.conflict.forEach(w => { if (hasPhrase(text, w)) conflict++; });
      rules.tone.explaining.forEach(w => { if (hasPhrase(text, w)) explain++; });
      const letters = String(title).replace(/[^A-Za-z]/g, "");
      const caps = String(title).match(/\b[A-Z]{3,}\b/g) || [];
      if (letters.length > 8 && (String(title).replace(/[^A-Z]/g, "").length / letters.length > 0.6)) conflict++;
      else if (caps.length) conflict++;
      if (/[!?]{2,}/.test(title)) conflict++;
    }
    const tone = !political ? null : conflict >= 2 ? "conflict" : (conflict === 0 && explain > 0) ? "explaining" : "neutral";
    return { political, topics, person, tone, conflictScore: conflict };
  }

  /* ---------- chosen vs fed ---------- */
  function markChosen(views, searches, rules) {
    const s = searches.map(x => ({ t: x.t.getTime(), toks: new Set(tokens(x.q)), topics: new Set(classify(x.q, rules).topics), q: x.q }));
    let j = 0;
    views.forEach(v => {
      v.chosen = false;
      if (!v.political) return;
      const tv = v.t.getTime();
      while (j < s.length && s[j].t < tv - CHOSEN_WINDOW_MIN * 60000) j++;
      for (let i = j; i < s.length && s[i].t <= tv; i++) {
        const sameTopic = v.topics.some(tp => s[i].topics.has(tp));
        const sharedWord = tokens(v.title).some(w => s[i].toks.has(w));
        if (sameTopic || sharedWord) { v.chosen = true; v.chosenBy = s[i].q; break; }
      }
    });
  }

  /* ---------- stats helpers ---------- */
  function weekStart(d) { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const day = (x.getUTCDay() + 6) % 7; x.setUTCDate(x.getUTCDate() - day); return x; }
  function effectiveNumber(counts) { // exp(Shannon entropy): "how many equally-sized voices this is worth"
    const total = counts.reduce((a, b) => a + b, 0); if (!total) return 0;
    let h = 0; counts.forEach(c => { if (c) { const p = c / total; h -= p * Math.log(p); } });
    return Math.exp(h);
  }
  function countBy(arr, f) { const m = new Map(); arr.forEach(x => { const k = f(x); if (k == null) return; m.set(k, (m.get(k) || 0) + 1); }); return m; }
  const pct = (a, b) => b ? a / b : 0;

  /* ---------- main ---------- */
  function analyze(parsed, rules, houseVotes, opts) {
    opts = opts || {};
    const views = parsed.views.map(v => Object.assign({}, v, classify(v.title, rules)));
    markChosen(views, parsed.searches, rules);
    const pol = views.filter(v => v.political);
    const hasTitles = views.some(v => v.title);
    const hasCreators = pol.some(v => v.creator);

    const start = views[0].t, end = views[views.length - 1].t;
    const chosen = pol.filter(v => v.chosen).length;

    // weekly series
    const weeks = new Map();
    views.forEach(v => {
      const k = weekStart(v.t).toISOString().slice(0, 10);
      if (!weeks.has(k)) weeks.set(k, { week: k, total: 0, political: 0, chosen: 0, creators: new Map(), topics: new Map(), conflict: 0, ratedLeft: 0, ratedCenter: 0, ratedRight: 0 });
      const w = weeks.get(k); w.total++;
      if (v.political) {
        w.political++; if (v.chosen) w.chosen++; if (v.tone === "conflict") w.conflict++;
        if (v.creator) w.creators.set(v.creator, (w.creators.get(v.creator) || 0) + 1);
        v.topics.forEach(tp => w.topics.set(tp, (w.topics.get(tp) || 0) + 1));
        const r = opts.ratings && v.creator ? opts.ratings[v.creator] : null;
        if (r === "left") w.ratedLeft++; else if (r === "center") w.ratedCenter++; else if (r === "right") w.ratedRight++;
      }
    });
    const weekly = [...weeks.values()].sort((a, b) => a.week < b.week ? -1 : 1).map(w => ({
      week: w.week, total: w.total, political: w.political, chosen: w.chosen,
      politicalShare: pct(w.political, w.total), conflictShare: pct(w.conflict, w.political),
      voices: effectiveNumber([...w.creators.values()]), distinctCreators: w.creators.size,
      topicVoices: effectiveNumber([...w.topics.values()]),
      left: w.ratedLeft, center: w.ratedCenter, right: w.ratedRight
    }));
    // ignore partial first/last weeks for the funnel trend if they are tiny
    const full = weekly.filter(w => w.total >= 0.5 * Math.max(...weekly.map(x => x.total)));
    const first = full[0] || weekly[0], last = full[full.length - 1] || weekly[weekly.length - 1];

    // sources
    const creatorCounts = [...countBy(pol, v => v.creator).entries()].sort((a, b) => b[1] - a[1]);
    const top3 = creatorCounts.slice(0, 3).reduce((a, c) => a + c[1], 0);
    const sources = creatorCounts.slice(0, 10).map(([name, n]) => ({ name, count: n, share: pct(n, pol.length), conflictShare: pct(pol.filter(v => v.creator === name && v.tone === "conflict").length, n) }));

    // topics vs Congress
    const inRange = (houseVotes ? houseVotes.votes : []).filter(v => { const d = new Date(v.date + "T12:00:00Z"); return d >= weekStart(start) && d <= new Date(end.getTime() + 864e5); });
    const topicRows = rules.topics.topics.map(tp => {
      const vids = pol.filter(v => v.topics.includes(tp.id));
      const votes = inRange.filter(v => v.topic === tp.id);
      return { id: tp.id, name: tp.name, videos: vids.length, share: pct(vids.length, pol.length), conflictShare: pct(vids.filter(v => v.tone === "conflict").length, vids.length), votes: votes.length, voteList: votes, topCreatorShare: vids.length ? Math.max(...countBy(vids, v => v.creator || "unknown").values()) / vids.length : 0 };
    }).filter(r => r.videos || r.votes).sort((a, b) => (b.votes - a.votes) || (b.videos - a.videos));
    const blindSpots = topicRows.filter(r => r.votes >= 2 && r.share < 0.02).sort((a, b) => b.votes - a.votes);

    // tone and people
    const tone = { conflict: pol.filter(v => v.tone === "conflict").length, neutral: pol.filter(v => v.tone === "neutral").length, explaining: pol.filter(v => v.tone === "explaining").length };
    const people = pol.filter(v => v.person).length;

    // examples (actual titles) for transparency
    const examples = {
      conflict: pol.filter(v => v.tone === "conflict").slice(-3).map(v => v.title),
      chosen: pol.filter(v => v.chosen).slice(0, 3).map(v => ({ title: v.title, search: v.chosenBy }))
    };

    const report = {
      platform: parsed.platform, start, end,
      days: Math.max(1, Math.round((end - start) / 864e5)),
      totalViews: views.length, political: pol.length, politicalShare: pct(pol.length, views.length),
      searches: parsed.searches.length,
      politicalSearches: parsed.searches.filter(s => classify(s.q, rules).political).length,
      chosen, fed: pol.length - chosen, chosenShare: pct(chosen, pol.length),
      strip: pol.map(v => ({ t: v.t.getTime(), chosen: v.chosen, tone: v.tone })),
      weekly, funnel: { firstVoices: first ? first.voices : 0, lastVoices: last ? last.voices : 0, firstWeek: first && first.week, lastWeek: last && last.week, firstShare: first ? first.politicalShare : 0, lastShare: last ? last.politicalShare : 0 },
      sources, top3Share: pct(top3, pol.length), creatorCount: creatorCounts.length,
      topics: topicRows, blindSpots, votesInRange: inRange,
      tone, people, peopleShare: pct(people, pol.length),
      examples, hasTitles, hasCreators
    };
    report.challenges = buildChallenges(report);
    return report;
  }

  /* ---------- challenges: things to go find, never answers ---------- */
  const BILL_PATH = [[/^H\.R\./, "house-bill"], [/^S\. ?\d/, "senate-bill"], [/^H\.J\.Res\./, "house-joint-resolution"], [/^H\.Con\.Res\./, "house-concurrent-resolution"], [/^H\.Res\./, "house-resolution"], [/^S\.J\.Res\./, "senate-joint-resolution"]];
  function billUrl(bill) {
    const m = BILL_PATH.find(([re]) => re.test(bill)); const num = (bill.match(/(\d+)\s*$/) || [])[1];
    return m && num ? `https://www.congress.gov/bill/119th-congress/${m[1]}/${num}` : "https://www.congress.gov/";
  }
  function rollUrl(v) { return `https://clerk.house.gov/Votes/${v.date.slice(0, 4)}${String(v.roll).padStart(3, "0")}`; }

  function buildChallenges(r) {
    const out = [];
    const spot = r.blindSpots[0];
    if (spot) {
      const v = spot.voteList.slice().sort((a, b) => (b.yea + b.nay) - (a.yea + a.nay))[0];
      out.push({ id: "blind-" + spot.id, kind: "Blind spot",
        title: `Read one ${spot.name.toLowerCase()} bill your feed skipped`,
        body: `The House voted on ${spot.votes} ${spot.name.toLowerCase()} bills while this history was recorded. ${spot.videos === 0 ? "None of your videos" : "Only " + spot.videos + " of your videos"} touched the topic. Find out what the ${v.bill} (${v.title}) does, using the official summary, not a video about it. Then decide whether you agree with how it passed, ${v.yea} to ${v.nay}.`,
        links: [{ label: `${v.bill} on Congress.gov`, url: billUrl(v.bill) }, { label: `Roll call ${v.roll} at the House Clerk`, url: rollUrl(v) }] });
    }
    const concentrated = r.topics.filter(t => t.videos >= 15).sort((a, b) => b.topCreatorShare - a.topCreatorShare)[0];
    if (concentrated) {
      out.push({ id: "voice-" + concentrated.id, kind: "One voice",
        title: `Find a second voice on ${concentrated.name.toLowerCase()}`,
        body: `${Math.round(concentrated.topCreatorShare * 100)}% of your ${concentrated.name.toLowerCase()} videos came from a single creator. Find one reporter, outlet or official source that covers the same story and would disagree with that creator. Write down one thing they say that your feed never mentioned.`,
        links: [{ label: "Search news coverage", url: "https://duckduckgo.com/?q=" + encodeURIComponent(concentrated.name + " news this week") + "&ia=news" }] });
    }
    const loud = r.topics.filter(t => t.videos >= 10).sort((a, b) => b.conflictShare - a.conflictShare)[0];
    if (loud) {
      const v = (loud.voteList[0]) || null;
      out.push({ id: "source-" + loud.id, kind: "Primary source",
        title: `Go to the source behind the shouting`,
        body: `${Math.round(loud.conflictShare * 100)}% of your ${loud.name.toLowerCase()} videos were framed as a fight. Pick one of those videos and find the document it is reacting to: a bill, a vote, a court filing or a full speech. Compare the actual words with how the video described them.`,
        links: v ? [{ label: `${v.bill} on Congress.gov`, url: billUrl(v.bill) }, { label: "All House roll call votes", url: "https://clerk.house.gov/Votes" }] : [{ label: "All House roll call votes", url: "https://clerk.house.gov/Votes" }, { label: "Congress.gov", url: "https://www.congress.gov/" }] });
    }
    return out.slice(0, 3);
  }

  const api = { parseFiles, parseTikTok, parseYouTube, classify, analyze, effectiveNumber, billUrl, rollUrl, weekStart, CHOSEN_WINDOW_MIN };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Spoonfed = api;
})(typeof window !== "undefined" ? window : globalThis);
