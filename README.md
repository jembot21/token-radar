# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/jembot21/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/jembot21/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: every protocol in the sealed DefiLlama snapshot that still records no token, ranked by what its launch would be worth — with a detail view and a concrete farm plan for each one. Built for make.fun's [token-radar-01](https://make.fun/bounty/token-radar-01) bounty.

## The board

From the snapshot's 758 protocols, the board ranks **198 pre-token protocols** and covers all **40** of the house watchlist. Set aside before ranking: anything that records a token, wrapped/staked/bridged products, names carrying a version marker or matching a tokenized protocol, exchange house products, and the Bridge, Liquid Staking and CEX categories. The watchlist is a floor, not a ceiling — the board also ranks pre-token protocols below its $50M line.

## The value model

No names are hardcoded; every figure comes from the snapshot itself:

```
implied value = TVL × peer multiple × momentum × track record
```

- **Peer multiple** — the median market-cap-to-TVL ratio of the tokenized protocols in the same category (peers with a recorded market cap above zero); the global median, 0.214× over 128 peers, when a category has fewer than three.
- **Momentum** — a bounded factor from the 7-day TVL change, between 0.72 and 1.54, so one hot week cannot outweigh the TVL itself.
- **Track record** — a bounded factor from the days the protocol has run with no token, between 0.85 and 1.30; unknown listing days are neutral.

An implied value is this board's own estimate of what a launch would price at if the protocol's record stayed as it is. It is not a prediction that a token will be issued.

## The dashboard

`dashboard/` is a static page (no framework, no network): a sortable, filterable board (search, category, chain, watchlist-only), a detail view per protocol showing the value breakdown factor by factor, and the farm plan — five concrete steps per protocol with what they cost and how long they take, shaped by the protocol's category, main chain and size.

## Run it

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
```

Writes `board.json` (the ranked rows), `data.js` (the dashboard's data), `dashboard/`, `screenshots/` and `dossier.json` (built with `vendor/makefun-board.ts`) into the output directory. Serve the output directory and open `dashboard/index.html` to use the radar.

## Files

- `main.ts` — the handover program: snapshot in, board + dashboard + dossier out.
- `lib/model.ts` — the model: universe rule, peer multiples, the two bounded factors, farm plans, and the gate's board checks mirrored.
- `dashboard/` — `index.html`, `app.css`, `app.js`: the page the screenshots show.
- `screenshots/` — the board, a protocol detail view, and a filtered view.
- `vendor/makefun-board.ts` — the kit's dossier builder, byte-identical to the kit's.

MIT licensed — see `LICENSE`.
