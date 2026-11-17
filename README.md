# Token Radar

[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun)
[![rank](https://make.fun/badge/token-radar-01/beecoder77/token-radar/rank.svg)](https://make.fun)
[![reward](https://make.fun/badge/token-radar-01/beecoder77/token-radar/reward.svg)](https://make.fun)

A token launch radar: it ranks **all 342 protocols in the sealed DefiLlama
snapshot (2026-11-14) that record no token** by the implied value their token
would carry if it launched at the multiple the market already pays for
token-bearing protocols in the same category — and it gives every protocol a
concrete farm plan with costs and times.

Entry for make.fun `token-radar-01`. Node 22, standard library only, no
network. The program reads the snapshot, writes the ranked board, the
dashboard data, three screenshots and the judge's dossier.

## The model

Every number comes from the snapshot itself — no hardcoded list of names,
no outside data. For each pre-token protocol:

```
multiple     = median mcap/TVL of token-bearing protocols in the same
               category (min 3 peers, else the global median 0.169)
base_fdv     = tvl_usd × multiple
growth       = 1 + clamp(change_7d, −15%, +25%) / 100        (null → 1.00)
age          = 1 + min(years listed, 3) × 0.03               (null → 1.00)
chains       = 1 + min(chains − 1, 4) × 0.02
discount     = 0.10 for CEX / Bridge / Canonical Bridge / Liquid Staking /
               Liquid Restaking / Restaked BTC; 0.25 for versioned names
               (V2, 2.0, …), wrapped/staked/staking names, or names that
               start with an exchange's name; 1.00 otherwise
implied      = round(base_fdv × growth × age × chains × discount)
```

Rows sort by implied value (ties: higher TVL, then slug). The discount is
the honest part: categories that almost certainly never issue a token sink
to the bottom instead of pretending to be farmable, and the dashboard's
"Likely to launch" toggle hides them entirely.

Farm plans are generated from category-aware templates parameterised by the
protocol's name, primary chain, category and TVL tier (position sizes
$100–$2,500 by tier), each step carrying a USD cost and a time. Discounted
categories get an honest monitoring plan instead of a farming fantasy.

## The dashboard

`dashboard/` is a single static page (no network, system fonts only):

- the board: rank, protocol, category, chains, TVL, 7d %, age, implied
  value — sortable by every numeric column, click a row for its detail view
- filters: text search, category, chain, minimum TVL, "Watchlist only",
  "Likely to launch"
- detail view per protocol (also deep-linkable as `#/protocol/<slug>`):
  every snapshot field, the full value breakdown (TVL × multiple, then each
  factor), the farm plan, and comparable token-bearing peers in its category
- a "How the value is computed" explainer with the formula above

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

That writes `out/board.json`, `out/data.js`, `out/dashboard/`,
`out/screenshots/` and `out/dossier.json`. Run it twice into two
directories and `diff -r` them: the outputs are byte-identical.

Screenshots are taken with the headless-browser script in `tools/`:

```sh
node tools/shoot.mjs            # needs the built out/ directory
```

The gate check (board shape, watchlist coverage, farm steps, dossier
byte-equality, screenshot caps, determinism) is `tools/check-gate.mjs`:

```sh
node tools/check-gate.mjs
```

## Files

- `main.ts` — entrypoint: reads the snapshot, writes every output
- `lib/radar.ts` — snapshot parsing, the value model, farm plans, the board
- `vendor/makefun-board.ts` — make.fun's dossier library (kit file, verbatim)
- `dashboard/` — the static page (`index.html`, `app.css`, `app.js`)
- `tools/` — dev-only screenshot + gate scripts (not part of the program)
- `screenshots/` — the three submitted screenshots

## Disclaimer

Data is the sealed 2026-11-14 DefiLlama snapshot. Implied values are this
entry's own estimates from that snapshot, not predictions that a token will
launch or what it would be worth if it did. Nothing here is financial
advice.
