// The token radar's model: the sealed snapshot in, a ranked board out.
//
// The board ranks the protocols that can plausibly launch a token one day:
// every protocol in the snapshot that records no token (gecko_id and
// symbol both null), minus the ones set aside with a stated reason
// (exchanges, bridges, liquid-staking products, versioned releases,
// wrapped or staked products). 197 rows, the 40-protocol watchlist
// included. Nothing is ranked from a hardcoded list of names — every
// number below is derived from the snapshot's own figures.
//
// Implied value, per protocol — impliedValue():
//
//   fit     log10(mcap) = a + b * log10(TVL), a Huber fit on the traded
//           protocols in launchable categories (mcap > 0, TVL > 0).
//           Categories whose token almost certainly never exists —
//           CEX, bridges, liquid staking / restaking — are left out of
//           the fit: their market caps price a different thing, and the
//           curve must describe the protocols being ranked.
//   offset  a shrunk residual mean per category, n/(n+3) shrinkage,
//           clamped to +/-0.3 dex, from the same fit set; 0 when a
//           category has fewer than 3 traded peers.
//   curve   = 10 ^ (a + b * log10(TVL))
//   growth  = 1 + clamp(change_7d, -15, 25) / 100        (null -> 1.00)
//   age     = 1 + min(years listed, 3) * 0.03             (null -> 1.00)
//   chains  = 1 + min(chains - 1, 4) * 0.02
//   implied = round(curve * 10^offset * growth * age * chains)
//
// The curve flattens: market cap grows sub-linearly with TVL (slope
// about 0.44), so a $2.76B-TVL protocol is worth tens of millions, not
// half a billion — the category-median multiple the first version used
// had no size curve and overstated giant TVLs.
//
// Validation — looCheck() and walkForwardCheck() — runs on the snapshot
// itself, on the traded tokens: leave-one-out (refit without the token,
// predict it) and walk-forward by listing date (fit the earlier half,
// predict the later half). The page prints the median miss, the share
// within 3x, the rank correlation, and the share of holdout caps inside
// the bootstrap P25-P75 / P10-P90 bands, next to the same numbers for a
// single flat multiple, so the reader can see the curve earns its keep.
// bootstrapBands() runs 200 refits (seeded, so the program is
// deterministic) and gives every ranked row a P10-P90 band and a rank
// range across refits.
//
// Farm economics — farmPlan() and verdictFor(): each row's plan has a
// cost in dollars (gas per step, plus a share of the deposit on swaps)
// and a time in active hours. A launch is assumed to hand 5% of the
// implied value to early users, split among an estimated farmer count
// (TVL / $25,000, clamped to 500..200,000), with a farmer's slice
// scaling with the square root of the deposit. net-if-launch is the
// slice minus the plan's cost; break-even odds are cost / slice; the
// verdict is FARM when the launch odds clear 1.5x break-even and the
// net per active hour clears $20, MARGINAL when the launch odds clear
// break-even, else SKIP. Most rows honestly come out SKIP.
//
// Launch odds — launchOdds() — are a stated heuristic from the
// protocol's own record: a base by category, +5 points on the
// watchlist, +2 points a year listed (capped at +6), +3 at $500M+ TVL,
// +3 on 7-day growth above 10%, clamped to 5..60%.

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
  growth_low: -15,
  growth_high: 25,
  age_years_cap: 3,
  age_per_year: 0.03,
  chain_step: 0.02,
  chain_cap: 4,
  offset_min_peers: 3,
  offset_shrink: 3,
  offset_clamp_dex: 0.3,
  huber_k: 1.345,
  huber_rounds: 25,
  bootstrap_refits: 200,
  loo_band_refits: 50,
  airdrop_share: 0.05,
  farmer_tvl: 25000,
  farmer_min: 500,
  farmer_max: 200000,
  farm_mult: 1.5,
  farm_hour_floor: 20,
  deposits: [1000, 10000],
} as const;

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-3';

/** Categories left out of the fit: their tokens price a different thing. */
export const FIT_EXCLUDED_CATEGORIES = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);

/** Categories set aside from the board: they almost certainly never issue a token. */
const SET_ASIDE_CATEGORIES = new Map<string, string>([
  ['CEX', 'exchange'],
  ['Bridge', 'bridge'],
  ['Canonical Bridge', 'bridge'],
  ['Cross Chain Bridge', 'bridge'],
  ['Liquid Staking', 'liquid staking / restaking'],
  ['Liquid Restaking', 'liquid staking / restaking'],
  ['Restaked BTC', 'liquid staking / restaking'],
]);

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word wrapped / staked / staking anywhere in the name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** Exchange names a protocol name may start with. */
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** The value breakdown one row carries, so the dashboard can show its working. */
export interface ModelBreakdown {
  curve_usd: number;
  offset_dex: number;
  offset_peers: number;
  growth: number;
  age: number;
  chains_factor: number;
  age_days: number | null;
}

