// Token launch radar, model "radar-2": the comparables model.
//
// Every figure in an implied value is read from the sealed snapshot itself.
// Protocols whose token already trades report a market cap; for each
// category, the median market-cap / TVL ratio of those trading protocols is
// what the market currently pays for one dollar of TVL in that category.
// A pre-token protocol is valued as if it launched at that same multiple:
//
//   implied = TVL x category multiple x growth factor x maturity factor
//
// Category medians from few trading protocols are shrunk toward the global
// median (weight n / (n + 8)) so a thin category cannot produce a wild
// multiple; a category with fewer than three trading protocols is also
// capped at twice the global median, and every multiple is clamped to
// [0.02, 2.5]. The growth factor
// rewards a protocol whose TVL is rising into a launch; the maturity factor
// rewards one that has run for years with no token. Nothing is hardcoded
// per protocol: rename every protocol in the snapshot and the board is the
// same board with different labels.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  watchlist: string[];
  protocols: Protocol[];
}

export interface CategoryStat {
  n: number;
  median: number;
  q1: number;
  q3: number;
  multiple: number;
  multiple_q1: number;
  multiple_q3: number;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  model: {
    multiple: number;
    comps: number;
    source: "category" | "global";
    growth_factor: number;
    maturity_factor: number;
  };
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
}

export const MODEL_ID = "radar-2";
export const MODEL_FORMULA =
  "implied = TVL x category multiple (median market cap / TVL of the category's trading protocols, shrunk toward the global median) x growth factor x maturity factor";

const DAY_MS = 86_400_000;
const UNKNOWN_AGE_DAYS = 365;
const SHRINK_K = 8;
const MULTIPLE_MIN = 0.02;
const MULTIPLE_MAX = 2.5;

const clamp = (x: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, x));

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

function ratiosOf(protocols: Protocol[]): number[] {
  // A recorded market cap of zero is the absence of a market, not evidence
  // that the market values TVL at zero: such protocols are not comparables
  // and stay out of every median. (They are still not pre-token — a token
  // exists — so they never reach the board either.)
  return protocols
    .filter((p) => p.mcap_usd != null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => (p.mcap_usd as number) / p.tvl_usd)
    .sort((a, b) => a - b);
}

function statOf(ratios: number[], globalMedian: number): CategoryStat {
  // One transform for the median and both quartiles, so the range the
  // dashboard shows can never contradict the multiple the board used:
  // shrink toward the global median, cap thin categories at twice it,
  // clamp to the sane band.
  const transform = (r: number): number => {
    const shrunk = (ratios.length * r + SHRINK_K * globalMedian) / (ratios.length + SHRINK_K);
    const capped = ratios.length < 3 ? Math.min(shrunk, 2 * globalMedian) : shrunk;
    return clamp(capped, MULTIPLE_MIN, MULTIPLE_MAX);
  };
  const median = percentile(ratios, 0.5);
  const q1 = percentile(ratios, 0.25);
  const q3 = percentile(ratios, 0.75);
  return {
    n: ratios.length,
    median,
    q1,
    q3,
    multiple: transform(median),
    multiple_q1: transform(q1),
    multiple_q3: transform(q3),
  };
}

export function globalStats(snapshot: Snapshot): CategoryStat {
  const ratios = ratiosOf(snapshot.protocols);
  const median = percentile(ratios, 0.5);
  const multiple = clamp(median, MULTIPLE_MIN, MULTIPLE_MAX);
  return {
    n: ratios.length,
    median,
    q1: percentile(ratios, 0.25),
    q3: percentile(ratios, 0.75),
    multiple,
    multiple_q1: multiple,
    multiple_q3: multiple,
  };
}

