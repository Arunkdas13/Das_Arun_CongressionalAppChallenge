/* Kilowhen: one interactive scene of a real day on New York's grid. */
(function () {
  "use strict";
  const K = window.Kilowhen;
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const NS = "http://www.w3.org/2000/svg";
  const UNIT_MW = 40;
  const hr = h => { h = ((Math.floor(h) % 24) + 24) % 24; return h === 0 ? "12 AM" : h === 12 ? "Noon" : h < 12 ? h + " AM" : (h - 12) + " PM"; };
  const hrS = h => { h = ((h % 24) + 24) % 24; return h === 0 ? "12a" : h === 12 ? "12p" : h < 12 ? h + "a" : (h - 12) + "p"; };
  const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const fmt = n => Math.round(n).toLocaleString("en-US");
  const cents = d => d < 1 ? Math.round(d * 100) + "¢" : "$" + d.toFixed(2);

  const ICON = {
    dryer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="13" r="4.5"/><path d="M7 6.5h2"/></svg>',
    dish: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 8h16M8 5.5h1M11 5.5h1M8 12c2 1.5 6 1.5 8 0M8 16c2 1.5 6 1.5 8 0"/></svg>',
    car: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 16v-4l2-5h12l2 5v4z"/><circle cx="8" cy="16.5" r="1.8"/><circle cx="16" cy="16.5" r="1.8"/><path d="M12 9.5l-1.2 2.2h2.4L12 14"/></svg>'
  };
  const USUAL = [
    { id: "dryer", name: "Dryer", kw: 3.0, hours: 1, start: 18 },
    { id: "dish", name: "Dishwasher", kw: 1.2, hours: 2, start: 19 },
    { id: "car", name: "Car charger", kw: 7.2, hours: 4, start: 18 }
  ];
  const S = { stagger: false, data: null, zone: "HUD VL", days: [], day: null, play: 18, chips: USUAL.map(c => Object.assign({}, c)), step: 0, steps: [], playing: false, today: null };

  /* ---------- time ---------- */
  function localNow(tz) {
    const at = new URLSearchParams(location.search).get("at");
    if (at && /^\d{4}-\d{2}-\d{2}T\d{2}/.test(at)) return { date: at.slice(0, 10), hour: +at.slice(11, 13) };
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map(x => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, hour: (+p.hour % 24) + (+p.minute) / 60 };
  }
  const addDays = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  function dayLabel(d) {
    if (d === S.today) return "Today"; if (d === addDays(S.today, 1)) return "Tomorrow"; if (d === addDays(S.today, -1)) return "Yesterday";
    return DOW[new Date(d + "T12:00:00Z").getUTCDay()];
  }

  /* ---------- model ---------- */
  function model() {
    const price = S.data.price[S.zone][S.day], base = S.data.load.NYISO[S.day];
    const peaks = K.peakHours(price, base);
    let T;
    if (!peaks.length) T = Math.max(...base) + 1;
    else {
      const minPeak = Math.min(...peaks.map(h => base[h]));
      const non = base.filter((_, h) => !peaks.includes(h)), maxNon = non.length ? Math.max(...non) : minPeak;
      T = maxNon < minPeak ? (minPeak + maxNon) / 2 : minPeak - 1;
    }
    const homes = S.steps[S.step].homes;
    const delta = new Array(24).fill(0);
    USUAL.forEach((u, k) => { const c = S.chips[k]; for (let i = 0; i < u.hours; i++) { delta[(u.start + i) % 24] -= u.kw; delta[(c.start + i) % 24] += c.kw; } });
    let adj = base.map((v, h) => v + homes * delta[h] / 1000);
    const moved = USUAL.some((u, k) => u.start !== S.chips[k].start);
    if (S.stagger && homes > 1 && moved) adj = K.fillValley(base, USUAL, homes, peaks);
    const units = a => a.map(v => Math.ceil(Math.max(0, v - T) / UNIT_MW));
    const ub = units(base), ua = units(adj);
    const costOf = (c, start) => { let s = 0; for (let i = 0; i < c.hours; i++) s += price[(start + i) % 24]; return c.kw * s / 1000; };
    const herd = homes > 1 && Math.max(...ua) > 0 && !peaks.includes(ua.indexOf(Math.max(...ua)));
    return { price, base, adj, T, peaks, homes, delta, ub, ua, costOf, moved, herd };
  }

  /* ---------- scene ---------- */
  const W = 1000, H = 460, Y0 = 400, Y1 = 120;
  const X = h => (h / 24) * W;
  function smooth(pts) {
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      d += `C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
    }
    return d;
  }
  // a fixed little town: houses and stacks, seeded so it never changes
  const TOWN = (() => {
    let s = 11; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const houses = []; let x = -10;
    while (x < W + 10) { const w = 26 + r() * 30, h = 18 + r() * 26; houses.push({ x, w, h, win: Array.from({ length: Math.floor(w / 11) }, () => r()) }); x += w + 3 + r() * 6; }
    const stacks = Array.from({ length: 16 }, (_, i) => ({ x: 40 + i * 58 + r() * 18, h: 46 + r() * 22 }));
    return { houses, stacks };
  })();

  function drawScene(m) {
    const lo = Math.min(...m.base) * 0.9, hi = Math.max(...m.base) * 1.03;
    const Y = v => Y0 - (Math.max(lo, Math.min(hi * 1.02, v)) - lo) / (hi - lo) * (Y0 - Y1);
    const ptsOf = arr => { const p = arr.map((v, h) => [X(h + 0.5), Y(v)]); return [[0, p[0][1]], ...p, [W, p[23][1]]]; };
    const ridge = smooth(ptsOf(m.adj)) + `L${W},${H}L0,${H}Z`;
    const ghost = smooth(ptsOf(m.base));
    const yT = Y(m.T);
    const hour = S.play, night = hour < 6.3 || hour >= 18.6, dusk = hour >= 16.5 && hour < 18.6;
    const active = m.ua[Math.min(23, Math.floor(hour))];
    let svg = `<defs>
      <linearGradient id="skyg" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stop-color="#0b1530"/><stop offset=".2" stop-color="#14224a"/><stop offset=".255" stop-color="#d9927a"/>
        <stop offset=".31" stop-color="#9fc3e3"/><stop offset=".66" stop-color="#a7c9e6"/><stop offset=".72" stop-color="#f0a46d"/>
        <stop offset=".775" stop-color="#5a3f7c"/><stop offset=".84" stop-color="#16214a"/><stop offset="1" stop-color="#0b1530"/>
      </linearGradient>
      <linearGradient id="fade" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></linearGradient>
      <clipPath id="above"><rect x="0" y="0" width="${W}" height="${yT}"/></clipPath>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#skyg)"/><rect width="${W}" height="${H}" fill="url(#fade)"/>`;
    // stars in the night parts
    for (let i = 0; i < 46; i++) { const x = (i * 97) % W, y = 40 + (i * 53) % 120; if (x < 190 || x > 850) svg += `<circle cx="${x}" cy="${y}" r="${i % 3 ? 0.9 : 1.4}" fill="#fff" opacity=".55"/>`; }
    // ridge of demand, amber above the peaker line
    svg += `<path d="${ridge}" fill="#1b2a52" opacity=".96"/>`;
    svg += `<path d="${ridge}" fill="#ff9e1b" clip-path="url(#above)"/>`;
    if (S.step > 0) svg += `<path d="${ghost}" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.6" stroke-dasharray="5 5"/>`;
    svg += `<line x1="0" x2="${W}" y1="${yT}" y2="${yT}" stroke="#ff9e1b" stroke-width="1.5" stroke-dasharray="7 6"/>`;
    // town
    svg += `<rect x="0" y="${H - 34}" width="${W}" height="34" fill="#070d1d"/>`;
    TOWN.stacks.forEach((st, i) => {
      const on = i < Math.min(active, TOWN.stacks.length), base = H - 34;
      svg += `<rect x="${st.x}" y="${base - st.h}" width="9" height="${st.h}" fill="${on ? "#2a1d10" : "#0a1226"}"/><rect x="${st.x - 1}" y="${base - st.h}" width="11" height="4" fill="${on ? "#ff9e1b" : "#1a2440"}"/>`;
      if (on) for (let k = 0; k < 3; k++) svg += `<circle class="smoke" style="animation-delay:${-k * 0.8 - i * 0.37}s" cx="${st.x + 4.5}" cy="${base - st.h - 6}" r="6" fill="#c9c3bb"/>`;
    });
    TOWN.houses.forEach(hs => {
      const top = H - 34 - hs.h;
      svg += `<rect x="${hs.x}" y="${top}" width="${hs.w}" height="${hs.h + 34}" fill="#0c1428"/><path d="M${hs.x - 2},${top}L${hs.x + hs.w / 2},${top - 9}L${hs.x + hs.w + 2},${top}Z" fill="#0c1428"/>`;
      hs.win.forEach((r, k) => { const lit = (night && r > 0.35) || (dusk && r > 0.6); svg += `<rect x="${hs.x + 5 + k * 11}" y="${top + 6}" width="5" height="6" fill="${lit ? "#ffd27a" : "#16203a"}"/>`; });
    });
    $("#sky").innerHTML = svg;
    $("#peaker-label").style.top = (yT / H * 100) + "%";
    $("#peaker-label").hidden = !m.peaks.length;
  }

  function drawPlayhead(m) {
    const h = Math.min(23.99, S.play), i = Math.floor(h), units = m.ua[i];
    $("#playhead").style.left = (h / 24 * 100) + "%";
    const b = $("#bubble");
    b.innerHTML = `<b>${hr(i)}</b> &nbsp;$${m.price[i].toFixed(2)} per MWh<br>${fmt(m.adj[i])} MW across New York<br>${units ? `<span class="pk">${units} peaker unit${units === 1 ? "" : "s"} running</span>` : `<span class="ok">No peakers needed</span>`}`;
    b.style.left = h < 3 ? "0" : h > 21 ? "auto" : "50%"; b.style.right = h > 21 ? "0" : "auto"; b.style.transform = h < 3 || h > 21 ? "none" : "translateX(-50%)";
  }

  function drawLane(m) {
    const lane = $("#lane"), rows = S.chips.length, rowH = 40;
    lane.style.height = (rows * rowH + 14) + "px";
    const band = m.peaks.map(h => `transparent ${h / 24 * 100}%, rgba(255,158,27,.16) ${h / 24 * 100}%, rgba(255,158,27,.16) ${(h + 1) / 24 * 100}%, transparent ${(h + 1) / 24 * 100}%`).join(",");
    lane.style.setProperty("--peakband", m.peaks.length ? `linear-gradient(90deg, ${band})` : "none");
    if (!lane.children.length) lane.innerHTML = S.chips.map((c, k) => `<div class="chip" data-k="${k}" role="slider" tabindex="0" aria-label="${c.name} start time" aria-valuemin="0" aria-valuemax="${24 - c.hours}"></div>`).join("");
    S.chips.forEach((c, k) => {
      const el = lane.querySelector(`[data-k="${k}"]`), inPeak = Array.from({ length: c.hours }, (_, i) => (c.start + i) % 24).some(h => m.peaks.includes(h));
      el.style.left = `calc(${c.start / 24 * 100}% + 2px)`; el.style.width = `calc(${c.hours / 24 * 100}% - 4px)`; el.style.top = (8 + k * rowH) + "px"; el.style.height = (rowH - 6) + "px";
      el.classList.toggle("peak", inPeak);
      el.setAttribute("aria-valuenow", c.start); el.setAttribute("aria-valuetext", `${c.name} starts at ${hr(c.start)}`);
      el.innerHTML = `${ICON[c.id]}<span class="label${c.start + c.hours > 19 ? " left" : ""}"><span class="name">${c.name}</span> <span class="cost">${hr(c.start)}, ${cents(m.costOf(c, c.start))}</span></span>`;
    });
  }

  function drawStory(m) {
    const before = Math.max(...m.ub), after = Math.max(...m.ua), step = S.steps[S.step];
    const usualCost = USUAL.reduce((a, c) => a + m.costOf(c, c.start), 0), nowCost = S.chips.reduce((a, c) => a + m.costOf(c, c.start), 0);
    const moved = USUAL.some((u, k) => u.start !== S.chips[k].start);
    const save = usualCost ? 1 - nowCost / usualCost : 0;
    const pk = K.windows(m.peaks);
    const peakMW = Math.max(...m.adj), shaved = Math.max(...m.base) - peakMW;
    let big;
    if (!m.peaks.length) big = `${dayLabel(S.day)} has no peak hours, so no peaker units are needed at any time.`;
    else if (S.step === 0) big = moved
      ? `Your new times cost <em>${Math.round(save * 100)}% less</em>: ${cents(nowCost)} of energy instead of ${cents(usualCost)}. On its own that won't switch off a power plant. Slide to see what happens when your neighbors do the same.`
      : `At 6 PM, ${dayLabel(S.day).toLowerCase() === "today" ? "tonight" : "that evening"} needs <span class="amb">${before} peaker units</span>. Drag your dryer, dishwasher and car charger out of the amber hours.`;
    else if (m.herd) big = `Everyone moved to the same hours, so the peak just moved to <span class="amb">${hr(m.ua.indexOf(after))}</span>: ${after} peaker units. Turn on <strong>Stagger the homes</strong> to spread them out.`;
    else if (S.stagger && m.moved) big = `Staggered into the quietest hours, ${fmt(step.homes)} homes ${step.where} would need <em>${after} peaker unit${after === 1 ? "" : "s"}</em> instead of <span class="amb">${before}</span>, with no new peak anywhere.${after === 0 ? " No peakers at all." : ""}`;
    else big = after < before
      ? `If ${fmt(step.homes)} homes ${step.where} moved the same appliances, the evening would need <em>${after} peaker unit${after === 1 ? "" : "s"}</em> instead of <span class="amb">${before}</span>.${after === 0 ? " No peakers at all." : ""}`
      : `If ${fmt(step.homes)} homes ${step.where} kept these times, the evening would still need <span class="amb">${after} peaker units</span>. Move the appliances out of the amber hours.`;
    $("#story").innerHTML = `<p class="big">${big}</p><div>
      <p class="side">${pk.length ? `Peak hours ${dayLabel(S.day).toLowerCase()}: <strong>${pk.map(w => `${hr(w.start)} to ${hr(w.end)}`).join(" and ")}</strong>, priced up to $${Math.max(...m.peaks.map(h => m.price[h])).toFixed(2)} per MWh in ${esc(zoneName())}. The cheapest hour is ${hr(m.price.indexOf(Math.min(...m.price)))} at $${Math.min(...m.price).toFixed(2)}.` : "No peak hours on this day."}</p>
      ${S.step > 0 ? `<p class="side">${shaved > 0.5 ? `The highest hour drops by <strong>${fmt(shaved)} MW</strong>.` : "The highest hour doesn't change yet."} The dashed line is the day before anyone moved.</p>` : `<p class="side">Each smokestack is one 40 MW peaker unit. The ridge is New York's forecast demand for every hour of the day.</p>`}
    </div>`;
  }
  const zoneName = () => (S.data.zones.find(z => z.id === S.zone) || {}).name || S.zone;

  let raf = 0;
  function render() { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { const m = model(); $("#stagger").hidden = S.step === 0; drawScene(m); drawPlayhead(m); drawLane(m); drawStory(m); }); }

  /* ---------- interactions ---------- */
  function hourFromEvent(e, el) { const r = el.getBoundingClientRect(); return Math.max(0, Math.min(23.99, (e.clientX - r.left) / r.width * 24)); }
  const scene = $("#scene");
  scene.addEventListener("pointerdown", e => { stop(); scene.setPointerCapture(e.pointerId); S.play = hourFromEvent(e, scene); render(); const mv = ev => { S.play = hourFromEvent(ev, scene); render(); }; scene.addEventListener("pointermove", mv); scene.addEventListener("pointerup", () => scene.removeEventListener("pointermove", mv), { once: true }); });
  scene.addEventListener("keydown", e => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); stop(); S.play = Math.max(0, Math.min(23, Math.floor(S.play) + (e.key === "ArrowRight" ? 1 : -1))) + 0.5; render(); } });

  const lane = $("#lane");
  lane.addEventListener("pointerdown", e => {
    const el = e.target.closest(".chip"); if (!el) return;
    const k = +el.dataset.k, c = S.chips[k], r = lane.getBoundingClientRect();
    const grab = (e.clientX - r.left) / r.width * 24 - c.start;
    el.setPointerCapture(e.pointerId); el.classList.add("dragging");
    const mv = ev => { const s = Math.round((ev.clientX - r.left) / r.width * 24 - grab); const ns = Math.max(0, Math.min(24 - c.hours, s)); if (ns !== c.start) { c.start = ns; S.play = ns + Math.min(c.hours, 1) / 2; render(); } };
    el.addEventListener("pointermove", mv);
    el.addEventListener("pointerup", () => { el.removeEventListener("pointermove", mv); el.classList.remove("dragging"); }, { once: true });
  });
  lane.addEventListener("keydown", e => {
    const el = e.target.closest(".chip"); if (!el || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    e.preventDefault(); const c = S.chips[+el.dataset.k]; c.start = Math.max(0, Math.min(24 - c.hours, c.start + (e.key === "ArrowRight" ? 1 : -1))); S.play = c.start + 0.5; render();
  });

  $("#homes").addEventListener("input", e => { S.step = +e.target.value; drawTicks(); render(); });
  $("#stagger").addEventListener("click", e => { S.stagger = !S.stagger; e.currentTarget.setAttribute("aria-pressed", String(S.stagger)); render(); });
  function drawTicks() {
    $("#ticks").innerHTML = S.steps.map((s, i) => `<button data-step="${i}" aria-current="${i === S.step}">${esc(s.label)}</button>`).join("");
  }
  $("#ticks").addEventListener("click", e => { const b = e.target.closest("[data-step]"); if (!b) return; S.step = +b.dataset.step; $("#homes").value = S.step; drawTicks(); render(); });

  function stop() { S.playing = false; $("#play").setAttribute("aria-pressed", "false"); $("#play span").textContent = "Play the day"; }
  $("#play").addEventListener("click", () => {
    if (S.playing) return stop();
    S.playing = true; $("#play").setAttribute("aria-pressed", "true"); $("#play span").textContent = "Pause";
    let last = performance.now(); if (S.play > 23) S.play = 0;
    const tick = now => { if (!S.playing) return; S.play += (now - last) / 1000 * (24 / 10); last = now; if (S.play >= 23.99) { S.play = 23.99; render(); return stop(); } render(); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });

  $("#zone").addEventListener("change", e => { S.zone = e.target.value; setDays(); render(); });
  $("#days").addEventListener("click", e => { const b = e.target.closest("[data-day]"); if (!b) return; S.day = b.dataset.day; drawDays(); render(); });
  $("#open-how").addEventListener("click", () => $("#how").showModal());

  function setDays() {
    S.days = S.data.days.filter(d => S.data.price[S.zone] && S.data.price[S.zone][d] && S.data.load.NYISO && S.data.load.NYISO[d]);
    if (!S.days.includes(S.day)) S.day = S.days.includes(S.today) ? S.today : S.days[S.days.length - 1];
    drawDays();
  }
  function drawDays() { $("#days").innerHTML = S.days.slice(-3).map(d => `<button data-day="${d}" aria-pressed="${d === S.day}">${dayLabel(d)}</button>`).join(""); }

  async function init() {
    try {
      const [data, places] = await Promise.all([fetch("data/ny.json", { cache: "no-cache" }).then(r => r.json()), fetch("data/places.json").then(r => r.json())]);
      S.data = data;
      const P = id => places.places.find(p => p.id === id);
      const D = P("ny17").households;
      S.steps = [
        { label: "Just you", homes: 1, where: "" },
        { label: "1,000 homes", homes: 1000, where: "in our district" },
        { label: "1 in 10 in our district", homes: Math.round(D / 10), where: "in New York's 17th district" },
        { label: "1 in 4", homes: Math.round(D / 4), where: "in New York's 17th district" },
        { label: "Half the district", homes: Math.round(D / 2), where: "in New York's 17th district" }
      ];
      const now = localNow(data.timezone); S.today = now.date;
      $("#zone").innerHTML = data.zones.map(z => `<option value="${esc(z.id)}" ${z.id === S.zone ? "selected" : ""}>${esc(z.name)}</option>`).join("");
      setDays();
      S.play = S.day === S.today ? Math.min(23.5, now.hour) : 18.5;
      $("#hours").innerHTML = Array.from({ length: 8 }, (_, i) => `<span style="left:${(i * 3) / 24 * 100}%;${i === 0 ? "transform:none;padding-left:10px" : ""}">${hrS(i * 3)}</span>`).join("");
      const built = new Date(data.built).toLocaleString("en-US", { timeZone: data.timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      $("#src").innerHTML = `Data from <a href="${esc(data.sourceUrl)}" target="_blank" rel="noopener">NYISO</a>, updated ${esc(built)}`;
      drawTicks(); render();
    } catch (e) {
      $("#prompt").textContent = "The grid data didn't load. Open this page from a web server or GitHub Pages, not straight from your files.";
    }
  }
  init();
})();
