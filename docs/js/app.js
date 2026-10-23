/* Kilowhen interface. */
(function () {
  "use strict";
  const K = window.Kilowhen;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => [...(el || document).querySelectorAll(s)];
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const NS = "http://www.w3.org/2000/svg";
  const tip = t => `<span class="tip" tabindex="0" data-tip="${esc(t)}">?</span>`;
  const store = {
    get(k, d) { try { const v = localStorage.getItem("kilowhen." + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("kilowhen." + k, JSON.stringify(v)); } catch (e) { /* storage off: settings just won't persist */ } }
  };

  /* ---------- formatting ---------- */
  const hr = h => { h = ((h % 24) + 24) % 24; return h === 0 ? "12 AM" : h === 12 ? "Noon" : h < 12 ? h + " AM" : (h - 12) + " PM"; };
  const hrShort = h => { h = ((h % 24) + 24) % 24; return h === 0 ? "12a" : h === 12 ? "12p" : h < 12 ? h + "a" : (h - 12) + "p"; };
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dayName = d => { const x = new Date(d + "T12:00:00Z"); return `${DOW[x.getUTCDay()]}, ${MON[x.getUTCMonth()]} ${x.getUTCDate()}`; };
  const money = v => "$" + (Math.abs(v) >= 100 ? Math.round(v).toLocaleString("en-US") : v.toFixed(2));
  const sig = (v, kind) => kind === "co2" ? Math.round(v).toLocaleString("en-US") : "$" + v.toFixed(v >= 100 ? 0 : 2);
  const sigUnit = kind => kind === "co2" ? "lb CO2 per MWh" : "per MWh";
  const pct = v => Math.round(v * 100) + "%";
  const span = (a, b) => `${hr(a)} to ${hr(b)}`;

  /* color: cheap teal -> peak amber */
  const C1 = [61, 214, 192], C2 = [255, 178, 36];
  const color = (v, lo, hi) => { const t = hi > lo ? Math.max(0, Math.min(1, (v - lo) / (hi - lo))) : 0; const c = C1.map((x, i) => Math.round(x + (C2[i] - x) * Math.pow(t, 1.1))); return `rgb(${c.join(",")})`; };

  /* ---------- state ---------- */
  const S = { regions: [], region: null, data: null, zone: null, t: [], nowIdx: 0, stale: false, clockDay: "today", places: [] };
  const DEFAULT_LOADS = [
    { id: "ev", name: "Electric car charging", kw: 7.2, hours: 4, usual: 18, by: 7, on: true },
    { id: "dryer", name: "Clothes dryer", kw: 3.0, hours: 1, usual: 18, by: 23, on: true },
    { id: "dish", name: "Dishwasher", kw: 1.2, hours: 2, usual: 19, by: 7, on: true },
    { id: "washer", name: "Washing machine", kw: 0.5, hours: 1, usual: 18, by: 23, on: false },
    { id: "water", name: "Electric water heater", kw: 4.5, hours: 2, usual: 17, by: 6, on: false },
    { id: "pool", name: "Pool pump", kw: 1.5, hours: 6, usual: 12, by: 23, on: false }
  ];
  let loads = store.get("loads", DEFAULT_LOADS);
  let tou = store.get("tou", { peak: "", off: "", start: 14, end: 19 });
  let tg = store.get("together", { place: "ny17", pct: 10, kw: null, unit: 40 });

  /* ---------- time ---------- */
  function localNow(tz) {
    const at = new URLSearchParams(location.search).get("at"); // demo override: ?at=2026-10-23T18
    if (at && /^\d{4}-\d{2}-\d{2}T\d{2}/.test(at)) return { date: at.slice(0, 10), hour: +at.slice(11, 13), minute: 0 };
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map(p => [p.type, p.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: +parts.hour % 24, minute: +parts.minute };
  }

  /* ---------- loading ---------- */
  async function getJSON(p) { const r = await fetch(p, { cache: "no-cache" }); if (!r.ok) throw new Error(p); return r.json(); }
  async function init() {
    try {
      const [reg, places] = await Promise.all([getJSON("data/regions.json"), getJSON("data/places.json")]);
      S.regions = reg.regions; S.places = places.places;
      $("#region").innerHTML = S.regions.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join("");
      const saved = store.get("region", null);
      await loadRegion(S.regions.find(r => r.id === saved) ? saved : S.regions[0].id);
    } catch (e) {
      $("#view-now").innerHTML = `<h1>Grid data didn't load</h1><p class="sub error">If you opened index.html straight from your computer, run it from a web server or GitHub Pages instead. (${esc(e.message)})</p>`;
    }
    route();
  }
  async function loadRegion(id) {
    S.region = S.regions.find(r => r.id === id); store.set("region", id);
    $("#region").value = id;
    S.data = await getJSON("data/" + S.region.file);
    const z = store.get("zone." + id, S.data.defaultZone);
    $("#zone").innerHTML = S.data.zones.map(z => `<option value="${esc(z.id)}">${esc(z.name)}</option>`).join("");
    setZone(S.data.zones.some(x => x.id === z) ? z : S.data.defaultZone);
  }
  function setZone(z) {
    S.zone = z; store.set("zone." + S.region.id, z); $("#zone").value = z;
    S.t = K.timeline(S.data, z);
    const n = localNow(S.data.timezone);
    let i = K.indexOf(S.t, n.date, n.hour);
    S.stale = i < 0;
    if (i < 0) { // data doesn't cover today: show the latest day we have at the same hour
      const lastDay = S.t.length ? S.t[S.t.length - 1].date : null;
      i = n.date > (lastDay || "") ? K.indexOf(S.t, lastDay, n.hour) : 0;
    }
    S.nowIdx = Math.max(0, i); S.minute = n.minute;
    stamp(); renderAll();
  }

  function stamp() {
    const d = S.data, built = new Date(d.built), ageH = (Date.now() - built) / 36e5;
    const last = d.days[d.days.length - 1];
    const when = built.toLocaleString("en-US", { timeZone: d.timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    $("#stamp").innerHTML = `<span class="dot${ageH > 3 || S.stale ? " stale" : ""}"></span><span>${S.data.signalKind === "co2" ? "Emissions outlook" : "Day-ahead prices"} through ${dayName(last)}. Updated ${esc(when)}.</span>`;
    $("#source-foot").innerHTML = `Data: <a href="${esc(d.sourceUrl)}" target="_blank" rel="noopener">${esc(d.region === "NYISO" ? "NYISO" : "U.S. EIA")}</a>`;
  }

  /* ---------- routing ---------- */
  const VIEWS = ["now", "plan", "together", "week", "how", "about"];
  function route() {
    const v = (location.hash.replace(/^#\/?/, "") || "now"); const view = VIEWS.includes(v) ? v : "now";
    $$("[data-view]").forEach(s => { s.hidden = s.dataset.view !== view; });
    $$(".rail a.tab, .tabbar a").forEach(a => a.setAttribute("aria-current", a.getAttribute("href") === "#/" + view ? "page" : "false"));
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);

  function renderAll() { if (!S.t.length) return; renderNow(); renderPlan(); renderTogether(); renderWeek(); }

  /* ---------- the Peaker Clock ---------- */
  function clockSVG(day, opts) {
    const hours = S.t.filter(x => x.date === day); if (hours.length < 24) return "";
    const lo = Math.min(...hours.map(x => x.price)), hi = Math.max(...hours.map(x => x.price));
    const W = 440, c = W / 2, R1 = 176, R0 = 120, kind = S.data.signalKind;
    const pt = (r, a) => [c + r * Math.sin(a), c - r * Math.cos(a)];
    const arc = (r0, r1, a0, a1) => { const [x0, y0] = pt(r1, a0), [x1, y1] = pt(r1, a1), [x2, y2] = pt(r0, a1), [x3, y3] = pt(r0, a0); const lg = a1 - a0 > Math.PI ? 1 : 0; return `M${x0},${y0}A${r1},${r1} 0 ${lg} 1 ${x1},${y1}L${x2},${y2}A${r0},${r0} 0 ${lg} 0 ${x3},${y3}Z`; };
    const step = 2 * Math.PI / 24, gap = 0.012;
    let s = `<svg class="clock" viewBox="0 0 ${W} ${W}" role="img" aria-label="24-hour clock of ${kind === "co2" ? "expected emissions" : "prices"} for ${dayName(day)}. Peak hours: ${K.windows(hours.filter(x => x.peak).map(x => x.hour)).map(w => span(w.start, w.end)).join(", ") || "none"}.">`;
    hours.forEach((x, h) => {
      s += `<path d="${arc(R0, R1, h * step + gap, (h + 1) * step - gap)}" fill="${color(x.price, lo, hi)}" opacity="${opts.past && opts.past(x) ? 0.32 : 1}"><title>${hr(h)}: ${sig(x.price, kind)} ${sigUnit(kind)}${x.peak ? ", peak hour" : ""}</title></path>`;
      if (x.peak) s += `<path d="${arc(R1 + 7, R1 + 13, h * step + gap, (h + 1) * step - gap)}" fill="#ffb224"/>`;
    });
    (opts.blocks || []).forEach(b => { s += `<path d="${arc(R0 - 16, R0 - 8, b.start * step + gap, Math.min(24, b.start + b.len) * step - gap)}" fill="#e9eef6" opacity=".9"/>`; });
    [[0, "12 AM"], [6, "6 AM"], [12, "Noon"], [18, "6 PM"]].forEach(([h, l]) => { const [x, y] = pt(R1 + 30, h * step); s += `<text x="${x}" y="${y + 4}" text-anchor="middle" font-size="12" fill="#8c9bb4">${l}</text>`; });
    if (opts.hand != null) {
      const a = opts.hand * step, [x, y] = pt(R1 - 4, a), [x2, y2] = pt(R0 - 26, a);
      s += `<line x1="${x2}" y1="${y2}" x2="${x}" y2="${y}" stroke="#e9eef6" stroke-width="3" stroke-linecap="round"/><circle cx="${x}" cy="${y}" r="5" fill="#e9eef6"/>`;
    }
    s += `<text x="${c}" y="${c - 8}" text-anchor="middle" font-size="40" font-weight="650" fill="#e9eef6" letter-spacing="-1">${esc(opts.center1)}</text>`;
    s += `<text x="${c}" y="${c + 20}" text-anchor="middle" font-size="13" fill="#8c9bb4">${esc(opts.center2)}</text>`;
    return s + "</svg>";
  }

  /* ---------- NOW ---------- */
  function renderNow() {
    const t = S.t, i = S.nowIdx, kind = S.data.signalKind, n = K.now(t, i, 24), cur = n.cur, zoneName = S.data.zones.find(z => z.id === S.zone).name;
    const days = [...new Set(t.map(x => x.date))], today = cur.date, tomorrow = days[days.indexOf(today) + 1];
    const todayPeaks = K.windows(t.filter(x => x.date === today && x.peak && t.indexOf(x) >= i).map(x => x.hour));
    const best = t[n.bestIndex];
    const unit = kind === "co2" ? " lb/MWh" : "/MWh";
    const line = n.verdict === "go"
      ? `Power in ${zoneName} is ${sig(cur.price, kind)}${unit} right now, close to the best it gets in the next day. Run the big stuff.`
      : `Power in ${zoneName} is ${sig(cur.price, kind)}${unit} right now${cur.peak ? ", a peak hour" : ""}. The best 3 hours start at ${hr(best.hour)}${best.date !== today ? " tomorrow" : ""}, ${pct(n.saveVsNow)} ${kind === "co2" ? "cleaner" : "cheaper"}.`;
    const mix = latestMix();
    const showDay = S.clockDay === "tomorrow" && tomorrow ? tomorrow : today;
    const dayHours = t.filter(x => x.date === showDay);
    const clock = clockSVG(showDay, {
      hand: showDay === today ? cur.hour + (S.minute || 0) / 60 : null,
      past: showDay === today ? (x => t.indexOf(x) < i) : null,
      center1: showDay === today ? sig(cur.price, kind) : (K.windows(dayHours.filter(x => x.peak).map(x => x.hour))[0] ? span(...Object.values(K.windows(dayHours.filter(x => x.peak).map(x => x.hour))[0])) : "No peak"),
      center2: showDay === today ? (kind === "co2" ? "lb CO2 per MWh now" : "per MWh now") : "peak hours tomorrow",
      blocks: planBlocks(showDay)
    });
    const ahead = t.slice(i, i + 24), lo = Math.min(...ahead.map(x => x.price)), hi = Math.max(...ahead.map(x => x.price));

    $("#view-now").innerHTML = `
      <div class="grid g-now">
        <div class="card verdict">
          <div class="word ${n.verdict}">${n.verdict === "go" ? "Go." : "Wait."}</div>
          <p class="line">${esc(line)}</p>
          <div class="kv">
            <div><div class="n">${sig(cur.price, kind)}</div><div class="l">${hr(cur.hour)} ${kind === "co2" ? "lb CO2/MWh" : "price per MWh"} ${tip(kind === "co2" ? "Estimated pounds of carbon dioxide for each megawatt-hour generated, based on the typical fuel mix at this hour over the past week." : "The day-ahead wholesale price for this hour in your zone, in dollars per megawatt-hour. 1 MWh is 1,000 kWh, so $50/MWh is 5 cents per kWh for the energy itself.")}</div></div>
            <div><div class="n">${sig(n.min, kind)} to ${sig(n.max, kind)}</div><div class="l">Today's range</div></div>
            <div><div class="n ${todayPeaks.length ? "peak" : ""}">${todayPeaks.length ? span(todayPeaks[0].start, todayPeaks[0].end) : "Clear"}</div><div class="l">${todayPeaks.length ? "Next peak hours" : "No more peak hours today"} ${tip("Peak hours are when demand is near the day's high and prices are in the top quarter. That's when the grid calls on its last and most expensive power plants, called peakers.")}</div></div>
          </div>
          ${planList()}
          ${S.stale ? `<p class="note">The newest data is for ${dayName(today)}. It refreshes automatically every 30 minutes.</p>` : ""}
        </div>
        <div class="card clockwrap">
          <div style="display:flex;justify-content:space-between;align-items:center;width:100%;flex-wrap:wrap;gap:10px">
            <h2 style="margin:0">The Peaker Clock ${tip("Each slice is one hour. Teal hours are the cheapest and cleanest, amber the most expensive. The amber outer ring marks peak hours. White marks inside show when Plan my day would run your appliances.")}</h2>
            ${tomorrow ? `<div class="seg-ctl" role="group" aria-label="Day"><button data-day="today" aria-pressed="${showDay === today}">Today</button><button data-day="tomorrow" aria-pressed="${showDay !== today}">Tomorrow</button></div>` : ""}
          </div>
          ${clock}
          <div class="legend"><span>Cheaper<span class="ramp"></span>Pricier</span><span><i style="background:var(--peak)"></i>Peak hours</span><span><i style="background:var(--text)"></i>Your plan</span></div>
        </div>
        <div class="card">
          <h2>On the grid ${mix ? "at " + hr(mix.hour) : ""} ${tip("What New York's power plants were actually generating, by fuel, from the grid operator's five-minute data, averaged over the hour.")}</h2>
          ${mix ? mixBlock(mix) : `<p class="muted">Generation data for this region isn't available yet.</p>`}
        </div>
        <div class="card">
          <h2>Next 24 hours</h2>
          <div class="bars">${ahead.map(x => `<div class="${x.peak ? "pk" : ""}" title="${x.date === today ? "" : "Tomorrow "}${hr(x.hour)}: ${sig(x.price, kind)}" style="height:${8 + 92 * (x.price - lo) / Math.max(1e-9, hi - lo)}%;background:${color(x.price, lo, hi)}"></div>`).join("")}</div>
          <div class="axis">${ahead.map((x, k) => `<span>${k % 3 === 0 ? hrShort(x.hour) : ""}</span>`).join("")}</div>
          <p class="note">Amber marks are peak hours. ${ahead.filter(x => x.peak).length ? `The priciest hour ahead costs ${(hi / lo).toFixed(1)} times the cheapest.` : ""}</p>
        </div>
      </div>`;
  }
  function planList() {
    const res = currentPlan().filter(r => r.ok); if (!res.length) return "";
    const cur = S.t[S.nowIdx];
    return `<div><h2 style="font-size:14px;margin-bottom:8px">Your plan <a href="#/plan" class="small muted" style="font-weight:400;margin-left:6px">Edit</a></h2>${res.map(r => { const x = S.t[r.startIndex]; return `<div style="display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-top:1px solid var(--line)"><span>${esc(r.name)}</span><span><strong>${hr(x.hour)}</strong>${x.date !== cur.date ? ` <span class="muted">${dayName(x.date).slice(0, 3)}</span>` : ""}${r.pctLower > 0.005 ? ` <span class="cheap small">${pct(r.pctLower)} less</span>` : ""}</span></div>`; }).join("")}</div>`;
  }
  function latestMix() {
    const m = S.data.mix || []; if (!m.length) return null;
    const cur = S.t[S.nowIdx]; const key = x => x.date + String(x.hour).padStart(2, "0");
    const upto = m.filter(x => key(x) <= key(cur)); return (upto.length ? upto : m)[(upto.length ? upto : m).length - 1];
  }
  function mixBlock(m) {
    const e = K.intensity(m.mw), total = Object.values(m.mw).reduce((a, b) => a + b, 0);
    const COL = { "Nuclear": "#7e8fe0", "Hydro": "#4aa3df", "Wind": "#8fd3c9", "Solar": "#e8d36b", "Other Renewables": "#7fbf7f", "Natural Gas": "#d98c5f", "Dual Fuel": "#ffb224", "Other Fossil Fuels": "#ff6b4a", "Coal": "#6b6b6b", "Oil": "#ff6b4a", "Other": "#9aa5b8", "Battery": "#b48ce0" };
    const items = Object.entries(m.mw).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    return `<div class="kv" style="border-top:0">
        <div style="padding-top:0"><div class="n">${pct(e.fossil)}</div><div class="l">from fossil fuels</div></div>
        <div style="padding-top:0"><div class="n peak">${pct(e.peakerShare)}</div><div class="l">from dual-fuel and oil units ${tip("New York's 'dual fuel' plants can burn gas or oil. They include many of the older units the grid relies on at peak times.")}</div></div>
        <div style="padding-top:0"><div class="n">${Math.round(e.co2).toLocaleString("en-US")}</div><div class="l">lb CO2 per MWh, estimated</div></div>
      </div>
      <div class="mixbar">${items.map(([f, v]) => `<div title="${esc(f)} ${Math.round(v)} MW" style="width:${100 * v / total}%;background:${COL[f] || "#9aa5b8"}"></div>`).join("")}</div>
      <div class="mixlist">${items.map(([f, v]) => `<div><span><i style="display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px;background:${COL[f] || "#9aa5b8"}"></i>${esc(f)}</span><span>${Math.round(v).toLocaleString("en-US")} MW</span></div>`).join("")}</div>
      <p class="note">${dayName(m.date)}, ${hr(m.hour)} hour. Statewide.</p>`;
  }

  /* ---------- PLAN ---------- */
  function currentPlan() { return K.plan(S.t, loads.filter(l => l.on), S.nowIdx); }
  function planBlocks(day) {
    return currentPlan().filter(p => p.ok && p.startIndex != null && S.t[p.startIndex].date === day).map(p => ({ start: S.t[p.startIndex].hour, len: p.hours }));
  }
  function renderPlan() {
    const kind = S.data.signalKind, res = currentPlan(), ok = res.filter(r => r.ok);
    const base = ok.reduce((a, r) => a + r.costBase, 0), best = ok.reduce((a, r) => a + r.costBest, 0);
    const peakMoved = ok.reduce((a, r) => a + r.peakKwhBase - r.peakKwhBest, 0);
    const co2 = ok.every(r => r.co2Base != null) && ok.length ? ok.reduce((a, r) => a + r.co2Base - r.co2Best, 0) : null;
    const kwhAll = ok.reduce((a, r) => a + r.kw * r.hours, 0), pkB = ok.reduce((a, r) => a + r.peakKwhBase, 0), pkA = ok.reduce((a, r) => a + r.peakKwhBest, 0);
    const opts = Array.from({ length: 24 }, (_, h) => h);
    const sel = (v, name, id) => `<select data-load="${id}" data-f="${name}" aria-label="${name}">${opts.map(h => `<option value="${h}" ${h === v ? "selected" : ""}>${hr(h)}</option>`).join("")}</select>`;
    const span0 = S.nowIdx, spanN = Math.min(S.t.length, S.nowIdx + 36), W = spanN - span0;
    const tl = S.t.slice(span0, spanN), lo = Math.min(...tl.map(x => x.price)), hi = Math.max(...tl.map(x => x.price));
    const pos = idx => 100 * (idx - span0) / W;

    $("#view-plan").innerHTML = `
      <h1>Plan my day</h1>
      <p class="sub">Turn on what you use. Kilowhen finds the start time for each one that ${kind === "co2" ? "causes the least pollution" : "costs the grid the least"} before it has to be done.</p>
      <div class="card">
        <table class="loads">
          <thead><tr><th></th><th>Appliance</th><th>Power ${tip("How many kilowatts the appliance draws while running. Check the label or manual. A Level 2 car charger is often 7 to 11 kW; a dryer about 3 kW.")}</th><th>Runs for</th><th>I usually start it</th><th>Done by ${tip("The latest time it has to be finished. Kilowhen only looks at start times between when you usually start it and this deadline.")}</th></tr></thead>
          <tbody>${loads.map(l => `<tr class="${l.on ? "" : "off"}">
            <td><input type="checkbox" class="switch" data-load="${l.id}" data-f="on" ${l.on ? "checked" : ""} aria-label="Include ${esc(l.name)}"></td>
            <td class="lname">${esc(l.name)}</td>
            <td class="lf" data-l="Power"><input type="number" min="0.1" max="50" step="0.1" value="${l.kw}" data-load="${l.id}" data-f="kw" aria-label="kilowatts"> kW</td>
            <td class="lf" data-l="Runs for"><input type="number" min="1" max="12" step="1" value="${l.hours}" data-load="${l.id}" data-f="hours" aria-label="hours"> h</td>
            <td class="lf" data-l="Usually starts">${sel(l.usual, "usual", l.id)}</td>
            <td class="lf" data-l="Done by">${sel(l.by, "by", l.id)}</td></tr>`).join("")}</tbody>
        </table>
        <div class="result">
          <div><div class="n cheap">${base ? pct(1 - best / base) : "0%"}</div><div class="l">lower ${kind === "co2" ? "emissions rate" : "energy cost"} than your usual times</div></div>
          <div><div class="n">${kind === "co2" ? "n/a" : money(base - best)}</div><div class="l">saved per day at wholesale ${tip("What the energy itself costs on the wholesale market. Your utility bill adds delivery charges, so your actual savings depend on your rate plan. Enter time-of-use rates below to see bill savings.")}</div></div>
          <div><div class="n">${peakMoved.toFixed(1)} kWh</div><div class="l">moved out of peak hours</div></div>
          ${co2 != null ? `<div><div class="n">${Math.round(co2)} lb</div><div class="l">CO2 avoided per day, estimated</div></div>` : `<div><div class="n">${kwhAll ? pct(pkB / kwhAll) : "0%"} <span class="muted" style="font-size:22px">to</span> ${kwhAll ? pct(pkA / kwhAll) : "0%"}</div><div class="l">of this energy used in peak hours</div></div>`}
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <h2>Your next 36 hours</h2>
        <div class="timeline">
          ${ok.map(r => `<div class="tl-row"><div class="small">${esc(r.name)}<div class="faint">${hr(S.t[r.usualIndex].hour)} to ${hr(S.t[r.startIndex].hour)}${r.pctLower > 0.005 ? `, ${pct(r.pctLower)} ${kind === "co2" ? "cleaner" : "cheaper"}` : ", already best"}</div></div>
            <div class="tl-track" style="grid-template-columns:repeat(${W},1fr)">${tl.map(x => `<div class="cell" style="background:${color(x.price, lo, hi)};opacity:${x.peak ? 1 : .42}"></div>`).join("")}
              ${r.usualIndex < spanN ? `<div class="tl-block base" style="left:${pos(r.usualIndex)}%;width:${100 * r.hours / W}%"></div>` : ""}
              ${r.startIndex < spanN ? `<div class="tl-block best" style="left:${pos(r.startIndex)}%;width:${100 * r.hours / W}%"></div>` : ""}</div></div>`).join("")}
          <div class="tl-axis"><div></div><div class="ticks">${tl.map((x, k) => x.hour % 6 === 0 ? `<span style="left:${100 * k / W}%">${x.hour === 0 ? dayName(x.date).slice(0, 3) : hr(x.hour)}</span>` : "").join("")}</div></div>
        </div>
        <div class="legend" style="margin-top:12px"><span><i style="border:1.5px dashed var(--muted)"></i>Usual time</span><span><i style="background:var(--text)"></i>Best time</span><span>Brighter cells are peak hours</span></div>
        ${res.filter(r => !r.ok).map(r => `<p class="note">${esc(r.name)}: ${esc(r.reason)}</p>`).join("")}
      </div>

      ${kind === "co2" ? "" : `<div class="card" style="margin-top:16px">
        <h2>On a time-of-use plan? ${tip("Many utilities, including Orange & Rockland and Con Edison, offer plans that charge more during set peak hours. Copy the numbers from your bill or your utility's rate page.")}</h2>
        <p class="cap">Enter your utility's rates to see what shifting these appliances saves on your bill.</p>
        <div class="tou">
          <label>Peak rate (cents per kWh)<input type="number" step="0.1" min="0" data-tou="peak" value="${esc(tou.peak)}"></label>
          <label>Off-peak rate (cents per kWh)<input type="number" step="0.1" min="0" data-tou="off" value="${esc(tou.off)}"></label>
          <label>Peak starts<select data-tou="start">${opts.map(h => `<option value="${h}" ${h === +tou.start ? "selected" : ""}>${hr(h)}</option>`).join("")}</select></label>
          <label>Peak ends<select data-tou="end">${opts.map(h => `<option value="${h}" ${h === +tou.end ? "selected" : ""}>${hr(h)}</option>`).join("")}</select></label>
        </div>
        <p style="margin-top:14px;font-size:17px" id="tou-out">${touText(ok)}</p>
      </div>`}`;
  }
  function touText(ok) {
    const p = parseFloat(tou.peak), o = parseFloat(tou.off);
    if (!(p > 0) || !(o >= 0)) return `<span class="muted">Enter both rates to see your bill savings.</span>`;
    const inPeak = h => tou.start <= tou.end ? h >= tou.start && h < tou.end : h >= tou.start || h < tou.end;
    let base = 0, best = 0;
    ok.forEach(r => { for (let k = 0; k < r.hours; k++) { base += r.kw * (inPeak(S.t[r.usualIndex + k].hour) ? p : o); best += r.kw * (inPeak(S.t[r.startIndex + k].hour) ? p : o); } });
    const month = (base - best) * 30 / 100;
    return month > 0.005 ? `About <strong class="cheap">$${month.toFixed(2)} a month</strong> off your bill, or $${(month * 12).toFixed(0)} a year, from these appliances alone.` : `With these rates and times, shifting doesn't change your bill. It still takes load off the grid's peak.`;
  }

  /* ---------- TOGETHER ---------- */
  function avgPeakKw() {
    const ok = currentPlan().filter(r => r.ok); const moved = ok.reduce((a, r) => a + r.peakKwhBase - r.peakKwhBest, 0);
    const day = S.t[S.nowIdx].date, peakH = S.t.filter(x => x.peak && x.date >= day).length / Math.max(1, new Set(S.t.filter(x => x.date >= day).map(x => x.date)).size);
    return moved > 0 && peakH > 0 ? Math.round(10 * moved / peakH) / 10 : 1.0;
  }
  function renderTogether() {
    const place = S.places.find(p => p.id === tg.place) || S.places[0];
    const kw = tg.kw == null ? 1.0 : tg.kw, mine = avgPeakKw();
    const zonePeak = S.data.load && S.data.load[S.zone] ? Math.max(...Object.values(S.data.load[S.zone]).flat()) : null;
    const statePeak = S.data.load && S.data.load.NYISO ? Math.max(...Object.values(S.data.load.NYISO).flat()) : null;
    const compare = place.id === "nys" ? { mw: statePeak, name: "New York's forecast peak" } : (place.id === "us" ? null : { mw: zonePeak, name: `the ${S.data.zones.find(z => z.id === S.zone).name} zone's forecast peak` });
    const r = K.together(place.households, tg.pct / 100, kw, tg.unit, compare && compare.mw);
    const units = Math.round(r.units);
    const fmt = n => Math.round(n).toLocaleString("en-US");
    $("#view-together").innerHTML = `
      <h1>If we all did it</h1>
      <p class="sub">One home moving its dryer is small. A town moving together is a power plant that never has to turn on.</p>
      <div class="card">
        <p class="big-sentence">If <span class="hl">${tg.pct}%</span> of homes in ${esc(place.name)} moved their big appliances out of peak hours, <span class="hl">${fmt(r.homes)}</span> homes would take <span class="hl">${r.mw >= 10 ? fmt(r.mw) : r.mw.toFixed(1)} MW</span> off the peak.</p>
        <p style="font-size:18px;margin-top:14px" class="muted">That's about <strong style="color:var(--text)">${units >= 1 ? units.toLocaleString("en-US") + (units === 1 ? " peaker unit" : " peaker units") : "a fraction of one peaker unit"}</strong> at ${tg.unit} MW each${compare && compare.mw && r.shareOfPeak != null ? `, or ${(r.shareOfPeak * 100).toFixed(1)}% of ${compare.name} of ${fmt(compare.mw)} MW` : ""}.</p>
        <div class="units" aria-hidden="true">${Array.from({ length: Math.min(60, Math.max(units, 1)) }, (_, k) => `<div class="unit off"></div>`).join("")}${units > 60 ? `<span class="muted small" style="align-self:center">and ${fmt(units - 60)} more</span>` : ""}</div>
      </div>
      <div class="card" style="margin-top:16px">
        <h2>Change the what-if</h2>
        <div class="controls">
          <label>Place ${tip("Household counts are from the U.S. Census Bureau.")}<select data-tg="place">${S.places.map(p => `<option value="${p.id}" ${p.id === place.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select><span class="faint">${fmt(place.households)} households</span></label>
          <label>Homes taking part <output>${tg.pct}%</output><input type="range" min="1" max="60" value="${tg.pct}" data-tg="pct"></label>
          <label>Power moved per home ${tip("Average kilowatts each taking-part home keeps out of peak hours. It starts at 1 kW. Your own plan's number, shown below, is the energy you moved out of peak hours spread across those hours. Most homes won't move as much as a car charger does.")}<input type="number" min="0.1" max="20" step="0.1" value="${kw}" data-tg="kw"><span class="faint">Your own plan moves ${mine} kW</span></label>
          <label>Peaker unit size ${tip("Many of New York's peaker units are small combustion turbines of roughly 15 to 60 MW. Change this to compare with a specific plant.")}<input type="number" min="5" max="500" step="5" value="${tg.unit}" data-tg="unit"><span class="faint">MW per unit</span></label>
        </div>
        <p class="note">Source: <a href="${esc(place.url)}" target="_blank" rel="noopener">${esc(place.source)}</a>. Zones don't follow town or district lines exactly, so the zone comparison is approximate.</p>
      </div>`;
  }

  /* ---------- WEEK ---------- */
  function renderWeek() {
    const kind = S.data.signalKind, w = K.week(S.data, S.zone);
    const all = w.grid.flat(), lo = Math.min(...all), hi = Math.max(...all), zoneName = S.data.zones.find(z => z.id === S.zone).name;
    const zrows = S.data.signalKind === "co2" ? [] : S.data.zones.map(z => {
      const ww = K.week(S.data, z.id); return { name: z.name, avg: ww.byHour.reduce((a, b) => a + b, 0) / 24, eve: (ww.byHour[17] + ww.byHour[18] + ww.byHour[19]) / 3, night: (ww.byHour[1] + ww.byHour[2] + ww.byHour[3]) / 3 };
    }).sort((a, b) => b.eve - a.eve);
    const zmax = Math.max(...zrows.map(z => z.eve), 1);
    $("#view-week").innerHTML = `
      <h1>This week</h1>
      <p class="sub">${w.days.length} days of ${kind === "co2" ? "expected emissions" : "day-ahead prices"} in ${esc(zoneName)}. The pattern repeats, so you only have to learn it once.</p>
      <div class="grid g-now">
        <div class="card"><div class="kv" style="border-top:0">
          <div style="padding-top:0"><div class="n cheap">${hr(w.cheapestHour)}</div><div class="l">Cheapest hour on average, ${sig(w.byHour[w.cheapestHour], kind)}</div></div>
          <div style="padding-top:0"><div class="n peak">${hr(w.priciestHour)}</div><div class="l">Priciest hour on average, ${sig(w.byHour[w.priciestHour], kind)}</div></div>
          <div style="padding-top:0"><div class="n">${w.ratio.toFixed(1)}x</div><div class="l">How much more the priciest hour costs</div></div>
        </div>
        <h2 style="margin-top:22px">Average by hour</h2>
        ${(() => { const a = Math.min(...w.byHour), z = Math.max(...w.byHour); return `<div class="bars" style="height:96px">${w.byHour.map((v, h) => `<div title="${hr(h)}: ${sig(v, kind)}" style="height:${8 + 92 * (v - a) / Math.max(1e-9, z - a)}%;background:${color(v, a, z)}"></div>`).join("")}</div><div class="axis">${w.byHour.map((v, h) => `<span>${h % 3 === 0 ? hrShort(h) : ""}</span>`).join("")}</div>`; })()}
        </div>
        <div class="card"><h2>Most expensive hours this week</h2>
          ${w.top.map(x => `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line)"><span>${dayName(x.date)}, ${hr(x.hour)}</span><span class="peak">${sig(x.price, kind)}</span></div>`).join("")}
        </div>
      </div>
      <div class="card" style="margin-top:16px">
        <h2>Every hour, every day</h2>
        <div class="heat">
          <div></div>${Array.from({ length: 24 }, (_, h) => `<div class="h">${h % 3 === 0 ? hrShort(h) : ""}</div>`).join("")}
          ${w.days.map((d, k) => `<div class="d">${dayName(d).replace(/^(\w+), \w+ (\d+)$/, "$1 $2")}</div>${w.grid[k].map((v, h) => `<div class="c" title="${dayName(d)} ${hr(h)}: ${sig(v, kind)}" style="background:${color(v, lo, hi)}"></div>`).join("")}`).join("")}
        </div>
        <div class="legend" style="margin-top:12px"><span>${sig(lo, kind)}<span class="ramp"></span>${sig(hi, kind)} ${sigUnit(kind)}</span></div>
      </div>
      ${zrows.length ? `<div class="card" style="margin-top:16px">
        <h2>Where you live changes the answer ${tip("Average day-ahead prices this week for each New York zone, from 5 to 8 PM and from 1 to 4 AM.")}</h2>
        <table class="zones"><thead><tr><th class="small muted" style="text-align:left;font-weight:500;padding-bottom:8px">Zone</th><th class="small muted" style="text-align:left;font-weight:500">Average price, 5 to 8 PM</th><th class="small muted" style="text-align:right;font-weight:500">Evening</th><th class="small muted" style="text-align:right;font-weight:500">1 to 4 AM</th></tr></thead><tbody>${zrows.map(z => `<tr${z.name === zoneName ? ' style="color:var(--cheap)"' : ""}><td style="width:22%">${esc(z.name)}</td><td><div class="bar" style="width:${100 * z.eve / zmax}%"></div></td><td class="num" style="width:12%;text-align:right">${sig(z.eve, kind)}</td><td class="num muted" style="width:12%;text-align:right">${sig(z.night, kind)}</td></tr>`).join("")}</tbody></table>
      </div>` : ""}`;
  }

  /* ---------- events ---------- */
  $("#region").addEventListener("change", e => loadRegion(e.target.value));
  $("#zone").addEventListener("change", e => setZone(e.target.value));
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-day]"); if (b) { S.clockDay = b.dataset.day; renderNow(); }
  });
  document.addEventListener("input", e => {
    const el = e.target;
    if (el.dataset.load) {
      const l = loads.find(x => x.id === el.dataset.load), f = el.dataset.f;
      if (f === "on") l.on = el.checked; else if (f === "kw") l.kw = Math.max(0.1, parseFloat(el.value) || l.kw); else l[f] = parseInt(el.value, 10);
      if (f === "hours") l.hours = Math.max(1, Math.min(12, l.hours || 1));
      store.set("loads", loads);
      if (el.type !== "number" || e.type === "change") { renderPlan(); renderNow(); renderTogether(); }
      else { clearTimeout(S.deb); S.deb = setTimeout(() => { renderPlan(); renderNow(); renderTogether(); const again = $(`[data-load="${l.id}"][data-f="${f}"]`); if (again) { again.focus(); const v = again.value; again.value = ""; again.value = v; } }, 500); }
    } else if (el.dataset.tou) {
      tou[el.dataset.tou] = el.tagName === "SELECT" ? +el.value : el.value; store.set("tou", tou);
      $("#tou-out").innerHTML = touText(currentPlan().filter(r => r.ok));
    } else if (el.dataset.tg) {
      const f = el.dataset.tg; tg[f] = f === "place" ? el.value : parseFloat(el.value); store.set("together", tg);
      if (f === "pct") { el.previousElementSibling.textContent = tg.pct + "%"; }
      clearTimeout(S.deb2); S.deb2 = setTimeout(() => { renderTogether(); const again = $(`[data-tg="${f}"]`); if (again) again.focus(); }, f === "pct" ? 60 : 500);
    }
  });

  init();
})();