export function categoryStats(snapshot: Snapshot): Map<string, CategoryStat> {
  const global = globalStats(snapshot);
  const byCategory = new Map<string, Protocol[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd == null || p.tvl_usd <= 0) continue;
    const key = p.category ?? "Unclassified";
    const list = byCategory.get(key);
    if (list) list.push(p);
    else byCategory.set(key, [p]);
  }
  const out = new Map<string, CategoryStat>();
  for (const [category, list] of byCategory) {
    out.set(category, statOf(ratiosOf(list), global.median));
  }
  return out;
}

export function isPreToken(p: Protocol): boolean {
  return p.mcap_usd == null && p.gecko_id == null && p.symbol == null;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

// The snapshot's own watchlist definition of a protocol still awaiting a
// launch, applied to the whole board: a wrapped, staked or bridged product
// of a token that already trades is not a launch candidate, whatever the
// data fields say, and neither is a bridge or a staking wrapper whose
// "protocol" is the product itself.
const PRODUCT_CATEGORIES = new Set([
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
]);
const PRODUCT_WORDS = /\b(wrapped|staked|staking|bridged)\b/i;

export function isRankable(p: Protocol): boolean {
  return (
    isPreToken(p) &&
    p.category !== "CEX" &&
    !(p.category != null && PRODUCT_CATEGORIES.has(p.category)) &&
    !VERSIONED.test(p.name) &&
    !PRODUCT_WORDS.test(p.name)
  );
}

export function ageInDays(p: Pick<Protocol, "listed_at">, asOf: string): number | null {
  if (p.listed_at == null) return null;
  const days = Math.floor(
    (Date.parse(asOf + "T00:00:00Z") - Date.parse(p.listed_at + "T00:00:00Z")) / DAY_MS,
  );
  return Number.isFinite(days) ? Math.max(0, days) : null;
}

export function growthFactor(change7d: number | null): number {
  return 1 + (clamp(change7d ?? 0, -60, 120) / 100) * 0.5;
}

export function maturityFactor(ageDays: number | null): number {
  const age = ageDays ?? UNKNOWN_AGE_DAYS;
  return 0.6 + 0.4 * (Math.min(age, 1095) / 1095);
}

export function impliedValue(
  p: Protocol,
  stats: Map<string, CategoryStat>,
  global: CategoryStat,
  asOf: string,
): number {
  const stat = stats.get(p.category ?? "Unclassified") ?? global;
  const raw =
    p.tvl_usd *
    stat.multiple *
    growthFactor(p.change_7d) *
    maturityFactor(ageInDays(p, asOf));
  return Math.max(1, Math.round(raw));
}

// The honest spread around an implied value: the same protocol valued at
// its category's lower- and upper-quartile multiples, passed through the
// same shrinkage as the headline multiple. For a category with a single
// trading protocol the quartiles are that protocol, so the range collapses
// onto the headline figure instead of inventing a spread.
export function impliedRange(
  p: Pick<Protocol, "category" | "tvl_usd" | "change_7d" | "listed_at">,
  stats: Map<string, CategoryStat>,
  global: CategoryStat,
  asOf: string,
): { low: number; high: number } {
  const stat = stats.get(p.category ?? "Unclassified") ?? global;
  const growth = growthFactor(p.change_7d);
  const maturity = maturityFactor(ageInDays(p, asOf));
  return {
    low: Math.max(1, Math.round(p.tvl_usd * stat.multiple_q1 * growth * maturity)),
    high: Math.max(1, Math.round(p.tvl_usd * stat.multiple_q3 * growth * maturity)),
  };
}

// ---- Farm plans ----

// Estimated cost of one ordinary transaction (approve, deposit, swap) per
// chain, in dollars, at typical congestion. Mainnet is an order of magnitude
// dearer than any L2; the plan totals use the same figures the steps quote.
const GAS_USD: Record<string, number> = {
  Ethereum: 14,
  Arbitrum: 0.6,
  Base: 0.4,
  Optimism: 0.5,
  "BNB Chain": 0.35,
  Polygon: 0.1,
  Avalanche: 0.9,
  Solana: 0.05,
  "zkSync Era": 0.35,
  Linea: 0.45,
  Scroll: 0.4,
  Mantle: 0.2,
  Starknet: 0.3,
};
const GAS_DEFAULT = 0.75;

export const gasOf = (chain: string): number => GAS_USD[chain] ?? GAS_DEFAULT;

export function fmtUsd(n: number): string {
  if (n < 1) return "$" + n.toFixed(2);
  if (n < 10) {
    const v = Math.round(n * 10) / 10;
    return "$" + (Number.isInteger(v) ? String(v) : v.toFixed(1));
  }
  return "$" + Math.round(n).toLocaleString("en-US");
}

function capitalTier(tvl: number): number {
  if (tvl >= 1_000_000_000) return 500;
  if (tvl >= 250_000_000) return 300;
  if (tvl >= 50_000_000) return 200;
  return 120;
}

function holdWeeks(ageDays: number | null): number {
  const age = ageDays ?? UNKNOWN_AGE_DAYS;
  if (age >= 730) return 6;
  if (age >= 365) return 8;
  if (age >= 90) return 10;
  return 12;
}

interface Playbook {
  core: (name: string, cap: string) => string;
  second: (name: string, cap: string) => string;
  cadence: string;
  // True when the weekly cadence action is itself a deposit of about $25:
  // those top-ups deploy real capital and the plan total must count them.
  cadence_deposit: boolean;
}

const PLAYBOOKS: Record<string, Playbook> = {
  Lending: {
    core: (name, cap) =>
      `Supply ${cap} of a major stablecoin (USDC or USDT) or ETH as collateral in ${name}'s main lending market`,
    second: (name, cap) =>
      `Open a second, smaller supply of ${cap} in a different asset market of the same protocol, so the wallet has used more than one market`,
    cadence: "a top-up supply or a partial withdraw-and-resupply of about $25",
    cadence_deposit: true,
  },
  Dexs: {
    core: (name, cap) =>
      `Provide ${cap} of liquidity to ${name}'s busiest major pair (the ETH or stablecoin pool with the deepest TVL)`,
    second: (name, cap) =>
      `Make three swaps of about $50 each across two other pairs, then add ${cap} of liquidity to a second pool`,
    cadence: "one swap of about $25 in the main pair",
    cadence_deposit: false,
  },
  Yield: {
    core: (name, cap) =>
      `Deposit ${cap} into ${name}'s flagship yield vault and leave the shares in the same wallet`,
    second: (name, cap) =>
      `Deposit ${cap} into a second vault running a different strategy, so the wallet is not riding on a single position`,
    cadence: "a top-up deposit of about $25 into the flagship vault",
    cadence_deposit: true,
  },
  "Yield Aggregator": {
    core: (name, cap) =>
      `Deposit ${cap} into the aggregator's flagship vault for a major stablecoin or ETH`,
    second: (name, cap) =>
      `Deposit ${cap} into a second vault on a different underlying asset`,
    cadence: "a top-up deposit of about $25",
    cadence_deposit: true,
  },
  "Liquid Staking": {
    core: (name, cap) =>
      `Stake ${cap} of ETH through ${name} and hold the liquid staking token it issues in the same wallet`,
    second: (name, cap) =>
      `Put ${cap} of the staking token to work in one integrated market the protocol lists, such as a lending market or a liquidity pool`,
    cadence: "one additional small stake of about $25",
    cadence_deposit: true,
  },
  Restaking: {
    core: (name, cap) =>
      `Restake ${cap} of ETH or a liquid staking token through ${name} and hold the position in the same wallet`,
    second: (name, cap) =>
      `Delegate or allocate ${cap} of the restaked balance toward a second operator or service the protocol offers`,
    cadence: "one additional small restake of about $25",
    cadence_deposit: true,
  },
  "Liquid Restaking": {
    core: (name, cap) =>
      `Deposit ${cap} of ETH or a liquid staking token into ${name} and hold the restaking token it issues`,
    second: (name, cap) =>
      `Use ${cap} of the restaking token in one integrated market the protocol lists`,
    cadence: "one additional small deposit of about $25",
    cadence_deposit: true,
  },
  Bridge: {
    core: (name, cap) =>
      `Bridge ${cap} of ETH or stablecoins across with ${name} and keep the funds working on the destination chain instead of bridging straight back`,
    second: (name, cap) =>
      `Bridge a second asset, or the same asset on a second route, for about ${cap}`,
    cadence: "one small bridge transfer of about $25",
    cadence_deposit: true,
  },
  "Canonical Bridge": {
    core: (name, cap) =>
      `Bridge ${cap} of ETH or stablecoins to the chain through its canonical bridge and use the funds in that chain's ecosystem`,
    second: (name, cap) =>
      `Bridge a second deposit of about ${cap} at least a week later, so the wallet shows repeated rather than one-off use`,
    cadence: "one small bridge deposit of about $25",
    cadence_deposit: true,
  },
  Derivatives: {
    core: (name, cap) =>
      `Deposit ${cap} as margin and open one small position sized so that a 10 percent move against it cannot liquidate it`,
    second: (name, cap) =>
      `Place and cancel two limit orders away from the market price, then trade a second market with about ${cap} of margin`,
    cadence: "one small trade using about $25 of margin",
    cadence_deposit: false,
  },
  CDP: {
    core: (name, cap) =>
      `Open a vault: deposit ${cap} of ETH as collateral and mint a conservative amount of the protocol's stablecoin, keeping the collateral ratio far above the liquidation line`,
    second: (name, cap) =>
      `Repay part of the minted debt and mint again a week later, so the wallet shows a full borrow-and-repay cycle`,
    cadence: "a small collateral top-up of about $25",
    cadence_deposit: true,
  },
  RWA: {
    core: (name, cap) =>
      `Buy ${cap} of ${name}'s flagship real-world-asset product, or deposit that amount into its main vault if it runs one`,
    second: (name, cap) =>
      `Hold the first position through one full yield or reporting cycle, then add ${cap} more`,
    cadence: "a top-up purchase of about $25",
    cadence_deposit: true,
  },
  "Risk Curators": {
    core: (name, cap) =>
      `Deposit ${cap} into the flagship curated vault, choosing the curator whose vault holds the largest share of the protocol's TVL`,
    second: (name, cap) =>
      `Deposit ${cap} into a second curated vault run by a different curator or carrying a different risk profile`,
    cadence: "a top-up deposit of about $25 into the flagship vault",
    cadence_deposit: true,
  },
  "Onchain Capital Allocator": {
    core: (name, cap) =>
      `Deposit ${cap} into the allocator's flagship vault and leave the shares untouched in the same wallet`,
    second: (name, cap) =>
      `Deposit ${cap} into a second vault the allocator runs, on a different underlying asset`,
    cadence: "a top-up deposit of about $25",
    cadence_deposit: true,
  },
};

const DEFAULT_PLAYBOOK: Playbook = {
  core: (name, cap) =>
    `Use ${name}'s core product with ${cap}: make the smallest real deposit, swap or position it supports, at full size rather than a dust-sized test`,
  second: (name, cap) =>
    `Repeat the core action in a second market, pool or vault of the same protocol with ${cap}`,
  cadence: "one small repeat of the core action, worth about $25",
  cadence_deposit: false,
};

interface PlanFigures {
  chain1: string;
  chain2: string | null;
  gas1: number;
  capital: number;
  capital2: number;
  cadenceCapital: number;
  weeks: number;
  coreGas: number;
  secondGas: number;
  weeklyGas: number;
  cadenceGas: number;
  secondChainGas: number;
  exitGas: number;
  totalGas: number;
}

// The slice of a protocol the farm plan reads. BoardRow satisfies it, so
// the entry point can total a board row's plan without rebuilding one.
export type PlanSubject = Pick<
  Protocol,
  "name" | "category" | "chains" | "tvl_usd" | "listed_at"
>;

export interface PlanTotals {
  gas_usd: number;
  capital_usd: number;
  weeks: number;
}

export interface PlanGasBreakdown {
  core: number;
  second: number;
  cadence: number;
  second_chain: number;
  exit: number;
  total: number;
}

// The gas total is exactly the sum of the gas figures the steps quote —
// no unquoted term. The breakdown is exported so tests can hold the
// totals and the step text to the same numbers.
export function planGasBreakdown(p: PlanSubject, asOf?: string): PlanGasBreakdown {
  const f = planFiguresFor(p, asOf);
  return {
    core: f.coreGas,
    second: f.secondGas,
    cadence: f.cadenceGas,
    second_chain: f.secondChainGas,
    exit: f.exitGas,
    total: f.totalGas,
  };
}

export function planTotals(p: PlanSubject, asOf?: string): PlanTotals {
  const f = planFiguresFor(p, asOf);
  return {
    gas_usd: Math.round(f.totalGas * 100) / 100,
    capital_usd: f.capital + f.capital2 + f.cadenceCapital,
    weeks: f.weeks,
  };
}

function planFiguresFor(p: PlanSubject, asOf?: string): PlanFigures {
  const chain1 = p.chains[0] ?? "Ethereum";
  const chain2 = p.chains.length > 1 ? p.chains[1] : null;
  const gas1 = gasOf(chain1);
  const capital = capitalTier(p.tvl_usd);
  const capital2 = Math.round(capital * 0.4);
  const weeks = holdWeeks(asOf ? ageInDays(p, asOf) : null);
  const book = PLAYBOOKS[p.category ?? ""] ?? DEFAULT_PLAYBOOK;
  const cadenceCapital = book.cadence_deposit ? 25 * weeks : 0;
  const coreGas = 2 * gas1;
  const secondGas = 2 * gas1;
  const weeklyGas = gas1;
  const cadenceGas = gas1 * weeks;
  const secondChainGas = 2 * gasOf(chain2 ?? chain1);
  const exitGas = 2 * gas1;
  const totalGas = coreGas + secondGas + cadenceGas + secondChainGas + exitGas;
  return {
    chain1,
    chain2,
    gas1,
    capital,
    capital2,
    cadenceCapital,
    weeks,
    coreGas,
    secondGas,
    weeklyGas,
    cadenceGas,
    secondChainGas,
    exitGas,
    totalGas,
  };
}

export function farmSteps(p: PlanSubject, asOf?: string): string[] {
  const f = planFiguresFor(p, asOf);
  const book = PLAYBOOKS[p.category ?? ""] ?? DEFAULT_PLAYBOOK;
  const fund = Math.max(10, Math.ceil(f.totalGas * 1.5));
  const steps: string[] = [];

  steps.push(
    `Verify before you fund anything: open ${p.name}'s official site from its DefiLlama page, check the domain letter by letter, and ignore app links from search ads and replies. Create a fresh wallet used only for this farm and fund it with about ${fmtUsd(fund)} of gas money on ${f.chain1}. Cost: $0 in fees; the ${fmtUsd(fund)} stays in your wallet as its gas balance. Time: 20 minutes, once.`,
  );
  steps.push(
    `${book.core(p.name, fmtUsd(f.capital))} on ${f.chain1}. Cost: about ${fmtUsd(f.coreGas)} in ${f.chain1} gas for the approval and the deposit; the ${fmtUsd(f.capital)} of capital stays in your wallet as your position and remains yours to withdraw. Time: 15 minutes, once.`,
  );
  steps.push(
    `${book.second(p.name, fmtUsd(f.capital2))}. Cost: about ${fmtUsd(f.secondGas)} in ${f.chain1} gas; the ${fmtUsd(f.capital2)} stays in your wallet as your position. Time: 15 minutes, once.`,
  );
  steps.push(
    `Keep the wallet active: repeat ${book.cadence} once a week for ${f.weeks} weeks, on the same weekday, so the wallet shows ${f.weeks} separate weeks of real use rather than one burst.${f.cadenceCapital > 0 ? ` Each weekly action also adds about $25 of capital to the position, ${fmtUsd(f.cadenceCapital)} across the plan, all of it still yours.` : ""} Cost: about ${fmtUsd(f.weeklyGas)} in gas per week, ${fmtUsd(f.cadenceGas)} across the plan. Time: 10 minutes a week for ${f.weeks} weeks.`,
  );
  if (f.chain2 != null) {
    steps.push(
      `Repeat the core position on ${f.chain2}, where ${p.name} also runs: many launches weight wallets that used a protocol on more than one chain. Cost: about ${fmtUsd(f.secondChainGas)} in ${f.chain2} gas; the position itself reuses capital already in the wallet. Time: 15 minutes, once.`,
    );
  } else {
    steps.push(
      `Deepen the history on ${f.chain1}: after two weeks, repeat the core action once more at half size, so the wallet's record is a pattern of use and not a single deposit. Cost: about ${fmtUsd(f.secondChainGas)} in ${f.chain1} gas, reusing capital already in the wallet. Time: 10 minutes, once.`,
    );
  }
  steps.push(
    `Hold the position for the full ${f.weeks} weeks. When you do the weekly action, confirm the position is still in place and the wallet still controls the funds. No snapshot or launch date is announced in the data this plan is built from, so do not move money on rumours of one. Cost: $0 beyond the weekly gas already counted. Time: 5 minutes a week for ${f.weeks} weeks.`,
  );
  steps.push(
    `Exit on your own schedule, not on hype: withdraw the position and bridge or swap the proceeds back to your main wallet. If a token launches, claim only through the link in the protocol's official announcement, and check the token contract it names against the announcement before signing anything. Cost: about ${fmtUsd(f.exitGas)} in gas for the withdrawal and exit transactions. Time: 20 minutes, once.`,
  );
  return steps;
}

// ---- Board and live set ----

export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const stats = categoryStats(snapshot);
  const global = globalStats(snapshot);
  const watch = new Set(snapshot.watchlist);
  const rows = snapshot.protocols.filter(isRankable).map((p) => {
    const catStat = stats.get(p.category ?? "Unclassified");
    const hasComps = catStat != null && catStat.n > 0;
    const stat = hasComps ? catStat : global;
    const age = ageInDays(p, snapshot.as_of);
    return {
      rank: 0,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_days: age,
      watchlist: watch.has(p.slug),
      implied_value_usd: impliedValue(p, stats, global, snapshot.as_of),
      model: {
        multiple: Math.round(stat.multiple * 10000) / 10000,
        comps: hasComps ? stat.n : 0,
        source: hasComps ? ("category" as const) : ("global" as const),
        growth_factor: Math.round(growthFactor(p.change_7d) * 10000) / 10000,
        maturity_factor: Math.round(maturityFactor(age) * 10000) / 10000,
      },
      farm_steps: farmSteps(p, snapshot.as_of),
    } satisfies BoardRow;
  });
  rows.sort(
    (a, b) =>
      b.implied_value_usd - a.implied_value_usd ||
      b.tvl_usd - a.tvl_usd ||
      (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
  );
  rows.forEach((row, i) => {
    row.rank = i + 1;
  });
  return rows;
}

export function liveRows(snapshot: Snapshot, limit = 40): LiveRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd != null)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd as number,
      ratio: p.tvl_usd > 0 ? Math.round(((p.mcap_usd as number) / p.tvl_usd) * 10000) / 10000 : 0,
    }))
    .sort((a, b) => b.mcap_usd - a.mcap_usd)
    .slice(0, limit);
}