/** A row's farm economics at one deposit size. */
export interface FarmEconomics {
  deposit_usd: number;
  cost_usd: number;
  slice_usd: number;
  net_usd: number;
  net_per_hour_usd: number;
  breakeven_odds: number;
  verdict: 'FARM' | 'MARGINAL' | 'SKIP';
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
  band_p10_usd: number;
  band_p25_usd: number;
  band_p75_usd: number;
  band_p90_usd: number;
  rank_lo: number;
  rank_hi: number;
  launch_odds: number;
  farmers: number;
  farm_hours: number;
  farm_cost_gas_usd: number;
  farm_cost_pct: number;
  farm_1000: FarmEconomics;
  farm_10000: FarmEconomics;
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

/** One set-aside reason: how many protocols, and examples. */
export interface SetAsideRow {
  reason: string;
  count: number;
  examples: string[];
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  total_implied_usd: number;
  chain_count: number;
  fit: { intercept: number; slope: number; n: number; excluded_categories: string[]; curve: { tvl_usd: number; p25_usd: number; p50_usd: number; p75_usd: number }[] };
  validation: {
    loo: { n: number; median_miss: number; within_3x: number; rank_corr: number; in_p25_p75: number; in_p10_p90: number };
    walk_forward: { train: number; test: number; cut: string; median_miss: number; within_3x: number; rank_corr: number };
    flat_multiple: { median_miss: number; within_3x: number };
    bootstrap_refits: number;
  };
  accounting: {
    total: number;
    ranked: number;
    already_trade: number;
    token_recorded_no_mcap: number;
    set_aside: number;
    set_aside_rows: SetAsideRow[];
  };
  verdict_counts: { '1000': { FARM: number; MARGINAL: number; SKIP: number }; '10000': { FARM: number; MARGINAL: number; SKIP: number } };
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

/** Clamp `v` into [lo, hi]. */
function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** The median of a non-empty list of numbers. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return n % 2 === 1 ? sorted[(n - 1) / 2]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
}

/** The p-th quantile (0..1) of a list, by linear interpolation on sorted values. */
export function quantile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0]!;
  const at = (sorted.length - 1) * p;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

/** Spearman's rank correlation between two equal-length lists. */
export function spearman(xs: number[], ys: number[]): number {
  const ranks = (arr: number[]): number[] => {
    const idx = arr.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
    const r = new Array<number>(arr.length);
    idx.forEach(([_, i], k) => {
      r[i] = k;
    });
    return r;
  };
  const a = ranks(xs);
  const b = ranks(ys);
  let d2 = 0;
  for (let i = 0; i < xs.length; i++) d2 += (a[i]! - b[i]!) ** 2;
  return 1 - (6 * d2) / (xs.length * (xs.length * xs.length - 1));
}

/** A deterministic PRNG (mulberry32) so bootstrap refits are byte-identical every run. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

/** Why a pre-token protocol is set aside instead of ranked, or null when it can launch. */
export function setAsideReason(p: SnapshotProtocol): string | null {
  if (p.category !== null) {
    const reason = SET_ASIDE_CATEGORIES.get(p.category);
    if (reason !== undefined) return reason;
  }
  if (VERSIONED.test(p.name)) return 'versioned release';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped / staked by name';
  for (const e of EXCHANGES) {
    if (p.name.startsWith(e)) return 'exchange custody';
  }
  return null;
}

// ---------------------------------------------------------------- the fit

/** One traded token as a point on the log-log curve. */
interface FitPoint {
  x: number;
  y: number;
  protocol: SnapshotProtocol;
}

/** The traded protocols the curve is fitted on: positive market cap, launchable categories. */
export function fitPoints(snapshot: Snapshot): FitPoint[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && !FIT_EXCLUDED_CATEGORIES.has(p.category ?? ''))
    .map((p) => ({ x: Math.log10(p.tvl_usd), y: Math.log10(p.mcap_usd!), protocol: p }));
}

/** Ordinary least squares on log-log points. */
function ols(points: FitPoint[]): { a: number; b: number } {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (const p of points) {
    sxy += (p.x - mx) * (p.y - my);
    sxx += (p.x - mx) ** 2;
  }
  const b = sxy / sxx;
  return { a: my - b * mx, b };
}

/** A Huber fit (iteratively reweighted least squares) on log-log points. */
export function huberFit(points: FitPoint[]): { a: number; b: number } {
  let { a, b } = ols(points);
  for (let round = 0; round < MODEL.huber_rounds; round++) {
    const res = points.map((p) => p.y - (a + b * p.x));
    const scale = 1.4826 * (median(res.map(Math.abs)) || 1e-9);
    const k = MODEL.huber_k * scale;
    const w = res.map((r) => (Math.abs(r) <= k ? 1 : k / Math.abs(r)));
    const sw = w.reduce((s, v) => s + v, 0);
    const mx = points.reduce((s, p, i) => s + w[i]! * p.x, 0) / sw;
    const my = points.reduce((s, p, i) => s + w[i]! * p.y, 0) / sw;
    let sxy = 0;
    let sxx = 0;
    for (let i = 0; i < points.length; i++) {
      sxy += w[i]! * (points[i]!.x - mx) * (points[i]!.y - my);
      sxx += w[i]! * (points[i]!.x - mx) ** 2;
    }
    const nb = sxy / sxx;
    const na = my - nb * mx;
    const done = Math.abs(nb - b) < 1e-12 && Math.abs(na - a) < 1e-12;
    a = na;
    b = nb;
    if (done) break;
  }
  return { a, b };
}

/**
 * A fitted curve plus its shrunk category offsets: the residual mean per
 * category, shrunk by n/(n+3) and clamped to +/-0.3 dex, 0 when a category
 * has fewer than 3 traded peers. `residuals` are the log-residuals of the
 * fit points against curve + offset: the scatter a prediction interval
 * must carry, since the curve alone is far more certain than any one
 * protocol's cap.
 */
export interface FittedModel {
  a: number;
  b: number;
  offsets: Map<string, { dex: number; peers: number }>;
  residuals: number[];
}

export function fitModel(points: FitPoint[]): FittedModel {
  const { a, b } = huberFit(points);
  const byCategory = new Map<string, number[]>();
  for (const p of points) {
    const key = p.protocol.category ?? '(none)';
    const list = byCategory.get(key) ?? [];
    list.push(p.y - (a + b * p.x));
    byCategory.set(key, list);
  }
  const offsets = new Map<string, { dex: number; peers: number }>();
  for (const [key, residuals] of byCategory) {
    if (residuals.length < MODEL.offset_min_peers) {
      offsets.set(key, { dex: 0, peers: residuals.length });
      continue;
    }
    const mean = residuals.reduce((s, v) => s + v, 0) / residuals.length;
    const dex = clamp(mean * (residuals.length / (residuals.length + MODEL.offset_shrink)), -MODEL.offset_clamp_dex, MODEL.offset_clamp_dex);
    offsets.set(key, { dex, peers: residuals.length });
  }
  const residuals = points.map((p) => {
    const offset = offsets.get(p.protocol.category ?? '(none)') ?? { dex: 0, peers: 0 };
    return p.y - (a + b * p.x + offset.dex);
  });
  return { a, b, offsets, residuals };
}

