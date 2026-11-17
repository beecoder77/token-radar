// The token radar's model: the sealed snapshot in, a ranked board out.
//
// The board ranks every protocol in the snapshot that records no token
// (gecko_id and symbol both null): 342 rows, the 40-protocol watchlist
// included. Nothing is ranked from a hardcoded list of names — every
// number below is derived from the snapshot's own figures.
//
// Implied value, per protocol:
//
//   multiple  = median mcap/TVL of the token-bearing protocols in the same
//               category (at least 3 peers, else the global median)
//   base      = tvl_usd x multiple
//   growth    = 1 + clamp(change_7d, -15, 25) / 100        (null -> 1.00)
//   age       = 1 + min(years listed, 3) x 0.03            (null -> 1.00)
//   chains    = 1 + min(chains - 1, 4) x 0.02
//   discount  = 0.10 for categories that almost certainly never issue a
//               token (CEX, Bridge, Canonical Bridge, Liquid Staking,
//               Liquid Restaking, Restaked BTC); 0.25 for versioned names
//               (V2, 2.0, ...), names carrying a whole word wrapped /
//               staked / staking, or names starting with an exchange's
//               name; 1.00 otherwise
//   implied   = round(base x growth x age x chains x discount)
//
// Rows sort by implied value, ties broken by higher TVL, then slug. The
// discount is the honest part: a wrapped product or an exchange sinks
// instead of pretending to be farmable, and the dashboard's "Likely to
// launch" toggle hides discounted rows entirely.
//
// Farm plans come from category-aware templates parameterised by the
// protocol's name, primary chain, category and TVL tier. Every step names
// what it costs in dollars and how long it takes. Discounted rows get an
// honest monitoring plan, not a farming fantasy.

/** One protocol record: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export const MODEL = {
  min_peers: 3,
  growth_low: -15,
  growth_high: 25,
  age_years_cap: 3,
  age_per_year: 0.03,
  chain_step: 0.02,
  chain_cap: 4,
  discount_category: 0.1,
  discount_name: 0.25,
} as const;

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** The value breakdown one row carries, so the dashboard can show its working. */
export interface ModelBreakdown {
  multiple: number;
  peers: number;
  base_fdv: number;
  growth: number;
  age: number;
  chains_factor: number;
  discount: number;
  discount_reason: string;
  age_days: number | null;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: ModelBreakdown;
  farm_steps: string[];
}

/** A token-bearing protocol, for the dashboard's comparable-peers view. */
export interface PeerRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  global_multiple: number;
  watchlist_size: number;
  board_size: number;
  total_implied_usd: number;
  chain_count: number;
  rows: BoardRow[];
  peers: PeerRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list of numbers. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return n % 2 === 1 ? sorted[(n - 1) / 2]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word wrapped / staked / staking anywhere in the name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** Exchange names a protocol name may start with. */
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
/** Categories that almost certainly never issue a token of their own. */
const DISCOUNTED_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/** A protocol's launch-likelihood discount and why it applies. */
export function discountFor(p: SnapshotProtocol): { factor: number; reason: string } {
  if (p.category !== null && DISCOUNTED_CATEGORIES.has(p.category)) {
    return { factor: MODEL.discount_category, reason: `category ${p.category} almost never issues a token` };
  }
  if (VERSIONED.test(p.name)) return { factor: MODEL.discount_name, reason: 'versioned name (V2 / 2.0): a pool of another protocol' };
  if (WRAPPED_WORD.test(p.name)) return { factor: MODEL.discount_name, reason: 'wrapped or staked product of a token that already trades' };
  for (const e of EXCHANGES) {
    if (p.name.startsWith(e)) return { factor: MODEL.discount_name, reason: `starts with exchange name ${e}` };
  }
  return { factor: 1, reason: '' };
}

/** The category multiples: median mcap/TVL per category over token-bearing peers, plus the global one. */
export function categoryMultiples(snapshot: Snapshot): { byCategory: Map<string, { multiple: number; peers: number }>; global: number } {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    const key = p.category ?? '(none)';
    const list = byCategory.get(key) ?? [];
    list.push(ratio);
    byCategory.set(key, list);
  }
  const global = median(all);
  const out = new Map<string, { multiple: number; peers: number }>();
  for (const [key, list] of byCategory) out.set(key, { multiple: median(list), peers: list.length });
  return { byCategory: out, global };
}

