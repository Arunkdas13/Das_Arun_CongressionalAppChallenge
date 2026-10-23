/* Kilowhen engine: turns hourly grid data into timing decisions.
 * Pure functions, no network. Runs in the browser and in Node (tests).
 *
 * Data shape (one region file, e.g. data/ny.json):
 *   days: ["2026-10-23", ...]                      local calendar dates
 *   zones: [{id, name}]
 *   price[zoneId][date] = [24 numbers]             day-ahead $/MWh, hour-beginning local time
 *   load[zoneId][date]  = [24 numbers]             forecast MW (optional)
 *   mix: [{date, hour, mw: {fuel: MW}}]            observed generation by fuel (optional)
 */
(function (root) {
  "use strict";

  // Pounds of CO2 per MWh by fuel. Approximate U.S. averages (EPA eGRID ranges); see How it works.
  const EMISSIONS = {
    "Natural Gas": 900, "Dual Fuel": 1150, "Other Fossil Fuels": 1700, "Coal": 2200, "Oil": 1700, "Petroleum": 1700,
    "Nuclear": 0, "Hydro": 0, "Wind": 0, "Solar": 0, "Other Renewables": 0, "Battery": 0, "Other": 900
  };
  const FOSSIL = new Set(["Natural Gas", "Dual Fuel", "Other Fossil Fuels", "Coal", "Oil", "Petroleum", "Other"]);
  const PEAKER_CLASS = new Set(["Dual Fuel", "Other Fossil Fuels", "Oil", "Petroleum"]);

  const sum = a => a.reduce((x, y) => x + y, 0);
  const median = a => { const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const quantile = (a, q) => { const s = a.slice().sort((x, y) => x - y); const i = (s.length - 1) * q; const lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };

  /** Hours of the day the grid is most strained: price in the top quarter of the day AND at least 25% above the day's median.
   *  If a load forecast exists, the hour must also be within 8% of the day's forecast peak. */
  function peakHours(prices, loads) {
    const med = median(prices), q75 = quantile(prices, 0.75), maxLoad = loads ? Math.max(...loads) : null;
    const out = [];
    prices.forEach((p, h) => {
      const byPrice = p >= q75 && p >= med * 1.25;
      const byLoad = loads ? loads[h] >= maxLoad * 0.92 : true;
      if (byPrice && byLoad) out.push(h);
    });
    return out;
  }

  /** Group consecutive hours into windows: [{start, end}] where end is exclusive. */
  function windows(hours) {
    const w = []; hours.slice().sort((a, b) => a - b).forEach(h => {
      const last = w[w.length - 1]; if (last && last.end === h) last.end = h + 1; else w.push({ start: h, end: h + 1 });
    }); return w;
  }

  /** Build a continuous hourly timeline across the region's available days for one zone. */
  function timeline(data, zone) {
    const t = [];
    data.days.forEach(date => {
      const src = data.signal || data.price;
      const p = src[zone] && src[zone][date]; if (!p) return;
      const l = data.load && data.load[zone] && data.load[zone][date];
      const peaks = new Set(peakHours(p, l));
      for (let h = 0; h < 24; h++) t.push({ date, hour: h, price: p[h], load: l ? l[h] : null, peak: peaks.has(h), co2: null, fossil: null, peakerShare: null });
    });
    // attach observed emissions where generation data exists
    (data.mix || []).forEach(m => {
      const slot = t.find(x => x.date === m.date && x.hour === m.hour); if (!slot) return;
      const e = intensity(m.mw); Object.assign(slot, e);
    });
    return t;
  }

  /** Emissions intensity (lb CO2/MWh), fossil share and peaker-class share from a generation mix. */
  function intensity(mw) {
    let total = 0, lb = 0, fossil = 0, peaker = 0;
    for (const f in mw) { const v = Math.max(0, +mw[f] || 0); total += v; lb += v * (f in EMISSIONS ? EMISSIONS[f] : 900); if (FOSSIL.has(f)) fossil += v; if (PEAKER_CLASS.has(f)) peaker += v; }
    if (!total) return { co2: null, fossil: null, peakerShare: null };
    return { co2: lb / total, fossil: fossil / total, peakerShare: peaker / total };
  }

  /** Index in the timeline for a given date and hour. */
  function indexOf(t, date, hour) { return t.findIndex(x => x.date === date && x.hour === hour); }

  /**
   * Best start for a load that runs `hours` long, starting no earlier than `from` and finishing by `by` (timeline indexes, by exclusive).
   * Returns the start index with the lowest total price; ties go to the earliest start.
   */
  function bestStart(t, hours, from, by) {
    let best = null, bestCost = Infinity;
    for (let s = Math.max(0, from); s + hours <= Math.min(by, t.length); s++) {
      const c = sum(t.slice(s, s + hours).map(x => x.price));
      if (c < bestCost - 1e-9) { bestCost = c; best = s; }
    }
    return best;
  }

  /**
   * Plan a list of loads. Each load: {id, name, kw, hours, usual: hour 0-23, by: hour 0-23 next morning (or same day if later than usual)}.
   * `nowIndex` is the current timeline position. Usual time is the next occurrence of that hour at or after now.
   */
  function plan(t, loads, nowIndex) {
    return loads.map(L => {
      const usual = nextHour(t, nowIndex, L.usual);
      if (usual == null) return Object.assign({}, L, { ok: false, reason: "Not enough price data ahead to plan this yet." });
      let by = nextHour(t, usual + 1, L.by);
      if (by == null) by = t.length; // as far as data reaches
      if (by - usual < L.hours) by = Math.min(t.length, usual + 24);
      const start = bestStart(t, L.hours, usual, by);
      const base = t.slice(usual, usual + L.hours), opt = start == null ? base : t.slice(start, start + L.hours);
      if (base.length < L.hours) return Object.assign({}, L, { ok: false, reason: "Not enough price data ahead to plan this yet." });
      const costBase = L.kw * sum(base.map(x => x.price)) / 1000, costBest = L.kw * sum(opt.map(x => x.price)) / 1000;
      const peakBase = base.filter(x => x.peak).length * L.kw, peakBest = opt.filter(x => x.peak).length * L.kw;
      const co2Known = base.every(x => x.co2 != null) && opt.every(x => x.co2 != null);
      return Object.assign({}, L, {
        ok: true, usualIndex: usual, startIndex: start, byIndex: by,
        costBase, costBest, saved: costBase - costBest, pctLower: costBase ? 1 - costBest / costBase : 0,
        peakKwhBase: peakBase, peakKwhBest: peakBest,
        co2Base: co2Known ? L.kw * sum(base.map(x => x.co2)) / 1000 : null,
        co2Best: co2Known ? L.kw * sum(opt.map(x => x.co2)) / 1000 : null
      });
    });
  }

  /** Next timeline index at or after `from` whose hour equals `hour`. */
  function nextHour(t, from, hour) { for (let i = Math.max(0, from); i < t.length; i++) if (t[i].hour === hour) return i; return null; }

  /** Summary for "right now": where the current hour sits in today's range and the best upcoming window. */
  function now(t, nowIndex, lookahead) {
    const cur = t[nowIndex]; if (!cur) return null;
    const ahead = t.slice(nowIndex, Math.min(t.length, nowIndex + (lookahead || 24)));
    const today = t.filter(x => x.date === cur.date);
    const min = Math.min(...today.map(x => x.price)), max = Math.max(...today.map(x => x.price));
    // cheapest 3-hour stretch ahead
    let bestI = nowIndex, bestC = Infinity;
    for (let i = 0; i + 3 <= ahead.length; i++) { const c = sum(ahead.slice(i, i + 3).map(x => x.price)); if (c < bestC) { bestC = c; bestI = nowIndex + i; } }
    const nextPeak = ahead.findIndex(x => x.peak);
    const verdict = cur.peak ? "wait" : (cur.price <= t[bestI].price * 1.1 ? "go" : "wait");
    return {
      cur, min, max, position: max > min ? (cur.price - min) / (max - min) : 0,
      bestIndex: bestI, bestAvg: bestC / 3, saveVsNow: cur.price ? 1 - (bestC / 3) / cur.price : 0,
      nextPeakIndex: nextPeak < 0 ? null : nowIndex + nextPeak, verdict
    };
  }

  /** Week view: per-hour averages across days and the spread between the cheapest and priciest hours. */
  function week(data, zone) {
    data = Object.assign({}, data, { price: data.signal || data.price });
    const days = data.days.filter(d => data.price[zone] && data.price[zone][d]);
    const byHour = Array.from({ length: 24 }, (_, h) => sum(days.map(d => data.price[zone][d][h])) / days.length);
    const all = []; days.forEach(d => data.price[zone][d].forEach((p, h) => all.push({ date: d, hour: h, price: p })));
    const sorted = all.slice().sort((a, b) => a.price - b.price);
    const cheapH = byHour.indexOf(Math.min(...byHour)), dearH = byHour.indexOf(Math.max(...byHour));
    return { days, byHour, cheapestHour: cheapH, priciestHour: dearH, ratio: byHour[dearH] / byHour[cheapH], top: sorted.slice(-5).reverse(), bottom: sorted.slice(0, 5), grid: days.map(d => data.price[zone][d]) };
  }

  /** "What if we all did it": MW moved out of peak hours. */
  function together(households, participation, kwPerHome, unitMw, zonePeakMw) {
    const homes = households * participation;
    const mw = homes * kwPerHome / 1000;
    return { homes, mw, units: unitMw ? mw / unitMw : null, shareOfPeak: zonePeakMw ? mw / zonePeakMw : null };
  }

  const api = { EMISSIONS, FOSSIL, PEAKER_CLASS, peakHours, windows, timeline, intensity, indexOf, bestStart, plan, nextHour, now, week, together, median, quantile };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Kilowhen = api;
})(typeof window !== "undefined" ? window : globalThis);