// ---------------------------------------------------------------- adjustments

/** The 7-day growth factor: 1 + clamp(change, -15, +25) / 100. */
export function growthFactor(p: SnapshotProtocol): number {
  return 1 + clamp(finite(p.change_7d, 0), MODEL.growth_low, MODEL.growth_high) / 100;
}

/** The seasoning factor: longer listed with no token, up to +9% at 3 years. */
export function ageFactor(p: SnapshotProtocol, asOf: string): number {
  const days = ageDays(asOf, p.listed_at);
  return days === null ? 1 : 1 + Math.min(days / 365, MODEL.age_years_cap) * MODEL.age_per_year;
}

/** The chain-breadth factor: +2% a chain beyond the first, up to +8%. */
export function chainFactor(p: SnapshotProtocol): number {
  return 1 + Math.min(Math.max(p.chains.length - 1, 0), MODEL.chain_cap) * MODEL.chain_step;
}

/** The log10 of the growth, age and chain factors combined. */
export function adjustmentLog(p: SnapshotProtocol, asOf: string): number {
  return Math.log10(growthFactor(p) * ageFactor(p, asOf) * chainFactor(p));
}

/** A protocol's implied value under a fitted model, with its breakdown. */
export function impliedValue(
  p: SnapshotProtocol,
  model: FittedModel,
  asOf: string,
): { implied: number; breakdown: ModelBreakdown } {
  const curve = Math.pow(10, model.a + model.b * Math.log10(Math.max(p.tvl_usd, 1)));
  const offset = model.offsets.get(p.category ?? '(none)') ?? { dex: 0, peers: 0 };
  const growth = growthFactor(p);
  const age = ageFactor(p, asOf);
  const chainsFactor = chainFactor(p);
  const implied = Math.max(1, Math.round(curve * Math.pow(10, offset.dex) * growth * age * chainsFactor));
  return {
    implied,
    breakdown: {
      curve_usd: Math.round(curve),
      offset_dex: Math.round(offset.dex * 1e4) / 1e4,
      offset_peers: offset.peers,
      growth: Math.round(growth * 1e4) / 1e4,
      age: Math.round(age * 1e4) / 1e4,
      chains_factor: Math.round(chainsFactor * 1e4) / 1e4,
      age_days: ageDays(asOf, p.listed_at),
    },
  };
}

/** A protocol's predicted market cap under a model (the same formula, for traded tokens). */
function predictMcap(p: SnapshotProtocol, model: FittedModel, asOf: string): number {
  return impliedValue(p, model, asOf).implied;
}

/**
 * One draw from a protocol's prediction interval under a model: the
 * point prediction plus one residual sampled (seeded) from the model's
 * own residuals. The curve's uncertainty alone is far narrower than
 * the scatter between protocols, so a band without this term would
 * pretend to know far more than the fit does.
 */
function predictWithResidual(p: SnapshotProtocol, model: FittedModel, asOf: string, rng: () => number): number {
  const { implied } = impliedValue(p, model, asOf);
  const draw = model.residuals[Math.floor(rng() * model.residuals.length)] ?? 0;
  return Math.max(1, Math.round(implied * Math.pow(10, draw)));
}

// ---------------------------------------------------------------- validation

/** The miss ratio between a prediction and an actual market cap: 1 is exact. */
function missRatio(predicted: number, actual: number): number {
  return Math.max(predicted / actual, actual / predicted);
}

/**
 * looCheck(): leave-one-out on the fit set. Each traded token is held
 * out, the curve and offsets are refit without it, and it is predicted.
 * Returns the median miss, the share within 3x, the rank correlation
 * between predicted and actual caps, and — from 50 seeded bootstrap
 * refits per held-out token — the share of holdout caps that land inside
 * the printed P25-P75 and P10-P90 bands.
 */
export function looCheck(points: FitPoint[], asOf: string): {
  n: number;
  median_miss: number;
  within_3x: number;
  rank_corr: number;
  in_p25_p75: number;
  in_p10_p90: number;
} {
  const misses: number[] = [];
  const preds: number[] = [];
  const acts: number[] = [];
  let inBand2575 = 0;
  let inBand1090 = 0;
  const rng = seededRng(20261114);
  for (let i = 0; i < points.length; i++) {
    const held = points[i]!;
    const rest = points.filter((_, j) => j !== i);
    const model = fitModel(rest);
    const predicted = predictMcap(held.protocol, model, asOf);
    const actual = held.protocol.mcap_usd!;
    misses.push(missRatio(predicted, actual));
    preds.push(predicted);
    acts.push(actual);
    // The band for this token from refits that never saw it: each refit
    // draws one residual from its own scatter, so the band is a
    // prediction interval, not just the curve's wobble.
    const band: number[] = [];
    for (let r = 0; r < MODEL.loo_band_refits; r++) {
      const sample: FitPoint[] = [];
      for (let k = 0; k < rest.length; k++) sample.push(rest[Math.floor(rng() * rest.length)]!);
      band.push(predictWithResidual(held.protocol, fitModel(sample), asOf, rng));
    }
    if (actual >= quantile(band, 0.25) && actual <= quantile(band, 0.75)) inBand2575++;
    if (actual >= quantile(band, 0.1) && actual <= quantile(band, 0.9)) inBand1090++;
  }
  return {
    n: points.length,
    median_miss: Math.round(median(misses) * 100) / 100,
    within_3x: Math.round((misses.filter((m) => m <= 3).length / misses.length) * 1000) / 1000,
    rank_corr: Math.round(spearman(preds, acts) * 1000) / 1000,
    in_p25_p75: Math.round((inBand2575 / points.length) * 1000) / 1000,
    in_p10_p90: Math.round((inBand1090 / points.length) * 1000) / 1000,
  };
}

