// Local tests for the radar-2 model and board builder.
// Run: node --test tests/model.test.ts
// The fixture tests pin the model's arithmetic; the snapshot tests run the
// real sealed snapshot through the same gates the scorer applies.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MODEL_ID,
  ageInDays,
  buildBoard,
  categoryStats,
  farmSteps,
  globalStats,
  impliedValue,
  impliedRange,
  isPreToken,
  isRankable,
  fmtUsd,
  liveRows,
  planGasBreakdown,
  planTotals,
  type Protocol,
  type Snapshot,
} from "../lib/model.ts";

const AS_OF = "2026-11-14";

function proto(partial: Partial<Protocol>): Protocol {
  return {
    slug: "proto",
    name: "Proto",
    category: "Lending",
    chains: ["Ethereum"],
    tvl_usd: 100_000_000,
    change_7d: 0,
    mcap_usd: null,
    listed_at: "2025-11-14",
    gecko_id: null,
    symbol: null,
    ...partial,
  };
}

function fixtureSnapshot(): Snapshot {
  const trading: Protocol[] = [];
  // Four trading Lending protocols with mcap/TVL ratios 0.1, 0.2, 0.3, 0.4.
  [0.1, 0.2, 0.3, 0.4].forEach((ratio, i) => {
    trading.push(
      proto({
        slug: `lend-${i}`,
        name: `Lend ${i}`,
        tvl_usd: 100_000_000,
        mcap_usd: ratio * 100_000_000,
        gecko_id: `lend-${i}`,
        symbol: `L${i}`,
      }),
    );
  });
  // Two trading Dexs protocols, ratios 0.5 and 0.7 (thin category).
  [0.5, 0.7].forEach((ratio, i) => {
    trading.push(
      proto({
        slug: `dex-${i}`,
        name: `Dex ${i}`,
        category: "Dexs",
        tvl_usd: 50_000_000,
        mcap_usd: ratio * 50_000_000,
        gecko_id: `dex-${i}`,
        symbol: `D${i}`,
      }),
    );
  });
  return {
    as_of: AS_OF,
    source: "fixture",
    floor_usd: 50_000_000,
    watchlist: ["hero"],
    protocols: [
      ...trading,
      proto({ slug: "hero", name: "Hero", tvl_usd: 200_000_000 }),
    ],
  };
}

test("model id is radar-2", () => {
  assert.equal(MODEL_ID, "radar-2");
});

test("isPreToken requires mcap, gecko id and symbol all absent", () => {
  assert.equal(isPreToken(proto({})), true);
  assert.equal(isPreToken(proto({ mcap_usd: 5 })), false);
  assert.equal(isPreToken(proto({ gecko_id: "x" })), false);
  assert.equal(isPreToken(proto({ symbol: "X" })), false);
});

test("isRankable excludes centralised exchanges and versioned products", () => {
  assert.equal(isRankable(proto({})), true);
  assert.equal(isRankable(proto({ category: "CEX" })), false);
  assert.equal(isRankable(proto({ name: "Proto V2" })), false);
  assert.equal(isRankable(proto({ name: "Proto 1.5" })), false);
  assert.equal(isRankable(proto({ name: "Proto v3" })), false);
  assert.equal(isRankable(proto({ mcap_usd: 10 })), false);
});

test("isRankable excludes products of tokens that already trade", () => {
  assert.equal(isRankable(proto({ category: "Bridge" })), false);
  assert.equal(isRankable(proto({ category: "Canonical Bridge" })), false);
  assert.equal(isRankable(proto({ category: "Liquid Staking" })), false);
  assert.equal(isRankable(proto({ category: "Liquid Restaking" })), false);
  assert.equal(isRankable(proto({ category: "Restaked BTC" })), false);
  assert.equal(isRankable(proto({ name: "Wrapped Ether" })), false);
  assert.equal(isRankable(proto({ name: "Exchange Staked ETH" })), false);
  assert.equal(isRankable(proto({ name: "Proto Staking" })), false);
  // Whole words only: a name merely containing the letters stays rankable.
  assert.equal(isRankable(proto({ name: "Steakhouse Financial" })), true);
  assert.equal(isRankable(proto({ name: "Prostaked" })), true);
});

