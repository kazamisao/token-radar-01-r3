// Token launch radar: entry point.
//
// Reads the sealed snapshot, builds the ranked board with the radar-2
// comparables model (lib/model.ts), and writes the four deliverables into
// the output directory: board.json, the dashboard data file, a copy of the
// dashboard and screenshots, and the dossier the judge reads.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// The program refuses to write a board that fails its own gate checks: a
// broken board is worse than a loud failure.

import { cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MODEL_FORMULA,
  MODEL_ID,
  buildBoard,
  categoryStats,
  globalStats,
  growthFactor,
  impliedRange,
  liveRows,
  maturityFactor,
  planTotals,
  type Snapshot,
} from "./lib/model.ts";
import { buildDossier } from "./vendor/makefun-board.ts";

const root = dirname(fileURLToPath(import.meta.url));

function parseArgs(): { input: string; output: string } {
  const named = new Map<string, string>();
  const positional: string[] = [];
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 2) {
        named.set(a.slice(2, eq), a.slice(eq + 1));
      } else if (i + 1 < argv.length && !(argv[i + 1] as string).startsWith("--")) {
        named.set(a.slice(2), argv[i + 1] as string);
        i++;
      } else {
        named.set(a.slice(2), "true");
      }
    } else {
      positional.push(a);
    }
  }
  return {
    input: named.get("input") ?? positional[0] ?? "/input/snapshot.json",
    output:
      named.get("output") ??
      process.env.MAKEFUN_OUTPUT_DIR ??
      positional[1] ??
      "/output",
  };
}

const args = parseArgs();
const inputPath = existsSync(args.input) && statSync(args.input).isDirectory()
  ? join(args.input, "snapshot.json")
  : args.input;
const out = args.output;

const snapshot = JSON.parse(readFileSync(inputPath, "utf8")) as Snapshot;
const board = buildBoard(snapshot);
const live = liveRows(snapshot);
const stats = categoryStats(snapshot);
const global = globalStats(snapshot);

function boardIssue(): string | null {
  const watch = new Set(snapshot.watchlist);
  const seen = new Set<string>();
  let previous = Number.POSITIVE_INFINITY;
  for (let i = 0; i < board.length; i++) {
    const row = board[i] as (typeof board)[number];
    if (row.rank !== i + 1) return `rank ${row.rank} out of place at row ${i}`;
    if (seen.has(row.slug)) return `duplicate slug ${row.slug}`;
    seen.add(row.slug);
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0)
      return `${row.slug}: implied value is not a positive whole number`;
    if (row.implied_value_usd > previous) return `${row.slug}: board is not sorted by value`;
    previous = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12)
      return `${row.slug}: farm plan has ${row.farm_steps.length} steps`;
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `${row.slug}: farm step of ${len} chars`;
    }
  }
  for (const slug of watch) if (!seen.has(slug)) return `watchlist slug missing: ${slug}`;
  if (new Set(board.map((r) => r.implied_value_usd)).size < 2)
    return "every implied value is equal";
  return null;
}

const issue = boardIssue();
if (issue != null) {
  console.error(`board refused: ${issue}`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });

const boardFile = {
  model: MODEL_ID,
  as_of: snapshot.as_of,
  source: snapshot.source,
  rows: board,
};
writeFileSync(join(out, "board.json"), JSON.stringify(boardFile, null, 2) + "\n");

const categories: Record<string, { n: number; median: number; q1: number; q3: number; multiple: number; multiple_q1: number; multiple_q3: number; fallback?: boolean }> = {};
for (const [name, stat] of [...stats.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
  categories[name] = {
    n: stat.n,
    median: Math.round(stat.median * 10000) / 10000,
    q1: Math.round(stat.q1 * 10000) / 10000,
    q3: Math.round(stat.q3 * 10000) / 10000,
    multiple: Math.round(stat.multiple * 10000) / 10000,
    multiple_q1: Math.round(stat.multiple_q1 * 10000) / 10000,
    multiple_q3: Math.round(stat.multiple_q3 * 10000) / 10000,
  };
}
// Categories on the board with no trading comparables get an explicit
// fallback entry, so the dashboard can say "valued at the global median"
// instead of staying silent.
for (const row of board) {
  const name = row.category ?? "Unclassified";
  if (!categories[name] || categories[name].n === 0) {
    categories[name] = {
      n: 0,
      median: Math.round(global.median * 10000) / 10000,
      q1: Math.round(global.median * 10000) / 10000,
      q3: Math.round(global.median * 10000) / 10000,
      multiple: Math.round(global.multiple * 10000) / 10000,
      multiple_q1: Math.round(global.multiple * 10000) / 10000,
      multiple_q3: Math.round(global.multiple * 10000) / 10000,
      fallback: true,
    };
  }
}

const data = {
  model: {
    id: MODEL_ID,
    formula: MODEL_FORMULA,
    as_of: snapshot.as_of,
    source: snapshot.source,
    protocols_scanned: snapshot.protocols.length,
    watchlist_total: snapshot.watchlist.length,
    global: {
      n: global.n,
      median: Math.round(global.median * 10000) / 10000,
      multiple: Math.round(global.multiple * 10000) / 10000,
    },
    categories,
  },
  rows: board.map((row) => {
    const stat = stats.get(row.category ?? "Unclassified") ?? global;
    const growth = growthFactor(row.change_7d);
    const maturity = maturityFactor(row.age_days);
    const range = impliedRange(row, stats, global, snapshot.as_of);
    return {
      ...row,
      model_exact: { multiple: stat.multiple, growth_factor: growth, maturity_factor: maturity },
      range_low_usd: range.low,
      range_high_usd: range.high,
      plan_totals: planTotals(row, snapshot.as_of),
    };
  }),
  live,
};
writeFileSync(join(out, "data.js"), "window.RADAR_DATA = " + JSON.stringify(data) + ";\n");

for (const dir of ["dashboard", "screenshots"]) {
  const from = join(root, dir);
  if (existsSync(from)) cpSync(from, join(out, dir), { recursive: true });
}

writeFileSync(
  join(out, "dossier.json"),
  buildDossier(out, {
    text_max_bytes: 65536,
    screenshots: { max: 4, max_bytes: 512 * 1024 },
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }),
);

const watchOnBoard = board.filter((r) => r.watchlist).length;
console.log(`model ${MODEL_ID}: ${board.length} pre-token protocols ranked`);
console.log(`watchlist coverage ${watchOnBoard}/${snapshot.watchlist.length}`);
console.log(`live comparables ${global.n} trading protocols, global median multiple ${global.median.toFixed(3)}`);
console.log(`wrote board.json, data.js, dashboard/, screenshots/, dossier.json to ${out}`);
