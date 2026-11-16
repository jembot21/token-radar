// lib/model.ts — the token radar's model: which protocols are still pre-token,
// what a launch would be worth on the snapshot's own figures, and how to farm each one.
//
// The model in one paragraph. Start from every protocol in the sealed DefiLlama
// snapshot that records no token (both gecko_id and symbol null). Set aside the
// ones that are not really pre-token launches: wrapped, staked or bridged
// products of a token that already trades, names carrying a version marker
// (a V2 is farmed through its protocol's own eventual launch, not ranked as a
// separate one), names whose base is a tokenized protocol, exchange
// house products, and the Bridge / Liquid Staking / CEX categories the house
// watchlist also sets aside. What is left is the board's universe, at any TVL,
// not just above the watchlist's $50M floor. Value each one from the snapshot's
// own figures: implied value = TVL × peer multiple × momentum × track record,
// where the peer multiple is the median market-cap-to-TVL ratio of the
// tokenized protocols in the same category (the global median when a category
// has fewer than three tokenized peers), momentum is a bounded factor from
// the 7-day TVL change, and track record is a bounded factor from how long
// the protocol has run with no token. No protocol is named anywhere in this
// file: change the snapshot and the board changes with it.

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
  protocols: Protocol[];
  watchlist: string[];
}

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot.json does not hold protocols and watchlist arrays');
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Peer multiples: what the market pays per dollar of TVL, per category
// ---------------------------------------------------------------------------

export interface Multiple {
  ratio: number;
  peers: number;
}

export interface Multiples {
  byCategory: Map<string, Multiple>;
  global: Multiple;
}

/** Median market-cap / TVL over the snapshot's tokenized protocols. */
export function peerMultiples(protocols: Protocol[]): Multiples {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    if (p.category !== null) {
      const list = byCategory.get(p.category) ?? [];
      list.push(ratio);
      byCategory.set(p.category, list);
    }
  }
  const medians = new Map<string, Multiple>();
  for (const [category, ratios] of byCategory) {
    if (ratios.length >= 3) medians.set(category, { ratio: median(ratios), peers: ratios.length });
  }
  return { byCategory: medians, global: { ratio: median(all), peers: all.length } };
}

// ---------------------------------------------------------------------------
// The universe rule: pre-token, and not a product of something already trading
// ---------------------------------------------------------------------------

const SET_ASIDE_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const EXCHANGE_PREFIXES = ['binance', 'coinbase', 'bybit', 'kraken', 'bitget', 'okx', 'bitfinex', 'gemini'];

/** "Aave V3" -> "Aave"; "LayerZero V2" -> "LayerZero"; a name with no version marker is its own base. */
export function baseName(name: string): string {
  return name.replace(/\s+(v\d+(?:\.\d+)?|\d+\.\d+)$/i, '');
}