test("ageInDays measures whole days to the snapshot date", () => {
  assert.equal(ageInDays(proto({ listed_at: "2025-11-14" }), AS_OF), 365);
  assert.equal(ageInDays(proto({ listed_at: "2026-11-14" }), AS_OF), 0);
  assert.equal(ageInDays(proto({ listed_at: null }), AS_OF), null);
});

test("categoryStats reports median, quartiles and sample count", () => {
  const stats = categoryStats(fixtureSnapshot());
  const lending = stats.get("Lending");
  assert.ok(lending);
  assert.equal(lending.n, 4);
  assert.ok(Math.abs(lending.median - 0.25) < 1e-9);
  assert.ok(lending.q1 <= lending.median && lending.median <= lending.q3);
});

test("thin categories shrink toward the global median", () => {
  const snap = fixtureSnapshot();
  const stats = categoryStats(snap);
  const global = globalStats(snap);
  const dexs = stats.get("Dexs");
  assert.ok(dexs);
  assert.equal(dexs.n, 2);
  // Raw Dexs median is 0.6; the shrunk multiple must sit between the global
  // median and 0.6, never equal to the raw figure at n=2.
  assert.ok(dexs.multiple > global.median && dexs.multiple < 0.6);
});

test("a single speculative comp cannot set a category multiple", () => {
  const snap = fixtureSnapshot();
  snap.protocols.push(
    proto({
      slug: "solo-comp",
      name: "Solo Comp",
      category: "RWA",
      tvl_usd: 10_000_000,
      mcap_usd: 30_000_000, // ratio 3.0, the only trading RWA protocol
      gecko_id: "solo-comp",
      symbol: "SOLO",
    }),
  );
  const stats = categoryStats(snap);
  const global = globalStats(snap);
  const rwa = stats.get("RWA");
  assert.ok(rwa);
  assert.equal(rwa.n, 1);
  assert.ok(
    rwa.multiple <= 2 * global.median + 1e-12,
    `thin-category multiple ${rwa.multiple} exceeds twice the global median`,
  );
});

test("a category with no trading protocols falls back to the global multiple", () => {
  const snap = fixtureSnapshot();
  const stats = categoryStats(snap);
  const p = proto({ category: "RWA" });
  const v = impliedValue(p, stats, globalStats(snap), AS_OF);
  const expected = Math.max(
    1,
    Math.round(
      100_000_000 * globalStats(snap).multiple * 1 * (0.6 + (0.4 * 365) / 1095),
    ),
  );
  assert.equal(v, expected);
});

test("impliedValue applies growth and maturity factors", () => {
  const snap = fixtureSnapshot();
  const stats = categoryStats(snap);
  const global = globalStats(snap);
  // Lending multiple comes from the stats themselves (n=4, shrunk median).
  const mult = stats.get("Lending")?.multiple ?? 0;
  assert.ok(mult > 0);
  const calm = proto({ change_7d: 0, listed_at: "2025-11-14" }); // age 365
  const expectedCalm = Math.round(
    100_000_000 * mult * 1 * (0.6 + (0.4 * 365) / 1095),
  );
  assert.equal(impliedValue(calm, stats, global, AS_OF), expectedCalm);
  const hot = proto({ change_7d: 40, listed_at: "2025-11-14" });
  assert.ok(
    impliedValue(hot, stats, global, AS_OF) > impliedValue(calm, stats, global, AS_OF),
  );
});

test("growth is clamped so a spike cannot dominate the value", () => {
  const snap = fixtureSnapshot();
  const stats = categoryStats(snap);
  const global = globalStats(snap);
  const wild = proto({ change_7d: 900 });
  const capped = proto({ change_7d: 120 });
  assert.equal(
    impliedValue(wild, stats, global, AS_OF),
    impliedValue(capped, stats, global, AS_OF),
  );
  const crashed = proto({ change_7d: -95 });
  const floored = proto({ change_7d: -60 });
  assert.equal(
    impliedValue(crashed, stats, global, AS_OF),
    impliedValue(floored, stats, global, AS_OF),
  );
});

