/* Spoonfed page logic: routing, file loading, drawing the report. */
(function () {
  "use strict";
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => [...(el || document).querySelectorAll(s)];
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pc = (x, d) => (x * 100).toFixed(d || 0) + "%";
  const pcSmart = x => (x > 0 && x < 0.01) ? "under 1%" : Math.round(x * 100) + "%";
  const num = n => Number(n).toLocaleString("en-US");
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = d => { d = new Date(d); return MONTHS[d.getUTCMonth()] + " " + d.getUTCDate(); };
  const dayY = d => { d = new Date(d); return day(d) + ", " + d.getUTCFullYear(); };
  const listJoin = a => a.length < 2 ? (a[0] || "") : a.slice(0, -1).join(", ") + (a.length > 2 ? "," : "") + " or " + a[a.length - 1];
  const SVGNS = "http://www.w3.org/2000/svg";

  /* ---------- storage (always optional) ---------- */
  const store = {
    get(k, def) { try { const v = localStorage.getItem("spoonfed." + k); return v ? JSON.parse(v) : def; } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem("spoonfed." + k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  };

  /* ---------- routing ---------- */
  function route() {
    const name = (location.hash.replace(/^#\/?/, "") || "analyze").split("?")[0];
    const view = ["analyze", "method", "research", "about"].includes(name) ? name : "analyze";
    $$("[data-view]").forEach(s => { s.hidden = s.dataset.view !== view; });
    $$(".nav a").forEach(a => a.setAttribute("aria-current", (a.getAttribute("href").replace("#/", "") || "analyze") === view ? "page" : "false"));
    if (view !== "analyze" || !state.report) window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);

  /* ---------- rules ---------- */
  const state = { rules: null, votes: null, parsed: null, report: null, sample: false };
  async function loadRules() {
    if (state.rules) return;
    const get = p => fetch(p).then(r => { if (!r.ok) throw new Error(p); return r.json(); });
    const [topics, tone, votes] = await Promise.all([get("data/topics.json"), get("data/tone.json"), get("data/house-votes.json")]);
    state.rules = { topics, tone }; state.votes = votes;
  }

  /* ---------- file reading ---------- */
  async function readInputs(fileList) {
    const out = [];
    for (const f of fileList) {
      if (/\.zip$/i.test(f.name) || f.type.includes("zip")) {
        const zip = await JSZip.loadAsync(await f.arrayBuffer());
        const entries = Object.values(zip.files).filter(e => !e.dir && /\.json$/i.test(e.name) && !/__MACOSX/.test(e.name));
        const wanted = entries.filter(e => /(user_data.*\.json|watch-history\.json|search-history\.json)$/i.test(e.name));
        for (const e of (wanted.length ? wanted : entries)) {
          try { out.push({ name: e.name, json: JSON.parse(await e.async("string")) }); } catch (err) { /* skip non-JSON */ }
        }
      } else {
        const text = await f.text();
        try { out.push({ name: f.name, json: JSON.parse(text) }); }
        catch (err) { throw new Error(`${f.name} is not a JSON file. Request your data in JSON format, not HTML or TXT.`); }
      }
    }
    return out;
  }

  async function run(files, isSample) {
    const err = $("#error"); err.hidden = true;
    try {
      await loadRules();
      state.parsed = Spoonfed.parseFiles(files);
      state.sample = !!isSample;
      analyzeAndDraw(true);
    } catch (e) {
      err.textContent = e.message || String(e); err.hidden = false;
    }
  }

  function ratingsKey() { return "ratings." + state.parsed.platform; }
  function analyzeAndDraw(scroll) {
    const ratings = store.get(ratingsKey(), {});
    state.report = Spoonfed.analyze(state.parsed, state.rules, state.votes, { ratings });
    draw(state.report, ratings);
    if (scroll) $("#report").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  /* ---------- drawing helpers ---------- */
  function svg(w, h, cls) { const s = document.createElementNS(SVGNS, "svg"); s.setAttribute("viewBox", `0 0 ${w} ${h}`); s.setAttribute("class", cls || "chart"); s.setAttribute("preserveAspectRatio", "none"); return s; }
  function el(tag, attrs, parent) { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
  function text(parent, x, y, s, attrs) { const t = el("text", Object.assign({ x, y }, attrs || {}), parent); t.textContent = s; return t; }
  const how = body => `<details class="how"><summary>How this is calculated</summary><p>${body}</p></details>`;

  function drawStrip(r, host) {
    const W = 1000, H = 132, s = svg(W, H, "strip");
    s.setAttribute("role", "img");
    s.setAttribute("aria-label", `${r.political} political videos in time order. ${r.chosen} chosen, ${r.fed} fed.`);
    const N = r.strip.length, x = i => 1 + (W - 2) * (i + 0.5) / Math.max(1, N), bw = Math.max(0.6, Math.min(4, (W - 2) / Math.max(1, N) * 0.62));
    r.strip.forEach((v, i) => { if (!v.chosen) el("rect", { x: x(i) - bw / 2, y: 30, width: bw, height: 102, fill: "#c3c8d0" }, s); });
    r.strip.forEach((v, i) => { if (v.chosen) el("rect", { x: x(i) - Math.max(bw, 2.4) / 2, y: 0, width: Math.max(bw, 2.4), height: 132, fill: "#157a4b" }, s); });
    host.appendChild(s);
    const lab = document.createElement("div"); lab.className = "legend"; lab.style.justifyContent = "space-between"; lab.style.marginTop = "8px";
    lab.innerHTML = N ? `<span>${day(r.strip[0].t)}</span><span>${day(r.strip[Math.floor(N / 2)].t)}</span><span>${day(r.strip[N - 1].t)}</span>` : "";
    host.appendChild(lab);
  }

  function drawFunnel(r, host) {
    const wk = r.weekly; const n = wk.length; if (!n) return;
    const W = 1000, H = 260, mid = 120, maxV = Math.max(...wk.map(w => w.voices), 1);
    const s = svg(W, H); s.setAttribute("preserveAspectRatio", "xMidYMid meet"); s.setAttribute("role", "img");
    s.setAttribute("aria-label", "Effective number of political voices per week: " + wk.map(w => day(w.week) + " " + w.voices.toFixed(1)).join(", "));
    const xs = i => n === 1 ? W / 2 : 40 + (W - 80) * i / (n - 1);
    const hh = v => 8 + 100 * v / maxV;
    const top = wk.map((w, i) => `${xs(i)},${mid - hh(w.voices)}`), bot = wk.map((w, i) => `${xs(i)},${mid + hh(w.voices)}`).reverse();
    el("polygon", { points: top.concat(bot).join(" "), fill: "#e9ebef" }, s);
    el("polyline", { points: top.join(" "), fill: "none", stroke: "#000", "stroke-width": 1.5 }, s);
    el("polyline", { points: bot.join(" "), fill: "none", stroke: "#000", "stroke-width": 1.5 }, s);
    el("line", { x1: 20, x2: W - 20, y1: mid, y2: mid, stroke: "#c3c8d0", "stroke-dasharray": "3 4" }, s);
    wk.forEach((w, i) => {
      text(s, xs(i), mid + 5, w.voices ? w.voices.toFixed(1) : "0", { "text-anchor": "middle", style: "font-weight:600;fill:#000;font-size:15px" });
      text(s, xs(i), H - 12, "Week of " + day(w.week), { "text-anchor": "middle" });
    });
    host.appendChild(s);
  }

  function drawLean(r, host) {
    const rows = r.weekly.filter(w => w.political);
    const anyRated = rows.some(w => w.left + w.center + w.right);
    if (!anyRated) { host.innerHTML = `<p class="muted small" style="margin-top:20px">Rate at least one source above and your lean by week appears here.</p>`; return; }
    host.innerHTML = rows.map(w => {
      const un = Math.max(0, w.political - w.left - w.center - w.right), T = w.political;
      const seg = (n, c, label) => n ? `<div title="${label}: ${n}" style="width:${100 * n / T}%;background:${c}"></div>` : "";
      return `<div style="display:grid;grid-template-columns:120px 1fr;gap:16px;align-items:center;margin-top:10px"><span class="small muted">Week of ${day(w.week)}</span>
        <div class="tonebar" style="margin:0;height:22px;border-radius:5px">${seg(w.left, "var(--left)", "Left")}${seg(w.center, "var(--center)", "Center")}${seg(w.right, "var(--right)", "Right")}${seg(un, "#eceef1", "Not rated")}</div></div>`;
    }).join("") + `<div class="legend" style="margin-top:14px"><span><i style="background:var(--left)"></i>Rated left by you</span><span><i style="background:var(--center)"></i>Center</span><span><i style="background:var(--right)"></i>Right</span><span><i style="background:#eceef1"></i>Not rated</span></div>`;
  }

  /* ---------- main report ---------- */
  function draw(r, ratings) {
    const host = $("#report"); host.hidden = false;
    const fewChosen = r.chosenShare < 0.5;
    const narrowed = r.funnel.lastVoices < r.funnel.firstVoices * 0.9, widened = r.funnel.lastVoices > r.funnel.firstVoices * 1.1;
    const found = store.get("found", {});
    const maxVid = Math.max(...r.topics.map(t => t.videos), 1), maxVote = Math.max(...r.topics.map(t => t.votes), 1);

    host.innerHTML = `
    <div class="wrap">
      <div class="report-meta">
        <span>${esc(r.platform)} history, ${dayY(r.start)} to ${dayY(r.end)}. ${num(r.totalViews)} videos, ${num(r.searches)} searches.</span>
        ${state.sample ? `<span class="tag">Sample data from a fictional user</span>` : `<span>Analyzed on this device</span>`}
      </div>
      ${!r.hasTitles ? `<p class="error" style="margin-top:18px">This download has no video titles, so Spoonfed can count your videos but cannot tell which ones were political. Newer TikTok downloads include titles. Try requesting a new one.</p>` : ""}

      <div class="hero">
        <div class="big">${r.political ? pcSmart(r.chosenShare) : "0%"}</div>
        <h2>of the politics you watched, you went looking for.</h2>
        <p>Out of ${num(r.political)} political videos, ${num(r.chosen)} came right after you searched for that topic. The other ${num(r.fed)} ${fewChosen ? "were picked for you" : "were picked for you by the app"}.</p>
      </div>

      <div class="strip-wrap" id="strip"></div>
      <div class="legend"><span><i style="background:var(--chosen)"></i>Chosen: you searched first</span><span><i style="background:var(--fed)"></i>Fed: the app chose it</span><span>Every mark is one political video, in the order you watched it.</span></div>
      ${how(`A political video counts as chosen if you searched for the same topic, or a word from its title, in the ${Spoonfed.CHOSEN_WINDOW_MIN} minutes before watching it. ${r.examples.chosen.length ? "For example, you searched “" + esc(r.examples.chosen[0].search) + "” and then watched “" + esc(r.examples.chosen[0].title) + ".”" : ""} You made ${num(r.politicalSearches)} political searches in this history.`)}

      <div class="facts">
        <div class="fact"><div class="n">${pc(r.politicalShare)}</div><div class="l">of everything you watched was political, from ${pc(r.funnel.firstShare)} in the first full week to ${pc(r.funnel.lastShare)} in the last.</div></div>
        <div class="fact"><div class="n">${r.hasCreators ? pc(r.top3Share) : "n/a"}</div><div class="l">${r.hasCreators ? `of your political videos came from just 3 of ${num(r.creatorCount)} creators.` : "Creator names are missing from this download."}</div></div>
        <div class="fact"><div class="n">${pc(r.peopleShare)}</div><div class="l">were about a politician as a person, not about a policy.</div></div>
      </div>
    </div>

    <div class="section"><div class="wrap">
      <h2>${narrowed ? "Your feed narrowed" : widened ? "Your feed widened" : "Your feed held steady"}</h2>
      <p class="lede">In the week of ${day(r.funnel.firstWeek)}, your political videos came from the equivalent of ${r.funnel.firstVoices.toFixed(1)} equal voices. By the week of ${day(r.funnel.lastWeek)}, it was ${r.funnel.lastVoices.toFixed(1)}.${narrowed ? " The more you watched, the fewer people you heard from." : ""}</p>
      <div id="funnel"></div>
      ${how("Each week, Spoonfed counts how many political videos came from each creator and converts that into an effective number of voices: 10 creators with equal shares count as 10, and one creator who made nearly everything counts as about 1. It is the exponential of the Shannon entropy of creator shares. The width of the shape is that number.")}
    </div></div>

    <div class="section"><div class="wrap">
      <h2>How it was framed</h2>
      <p class="lede">${pc(r.tone.conflict / Math.max(1, r.political))} of your political videos were framed as a fight. ${pc(r.tone.explaining / Math.max(1, r.political))} set out to explain something.</p>
      <div class="tonebar" role="img" aria-label="Conflict ${r.tone.conflict}, neutral ${r.tone.neutral}, explaining ${r.tone.explaining}">
        <div style="width:${100 * r.tone.conflict / Math.max(1, r.political)}%;background:var(--conflict)"></div>
        <div style="width:${100 * r.tone.neutral / Math.max(1, r.political)}%;background:var(--fed)"></div>
        <div style="width:${100 * r.tone.explaining / Math.max(1, r.political)}%;background:var(--chosen)"></div>
      </div>
      <div class="legend"><span><i style="background:var(--conflict)"></i>Conflict ${num(r.tone.conflict)}</span><span><i style="background:var(--fed)"></i>Neutral ${num(r.tone.neutral)}</span><span><i style="background:var(--chosen)"></i>Explaining ${num(r.tone.explaining)}</span></div>
      ${r.examples.conflict.length ? `<ul class="quotes">${r.examples.conflict.map(t => `<li>${esc(t)}</li>`).join("")}</ul><p class="small muted" style="margin-top:10px">Recent titles from your history labeled conflict.</p>` : ""}
      ${how("Each conflict word in a title adds 1, such as “destroys”, “slams” or “exposed”. Capital-letter shouting adds 1, and “!!” or “??” adds 1. A score of 2 or more is conflict. A score of 0 with an explaining word such as “explained” or “breakdown” is explaining. Everything else is neutral. The full word lists are on the How it works page.")}
    </div></div>

    <div class="section"><div class="wrap">
      <h2>What the House voted on, and what you saw</h2>
      <p class="lede">${r.votesInRange.length ? `The House held ${r.votesInRange.length} recorded votes on bills and resolutions while this history was recorded.` : "No House votes in Spoonfed's data fall within the dates of this history. The topic list below shows only your videos."} ${r.blindSpots.length ? `Your feed barely touched ${listJoin(r.blindSpots.map(b => b.name.toLowerCase()))}.` : ""}</p>
      <table>
        <thead><tr><th>Topic</th><th>Your videos</th><th class="barcell"></th><th>House votes</th><th class="barcell"></th></tr></thead>
        <tbody>${r.topics.map(t => {
          const blind = r.blindSpots.some(b => b.id === t.id);
          return `<tr><td>${t.votes ? `<button class="linkbtn" data-expand="${t.id}" aria-expanded="false">${esc(t.name)}</button>` : esc(t.name)}${blind ? `<span class="flag">Blind spot</span>` : ""}</td>
            <td class="num">${num(t.videos)}</td><td class="barcell"><div class="bar" style="width:${100 * t.videos / maxVid}%"></div></td>
            <td class="num">${t.votes || ""}</td><td class="barcell">${t.votes ? `<div class="bar vote" style="width:${100 * t.votes / maxVote}%"></div>` : ""}</td></tr>
            ${t.votes ? `<tr class="expand" data-for="${t.id}" hidden><td colspan="5"><ul class="votes">${t.voteList.map(v => `<li>${esc(dayY(v.date + "T12:00:00Z"))}: <a href="${Spoonfed.billUrl(v.bill)}">${esc(v.bill)}</a>, ${esc(v.title)}. ${v.yea} to ${v.nay}. <a href="${Spoonfed.rollUrl(v)}">Roll call ${v.roll}</a></li>`).join("")}</ul></td></tr>` : ""}`;
        }).join("")}</tbody>
      </table>
      ${how(`Votes are final-passage and similar roll calls from the House Clerk, placed in a topic by their title. A topic is a blind spot when the House held at least 2 votes on it and it made up less than 2% of your political videos. Click a topic to see its votes and open the bills.`)}
    </div></div>

    <div class="section"><div class="wrap">
      <h2>Who fed you</h2>
      <p class="lede">Spoonfed does not decide which side anyone is on. Look up the sources that fed you most, rate them yourself, and your lean by week appears below.</p>
      ${r.hasCreators ? `<table class="srctable"><thead><tr><th>Source</th><th>Videos</th><th class="barcell">Share of your political feed</th><th>Your rating</th></tr></thead><tbody>
        ${r.sources.map(s => `<tr><td class="src-name">${esc(s.name)}<a class="lookup" href="https://duckduckgo.com/?q=${encodeURIComponent(s.name + " " + r.platform + " political views")}">Look up</a></td><td class="num">${num(s.count)}</td>
          <td class="barcell"><div class="bar" style="width:${100 * s.share / r.sources[0].share}%;background:var(--ink)"></div></td>
          <td><div class="seg" role="group" aria-label="Rate ${esc(s.name)}">${["left", "center", "right", "unsure"].map(v => `<button data-rate="${esc(s.name)}" data-v="${v}" aria-pressed="${ratings[s.name] === v}">${v === "unsure" ? "Not sure" : v[0].toUpperCase() + v.slice(1)}</button>`).join("")}</div></td></tr>`).join("")}
      </tbody></table><div id="lean"></div>` : `<p class="muted">This download does not include creator names.</p>`}
      ${how("Your ratings are saved only in this browser. The lean chart counts each political video by the rating you gave its source. Sources you have not rated show as not rated.")}
    </div></div>

    <div class="section"><div class="wrap">
      <h2>Go find it yourself</h2>
      <p class="lede">These come from your own report. Each one points you to a primary source, never a summary, because the only way out of a feed is to look for things on purpose.</p>
      <div class="tasks">${r.challenges.map(c => {
        const f = found[c.id];
        return `<div class="task${f ? " done" : ""}" data-task="${c.id}">
          <div class="kind">${esc(c.kind)}</div>
          <div><h3>${esc(c.title)}</h3><p>${esc(c.body)}</p>
            <div class="links">${c.links.map(l => `<a href="${l.url}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join("")}</div>
            <div class="found">${f ? `<span class="saved">Found ${esc(dayY(f.at))}${f.url ? `: <a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.url.replace(/^https?:\/\//, "").slice(0, 60))}</a>` : ""}</span>` :
              `<label class="small muted" for="in-${c.id}">What did you find?</label><input id="in-${c.id}" type="url" placeholder="Paste the link to your source"><button class="btn small" data-found="${c.id}">Mark as found</button>`}</div>
          </div></div>`;
      }).join("")}</div>
    </div></div>

    <div class="section"><div class="wrap">
      <h2>Check again next month</h2>
      <p class="lede">Save this result on this device. Next month, open a new download and Spoonfed will show whether your feed got wider and how much more of it you chose.</p>
      <div id="compare"></div>
      <p style="margin-top:22px"><button class="btn" id="save">Save this result</button> <span class="small muted" id="saved-msg"></span></p>
    </div></div>`;

    drawStrip(r, $("#strip"));
    drawFunnel(r, $("#funnel"));
    if ($("#lean")) drawLean(r, $("#lean"));
    drawCompare(r);
  }

  function summary(r) { return { platform: r.platform, start: r.start, end: r.end, chosenShare: r.chosenShare, voices: r.funnel.lastVoices, politicalShare: r.politicalShare, conflictShare: r.tone.conflict / Math.max(1, r.political), savedAt: new Date().toISOString(), sample: state.sample }; }
  function drawCompare(r) {
    const hist = store.get("history", []).filter(h => h.platform === r.platform && h.sample === state.sample && new Date(h.end) < new Date(r.start));
    const prev = hist[hist.length - 1]; const host = $("#compare");
    if (!prev) { host.innerHTML = ""; return; }
    const d = (a, b, f, better) => { const diff = a - b; const word = diff === 0 ? "no change" : (diff > 0 ? "up " : "down ") + f(Math.abs(diff)); return `<div class="d">${word} from ${dayY(prev.end)}${diff !== 0 ? (((diff > 0) === better) ? ", better" : "") : ""}</div>`; };
    host.innerHTML = `<div class="compare">
      <div><div class="n">${pcSmart(r.chosenShare)}</div><div class="small muted">chosen</div>${d(r.chosenShare, prev.chosenShare, x => (x * 100).toFixed(0) + " points", true)}</div>
      <div><div class="n">${r.funnel.lastVoices.toFixed(1)}</div><div class="small muted">voices in your last week</div>${d(r.funnel.lastVoices, prev.voices, x => x.toFixed(1), true)}</div>
      <div><div class="n">${pc(r.tone.conflict / Math.max(1, r.political))}</div><div class="small muted">framed as a fight</div>${d(r.tone.conflict / Math.max(1, r.political), prev.conflictShare, x => (x * 100).toFixed(0) + " points", false)}</div></div>`;
  }

  /* ---------- events ---------- */
  document.addEventListener("click", e => {
    const t = e.target.closest("button, [data-sample]"); if (!t) return;
    if (t.dataset.sample) {
      const url = t.dataset.sample === "tiktok" ? "samples/tiktok-sample.zip" : "samples/youtube-sample.zip";
      fetch(url).then(r => r.blob()).then(b => readInputs([new File([b], url.split("/").pop(), { type: "application/zip" })])).then(f => run(f, true)).catch(err => { $("#error").textContent = "The sample could not be opened. " + err.message; $("#error").hidden = false; });
    } else if (t.dataset.expand) {
      const row = $(`tr[data-for="${t.dataset.expand}"]`); row.hidden = !row.hidden; t.setAttribute("aria-expanded", String(!row.hidden));
    } else if (t.dataset.rate) {
      const ratings = store.get(ratingsKey(), {}); ratings[t.dataset.rate] = t.dataset.v; store.set(ratingsKey(), ratings);
      $$(`button[data-rate="${CSS.escape(t.dataset.rate)}"]`).forEach(b => b.setAttribute("aria-pressed", String(b === t)));
      state.report = Spoonfed.analyze(state.parsed, state.rules, state.votes, { ratings });
      drawLean(state.report, $("#lean"));
    } else if (t.dataset.found) {
      const id = t.dataset.found, input = $("#in-" + CSS.escape(id)); const url = (input.value || "").trim();
      if (url && !/^https?:\/\/\S+\.\S+/.test(url)) { input.setCustomValidity("Paste a full link that starts with https://"); input.reportValidity(); return; }
      const found = store.get("found", {}); found[id] = { at: new Date().toISOString(), url }; store.set("found", found);
      const box = t.parentElement; box.innerHTML = `<span class="saved">Found ${esc(dayY(found[id].at))}${url ? ": " + esc(url.replace(/^https?:\/\//, "").slice(0, 60)) : ""}</span>`;
      box.closest(".task").classList.add("done");
    } else if (t.id === "save") {
      const hist = store.get("history", []); hist.push(summary(state.report));
      $("#saved-msg").textContent = store.set("history", hist.slice(-24)) ? "Saved on this device." : "This browser is not allowing saved data, so the result could not be kept.";
    }
  });

  const fileInput = $("#file");
  fileInput.addEventListener("change", async () => { if (!fileInput.files.length) return; try { await run(await readInputs([...fileInput.files]), false); } catch (e) { $("#error").textContent = e.message; $("#error").hidden = false; } fileInput.value = ""; });
  const drop = $("#drop");
  ["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", async e => { const files = [...e.dataTransfer.files]; if (!files.length) return; try { await run(await readInputs(files), false); } catch (err) { $("#error").textContent = err.message; $("#error").hidden = false; } });

  route();
  loadRules().catch(() => { $("#error").textContent = "Spoonfed's rule files did not load. If you opened index.html straight from your computer, run it from a web server or GitHub Pages instead."; $("#error").hidden = false; });
})();