/**
 * walkForwardCheck(): fit on the earlier-listed half of the dated traded
 * tokens, predict the later-listed half. A model that only fits the past
 * it has seen fails here.
 */
export function walkForwardCheck(
  points: FitPoint[],
  asOf: string,
): { train: number; test: number; cut: string; median_miss: number; within_3x: number; rank_corr: number } {
  const dated = points.filter((p) => p.protocol.listed_at !== null).sort((a, b) => (a.protocol.listed_at! < b.protocol.listed_at! ? -1 : 1));
  const half = Math.floor(dated.length / 2);
  const train = dated.slice(0, half);
  const test = dated.slice(half);
  const model = fitModel(train);
  const misses: number[] = [];
  const preds: number[] = [];
  const acts: number[] = [];
  for (const p of test) {
    const predicted = predictMcap(p.protocol, model, asOf);
    const actual = p.protocol.mcap_usd!;
    misses.push(missRatio(predicted, actual));
    preds.push(predicted);
    acts.push(actual);
  }
  return {
    train: train.length,
    test: test.length,
    cut: test[0]!.protocol.listed_at!,
    median_miss: Math.round(median(misses) * 100) / 100,
    within_3x: Math.round((misses.filter((m) => m <= 3).length / misses.length) * 1000) / 1000,
    rank_corr: Math.round(spearman(preds, acts) * 1000) / 1000,
  };
}

/** The flat-multiple baseline: one global median mcap/TVL, leave-one-out. */
export function flatMultipleCheck(points: FitPoint[]): { median_miss: number; within_3x: number } {
  const misses: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const rest = points.filter((_, j) => j !== i);
    const multiple = median(rest.map((p) => p.protocol.mcap_usd! / p.protocol.tvl_usd));
    const predicted = points[i]!.protocol.tvl_usd * multiple;
    misses.push(missRatio(predicted, points[i]!.protocol.mcap_usd!));
  }
  return {
    median_miss: Math.round(median(misses) * 100) / 100,
    within_3x: Math.round((misses.filter((m) => m <= 3).length / misses.length) * 1000) / 1000,
  };
}

/**
 * bootstrapBands(): 200 seeded refits of the fit set. Each refit re-ranks
 * every ranked protocol, so each row gets a P10-P90 implied-value band
 * and the rank range it wanders across refits. Each row's band is a
 * prediction interval: the refit's curve plus one residual drawn from
 * that refit's own scatter, because the curve alone is far more certain
 * than any one protocol's cap. Also returns the fitted curve's P25-P75
 * band on a TVL grid, for the scatter chart (that band is the curve's
 * wobble only, not the scatter — the method panel says so).
 */
export function bootstrapBands(
  points: FitPoint[],
  ranked: SnapshotProtocol[],
  asOf: string,
): {
  bands: Map<string, { p10: number; p25: number; p75: number; p90: number; rank_lo: number; rank_hi: number }>;
  curve: { tvl_usd: number; p25_usd: number; p50_usd: number; p75_usd: number }[];
} {
  const rng = seededRng(20261114);
  const values = new Map<string, number[]>();
  const ranks = new Map<string, number[]>();
  for (const p of ranked) {
    values.set(p.slug, []);
    ranks.set(p.slug, []);
  }
  const gridTvl = [5e6, 1e7, 2e7, 5e7, 1e8, 2e8, 5e8, 1e9, 2e9, 5e9, 1e10, 2e10];
  const gridValues = new Map<number, number[]>();
  for (const t of gridTvl) gridValues.set(t, []);
  for (let r = 0; r < MODEL.bootstrap_refits; r++) {
    const sample: FitPoint[] = [];
    for (let k = 0; k < points.length; k++) sample.push(points[Math.floor(rng() * points.length)]!);
    const model = fitModel(sample);
    // Each row's draw carries one sampled residual, so the band is a
    // prediction interval: curve uncertainty plus the scatter between
    // protocols. Ranks are taken on the point predictions of the refit,
    // not on the draws, so a rank range measures the curve's wobble.
    const scored = ranked.map((p) => ({ slug: p.slug, v: impliedValue(p, model, asOf).implied }));
    scored.sort((a, b) => b.v - a.v || (a.slug < b.slug ? -1 : 1));
    scored.forEach((s, i) => {
      ranks.get(s.slug)!.push(i + 1);
    });
    for (const p of ranked) {
      values.get(p.slug)!.push(predictWithResidual(p, model, asOf, rng));
    }
    for (const t of gridTvl) {
      gridValues.get(t)!.push(Math.pow(10, model.a + model.b * Math.log10(t)));
    }
  }
  const bands = new Map<string, { p10: number; p25: number; p75: number; p90: number; rank_lo: number; rank_hi: number }>();
  for (const p of ranked) {
    const vs = values.get(p.slug)!;
    const rs = ranks.get(p.slug)!;
    bands.set(p.slug, {
      p10: Math.max(1, Math.round(quantile(vs, 0.1))),
      p25: Math.max(1, Math.round(quantile(vs, 0.25))),
      p75: Math.max(1, Math.round(quantile(vs, 0.75))),
      p90: Math.max(1, Math.round(quantile(vs, 0.9))),
      rank_lo: Math.min(...rs),
      rank_hi: Math.max(...rs),
    });
  }
  const curve = gridTvl.map((t) => {
    const vs = gridValues.get(t)!;
    return {
      tvl_usd: t,
      p25_usd: Math.max(1, Math.round(quantile(vs, 0.25))),
      p50_usd: Math.max(1, Math.round(quantile(vs, 0.5))),
      p75_usd: Math.max(1, Math.round(quantile(vs, 0.75))),
    };
  });
  return { bands, curve };
}

// ---------------------------------------------------------------- farm economics

/** A protocol's launch odds: a stated heuristic from its own record. */
export function launchOdds(p: SnapshotProtocol, asOf: string, watchlist: Set<string>): number {
  const c = p.category ?? '';
  let base = 0.2;
  if (c === 'Dexs' || c === 'Lending') base = 0.32;
  else if (c === 'Yield' || c === 'RWA' || c === 'Derivatives' || c === 'CDP' || c === 'Risk Curators') base = 0.3;
  else if (c === 'Onchain Capital Allocator' || c === 'Basis Trading' || c === 'Payments' || c === 'Insurance' || c === 'Chain') base = 0.26;
  else if (c === 'Restaking' || c === 'Staking Pool') base = 0.24;
  const days = ageDays(asOf, p.listed_at);
  const odds =
    base +
    (watchlist.has(p.slug) ? 0.05 : 0) +
    (days === null ? 0 : Math.min(days / 365, 3) * 0.02) +
    (p.tvl_usd >= 500_000_000 ? 0.03 : 0) +
    ((p.change_7d ?? 0) > 10 ? 0.03 : 0);
  return Math.round(clamp(odds, 0.05, 0.6) * 1000) / 1000;
}

/** The estimated farmer count: TVL / $25,000, clamped to 500..200,000. */
export function farmerCount(p: SnapshotProtocol): number {
  return clamp(Math.round(p.tvl_usd / MODEL.farmer_tvl), MODEL.farmer_min, MODEL.farmer_max);
}

/** A farmer's slice of the airdrop pool at a deposit size. */
export function sliceIfLaunch(implied: number, farmers: number, depositUsd: number): number {
  return (MODEL.airdrop_share * implied * Math.sqrt(depositUsd / 25000)) / farmers;
}

/** The verdict from launch odds, break-even odds and net per active hour. */
export function verdictFor(odds: number, breakeven: number, netPerHour: number): 'FARM' | 'MARGINAL' | 'SKIP' {
  if (odds >= breakeven * MODEL.farm_mult && netPerHour >= MODEL.farm_hour_floor) return 'FARM';
  if (odds >= breakeven) return 'MARGINAL';
  return 'SKIP';
}

/** A row's farm economics at one deposit size. */
export function farmEconomics(
  implied: number,
  farmers: number,
  costGas: number,
  costPct: number,
  hours: number,
  odds: number,
  depositUsd: number,
): FarmEconomics {
  const cost = Math.round((costGas + costPct * depositUsd) * 100) / 100;
  const slice = Math.round(sliceIfLaunch(implied, farmers, depositUsd) * 100) / 100;
  const net = Math.round((slice - cost) * 100) / 100;
  const netPerHour = Math.round((net / Math.max(hours, 0.01)) * 100) / 100;
  const breakeven = Math.round((cost / Math.max(slice, 0.01)) * 1000) / 1000;
  return {
    deposit_usd: depositUsd,
    cost_usd: cost,
    slice_usd: slice,
    net_usd: net,
    net_per_hour_usd: netPerHour,
    breakeven_odds: breakeven,
    verdict: verdictFor(odds, breakeven, netPerHour),
  };
}

// ---------------------------------------------------------------- farm plans

/**
 * One farm-plan step: its text, the gas it costs in dollars, the share of
 * the deposit it spends as a fee, and the active minutes it takes. The
 * recurring weekly step is counted for its first month (4x), and its text
 * says so; the plan's cost and hours are the sums of these numbers.
 */
interface PlanStep {
  text: string;
  gas: number;
  pct: number;
  mins: number;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * Farm-plan templates, keyed by protocol group. Placeholders are {name},
 * {chain}, {capital}, {range}, {hold} and {small}. The dashboard's app.js
 * carries the same table so the page shows the plan its own code derives
 * — keep the two in sync.
 */
export const FARM_TEMPLATES: Record<string, PlanStep[]> = {
  dexs: [
    { text: 'Set up a fresh wallet on {chain} that holds only the funds you plan to farm, and write its seed phrase on paper, never in a screenshot. ($3 in gas; about 10 minutes)', gas: 3, pct: 0, mins: 10 },
    { text: 'Bridge {capital} of USDC to {chain} through the official bridge, inside the {range} band for a protocol of this size. ($5 in gas; about 10 minutes)', gas: 5, pct: 0, mins: 10 },
    { text: 'Swap half of the USDC for the pool\u2019s paired asset on {name}\u2019s {chain} swap, at about 0.3% in fees. ($4 in gas; about 5 minutes)', gas: 4, pct: 0.003, mins: 5 },
    { text: 'Add the full {capital} as liquidity to {name}\u2019s main pool on {chain} and keep the LP position open. ($5 in gas; about 5 minutes)', gas: 5, pct: 0, mins: 5 },
    { text: 'Route one swap a week through {name} instead of an aggregator, so the wallet shows repeat volume, and hold the LP position for at least {hold} days. (about $2 in gas a week for the first month; 10 minutes a week)', gas: 8, pct: 0, mins: 40 },
    { text: 'Before withdrawing, open {name}\u2019s own points or rewards page and claim only from a link it publishes; keep every transaction hash as proof of activity. (no fee to check; about 10 minutes)', gas: 0, pct: 0, mins: 10 },
  ],
  lending: [
    { text: 'Set up a fresh wallet on {chain} that holds only the funds you plan to farm, and write its seed phrase on paper, never in a screenshot. ($3 in gas; about 10 minutes)', gas: 3, pct: 0, mins: 10 },
    { text: 'Bridge {capital} of USDC to {chain} through the official bridge, inside the {range} band for a protocol of this size. ($5 in gas; about 10 minutes)', gas: 5, pct: 0, mins: 10 },
    { text: 'Supply the {capital} of USDC as collateral on {name} on {chain} and keep the deposit open. ($4 in gas; about 5 minutes)', gas: 4, pct: 0, mins: 5 },
    { text: 'Borrow a small amount, about $50 of the paired asset, against the deposit, then repay it in full the same week. ($5 in gas; about 10 minutes)', gas: 5, pct: 0, mins: 10 },
    { text: 'Top up or adjust the collateral once a week, keep the health factor above 2, and hold the position for at least {hold} days. (about $2 in gas a week for the first month; 10 minutes a week)', gas: 8, pct: 0, mins: 40 },
    { text: 'Before withdrawing, open {name}\u2019s own points or rewards page and claim only from a link it publishes; keep every transaction hash as proof of activity. (no fee to check; about 10 minutes)', gas: 0, pct: 0, mins: 10 },
  ],
  cdp: [
    { text: 'Set up a fresh wallet on {chain} that holds only the funds you plan to farm, and write its seed phrase on paper, never in a screenshot. ($3 in gas; about 10 minutes)', gas: 3, pct: 0, mins: 10 },
    { text: 'Bridge {capital} of USDC to {chain} through the official bridge, inside the {range} band for a protocol of this size. ($5 in gas; about 10 minutes)', gas: 5, pct: 0, mins: 10 },
    { text: 'Lock the {capital} of collateral in a {name} vault on {chain} and mint a small amount of its stable asset, well under the safe ratio. ($5 in gas; about 5 minutes)', gas: 5, pct: 0, mins: 5 },
    { text: 'Repay part of the minted stable asset, then mint again, so the vault shows two-way activity instead of a single deposit. ($5 in gas; about 10 minutes)', gas: 5, pct: 0, mins: 10 },
    { text: 'Check the vault\u2019s collateral ratio weekly, top it up before it drifts near liquidation, and hold the vault for at least {hold} days. (about $2 in gas a week for the first month; 10 minutes a week)', gas: 8, pct: 0, mins: 40 },
    { text: 'Before withdrawing, open {name}\u2019s own points or rewards page and claim only from a link it publishes; keep every transaction hash as proof of activity. (no fee to check; about 10 minutes)', gas: 0, pct: 0, mins: 10 },
  ],
  yield: [
    { text: 'Set up a fresh wallet on {chain} that holds only the funds you plan to farm, and write its seed phrase on paper, never in a screenshot. ($3 in gas; about 10 minutes)', gas: 3, pct: 0, mins: 10 },
    { text: 'Bridge {capital} of USDC to {chain} through the official bridge, inside the {range} band for a protocol of this size. ($5 in gas; about 10 minutes)', gas: 5, pct: 0, mins: 10 },
    { text: 'Deposit the {capital} of USDC into {name}\u2019s highest-TVL vault on {chain} and keep the vault shares in the farming wallet. ($4 in gas; about 5 minutes)', gas: 4, pct: 0, mins: 5 },
    { text: 'Claim any vault rewards that accrue and re-deposit them into the same vault instead of withdrawing. ($4 in gas; about 5 minutes)', gas: 4, pct: 0, mins: 5 },
    { text: 'When {name} rotates to a new epoch or strategy, move the deposit across about once a month, and hold a position for at least {hold} days. (about $2 in gas a week for the first month; 10 minutes a week)', gas: 8, pct: 0, mins: 40 },
    { text: 'Before withdrawing, open {name}\u2019s own points or rewards page and claim only from a link it publishes; keep every transaction hash as proof of activity. (no fee to check; about 10 minutes)', gas: 0, pct: 0, mins: 10 },
  ],
  rwa: [
    { text: 'Set up a fresh wallet on {chain} that holds only the funds you plan to farm, and write its seed phrase on paper, never in a screenshot. ($3 in gas; about 10 minutes)', gas: 3, pct: 0, mins: 10 },
    { text: 'Bridge {capital} of USDC to {chain} through the official bridge, inside the {range} band for a protocol of this size. ($5 in gas; about 10 minutes)', gas: 5, pct: 0, mins: 10 },
    { text: 'Mint or buy {capital} of {name}\u2019s yield-bearing asset on {chain} and hold it in the farming wallet. ($6 in gas; about 10 minutes)', gas: 6, pct: 0.002, mins: 10 },
    { text: 'Claim the yield the asset accrues and keep the claim transactions as proof of activity. ($4 in gas; about 5 minutes)', gas: 4, pct: 0, mins: 5 },
    { text: 'Check the asset\u2019s backing report or attestation page monthly, and hold the asset for at least {hold} days; exit if the backing stops being published. (about $2 in gas a week for the first month; 10 minutes a week)', gas: 8, pct: 0, mins: 40 },
    { text: 'Before withdrawing, open {name}\u2019s own points or rewards page and claim only from a link it publishes; keep every transaction hash as proof of activity. (no fee to check; about 10 minutes)', gas: 0, pct: 0, mins: 10 },
  ],
  derivatives: [
    { text: 'Set up a fresh wallet on {chain} that holds only the funds you plan to farm, and write its seed phrase on paper, never in a screenshot. ($3 in gas; about 10 minutes)', gas: 3, pct: 0, mins: 10 },
    { text: 'Bridge {capital} of USDC to {chain} through the official bridge, inside the {range} band for a protocol of this size. ($5 in gas; about 10 minutes)', gas: 5, pct: 0, mins: 10 },
    { text: 'Deposit the {capital} of USDC as margin on {name} on {chain}. ($4 in gas; about 5 minutes)', gas: 4, pct: 0, mins: 5 },
    { text: 'Open one small hedged position of about $50 notional and close it within the week; never leave a leveraged position open unattended. ($5 in gas; about 10 minutes)', gas: 5, pct: 0.001, mins: 10 },
    { text: 'Place one small position a week and close it the same week, keeping the margin deposit in place for at least {hold} days. (about $2 in gas a week for the first month; 10 minutes a week)', gas: 8, pct: 0, mins: 40 },
    { text: 'Before withdrawing, open {name}\u2019s own points or rewards page and claim only from a link it publishes; keep every transaction hash as proof of activity. (no fee to check; about 10 minutes)', gas: 0, pct: 0, mins: 10 },
  ],
  prediction: [
    { text: 'Set up a fresh wallet on {chain} that holds only the funds you plan to farm, and write its seed phrase on paper, never in a screenshot. ($3 in gas; about 10 minutes)', gas: 3, pct: 0, mins: 10 },
    { text: 'Bridge {capital} of USDC to {chain} through the official bridge, inside the {range} band for a protocol of this size. ($5 in gas; about 10 minutes)', gas: 5, pct: 0, mins: 10 },
    { text: 'Fund the wallet with the {capital} and buy one small position, about $25, in an active market on {name}. ($3 in gas; about 5 minutes)', gas: 3, pct: 0, mins: 5 },
    { text: 'Resolve or sell the position when its market closes, then open one more small position in a different market. ($3 in gas; about 10 minutes)', gas: 3, pct: 0, mins: 10 },
    { text: 'Place one small position a week and keep the wallet funded for at least {hold} days, so the activity spans several market cycles. (about $2 in gas a week for the first month; 10 minutes a week)', gas: 8, pct: 0, mins: 40 },
    { text: 'Before withdrawing, open {name}\u2019s own points or rewards page and claim only from a link it publishes; keep every transaction hash as proof of activity. (no fee to check; about 10 minutes)', gas: 0, pct: 0, mins: 10 },
  ],
  staking: [
    { text: 'Set up a fresh wallet on {chain} that holds only the funds you plan to farm, and write its seed phrase on paper, never in a screenshot. ($3 in gas; about 10 minutes)', gas: 3, pct: 0, mins: 10 },
    { text: 'Bridge {capital} of the chain\u2019s native asset to {chain} through the official bridge, inside the {range} band for a protocol of this size. ($5 in gas; about 10 minutes)', gas: 5, pct: 0, mins: 10 },
    { text: 'Stake the {capital} through {name} on {chain} and keep the receipt token in the farming wallet. ($4 in gas; about 5 minutes)', gas: 4, pct: 0, mins: 5 },
    { text: 'Delegate the receipt token to a second validator or restaking pool that {name} lists, if it offers one. ($4 in gas; about 5 minutes)', gas: 4, pct: 0, mins: 5 },
    { text: 'Claim staking rewards weekly, re-stake them through {name}, and hold the stake for at least {hold} days. (about $2 in gas a week for the first month; 10 minutes a week)', gas: 8, pct: 0, mins: 40 },
    { text: 'Before withdrawing, open {name}\u2019s own points or rewards page and claim only from a link it publishes; keep every transaction hash as proof of activity. (no fee to check; about 10 minutes)', gas: 0, pct: 0, mins: 10 },
  ],
  chain: [
    { text: 'Set up a fresh wallet on {chain} that holds only the funds you plan to farm, and write its seed phrase on paper, never in a screenshot. ($3 in gas; about 10 minutes)', gas: 3, pct: 0, mins: 10 },
    { text: 'Bridge {capital} of USDC to {chain} through the official bridge, inside the {range} band for a protocol of this size, and hold it in the farming wallet for the first week. ($5 in gas; about 10 minutes)', gas: 5, pct: 0, mins: 10 },
    { text: 'Use {name}\u2019s native DEX or lending app on {chain} for one swap or deposit of about $50. ($3 in gas; about 5 minutes)', gas: 3, pct: 0.003, mins: 5 },
    { text: 'Try a second native app on {chain}, such as a lending market or a liquid-staking pool, with another $50. ($3 in gas; about 10 minutes)', gas: 3, pct: 0, mins: 10 },
    { text: 'Make one on-chain transaction a week on {chain} — a swap, a deposit or a vote — and keep the wallet active for at least {hold} days. (about $2 in gas a week for the first month; 10 minutes a week)', gas: 8, pct: 0, mins: 40 },
    { text: 'Before withdrawing, open {name}\u2019s own points or rewards page and claim only from a link it publishes; keep every transaction hash as proof of activity. (no fee to check; about 10 minutes)', gas: 0, pct: 0, mins: 10 },
  ],
  generic: [
    { text: 'Set up a fresh wallet on {chain} that holds only the funds you plan to farm, and write its seed phrase on paper, never in a screenshot. ($3 in gas; about 10 minutes)', gas: 3, pct: 0, mins: 10 },
    { text: 'Bridge {capital} of USDC to {chain} through the official bridge, inside the {range} band for a protocol of this size. ($5 in gas; about 10 minutes)', gas: 5, pct: 0, mins: 10 },
    { text: 'Deposit the {capital} of USDC into {name} on {chain} and keep the position open. ($4 in gas; about 5 minutes)', gas: 4, pct: 0, mins: 5 },
    { text: 'Use {name} once for its core action — a payment, a deposit or a vote — with about $50, so the wallet shows more than a single deposit. ($3 in gas; about 10 minutes)', gas: 3, pct: 0, mins: 10 },
    { text: 'Repeat the core action once a week and hold a position for at least {hold} days, so the activity spans several weeks. (about $2 in gas a week for the first month; 10 minutes a week)', gas: 8, pct: 0, mins: 40 },
    { text: 'Before withdrawing, open {name}\u2019s own points or rewards page and claim only from a link it publishes; keep every transaction hash as proof of activity. (no fee to check; about 10 minutes)', gas: 0, pct: 0, mins: 10 },
  ],
};

/** How much capital one farm position needs, from the protocol's own TVL tier. */
export function capitalTier(tvlUsd: number): { capital: string; range: string } {
  if (tvlUsd >= 500_000_000) return { capital: '$1,500', range: '$1,000–$2,500' };
  if (tvlUsd >= 100_000_000) return { capital: '$750', range: '$500–$1,000' };
  if (tvlUsd >= 50_000_000) return { capital: '$350', range: '$250–$500' };
  return { capital: '$175', range: '$100–$250' };
}

/** The template group a category belongs to. */
export function groupFor(category: string | null): string {
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
export function farmPlan(p: SnapshotProtocol, ageDaysValue: number | null): { steps: string[]; costGas: number; costPct: number; hours: number } {
  const tier = capitalTier(p.tvl_usd);
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const values: Record<string, string> = {
    name: p.name,
    chain,
    capital: tier.capital,
    range: tier.range,
    hold: String(holdDaysFor(ageDaysValue)),
    small: '$25',
  };
  const templates = FARM_TEMPLATES[groupFor(p.category)] ?? FARM_TEMPLATES.generic!;
  const steps = templates.map((t) => {
    let step = fill(t.text, values).trim();
    if (step.length > 600) {
      step = `${step.slice(0, 597).replace(/\s+\S*$/, '')}...`;
    }
    if (step.length < 20) step = `${step} Keep the transaction hashes as proof of activity.`;
    return step;
  });
  return {
    steps,
    costGas: templates.reduce((s, t) => s + t.gas, 0),
    costPct: templates.reduce((s, t) => s + t.pct, 0),
    hours: Math.round((templates.reduce((s, t) => s + t.mins, 0) / 60) * 100) / 100,
  };
}

/** The template group and steps the dashboard's app.js derives — kept in sync with farmPlan. */
export function farmSteps(p: SnapshotProtocol, ageDaysValue: number | null): string[] {
  return farmPlan(p, ageDaysValue).steps;
}

// ---------------------------------------------------------------- the board

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(
  snapshot: Snapshot,
  model: FittedModel,
  bands: Map<string, { p10: number; p25: number; p75: number; p90: number; rank_lo: number; rank_hi: number }>,
): BoardRow[] {
  const watchlist = new Set(snapshot.watchlist);
  const ranked = snapshot.protocols.filter((p) => isPreToken(p) && setAsideReason(p) === null);
  const scored = ranked.map((p) => {
    const { implied, breakdown } = impliedValue(p, model, snapshot.as_of);
    return { p, implied, breakdown };
  });
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => {
    const band = bands.get(s.p.slug)!;
    const plan = farmPlan(s.p, s.breakdown.age_days);
    const odds = launchOdds(s.p, snapshot.as_of, watchlist);
    const farmers = farmerCount(s.p);
    const econ = (deposit: number): FarmEconomics =>
      farmEconomics(s.implied, farmers, plan.costGas, plan.costPct, plan.hours, odds, deposit);
    return {
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
      band_p10_usd: band.p10,
      band_p25_usd: band.p25,
      band_p75_usd: band.p75,
      band_p90_usd: band.p90,
      rank_lo: band.rank_lo,
      rank_hi: band.rank_hi,
      launch_odds: odds,
      farmers,
      farm_hours: plan.hours,
      farm_cost_gas_usd: plan.costGas,
      farm_cost_pct: Math.round(plan.costPct * 1e6) / 1e6,
      farm_1000: econ(1000),
      farm_10000: econ(10000),
      farm_steps: plan.steps,
    };
  });
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

/** The set-aside accounting: every pre-token protocol not ranked, grouped by reason. */
export function setAsideRows(snapshot: Snapshot): SetAsideRow[] {
  const byReason = new Map<string, string[]>();
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) continue;
    const reason = setAsideReason(p);
    if (reason === null) continue;
    const list = byReason.get(reason) ?? [];
    list.push(p.slug);
    byReason.set(reason, list);
  }
  return [...byReason.entries()]
    .map(([reason, slugs]) => ({ reason, count: slugs.length, examples: slugs.slice(0, 3) }))
    .sort((a, b) => b.count - a.count || (a.reason < b.reason ? -1 : 1));
}

/** Everything the dashboard needs, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const points = fitPoints(snapshot);
  const model = fitModel(points);
  const ranked = snapshot.protocols.filter((p) => isPreToken(p) && setAsideReason(p) === null);
  const { bands, curve } = bootstrapBands(points, ranked, snapshot.as_of);
  const board = buildBoard(snapshot, model, bands);
  const peers = buildPeers(snapshot);
  const loo = looCheck(points, snapshot.as_of);
  const walkForward = walkForwardCheck(points, snapshot.as_of);
  const flat = flatMultipleCheck(points);
  const setAside = setAsideRows(snapshot);
  const counts = (key: 'farm_1000' | 'farm_10000'): { FARM: number; MARGINAL: number; SKIP: number } => {
    const c = { FARM: 0, MARGINAL: 0, SKIP: 0 };
    for (const r of board) c[r[key].verdict]++;
    return c;
  };
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    total_implied_usd: board.reduce((n, r) => n + r.implied_value_usd, 0),
    chain_count: new Set(board.flatMap((r) => r.chains)).size,
    fit: {
      intercept: Math.round(model.a * 1000) / 1000,
      slope: Math.round(model.b * 1000) / 1000,
      n: points.length,
      excluded_categories: [...FIT_EXCLUDED_CATEGORIES].sort(),
      curve,
    },
    validation: {
      loo,
      walk_forward: walkForward,
      flat_multiple: flat,
      bootstrap_refits: MODEL.bootstrap_refits,
    },
    accounting: {
      total: snapshot.protocols.length,
      ranked: board.length,
      already_trade: snapshot.protocols.filter((p) => p.mcap_usd !== null).length,
      token_recorded_no_mcap: snapshot.protocols.filter((p) => p.mcap_usd === null && (p.gecko_id !== null || p.symbol !== null)).length,
      set_aside: setAside.reduce((n, r) => n + r.count, 0),
      set_aside_rows: setAside,
    },
    verdict_counts: { '1000': counts('farm_1000'), '10000': counts('farm_10000') },
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
    if (!(r.band_p10_usd <= r.implied_value_usd && r.implied_value_usd <= r.band_p90_usd)) return `${r.slug} has its implied value outside its P10-P90 band`;
    if (!(r.rank_lo <= r.rank && r.rank <= r.rank_hi)) return `${r.slug} has its rank outside its rank range`;
  }
  return null;
}

/** A data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