test("unknown age uses the neutral 365 day assumption", () => {
  const snap = fixtureSnapshot();
  const stats = categoryStats(snap);
  const global = globalStats(snap);
  assert.equal(
    impliedValue(proto({ listed_at: null }), stats, global, AS_OF),
    impliedValue(proto({ listed_at: "2025-11-14" }), stats, global, AS_OF),
  );
});

test("impliedRange brackets the implied value on the real snapshot", () => {
  const stats = categoryStats(real);
  const global = globalStats(real);
  for (const p of real.protocols.filter(isRankable)) {
    const v = impliedValue(p, stats, global, real.as_of);
    const range = impliedRange(p, stats, global, real.as_of);
    assert.ok(range.low <= v && v <= range.high, `${p.slug}: ${range.low} <= ${v} <= ${range.high}`);
  }
});

test("impliedRange collapses for a one-comp category", () => {
  const snap = fixtureSnapshot();
  snap.protocols.push(
    proto({
      slug: "solo-comp",
      name: "Solo Comp",
      category: "RWA",
      tvl_usd: 10_000_000,
      mcap_usd: 30_000_000,
      gecko_id: "solo-comp",
      symbol: "SOLO",
    }),
  );
  const stats = categoryStats(snap);
  const global = globalStats(snap);
  const target = proto({ slug: "rwa-pre", category: "RWA" });
  const range = impliedRange(target, stats, global, AS_OF);
  assert.equal(range.low, range.high);
  assert.equal(range.low, impliedValue(target, stats, global, AS_OF));
});

test("farmSteps returns seven concrete steps with cost and time", () => {
  const steps = farmSteps(proto({ chains: ["Arbitrum", "Base"] }));
  assert.equal(steps.length, 7);
  for (const step of steps) {
    const trimmed = step.trim();
    assert.ok(trimmed.length >= 20 && trimmed.length <= 600, trimmed);
    assert.match(trimmed, /Cost:/);
    assert.match(trimmed, /Time:/);
    assert.match(trimmed, /\$/);
  }
  // Multi-chain protocols get a second-chain step naming the second chain.
  assert.ok(steps.some((s) => s.includes("Base")));
  // The core step names the primary chain.
  assert.ok(steps.some((s) => s.includes("Arbitrum")));
});

test("farmSteps separates spend from capital that stays in the wallet", () => {
  const steps = farmSteps(proto({}));
  assert.ok(steps.some((s) => /stays in your wallet|remains yours/i.test(s)));
  assert.ok(steps.some((s) => /verify|official/i.test(s)));
});

test("zero market caps are not comparables evidence", () => {
  const snap = fixtureSnapshot();
  snap.protocols.push(
    proto({
      slug: "zero-cap",
      name: "Zero Cap",
      mcap_usd: 0,
      gecko_id: "zero-cap",
      symbol: "ZERO",
    }),
  );
  assert.equal(categoryStats(snap).get("Lending")?.n, 4);
  assert.equal(globalStats(snap).n, 6);
});

test("board rows mark whether their multiple came from the category or the global fallback", () => {
  const snap = fixtureSnapshot();
  snap.protocols.push(proto({ slug: "rwa-pre", name: "RWA Pre", category: "RWA" }));
  const board = buildBoard(snap);
  const hero = board.find((r) => r.slug === "hero");
  assert.equal(hero?.model.source, "category");
  assert.ok((hero?.model.comps ?? 0) > 0);
  const rwa = board.find((r) => r.slug === "rwa-pre");
  assert.equal(rwa?.model.source, "global");
  assert.equal(rwa?.model.comps, 0);
});

test("plan gas total is exactly the sum of the gas figures the steps quote", () => {
  const p = proto({ chains: ["Ethereum", "Base"] });
  const breakdown = planGasBreakdown(p);
  const totals = planTotals(p);
  assert.equal(totals.gas_usd, breakdown.total);
  assert.equal(
    breakdown.total,
    breakdown.core + breakdown.second + breakdown.cadence + breakdown.second_chain + breakdown.exit,
  );
  const steps = farmSteps(p);
  assert.ok(steps[1].includes(fmtUsd(breakdown.core)), steps[1]);
  assert.ok(steps[2].includes(fmtUsd(breakdown.second)), steps[2]);
  assert.ok(steps[3].includes(fmtUsd(breakdown.cadence)), steps[3]);
  assert.ok(steps[4].includes(fmtUsd(breakdown.second_chain)), steps[4]);
  assert.ok(steps[6].includes(fmtUsd(breakdown.exit)), steps[6]);
});