/** The implied value and its breakdown for one protocol. */
export function scoreProtocol(
  p: SnapshotProtocol,
  asOf: string,
  multiples: { byCategory: Map<string, { multiple: number; peers: number }>; global: number },
): { implied: number; breakdown: ModelBreakdown } {
  const key = p.category ?? '(none)';
  const cat = multiples.byCategory.get(key);
  const useCategory = cat !== undefined && cat.peers >= MODEL.min_peers;
  const multiple = useCategory ? cat.multiple : multiples.global;
  const peers = useCategory ? cat.peers : 0;
  const base = p.tvl_usd * multiple;
  const growth = 1 + Math.min(Math.max(finite(p.change_7d, 0), MODEL.growth_low), MODEL.growth_high) / 100;
  const ageDaysValue = ageDays(asOf, p.listed_at);
  const age = ageDaysValue === null ? 1 : 1 + Math.min(ageDaysValue / 365, MODEL.age_years_cap) * MODEL.age_per_year;
  const chainsFactor = 1 + Math.min(Math.max(p.chains.length - 1, 0), MODEL.chain_cap) * MODEL.chain_step;
  const discount = discountFor(p);
  const implied = Math.max(1, Math.round(base * growth * age * chainsFactor * discount.factor));
  return {
    implied,
    breakdown: {
      multiple: Math.round(multiple * 1e4) / 1e4,
      peers,
      base_fdv: Math.round(base),
      growth: Math.round(growth * 1e4) / 1e4,
      age: Math.round(age * 1e4) / 1e4,
      chains_factor: Math.round(chainsFactor * 1e4) / 1e4,
      discount: discount.factor,
      discount_reason: discount.reason,
      age_days: ageDaysValue,
    },
  };
}

// ---------------------------------------------------------------- farm plans

