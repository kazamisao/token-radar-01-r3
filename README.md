# token-radar-01-r3

[![Competition](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![Rank](https://make.fun/badge/token-radar-01/kazamisao/token-radar-01-r3/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/kazamisao/token-radar-01-r3/reward.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: the pre-token protocols in the sealed DefiLlama snapshot (758 protocols, as of 2026-11-14), ranked by the value the market would likely give its token at launch — with the whole 40-protocol watchlist covered and a concrete farm plan for each of the 198 ranked protocols. The board applies the snapshot's own watchlist definition of a launch candidate, so wrapped, staked and bridged products of tokens that already trade are not ranked as if they were awaiting a launch.

The valuation is a comparables model (the code calls it `radar-2`), computed only from the snapshot's own figures. Protocols whose token already trades report a market cap; for each category the radar takes the median market-cap / TVL of that category's trading protocols — what the market currently pays for one dollar of TVL in that category — and values a pre-token protocol as TVL × category multiple × growth factor × maturity factor. Medians from thin categories are shrunk toward the global median (0.21× across 128 comparables with a recorded positive market cap) and capped at twice it, so one speculative name cannot price a whole category. The dashboard shows the full arithmetic for every protocol, including the quartile range of its category, and re-multiplies the factors to prove the page and the board agree.

Each farm plan is generated from the protocol's own category, chains, TVL and age: a verification step, a category-specific core action, a second position, a weekly cadence, a multi-chain or deepening step, a hold discipline and an exit — every step with a dollar cost (gas priced per chain, Ethereum mainnet versus L2) and a duration, and with spend kept separate from capital that stays in the user's wallet.

The dashboard is a dark instrument theme: sortable and filterable board (search, category, chain, minimum TVL, watchlist-only), a detail view per protocol, and a second tab listing the trading protocols whose ratios set the multiples.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
# equivalently: node main.ts /path/to/input-dir /path/to/output-dir
node --test tests/model.test.ts
```

The first command writes `board.json`, `data.js`, the dashboard, the screenshots and `dossier.json` into `out/`; it is deterministic and refuses to write a board that fails its own gate checks. The second runs the local test suite (28 tests: model arithmetic, shrinkage and thin-category caps, range coherence, gas and capital totals that match the step text, board invariants and coverage against the sealed snapshot). Node 22, standard library only.

Entered on [make.fun](https://make.fun/?ref=p5dwa49p&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards
