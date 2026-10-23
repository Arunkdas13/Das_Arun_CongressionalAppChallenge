// Run: node tests/engine.test.js
const fs = require("fs"), path = require("path"), assert = require("assert");
const K = require("../docs/js/engine.js");
let pass = 0; const t = (name, fn) => { try { fn(); pass++; console.log("ok   " + name); } catch (e) { console.log("FAIL " + name + "\n     " + e.message); process.exitCode = 1; } };

// a simple day shape: cheap overnight and midday, expensive 5-8 PM
const DAY = [40, 38, 36, 35, 36, 40, 55, 70, 60, 38, 34, 32, 30, 30, 31, 33, 41, 58, 68, 66, 57, 50, 46, 42];
const LOAD = DAY.map(p => p * 300);
const data = { days: ["2026-10-23", "2026-10-24"], zones: [{ id: "Z", name: "Zone" }], price: { Z: { "2026-10-23": DAY, "2026-10-24": DAY.map(x => x * 0.9) } }, load: { Z: { "2026-10-23": LOAD, "2026-10-24": LOAD } }, mix: [{ date: "2026-10-23", hour: 18, mw: { "Natural Gas": 500, "Nuclear": 500 } }] };

t("peak hours are the expensive, high-demand evening and morning hours", () => {
  const p = K.peakHours(DAY, LOAD);
  assert.deepStrictEqual(p, [7, 18, 19]);
  assert.deepStrictEqual(K.windows(p), [{ start: 7, end: 8 }, { start: 18, end: 20 }]);
});
t("peak hours without a load forecast use price alone", () => {
  const p = K.peakHours(DAY, null); assert.ok(p.includes(17) && p.includes(18) && !p.includes(3));
});
t("timeline spans both days and attaches emissions", () => {
  const tl = K.timeline(data, "Z"); assert.strictEqual(tl.length, 48);
  const h = tl[18]; assert.strictEqual(h.co2, 450); assert.strictEqual(h.fossil, 0.5);
});
t("intensity weights fuels and flags peaker-class units", () => {
  const e = K.intensity({ "Dual Fuel": 100, "Hydro": 100 }); assert.strictEqual(e.co2, 575); assert.strictEqual(e.peakerShare, 0.5);
});
t("best start picks the cheapest window inside the allowed range", () => {
  const tl = K.timeline(data, "Z");
  assert.strictEqual(K.bestStart(tl, 2, 18, 24 + 7), 24 + 2); // 2 AM next day, 36*0.9 + 35*0.9
  assert.strictEqual(K.bestStart(tl, 1, 18, 23), 22); // same evening, before 11 PM: 10 PM is cheapest
});
t("plan moves an evening car charge overnight and reports savings", () => {
  const tl = K.timeline(data, "Z");
  const [r] = K.plan(tl, [{ id: "ev", name: "EV", kw: 7, hours: 4, usual: 18, by: 7 }], 15);
  assert.ok(r.ok); assert.strictEqual(r.usualIndex, 18); assert.strictEqual(tl[r.startIndex].hour, 1);
  assert.ok(r.saved > 0 && r.pctLower > 0.3, "pct " + r.pctLower);
  assert.strictEqual(r.peakKwhBase, 14); assert.strictEqual(r.peakKwhBest, 0);
});
t("plan says so when there's not enough data ahead", () => {
  const tl = K.timeline(data, "Z");
  const [r] = K.plan(tl, [{ id: "x", name: "X", kw: 1, hours: 3, usual: 23, by: 6 }], 47);
  assert.strictEqual(r.ok, false);
});
t("now: verdict waits during a peak hour and points to a cheaper window", () => {
  const tl = K.timeline(data, "Z"); const n = K.now(tl, 18, 24);
  assert.strictEqual(n.verdict, "wait"); assert.ok(n.saveVsNow > 0.4);
  assert.strictEqual(K.now(tl, 12, 24).verdict, "go");
});
t("week finds the cheapest and priciest average hours", () => {
  const w = K.week(data, "Z"); assert.strictEqual(w.cheapestHour, 12); assert.strictEqual(w.priciestHour, 7);
});
t("together multiplies households, participation and kW", () => {
  const r = K.together(261372, 0.1, 1.5, 40, 1100);
  assert.ok(Math.abs(r.mw - 39.2058) < 1e-3); assert.ok(Math.abs(r.units - 0.98) < 0.01);
});
t("emissions-only regions use the signal field", () => {
  const d = { days: ["2026-10-23"], zones: [{ id: "CISO" }], signal: { CISO: { "2026-10-23": DAY } }, signalKind: "co2" };
  assert.strictEqual(K.timeline(d, "CISO").length, 24);
});
const real = path.join(__dirname, "../docs/data/ny.json");
if (fs.existsSync(real)) t("real NYISO file builds a usable Hudson Valley timeline", () => {
  const d = JSON.parse(fs.readFileSync(real, "utf8"));
  const tl = K.timeline(d, "HUD VL"); assert.ok(tl.length >= 48, "hours " + tl.length);
  assert.ok(tl.some(x => x.peak)); assert.ok(d.zones.length === 11);
  const w = K.week(d, "HUD VL"); console.log("     real week:", d.days.join(","), "cheapest", w.cheapestHour, "priciest", w.priciestHour, "ratio", w.ratio.toFixed(2));
});
t("fill the valley spreads energy without creating a new peak", () => {
  const base = [10, 9, 8, 8, 9, 10, 12, 14, 13, 12, 11, 11, 11, 11, 12, 13, 15, 18, 20, 19, 17, 15, 13, 11].map(x => x * 1000);
  const peaks = [17, 18, 19];
  const out = K.fillValley(base, [{ kw: 3, hours: 1, start: 18 }], 1000000, peaks); // 3,000 MW out of 6 PM
  const total = a => a.reduce((x, y) => x + y, 0);
  assert.ok(Math.abs(total(out) - total(base)) < 1e-6, "energy conserved");
  assert.strictEqual(out[18], 17000);
  assert.ok(Math.max(...out.filter((_, h) => !peaks.includes(h))) <= 17000, "no new peak");
  assert.ok(out[2] > 8000, "night valley filled first");
});
console.log(`\n${pass} passed`);