/** How much capital one farm position needs, from the protocol's own TVL tier. */
export function capitalTier(tvlUsd: number): { capital: string; range: string } {
  if (tvlUsd >= 500_000_000) return { capital: '$1,500', range: '$1,000–$2,500' };
  if (tvlUsd >= 100_000_000) return { capital: '$750', range: '$500–$1,000' };
  if (tvlUsd >= 50_000_000) return { capital: '$350', range: '$250–$500' };
  return { capital: '$175', range: '$100–$250' };
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * Farm-plan templates, keyed by protocol group. Each entry is the plan's
 * steps in order; placeholders are {name}, {chain}, {capital}, {range},
 * {hold} and {small}. The dashboard's app.js carries the same table so the
 * page shows the plan its own code derives — keep the two in sync.
 */
export const FARM_TEMPLATES: Record<string, string[]> = {
  dexs: [
    'Set up a fresh wallet on {chain} that holds only the funds you plan to farm, and write its seed phrase on paper, never in a screenshot. ($2–$4 in gas; about 10 minutes)',
    'Bridge {capital} of USDC to {chain} through the official bridge, inside the {range} band for a protocol of this size. ($3–$8 in gas; about 10 minutes)',
    'Swap half of the USDC for the pool\u2019s paired asset on {name}\u2019s {chain} swap, at about 0.3% in fees. ($3–$6 in gas; about 5 minutes)',
    'Add the full {capital} as liquidity to {name}\u2019s main pool on {chain} and keep the LP position open. ($4–$8 in gas; about 5 minutes)',
    'Route one swap a week through {name} instead of an aggregator, so the wallet shows repeat volume, and hold the LP position for at least {hold} days. (about $2 in gas a week; 10 minutes a week)',
    'Before withdrawing, open {name}\u2019s own points or rewards page and claim only from a link it publishes; keep every transaction hash as proof of activity. (no fee to check; about 10 minutes)',
  ],
  lending: [
    'Set up a fresh wallet on {chain} that holds only the funds you plan to farm, and write its seed phrase on paper, never in a screenshot. ($2–$4 in gas; about 10 minutes)',
    'Bridge {capital} of USDC to {chain} through the official bridge, inside the {range} band for a protocol of this size. ($3–$8 in gas; about 10 minutes)',
    'Supply the {capital} of USDC as collateral on {name} on {chain} and keep the deposit open. ($3–$6 in gas; about 5 minutes)',
    'Borrow a small amount, about $50 of the paired asset, against the deposit, then repay it in full the same week. ($4–$8 in gas; about 10 minutes)',
    'Top up or adjust the collateral once a week, keep the health factor above 2, and hold the position for at least {hold} days. (about $2 in gas a week; 10 minutes a week)',
    'Before withdrawing, open {name}\u2019s own points or rewards page and claim only from a link it publishes; keep every transaction hash as proof of activity. (no fee to check; about 10 minutes)',
  ],
  cdp: [
    'Set up a fresh wallet on {chain} that holds only the funds you plan to farm, and write its seed phrase on paper, never in a screenshot. ($2–$4 in gas; about 10 minutes)',
    'Bridge {capital} of USDC to {chain} through the official bridge, inside the {range} band for a protocol of this size. ($3–$8 in gas; about 10 minutes)',
    'Lock the {capital} of collateral in a {name} vault on {chain} and mint a small amount of its stable asset, well under the safe ratio. ($4–$8 in gas; about 5 minutes)',
    'Repay part of the minted stable asset, then mint again, so the vault shows two-way activity instead of a single deposit. ($4–$8 in gas; about 10 minutes)',
    'Check the vault\u2019s collateral ratio weekly, top it up before it drifts near liquidation, and hold the vault for at least {hold} days. (about $2 in gas a week; 10 minutes a week)',
    'Before withdrawing, open {name}\u2019s own points or rewards page and claim only from a link it publishes; keep every transaction hash as proof of activity. (no fee to check; about 10 minutes)',
  ],
  yield: [
    'Set up a fresh wallet on {chain} that holds only the funds you plan to farm, and write its seed phrase on paper, never in a screenshot. ($2–$4 in gas; about 10 minutes)',
    'Bridge {capital} of USDC to {chain} through the official bridge, inside the {range} band for a protocol of this size. ($3–$8 in gas; about 10 minutes)',
    'Deposit the {capital} of USDC into {name}\u2019s highest-TVL vault on {chain} and keep the vault shares in the farming wallet. ($3–$6 in gas; about 5 minutes)',
    'Claim any vault rewards that accrue and re-deposit them into the same vault instead of withdrawing. ($3–$6 in gas; about 5 minutes)',
    'When {name} rotates to a new epoch or strategy, move the deposit across about once a month, and hold a position for at least {hold} days. (about $4 in gas a month; 15 minutes a month)',
    'Before withdrawing, open {name}\u2019s own points or rewards page and claim only from a link it publishes; keep every transaction hash as proof of activity. (no fee to check; about 10 minutes)',
  ],
  rwa: [
    'Set up a fresh wallet on {chain} that holds only the funds you plan to farm, and write its seed phrase on paper, never in a screenshot. ($2–$4 in gas; about 10 minutes)',
    'Bridge {capital} of USDC to {chain} through the official bridge, inside the {range} band for a protocol of this size. ($3–$8 in gas; about 10 minutes)',
    'Mint or buy {capital} of {name}\u2019s yield-bearing asset on {chain} and hold it in the farming wallet. ($4–$10 in gas; about 10 minutes)',
    'Claim the yield the asset accrues and keep the claim transactions as proof of activity. ($3–$6 in gas; about 5 minutes)',
    'Check the asset\u2019s backing report or attestation page monthly, and hold the asset for at least {hold} days; exit if the backing stops being published. (no fee to check; 10 minutes a month)',
    'Before withdrawing, open {name}\u2019s own points or rewards page and claim only from a link it publishes; keep every transaction hash as proof of activity. (no fee to check; about 10 minutes)',
  ],
  derivatives: [
    'Set up a fresh wallet on {chain} that holds only the funds you plan to farm, and write its seed phrase on paper, never in a screenshot. ($2–$4 in gas; about 10 minutes)',
    'Bridge {capital} of USDC to {chain} through the official bridge, inside the {range} band for a protocol of this size. ($3–$8 in gas; about 10 minutes)',
    'Deposit the {capital} of USDC as margin on {name} on {chain}. ($3–$6 in gas; about 5 minutes)',
    'Open one small hedged position of about $50 notional and close it within the week; never leave a leveraged position open unattended. ($3–$6 in gas; about 10 minutes)',
    'Place one small position a week and close it the same week, keeping the margin deposit in place for at least {hold} days. (about $2 in gas a week; 10 minutes a week)',
    'Before withdrawing, open {name}\u2019s own points or rewards page and claim only from a link it publishes; keep every transaction hash as proof of activity. (no fee to check; about 10 minutes)',
  ],
  prediction: [
    'Set up a fresh wallet on {chain} that holds only the funds you plan to farm, and write its seed phrase on paper, never in a screenshot. ($2–$4 in gas; about 10 minutes)',
    'Bridge {capital} of USDC to {chain} through the official bridge, inside the {range} band for a protocol of this size. ($3–$8 in gas; about 10 minutes)',
    'Fund the wallet with the {capital} and buy one small position, about $25, in an active market on {name}. ($2–$5 in gas; about 5 minutes)',
    'Resolve or sell the position when its market closes, then open one more small position in a different market. ($2–$5 in gas; about 10 minutes)',
    'Place one small position a week and keep the wallet funded for at least {hold} days, so the activity spans several market cycles. (about $2 in gas a week; 10 minutes a week)',
    'Before withdrawing, open {name}\u2019s own points or rewards page and claim only from a link it publishes; keep every transaction hash as proof of activity. (no fee to check; about 10 minutes)',
  ],
  staking: [
    'Set up a fresh wallet on {chain} that holds only the funds you plan to farm, and write its seed phrase on paper, never in a screenshot. ($2–$4 in gas; about 10 minutes)',
    'Bridge {capital} of the chain\u2019s native asset to {chain} through the official bridge, inside the {range} band for a protocol of this size. ($3–$8 in gas; about 10 minutes)',
    'Stake the {capital} through {name} on {chain} and keep the receipt token in the farming wallet. ($3–$6 in gas; about 5 minutes)',
    'Delegate the receipt token to a second validator or restaking pool that {name} lists, if it offers one. ($3–$6 in gas; about 5 minutes)',
    'Claim staking rewards weekly, re-stake them through {name}, and hold the stake for at least {hold} days. (about $2 in gas a week; 10 minutes a week)',
    'Before withdrawing, open {name}\u2019s own points or rewards page and claim only from a link it publishes; keep every transaction hash as proof of activity. (no fee to check; about 10 minutes)',
  ],
  chain: [
    'Set up a fresh wallet on {chain} that holds only the funds you plan to farm, and write its seed phrase on paper, never in a screenshot. ($2–$4 in gas; about 10 minutes)',
    'Bridge {capital} of USDC to {chain} through the official bridge, inside the {range} band for a protocol of this size, and hold it in the farming wallet for the first week. ($3–$8 in gas; about 10 minutes)',
    'Use {name}\u2019s native DEX or lending app on {chain} for one swap or deposit of about $50. ($2–$5 in gas; about 5 minutes)',
    'Try a second native app on {chain}, such as a lending market or a liquid-staking pool, with another $50. ($2–$5 in gas; about 10 minutes)',
    'Make one on-chain transaction a week on {chain} — a swap, a deposit or a vote — and keep the wallet active for at least {hold} days. (about $2 in gas a week; 10 minutes a week)',
    'Before withdrawing, open {name}\u2019s own points or rewards page and claim only from a link it publishes; keep every transaction hash as proof of activity. (no fee to check; about 10 minutes)',
  ],
  generic: [
    'Set up a fresh wallet on {chain} that holds only the funds you plan to farm, and write its seed phrase on paper, never in a screenshot. ($2–$4 in gas; about 10 minutes)',
    'Bridge {capital} of USDC to {chain} through the official bridge, inside the {range} band for a protocol of this size. ($3–$8 in gas; about 10 minutes)',
    'Deposit the {capital} of USDC into {name} on {chain} and keep the position open. ($3–$6 in gas; about 5 minutes)',
    'Use {name} once for its core action — a payment, a deposit or a vote — with about $50, so the wallet shows more than a single deposit. ($2–$5 in gas; about 10 minutes)',
    'Repeat the core action once a week and hold a position for at least {hold} days, so the activity spans several weeks. (about $2 in gas a week; 10 minutes a week)',
    'Before withdrawing, open {name}\u2019s own points or rewards page and claim only from a link it publishes; keep every transaction hash as proof of activity. (no fee to check; about 10 minutes)',
  ],
  cex: [
    'Create an account on {name} with a dedicated email address and finish its identity check; keep the account separate from any trading account. (no fee; about 20 minutes)',
    'Deposit a small test amount, about {small}, and make one spot trade so the account is active, not idle. (about $1 in fees; about 10 minutes)',
    'Turn on {name}\u2019s official announcements channel and set an alert for the words token, airdrop and points. (no fee; about 5 minutes)',
    'Do not lock large funds here: {name} is an exchange, and exchanges almost never issue a token of their own, so treat this as low priority. (no cost; about 5 minutes)',
    'Re-check the announcements once a month; if a points program or token plan appears, switch to a full farm plan and move the position up the list. (no fee; 10 minutes a month)',
  ],
  bridge: [
    'Set up a fresh wallet on {chain} that holds only the funds you plan to farm, and write its seed phrase on paper, never in a screenshot. ($2–$4 in gas; about 10 minutes)',
    'Bridge a small test amount, about {small} of USDC, through {name} to {chain} so the wallet has one completed crossing. ($3–$8 in gas; about 10 minutes)',
    'Turn on {name}\u2019s official announcements channel and set an alert for the words token, airdrop and points. (no fee; about 5 minutes)',
    'Do not lock large funds here: {name} is a bridge, and bridges almost never issue a token of their own, so treat this as low priority. (no cost; about 5 minutes)',
    'Re-check the announcements once a month; if a points program or token plan appears, switch to a full farm plan and move the position up the list. (no fee; 10 minutes a month)',
  ],
  lst: [
    'Set up a fresh wallet on {chain} that holds only the funds you plan to farm, and write its seed phrase on paper, never in a screenshot. ($2–$4 in gas; about 10 minutes)',
    'Stake a small test amount, about {small} of the chain\u2019s native asset, through {name} on {chain} and keep the receipt token. ($3–$6 in gas; about 10 minutes)',
    'Turn on {name}\u2019s official announcements channel and set an alert for the words token, airdrop and points. (no fee; about 5 minutes)',
    'Do not lock large funds here: {name} is a liquid-staking product, and its receipt token is a claim on an asset that already trades, so treat this as low priority. (no cost; about 5 minutes)',
    'Re-check the announcements once a month; if a points program or token plan appears, switch to a full farm plan and move the position up the list. (no fee; 10 minutes a month)',
  ],
};

/** The template group a category belongs to. */
export function groupFor(category: string | null, discount: number): string {
  if (discount < 1) {
    if (category === 'CEX') return 'cex';
    if (category === 'Bridge' || category === 'Canonical Bridge' || category === 'Cross Chain Bridge') return 'bridge';
    return 'lst';
  }
  const c = (category ?? '').toLowerCase();
  if (c.includes('dex') || c.includes('leveraged farm') || c.includes('liquidity manager') || c === 'farm') return 'dexs';
  if (c.includes('lend') || c.includes('collateral')) return 'lending';
  if (c.includes('cdp')) return 'cdp';
  if (c.includes('yield') || c.includes('risk curator') || c.includes('allocator') || c.includes('basis trading') || c.includes('index')) return 'yield';
  if (c.includes('rwa') || c.includes('cedefi') || c.includes('stablecoin') || c.includes('token locker')) return 'rwa';
  if (c.includes('derivative') || c.includes('options')) return 'derivatives';
  if (c.includes('prediction')) return 'prediction';
  if (c.includes('staking') || c.includes('restaking')) return 'staking';
  if (c === 'chain') return 'chain';
  return 'generic';
}

/** Fill a template's placeholders for one protocol. */
function fill(template: string, values: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(values)) out = out.split(`{${key}}`).join(value);
  return out;
}