/** A protocol records no token when DefiLlama carries neither a gecko id nor a symbol for it. */
export function recordsNoToken(p: Protocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/**
 * True when the protocol belongs on the board: it records no token, and it is
 * not a wrapped/staked/bridged product of one whose token already trades, not
 * an exchange's own product, and not in a set-aside category. A name carrying
 * a version marker is set aside too — a V2 is farmed through its protocol's
 * own eventual launch, not ranked as a separate one — and so is any name
 * whose base is a protocol whose token trades. `tokenizedBases` is the set
 * of base names of every protocol in the snapshot whose token does trade.
 */
export function isCandidate(p: Protocol, tokenizedBases: Set<string>): boolean {
  if (!recordsNoToken(p)) return false;
  if (p.category !== null && SET_ASIDE_CATEGORIES.has(p.category)) return false;
  const lower = p.name.toLowerCase();
  if (/\b(wrapped|staked|staking)\b/.test(lower)) return false;
  if (EXCHANGE_PREFIXES.some((e) => lower === e || lower.startsWith(`${e} `) || lower.startsWith(`${e}-`))) return false;
  if (baseName(p.name) !== p.name) return false;
  if (tokenizedBases.has(p.name)) return false;
  return true;
}

export function tokenizedBaseNames(protocols: Protocol[]): Set<string> {
  const bases = new Set<string>();
  for (const p of protocols) {
    if (!recordsNoToken(p)) bases.add(baseName(p.name));
  }
  return bases;
}

// ---------------------------------------------------------------------------
// The two bounded factors: momentum and track record
// ---------------------------------------------------------------------------

/**
 * Momentum from the 7-day TVL change: a protocol growing into its launch is
 * worth more than one shrinking away from it, but the factor is bounded to
 * [0.72, 1.54] so a hot week can never outweigh the TVL itself. Unreported
 * change is neutral.
 */
export function growthFactor(change7d: number | null): number {
  if (change7d === null) return 1;
  const c = clamp(change7d, -60, 120);
  return round3(clamp(1 + (c / 100) * 0.45, 0.72, 1.54));
}

/** Whole days between the day DefiLlama began tracking a protocol and the snapshot's as_of day. */
export function daysLive(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

/**
 * Track record from days live with no token: a protocol that has held real
 * TVL for years without issuing has proven the demand a launch would price;
 * a protocol listed last month has not. Bounded to [0.85, 1.30], rising on a
 * saturating curve so age alone never makes a board. Unknown listing day is
 * neutral.
 */
export function ageFactor(days: number | null): number {
  if (days === null) return 1;
  return round3(0.85 + 0.45 * (1 - Math.exp(-days / 540)));
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface Scored {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  days_live: number | null;
  multiple: number;
  multiple_basis: 'category' | 'global';
  peer_count: number;
  growth_factor: number;
  age_factor: number;
  base_value_usd: number;
  implied_value_usd: number;
  on_watchlist: boolean;
}

/** Score every candidate in the snapshot; the result is sorted into board order. */
export function scoreAll(snapshot: Snapshot): Scored[] {
  const multiples = peerMultiples(snapshot.protocols);
  const bases = tokenizedBaseNames(snapshot.protocols);
  const watch = new Set(snapshot.watchlist);
  const scored: Scored[] = [];
  for (const p of snapshot.protocols) {
    if (!isCandidate(p, bases)) continue;
    const own = p.category !== null ? multiples.byCategory.get(p.category) : undefined;
    const multiple = own ?? multiples.global;
    const days = daysLive(snapshot.as_of, p.listed_at);
    const growth = growthFactor(p.change_7d);
    const age = ageFactor(days);
    const base = p.tvl_usd * multiple.ratio;
    const implied = Math.max(1, Math.round(base * growth * age));
    scored.push({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      days_live: days,
      multiple: round3(multiple.ratio),
      multiple_basis: own !== undefined ? 'category' : 'global',
      peer_count: multiple.peers,
      growth_factor: growth,
      age_factor: age,
      base_value_usd: Math.round(base),
      implied_value_usd: implied,
      on_watchlist: watch.has(p.slug),
    });
  }
  // Board order: implied value desc, then TVL desc, then slug — fully deterministic.
  scored.sort((a, b) => b.implied_value_usd - a.implied_value_usd || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  return scored;
}

// ---------------------------------------------------------------------------
// Farm plans: concrete steps per protocol, from its category, chains and size
// ---------------------------------------------------------------------------

function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}

function capitalTier(tvl: number): string {
  if (tvl >= 250_000_000) return '$2,000-$10,000';
  if (tvl >= 50_000_000) return '$1,000-$5,000';
  if (tvl >= 10_000_000) return '$500-$2,500';
  return '$200-$1,000';
}

function mainChain(s: Scored): string {
  return s.chains.length > 0 ? s.chains[0]! : 'its main chain';
}

function recordStep(s: Scored): string {
  const since = s.listed_at !== null ? `, tracked since ${s.listed_at.slice(0, 4)}` : '';
  return (
    `Keep a simple log of deposits, volume and fees for ${s.name} (${fmtUsd(s.tvl_usd)} TVL${since}) and review it monthly; ` +
    `if a token, points program or snapshot is announced, claim only through the official ${s.name} site or app, and never sign an approval from a link in a reply, DM or search ad.`
  );
}

/**
 * Five concrete steps to farm one protocol: what to do, what it costs and how
 * long it takes. The actions follow the protocol's category; the chain, the
 * capital band and the sizes follow the protocol's own snapshot figures.
 */
export function farmPlan(s: Scored): string[] {
  const chain = mainChain(s);
  const capital = capitalTier(s.tvl_usd);
  const multi = s.chains.length > 1 ? ` It runs on ${s.chains.length} chains; farm it where you already hold funds to avoid bridge fees.` : '';
  let steps: string[];
  switch (s.category) {
    case 'Dexs':
      steps = [
        `Open ${s.name} on ${chain} with a wallet you control and set aside ${capital} of working capital for this farm, kept separate from your main funds (about 10 minutes, no cost).`,
        `Swap in the main pairs 3-5 times a week, $100-$500 a trade, so the wallet builds a steady trading history instead of one burst (roughly $1-$4 of fees and slippage per swap, 10 minutes a week).`,
        `Place ${capital} into one of the top liquidity pools and leave it at least 4 weeks; check the position weekly and rebalance only when the pair or range changes (gas about $1-$5 a move on ${chain}).${multi}`,
        `Use a second feature beyond spot swaps once a week - a limit order, the aggregator, or a vault if offered - so activity is spread across the product, not just one button (about 15 minutes a week).`,
      ];
      break;
    case 'Lending':
      steps = [
        `Open ${s.name} on ${chain} and supply a small first deposit, $100-$250 of a major stablecoin or ETH, to learn the health-factor screens before adding size (about 10 minutes, gas under $2).`,
        `Grow the supply side to ${capital} over 2-3 deposits a week apart, favouring the markets with the deepest liquidity, and keep the position open a full quarter (deposit gas about $1-$3 each).`,
        `Borrow a modest amount against the collateral - 20-30% of its value - and repay it after 2-4 weeks, so the wallet shows both sides of the market; watch the health factor weekly and never let it drift near liquidation (interest is the main cost, a few dollars a week at this size).`,
        `Repeat the borrow-repay cycle once more later in the quarter and try one other listed asset, so the history is varied rather than a single loop (about 20 minutes a month).${multi}`,
      ];
      break;
    case 'Yield':
    case 'Yield Aggregator':
      steps = [
        `Pick one core vault in ${s.name} on ${chain} - a stablecoin or ETH vault with the longest track record - and deposit $100-$250 first to watch one full harvest cycle (about 10 minutes, gas under $3).`,
        `Build the position to ${capital} over a month in 3-4 deposits, and leave it compounding for at least a full quarter; withdrawing early is what costs farmers their ranking in most points systems.`,
        `Move a small slice, 10-20%, into a second vault with a different strategy so the wallet is not tied to one pool, and rebalance only when yields gap by more than 2 points (gas about $1-$4 a move).`,
        `Claim and restake rewards on a fixed day each month rather than daily, which keeps gas near $2-$5 a month while the claim history still reads as active.${multi}`,
      ];
      break;
    case 'Risk Curators':
    case 'Onchain Capital Allocator':
      steps = [
        `Read the curator's vault list in ${s.name} and pick one vault on ${chain} whose strategy you understand - who lends to whom, against what collateral - before depositing anything (about 30 minutes, no cost).`,
        `Deposit $100-$250 into that vault first and hold it through one full reporting period to see how yield and any losses are actually shared (gas under $3).`,
        `Scale the deposit to ${capital} over 4-6 weeks in equal tranches, and keep a third of the budget in reserve so you can add after a drawdown instead of only before one.`,
        `Once a month, compare the vault against the curator's other vaults and move at most one position; curators reward sticky capital, and churning weekly reads as mercenary flow (about 20 minutes a month).${multi}`,
      ];
      break;
    case 'Derivatives':
      steps = [
        `Open ${s.name} on ${chain}, deposit a $100-$250 margin balance, and trade the smallest size for the first week while you learn its funding and liquidation screens (about 15 minutes, gas under $2).`,
        `Trade 3-5 small perpetual positions a week, $100-$500 notional each, closing most within days, so the wallet builds real volume without one outsized bet (fees roughly 0.05-0.1% a side).`,
        `Grow total volume toward ${capital} of margin over a full quarter, keeping leverage under 3x and a stop on every position; a blown account ends the farm and the history with it.`,
        `Try one options or structured product if offered, at the smallest size, so activity covers more than one market type (about 20 minutes, one small premium).${multi}`,
      ];
      break;
    case 'CDP':
      steps = [
        `Open ${s.name} on ${chain} and mint a small first position: deposit $200-$400 of collateral and draw 30-40% of it as the stablecoin, staying far from the liquidation line (about 15 minutes, gas under $3).`,
        `Grow the vault to ${capital} of collateral over a month, and put the minted stablecoin to work in a plain savings or liquidity venue so both sides of the position are active.`,
        `Adjust collateral once a month to keep the ratio in its band as prices move; set a calendar check so a quiet month cannot drift into a liquidation (gas about $1-$3 an adjustment).`,
        `Repay and redraw a slice once later in the quarter so the wallet shows a full borrow lifecycle, not a single open-and-forget vault (interest over the quarter is the main cost).${multi}`,
      ];
      break;
    case 'RWA':
      steps = [
        `Complete the onboarding and any KYC ${s.name} asks for on ${chain} before moving money; real-world-asset platforms gate most features behind it (about 20-30 minutes, no fee in most cases).`,
        `Make a first purchase of $250-$500 in the platform's core tokenized treasury or credit product and hold it through one full yield period to learn how redemptions settle.`,
        `Build the holding to ${capital} over a quarter in monthly tranches, and keep the redemption window dates in a calendar - RWA positions are farmed by holding through cycles, not by trading.`,
        `Reinvest each distribution once rather than withdrawing it, so the account shows compounding behaviour across at least two cycles (about 15 minutes a cycle).${multi}`,
      ];
      break;
    case 'Basis Trading':
      steps = [
        `Deposit $100-$250 of stablecoins into ${s.name} on ${chain} and watch one funding cycle end to end before adding size, so you know how the basis yield is actually paid (about 10 minutes, gas under $3).`,
        `Scale the deposit to ${capital} over 4-6 weeks; basis strategies pay for patience, and entering the whole amount on one day concentrates the entry price.`,
        `Keep the position through at least one negative-funding week without withdrawing - how a farmer behaves in the bad week is exactly what these protocols measure.`,
        `Claim yield on a monthly rhythm and restake half of it, so the wallet shows both holding and compounding across a full quarter (gas about $2-$5 a month).${multi}`,
      ];
      break;
    case 'Chain':
      steps = [
        `Bridge $100-$250 to ${s.name} through its official bridge and keep the funds on the chain at least a month; a same-day round trip is the pattern every points program filters out (bridge fee roughly $1-$10).`,
        `Use 3-4 native apps a week - a swap, a lend, a mint - at small sizes, so the wallet builds a real on-chain footprint on the new chain (gas is usually under $1 a transaction here).`,
        `Hold ${capital} of working balance on the chain across a full quarter and transact in at least 8 separate weeks; consistency across weeks is the metric chains publish most often.`,
        `Try one ecosystem program the chain itself promotes - a testnet, a quest or a native vault - and keep the receipts; early-ecosystem activity is usually weighted heaviest.${multi}`,
      ];
      break;
    default:
      steps = [
        `Open ${s.name} on ${chain} with a wallet you control and make a first small transaction, $50-$150, to learn its fees and settlement before committing size (about 10 minutes).`,
        `Use the protocol's core action 2-3 times a week at small size for a full quarter, so the wallet builds a steady history rather than one burst of activity (fees are the main cost, a few dollars a week).`,
        `Hold a working position of ${capital} in the protocol across the quarter, sized to its ${fmtUsd(s.tvl_usd)} TVL, and add in tranches rather than all on one day.`,
        `Try one secondary feature - a vault, a referral, a governance vote or a second market - so the account is not tied to a single button (about 20 minutes, small fees).${multi}`,
      ];
      break;
  }
  steps.push(recordStep(s));
  return steps;
}

// ---------------------------------------------------------------------------
// The board, the dashboard data, and the gate's own checks, mirrored
// ---------------------------------------------------------------------------

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

export function buildBoard(snapshot: Snapshot): { board: BoardRow[]; scored: Scored[] } {
  const scored = scoreAll(snapshot);
  const board = scored.map((s, i) => ({
    slug: s.slug,
    name: s.name,
    rank: i + 1,
    implied_value_usd: s.implied_value_usd,
    farm_steps: farmPlan(s),
  }));
  return { board, scored };
}

export interface Radar {
  as_of: string;
  source: string;
  floor_usd: number;
  stats: {
    protocols: number;
    tokenized: number;
    board_rows: number;
    watchlist: number;
    board_tvl_usd: number;
    board_implied_usd: number;
  };
  method: {
    formula: string;
    notes: string[];
    global_multiple: number;
    global_peers: number;
    categories: { category: string; multiple: number; peers: number }[];
  };
  rows: (Scored & { rank: number; farm_steps: string[] })[];
}

export function buildRadar(snapshot: Snapshot, scored: Scored[]): Radar {
  const multiples = peerMultiples(snapshot.protocols);
  const categories = [...multiples.byCategory.entries()]
    .map(([category, m]) => ({ category, multiple: round3(m.ratio), peers: m.peers }))
    .sort((a, b) => (a.category < b.category ? -1 : 1));
  return {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    stats: {
      protocols: snapshot.protocols.length,
      tokenized: snapshot.protocols.filter((p) => !recordsNoToken(p)).length,
      board_rows: scored.length,
      watchlist: snapshot.watchlist.length,
      board_tvl_usd: scored.reduce((sum, s) => sum + s.tvl_usd, 0),
      board_implied_usd: scored.reduce((sum, s) => sum + s.implied_value_usd, 0),
    },
    method: {
      formula: 'implied value = TVL x peer multiple x momentum x track record',
      notes: [
        'Peer multiple: the median market-cap-to-TVL ratio of the tokenized protocols in the same category, from this snapshot; the global median when a category has fewer than three tokenized peers.',
        'Momentum: a bounded factor from the 7-day TVL change, between 0.72 and 1.54, so one hot week cannot outweigh the TVL itself.',
        'Track record: a bounded factor from the days the protocol has run with no token, between 0.85 and 1.30; unknown listing days are neutral.',
        'Set aside before ranking: anything that records a token, wrapped/staked/bridged products, names carrying a version marker or matching a tokenized protocol, exchange house products, and the Bridge, Liquid Staking and CEX categories.',
        'An implied value is this board\u2019s own estimate of what a launch would price at if the protocol\u2019s record stayed as it is. It is not a prediction that a token will be issued.',
      ],
      global_multiple: round3(multiples.global.ratio),
      global_peers: multiples.global.peers,
      categories,
    },
    rows: scored.map((s, i) => ({ ...s, rank: i + 1, farm_steps: farmPlan(s) })),
  };
}

/** The dashboard's data as a script the page loads: window.RADAR. */
export function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}

/**
 * The gate's board rules, mirrored so a bad board fails here first: 100 to
 * 4,000 rows of snapshot protocols, ranks exactly 1..N, implied values whole,
 * positive, at most 1e14 and never rising with rank, every watchlist slug
 * covered, and 3 to 12 farm steps of 20 to 600 characters on every row.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<number>();
  let previous = Number.POSITIVE_INFINITY;
  let firstValue: number | null = null;
  let allSame = true;
  for (const row of board) {
    if (!slugs.has(row.slug)) return `row ${row.rank} names invented slug ${row.slug}`;
    if (row.name.trim() === '') return `row ${row.rank} has an empty name`;
    if (!Number.isInteger(row.rank) || row.rank <= 0) return `row ${row.rank} has a bad rank`;
    if (seen.has(row.rank)) return `rank ${row.rank} appears twice`;
    seen.add(row.rank);
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0 || row.implied_value_usd > 100_000_000_000_000) {
      return `row ${row.rank} has implied value ${row.implied_value_usd}, outside 1..100000000000000`;
    }
    if (row.implied_value_usd > previous) return `implied value rises at rank ${row.rank}`;
    previous = row.implied_value_usd;
    if (firstValue === null) firstValue = row.implied_value_usd;
    else if (row.implied_value_usd !== firstValue) allSame = false;
    if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${row.rank} holds ${Array.isArray(row.farm_steps) ? row.farm_steps.length : 'no'} farm steps, outside 3..12`;
    }
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `row ${row.rank} holds a farm step of ${len} characters, outside 20..600`;
    }
  }
  if (seen.size !== board.length) return 'ranks are not exactly 1..N';
  if (allSame && board.length >= 2) return 'every implied value is the same: the board ranks nothing';
  const covered = new Set(board.map((r) => r.slug));
  for (const slug of snapshot.watchlist) {
    if (!covered.has(slug)) return `watchlist protocol ${slug} is not covered`;
  }
  return null;
}
