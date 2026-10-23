// Run: node tests/engine.test.js
const fs = require("fs"), path = require("path"), assert = require("assert");
const S = require("../docs/js/engine.js");
const D = p => JSON.parse(fs.readFileSync(path.join(__dirname, "../docs", p), "utf8"));
const rules = { topics: D("data/topics.json"), tone: D("data/tone.json") };
const votes = D("data/house-votes.json");
let pass = 0; const t = (name, fn) => { try { fn(); pass++; console.log("ok   " + name); } catch (e) { console.log("FAIL " + name + "\n     " + e.message); process.exitCode = 1; } };

t("everyday titles are not political", () => {
  for (const s of ["olive oil pasta in 10 minutes", "new bluetooth speaker review", "nerf gun battle", "true crime podcast recap", "my border collie learns a trick", "budget meal prep", "minecraft mining tips", "NFL draft grades", "class president speech"]) {
    assert.strictEqual(S.classify(s, rules).political, false, s);
  }
});
t("political titles are detected with topics", () => {
  const c = S.classify("Iran war powers vote CHAOS", rules);
  assert.ok(c.political); assert.ok(c.topics.includes("foreign"));
});
t("tone: conflict vs explaining", () => {
  assert.strictEqual(S.classify("this congresswoman DESTROYS the Speaker", rules).tone, "conflict");
  assert.strictEqual(S.classify("what the war powers act actually does explained", rules).tone, "explaining");
});
t("person detection", () => { assert.ok(S.classify("the governor freaks out at reporter about the border wall", rules).person); });
t("effective number of voices", () => {
  assert.ok(Math.abs(S.effectiveNumber([5, 5, 5, 5]) - 4) < 1e-9);
  assert.ok(Math.abs(S.effectiveNumber([20]) - 1) < 1e-9);
});
t("bill and roll call links", () => {
  assert.strictEqual(S.billUrl("H.R. 9497"), "https://www.congress.gov/bill/119th-congress/house-bill/9497");
  assert.strictEqual(S.billUrl("H.J.Res. 213"), "https://www.congress.gov/bill/119th-congress/house-joint-resolution/213");
  assert.strictEqual(S.billUrl("S. 2403"), "https://www.congress.gov/bill/119th-congress/senate-bill/2403");
  assert.strictEqual(S.rollUrl({ date: "2026-09-16", roll: 98 }), "https://clerk.house.gov/Votes/2026098");
});
t("chosen needs a matching search within the window", () => {
  const parsed = { platform: "TikTok",
    views: [{ t: new Date("2026-09-01T20:05:00Z"), title: "war powers vote count roll call breakdown", creator: "a" },
            { t: new Date("2026-09-01T23:00:00Z"), title: "Iran war powers vote CHAOS", creator: "b" }],
    searches: [{ t: new Date("2026-09-01T20:00:00Z"), q: "war powers" }] };
  const r = S.analyze(parsed, rules, votes);
  assert.strictEqual(r.political, 2); assert.strictEqual(r.chosen, 1);
});
t("TikTok sample parses and analyzes", () => {
  const p = S.parseFiles([{ name: "user_data_tiktok.json", json: D("samples/tiktok-sample.json") }]);
  assert.strictEqual(p.platform, "TikTok"); assert.ok(p.views.length > 2000);
  const r = S.analyze(p, rules, votes);
  assert.ok(r.political > 300 && r.chosenShare < 0.1, "chosen " + r.chosenShare);
  assert.ok(r.funnel.lastVoices < r.funnel.firstVoices, "funnel narrows");
  assert.ok(r.blindSpots.length >= 1, "has blind spots");
  assert.strictEqual(r.challenges.length, 3);
  console.log("     ", JSON.stringify({ views: r.totalViews, political: r.political, chosen: r.chosen, chosenShare: +r.chosenShare.toFixed(3), voices: [r.funnel.firstVoices.toFixed(1), r.funnel.lastVoices.toFixed(1)], top3: +r.top3Share.toFixed(2), conflict: r.tone, people: +r.peopleShare.toFixed(2), blind: r.blindSpots.map(b => b.name + ":" + b.votes + "/" + b.videos) }));
});
t("YouTube sample parses", () => {
  const y = D("samples/youtube-sample.json");
  const p = S.parseFiles([{ name: "watch-history.json", json: y["watch-history.json"] }, { name: "search-history.json", json: y["search-history.json"] }]);
  assert.strictEqual(p.platform, "YouTube"); assert.ok(p.searches.length > 50);
  const r = S.analyze(p, rules, votes); assert.ok(r.political > 50);
});
t("empty file gives a clear error", () => {
  assert.throws(() => S.parseFiles([{ name: "x.json", json: { Activity: {} } }]), /no watched videos/);
});
console.log(`\n${pass} passed`);