/**
 * A protocol's farm plan: the group's templates, parameterised by the
 * protocol's own record. Every step stays within the gate's 20..600
 * characters: a step past 600 is cut at a word boundary, a step under 20
 * gains a closing clause (neither ever triggers on the tables above, but
 * the board never ships a step the gate refuses).
 */
export function farmSteps(p: SnapshotProtocol, breakdown: ModelBreakdown): string[] {
  const tier = capitalTier(p.tvl_usd);
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const values: Record<string, string> = {
    name: p.name,
    chain,
    capital: tier.capital,
    range: tier.range,
    hold: String(holdDaysFor(breakdown.age_days)),
    small: '$25',
  };
  const group = groupFor(p.category, breakdown.discount);
  const templates = FARM_TEMPLATES[group] ?? FARM_TEMPLATES.generic!;
  return templates.map((t) => {
    let step = fill(t, values).trim();
    if (step.length > 600) {
      step = `${step.slice(0, 597).replace(/\s+\S*$/, '')}...`;
    }
    if (step.length < 20) step = `${step} Keep the transaction hashes as proof of activity.`;
    return step;
  });
}

// ---------------------------------------------------------------- the board

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const watchlist = new Set(snapshot.watchlist);
  const multiples = categoryMultiples(snapshot);
  const scored = snapshot.protocols
    .filter(isPreToken)
    .map((p) => {
      const { implied, breakdown } = scoreProtocol(p, snapshot.as_of, multiples);
      return { p, implied, breakdown };
    });
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    watchlist: watchlist.has(s.p.slug),
    age_days: s.breakdown.age_days,
    implied_value_usd: s.implied,
    model: s.breakdown,
    farm_steps: farmSteps(s.p, s.breakdown),
  }));
}

/** The token-bearing protocols, by market cap, for the dashboard's comparable peers. */
export function buildPeers(snapshot: Snapshot): PeerRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      change_7d: p.change_7d,
    }));
}

/** Everything the dashboard needs, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const peers = buildPeers(snapshot);
  const multiples = categoryMultiples(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    global_multiple: Math.round(multiples.global * 1e4) / 1e4,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    total_implied_usd: board.reduce((n, r) => n + r.implied_value_usd, 0),
    chain_count: new Set(board.flatMap((r) => r.chains)).size,
    rows: board,
    peers,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