test("plan capital counts weekly deposit top-ups for deposit cadences only", () => {
  // Fixture: TVL $100M -> capital $200 + second $80; age 365 -> 8 weeks.
  const lending = planTotals(proto({}));
  assert.equal(lending.capital_usd, 200 + 80 + 25 * 8);
  const dexs = planTotals(proto({ category: "Dexs" }));
  assert.equal(dexs.capital_usd, 200 + 80);
});

test("planTotals sums gas, capital and weeks from the same figures", () => {
  const totals = planTotals(proto({ chains: ["Ethereum"] }));
  assert.ok(totals.gas_usd > 0);
  assert.ok(totals.capital_usd >= 100);
  assert.ok(totals.weeks >= 4);
  const l2 = planTotals(proto({ chains: ["Base"] }));
  assert.ok(l2.gas_usd < totals.gas_usd, "L2 gas must be cheaper than mainnet");
});

// ---- The real sealed snapshot through the scorer's gate shape ----

// The fixture lives outside the repo (the harness supplies its own input);
// resolve it from the first candidate that exists.
import { existsSync } from "node:fs";
const snapshotCandidates = [
  process.env.RADAR_SNAPSHOT,
  "../../kit-token-radar-01-r3/token-radar-01-kit/input/snapshot.json",
  "../../kit-input/snapshot.json",
].filter((p): p is string => typeof p === "string" && p.length > 0);
const snapshotPath = snapshotCandidates
  .map((p) => new URL(p, import.meta.url))
  .find((u) => existsSync(u));
assert.ok(snapshotPath, "sealed snapshot fixture not found");
const real: Snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as Snapshot;

test("snapshot board covers the whole watchlist", () => {
  const board = buildBoard(real);
  const slugs = new Set(board.map((r) => r.slug));
  for (const slug of real.watchlist) assert.ok(slugs.has(slug), slug);
});

test("snapshot board ranks every rankable pre-token protocol", () => {
  const board = buildBoard(real);
  const rankable = real.protocols.filter(isRankable).length;
  assert.equal(board.length, rankable);
  assert.ok(board.length >= 150, `expected a broad board, got ${board.length}`);
});

test("snapshot board keeps known trading-token products off the radar", () => {
  const board = buildBoard(real);
  const slugs = new Set(board.map((r) => r.slug));
  for (const name of ["WBTC", "Binance staked ETH", "USDT0"]) {
    const found = real.protocols.find((p) => p.name === name);
    assert.ok(found, `${name} should exist in the snapshot`);
    assert.ok(!slugs.has(found.slug), `${name} must not be ranked as pre-token`);
  }
});

test("snapshot board is ranked 1..N with non-increasing implied value", () => {
  const board = buildBoard(real);
  board.forEach((row, i) => assert.equal(row.rank, i + 1));
  for (let i = 1; i < board.length; i++) {
    assert.ok(board[i - 1].implied_value_usd >= board[i].implied_value_usd);
  }
  assert.ok(
    new Set(board.map((r) => r.implied_value_usd)).size > 1,
    "implied values must not all be equal",
  );
});

test("every snapshot row carries 7 in-bounds farm steps", () => {
  const board = buildBoard(real);
  for (const row of board) {
    assert.equal(row.farm_steps.length, 7, row.slug);
    for (const step of row.farm_steps) {
      const t = step.trim();
      assert.ok(t.length >= 20 && t.length <= 600, `${row.slug}: ${t.length}`);
    }
  }
});

test("board building is deterministic", () => {
  assert.equal(JSON.stringify(buildBoard(real)), JSON.stringify(buildBoard(real)));
});

test("liveRows lists trading protocols by market cap, all with a cap", () => {
  const live = liveRows(real);
  assert.ok(live.length >= 24);
  for (const row of live) assert.ok(row.mcap_usd != null && row.mcap_usd > 0);
  for (let i = 1; i < live.length; i++) {
    assert.ok((live[i - 1].mcap_usd ?? 0) >= (live[i].mcap_usd ?? 0));
  }
});
