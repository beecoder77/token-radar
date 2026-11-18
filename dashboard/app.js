// Token Radar — the dashboard's own code. It reads window.RADAR (data.js,
// written beside this page by main.ts) and renders the board from it.
// The farm-plan templates below are the same table lib/radar.ts uses, so
// this page shows the plan its own code derives: farmSteps(row) must
// reproduce board.json's farm_steps for every row, and econFor(row, dep)
// must reproduce its farm economics at each deposit size. The seal line
// at the top of the page checks both, in the browser, every load.

/* global window, document, location, performance */

var DATA = (typeof window !== 'undefined' && window.RADAR) ? window.RADAR : null;
var rows = DATA ? DATA.rows : [];
var bySlug = new Map(rows.map(function (r) { return [r.slug, r]; }));

/** Dollars, compact: $67.3M, $1.94M, $812K, $420. */
function usd(v) {
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(v >= 1e8 ? 0 : 1) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(v >= 1e5 ? 0 : 1) + 'K';
  return '$' + Math.round(v);
}

/** Dollars, full: $67,268,045. */
function usdFull(v) {
  return '$' + Math.round(v).toLocaleString('en-US');
}

/** A percent with one decimal, or an em dash when null. */
function pct(v) {
  return v === null || v === undefined ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
}

/** An age in days as "2.1y", "312d" or an em dash when unknown. */
function ageStr(days) {
  if (days === null || days === undefined) return '—';
  if (days >= 365) return (days / 365).toFixed(1) + 'y';
  return days + 'd';
}

/** Escape text for HTML. */
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------- farm plans

/** [text, gas $, share of deposit spent as a fee, active minutes] per step. */
var TEMPLATES = {
  dexs: [
    ['Set up a fresh wallet on {chain} that holds only the funds you plan to farm, and write its seed phrase on paper, never in a screenshot. ($3 in gas; about 10 minutes)', 3, 0, 10],
    ['Bridge {capital} of USDC to {chain} through the official bridge, inside the {range} band for a protocol of this size. ($5 in gas; about 10 minutes)', 5, 0, 10],
    ['Swap half of the USDC for the pool’s paired asset on {name}’s {chain} swap, at about 0.3% in fees. ($4 in gas; about 5 minutes)', 4, 0.003, 5],
    ['Add the full {capital} as liquidity to {name}’s main pool on {chain} and keep the LP position open. ($5 in gas; about 5 minutes)', 5, 0, 5],
    ['Route one swap a week through {name} instead of an aggregator, so the wallet shows repeat volume, and hold the LP position for at least {hold} days. (about $2 in gas a week for the first month; 10 minutes a week)', 8, 0, 40],
    ['Before withdrawing, open {name}’s own points or rewards page and claim only from a link it publishes; keep every transaction hash as proof of activity. (no fee to check; about 10 minutes)', 0, 0, 10],
  ],
  lending: [
    ['Set up a fresh wallet on {chain} that holds only the funds you plan to farm, and write its seed phrase on paper, never in a screenshot. ($3 in gas; about 10 minutes)', 3, 0, 10],
    ['Bridge {capital} of USDC to {chain} through the official bridge, inside the {range} band for a protocol of this size. ($5 in gas; about 10 minutes)', 5, 0, 10],
    ['Supply the {capital} of USDC as collateral on {name} on {chain} and keep the deposit open. ($4 in gas; about 5 minutes)', 4, 0, 5],
    ['Borrow a small amount, about $50 of the paired asset, against the deposit, then repay it in full the same week. ($5 in gas; about 10 minutes)', 5, 0, 10],
    ['Top up or adjust the collateral once a week, keep the health factor above 2, and hold the position for at least {hold} days. (about $2 in gas a week for the first month; 10 minutes a week)', 8, 0, 40],
    ['Before withdrawing, open {name}’s own points or rewards page and claim only from a link it publishes; keep every transaction hash as proof of activity. (no fee to check; about 10 minutes)', 0, 0, 10],
  ],
  cdp: [
    ['Set up a fresh wallet on {chain} that holds only the funds you plan to farm, and write its seed phrase on paper, never in a screenshot. ($3 in gas; about 10 minutes)', 3, 0, 10],
    ['Bridge {capital} of USDC to {chain} through the official bridge, inside the {range} band for a protocol of this size. ($5 in gas; about 10 minutes)', 5, 0, 10],
    ['Lock the {capital} of collateral in a {name} vault on {chain} and mint a small amount of its stable asset, well under the safe ratio. ($5 in gas; about 5 minutes)', 5, 0, 5],
    ['Repay part of the minted stable asset, then mint again, so the vault shows two-way activity instead of a single deposit. ($5 in gas; about 10 minutes)', 5, 0, 10],
    ['Check the vault’s collateral ratio weekly, top it up before it drifts near liquidation, and hold the vault for at least {hold} days. (about $2 in gas a week for the first month; 10 minutes a week)', 8, 0, 40],
    ['Before withdrawing, open {name}’s own points or rewards page and claim only from a link it publishes; keep every transaction hash as proof of activity. (no fee to check; about 10 minutes)', 0, 0, 10],
  ],
  yield: [
    ['Set up a fresh wallet on {chain} that holds only the funds you plan to farm, and write its seed phrase on paper, never in a screenshot. ($3 in gas; about 10 minutes)', 3, 0, 10],
    ['Bridge {capital} of USDC to {chain} through the official bridge, inside the {range} band for a protocol of this size. ($5 in gas; about 10 minutes)', 5, 0, 10],
    ['Deposit the {capital} of USDC into {name}’s highest-TVL vault on {chain} and keep the vault shares in the farming wallet. ($4 in gas; about 5 minutes)', 4, 0, 5],
    ['Claim any vault rewards that accrue and re-deposit them into the same vault instead of withdrawing. ($4 in gas; about 5 minutes)', 4, 0, 5],
    ['When {name} rotates to a new epoch or strategy, move the deposit across about once a month, and hold a position for at least {hold} days. (about $2 in gas a week for the first month; 10 minutes a week)', 8, 0, 40],
    ['Before withdrawing, open {name}’s own points or rewards page and claim only from a link it publishes; keep every transaction hash as proof of activity. (no fee to check; about 10 minutes)', 0, 0, 10],
  ],
  rwa: [
    ['Set up a fresh wallet on {chain} that holds only the funds you plan to farm, and write its seed phrase on paper, never in a screenshot. ($3 in gas; about 10 minutes)', 3, 0, 10],
    ['Bridge {capital} of USDC to {chain} through the official bridge, inside the {range} band for a protocol of this size. ($5 in gas; about 10 minutes)', 5, 0, 10],
    ['Mint or buy {capital} of {name}’s yield-bearing asset on {chain} and hold it in the farming wallet. ($6 in gas; about 10 minutes)', 6, 0.002, 10],
    ['Claim the yield the asset accrues and keep the claim transactions as proof of activity. ($4 in gas; about 5 minutes)', 4, 0, 5],
    ['Check the asset’s backing report or attestation page monthly, and hold the asset for at least {hold} days; exit if the backing stops being published. (about $2 in gas a week for the first month; 10 minutes a week)', 8, 0, 40],
    ['Before withdrawing, open {name}’s own points or rewards page and claim only from a link it publishes; keep every transaction hash as proof of activity. (no fee to check; about 10 minutes)', 0, 0, 10],
  ],
  derivatives: [
    ['Set up a fresh wallet on {chain} that holds only the funds you plan to farm, and write its seed phrase on paper, never in a screenshot. ($3 in gas; about 10 minutes)', 3, 0, 10],
    ['Bridge {capital} of USDC to {chain} through the official bridge, inside the {range} band for a protocol of this size. ($5 in gas; about 10 minutes)', 5, 0, 10],
    ['Deposit the {capital} of USDC as margin on {name} on {chain}. ($4 in gas; about 5 minutes)', 4, 0, 5],
    ['Open one small hedged position of about $50 notional and close it within the week; never leave a leveraged position open unattended. ($5 in gas; about 10 minutes)', 5, 0.001, 10],
    ['Place one small position a week and close it the same week, keeping the margin deposit in place for at least {hold} days. (about $2 in gas a week for the first month; 10 minutes a week)', 8, 0, 40],
    ['Before withdrawing, open {name}’s own points or rewards page and claim only from a link it publishes; keep every transaction hash as proof of activity. (no fee to check; about 10 minutes)', 0, 0, 10],
  ],
  prediction: [
    ['Set up a fresh wallet on {chain} that holds only the funds you plan to farm, and write its seed phrase on paper, never in a screenshot. ($3 in gas; about 10 minutes)', 3, 0, 10],
    ['Bridge {capital} of USDC to {chain} through the official bridge, inside the {range} band for a protocol of this size. ($5 in gas; about 10 minutes)', 5, 0, 10],
    ['Fund the wallet with the {capital} and buy one small position, about $25, in an active market on {name}. ($3 in gas; about 5 minutes)', 3, 0, 5],
    ['Resolve or sell the position when its market closes, then open one more small position in a different market. ($3 in gas; about 10 minutes)', 3, 0, 10],
    ['Place one small position a week and keep the wallet funded for at least {hold} days, so the activity spans several market cycles. (about $2 in gas a week for the first month; 10 minutes a week)', 8, 0, 40],
    ['Before withdrawing, open {name}’s own points or rewards page and claim only from a link it publishes; keep every transaction hash as proof of activity. (no fee to check; about 10 minutes)', 0, 0, 10],
  ],
  staking: [
    ['Set up a fresh wallet on {chain} that holds only the funds you plan to farm, and write its seed phrase on paper, never in a screenshot. ($3 in gas; about 10 minutes)', 3, 0, 10],
    ['Bridge {capital} of the chain’s native asset to {chain} through the official bridge, inside the {range} band for a protocol of this size. ($5 in gas; about 10 minutes)', 5, 0, 10],
    ['Stake the {capital} through {name} on {chain} and keep the receipt token in the farming wallet. ($4 in gas; about 5 minutes)', 4, 0, 5],
    ['Delegate the receipt token to a second validator or restaking pool that {name} lists, if it offers one. ($4 in gas; about 5 minutes)', 4, 0, 5],
    ['Claim staking rewards weekly, re-stake them through {name}, and hold the stake for at least {hold} days. (about $2 in gas a week for the first month; 10 minutes a week)', 8, 0, 40],
    ['Before withdrawing, open {name}’s own points or rewards page and claim only from a link it publishes; keep every transaction hash as proof of activity. (no fee to check; about 10 minutes)', 0, 0, 10],
  ],
  chain: [
    ['Set up a fresh wallet on {chain} that holds only the funds you plan to farm, and write its seed phrase on paper, never in a screenshot. ($3 in gas; about 10 minutes)', 3, 0, 10],
    ['Bridge {capital} of USDC to {chain} through the official bridge, inside the {range} band for a protocol of this size, and hold it in the farming wallet for the first week. ($5 in gas; about 10 minutes)', 5, 0, 10],
    ['Use {name}’s native DEX or lending app on {chain} for one swap or deposit of about $50. ($3 in gas; about 5 minutes)', 3, 0.003, 5],
    ['Try a second native app on {chain}, such as a lending market or a liquid-staking pool, with another $50. ($3 in gas; about 10 minutes)', 3, 0, 10],
    ['Make one on-chain transaction a week on {chain} — a swap, a deposit or a vote — and keep the wallet active for at least {hold} days. (about $2 in gas a week for the first month; 10 minutes a week)', 8, 0, 40],
    ['Before withdrawing, open {name}’s own points or rewards page and claim only from a link it publishes; keep every transaction hash as proof of activity. (no fee to check; about 10 minutes)', 0, 0, 10],
  ],
  generic: [
    ['Set up a fresh wallet on {chain} that holds only the funds you plan to farm, and write its seed phrase on paper, never in a screenshot. ($3 in gas; about 10 minutes)', 3, 0, 10],
    ['Bridge {capital} of USDC to {chain} through the official bridge, inside the {range} band for a protocol of this size. ($5 in gas; about 10 minutes)', 5, 0, 10],
    ['Deposit the {capital} of USDC into {name} on {chain} and keep the position open. ($4 in gas; about 5 minutes)', 4, 0, 5],
    ['Use {name} once for its core action — a payment, a deposit or a vote — with about $50, so the wallet shows more than a single deposit. ($3 in gas; about 10 minutes)', 3, 0, 10],
    ['Repeat the core action once a week and hold a position for at least {hold} days, so the activity spans several weeks. (about $2 in gas a week for the first month; 10 minutes a week)', 8, 0, 40],
    ['Before withdrawing, open {name}’s own points or rewards page and claim only from a link it publishes; keep every transaction hash as proof of activity. (no fee to check; about 10 minutes)', 0, 0, 10],
  ],
};

function groupFor(category) {
  var c = (category || '').toLowerCase();
  if (c.indexOf('dex') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('liquidity manager') >= 0 || c === 'farm') return 'dexs';
  if (c.indexOf('lend') >= 0 || c.indexOf('collateral') >= 0) return 'lending';
  if (c.indexOf('cdp') >= 0) return 'cdp';
  if (c.indexOf('yield') >= 0 || c.indexOf('risk curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('basis trading') >= 0 || c.indexOf('index') >= 0) return 'yield';
  if (c.indexOf('rwa') >= 0 || c.indexOf('cedefi') >= 0 || c.indexOf('stablecoin') >= 0 || c.indexOf('token locker') >= 0) return 'rwa';
  if (c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'derivatives';
  if (c.indexOf('prediction') >= 0) return 'prediction';
  if (c.indexOf('staking') >= 0 || c.indexOf('restaking') >= 0) return 'staking';
  if (c === 'chain') return 'chain';
  return 'generic';
}

function capitalTier(tvl) {
  if (tvl >= 500000000) return { capital: '$1,500', range: '$1,000–$2,500' };
  if (tvl >= 100000000) return { capital: '$750', range: '$500–$1,000' };
  if (tvl >= 50000000) return { capital: '$350', range: '$250–$500' };
  return { capital: '$175', range: '$100–$250' };
}

function holdDaysFor(age) {
  if (age === null || age === undefined) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function fill(template, values) {
  var out = template;
  for (var key in values) out = out.split('{' + key + '}').join(values[key]);
  return out;
}

/** A row's farm plan, derived here from the same templates as the model. */
function farmSteps(row) {
  var tier = capitalTier(row.tvl_usd);
  var chain = row.chains.length > 0 ? row.chains[0] : 'its main chain';
  var values = {
    name: row.name,
    chain: chain,
    capital: tier.capital,
    range: tier.range,
    hold: String(holdDaysFor(row.age_days)),
    small: '$25',
  };
  var templates = TEMPLATES[groupFor(row.category)] || TEMPLATES.generic;
  return templates.map(function (t) {
    var step = fill(t[0], values).trim();
    if (step.length > 600) step = step.slice(0, 597).replace(/\s+\S*$/, '') + '...';
    if (step.length < 20) step = step + ' Keep the transaction hashes as proof of activity.';
    return step;
  });
}

// ---------------------------------------------------------------- farm economics

/** A row's farm economics at a deposit size, recomputed here from its primitives. */
function econFor(row, deposit) {
  var cost = Math.round((row.farm_cost_gas_usd + row.farm_cost_pct * deposit) * 100) / 100;
  var slice = Math.round(((0.05 * row.implied_value_usd * Math.sqrt(deposit / 25000)) / row.farmers) * 100) / 100;
  var net = Math.round((slice - cost) * 100) / 100;
  var netPerHour = Math.round((net / Math.max(row.farm_hours, 0.01)) * 100) / 100;
  var breakeven = Math.round((cost / Math.max(slice, 0.01)) * 1000) / 1000;
  var verdict = row.launch_odds >= breakeven * 1.5 && netPerHour >= 20 ? 'FARM'
    : row.launch_odds >= breakeven ? 'MARGINAL' : 'SKIP';
  return { deposit_usd: deposit, cost_usd: cost, slice_usd: slice, net_usd: net, net_per_hour_usd: netPerHour, breakeven_odds: breakeven, verdict: verdict };
}

function econKey(deposit) {
  return deposit === 1000 ? 'farm_1000' : 'farm_10000';
}

// ---------------------------------------------------------------- state

var state = { q: '', cat: '', chain: '', tvl: 0, verdict: '', watch: false, deposit: 1000, sort: 'rank', dir: 1 };

function $(id) {
  return document.getElementById(id);
}

function pill(v) {
  return '<span class="pill ' + v.toLowerCase() + '">' + v + '</span>';
}

// ---------------------------------------------------------------- seal: board.json = this page

/** Verify, in the browser, that this page is the board: ranks 1..N in
 * order, values non-increasing, farm steps and economics reproduced by
 * this file's own code for every row, verdict counts matching. */
function sealCheck() {
  var t0 = performance.now();
  var problems = [];
  var n = rows.length;
  var total = 0;
  var stepsOk = 0;
  var econOk = 0;
  for (var i = 0; i < n; i++) {
    var r = rows[i];
    if (r.rank !== i + 1) problems.push('rank ' + r.rank + ' at position ' + (i + 1));
    if (i > 0 && r.implied_value_usd > rows[i - 1].implied_value_usd) problems.push('value rises at rank ' + r.rank);
    total += r.implied_value_usd;
    var mine = farmSteps(r);
    if (mine.length === r.farm_steps.length && mine.every(function (s, j) { return s === r.farm_steps[j]; })) stepsOk++;
    var e1 = econFor(r, 1000);
    var e2 = econFor(r, 10000);
    var b1 = r.farm_1000;
    var b2 = r.farm_10000;
    if (e1.cost_usd === b1.cost_usd && e1.slice_usd === b1.slice_usd && e1.net_usd === b1.net_usd &&
      e1.net_per_hour_usd === b1.net_per_hour_usd && e1.breakeven_odds === b1.breakeven_odds && e1.verdict === b1.verdict &&
      e2.cost_usd === b2.cost_usd && e2.slice_usd === b2.slice_usd && e2.net_usd === b2.net_usd &&
      e2.net_per_hour_usd === b2.net_per_hour_usd && e2.breakeven_odds === b2.breakeven_odds && e2.verdict === b2.verdict) econOk++;
  }
  var counts = { FARM: 0, MARGINAL: 0, SKIP: 0 };
  rows.forEach(function (r) { counts[r[econKey(state.deposit)].verdict]++; });
  var meta = DATA.verdict_counts[String(state.deposit)];
  var countsOk = counts.FARM === meta.FARM && counts.MARGINAL === meta.MARGINAL && counts.SKIP === meta.SKIP;
  if (stepsOk !== n) problems.push('farm steps differ on ' + (n - stepsOk) + ' rows');
  if (econOk !== n) problems.push('farm economics differ on ' + (n - econOk) + ' rows');
  if (!countsOk) problems.push('verdict counts differ');
  if (total !== DATA.total_implied_usd) problems.push('total implied value differs');
  var ms = Math.round(performance.now() - t0);
  var seal = $('seal');
  if (problems.length === 0) {
    seal.innerHTML = '<b>board.json = this page:</b> ' + n + '/' + n + ' rows, ranks 1..' + n +
      ', steps + economics reproduced for ' + n + '/' + n + ' rows, FARM ' + counts.FARM +
      ' / MARGINAL ' + counts.MARGINAL + ' / SKIP ' + counts.SKIP + ' @ $' + state.deposit.toLocaleString('en-US') +
      ', total implied ' + usd(total) + ' — re-checked in the browser in ' + ms + ' ms.';
    seal.classList.remove('bad');
  } else {
    seal.innerHTML = '<b>This page does not match board.json:</b> ' + esc(problems.slice(0, 3).join('; ')) + '.';
    seal.classList.add('bad');
  }
}

// ---------------------------------------------------------------- header, accounting, validation

function renderStats() {
  var items = [
    ['Snapshot', DATA.as_of],
    ['Ranked', String(DATA.board_size)],
    ['Watchlist', String(DATA.watchlist_size)],
    ['Chains', String(DATA.chain_count)],
    ['Total implied value', usd(DATA.total_implied_usd)],
  ];
  var dl = $('stats');
  items.forEach(function (it, i) {
    var wrap = document.createElement('div');
    var dt = document.createElement('dt');
    dt.textContent = it[0];
    var dd = document.createElement('dd');
    dd.textContent = it[1];
    if (i === 4) dd.className = 'gold';
    wrap.appendChild(dt);
    wrap.appendChild(dd);
    dl.appendChild(wrap);
  });
}

function renderAccounting() {
  var a = DATA.accounting;
  $('accounting-strip').innerHTML =
    '<b>' + a.total + ' protocols:</b> ' + a.ranked + ' ranked · ' + a.already_trade + ' already trade · ' +
    a.token_recorded_no_mcap + ' token recorded, no market cap · ' + a.set_aside + ' set aside — ' +
    a.ranked + ' + ' + a.already_trade + ' + ' + a.token_recorded_no_mcap + ' + ' + a.set_aside + ' = ' + a.total + '.';
  $('accounting-line').innerHTML =
    '<b>' + a.total + ' protocols</b> in the sealed snapshot: <b>' + a.ranked + ' ranked</b> here, ' +
    '<b>' + a.already_trade + '</b> already trade a token (they anchor the curve, never the board), ' +
    '<b>' + a.token_recorded_no_mcap + '</b> record a token but no market cap, and ' +
    '<b>' + a.set_aside + '</b> set aside with a reason. ' + a.ranked + ' + ' + a.already_trade + ' + ' +
    a.token_recorded_no_mcap + ' + ' + a.set_aside + ' = ' + a.total + '.';
  var tbody = document.querySelector('#accounting-table tbody');
  var lines = [
    ['Ranked — plausibly launching', a.ranked, 'Pre-token protocols that can plausibly launch, ranked by implied value. All ' + DATA.watchlist_size + ' watchlist protocols are in this bucket.'],
    ['Already trades a token', a.already_trade, 'A market cap is recorded. These 90 in launchable categories are the curve’s fit; the rest (exchanges, bridges, liquid staking) are left out of the fit.'],
    ['Token recorded, no market cap', a.token_recorded_no_mcap, 'DefiLlama records a token id or symbol but no market cap, so the radar cannot price them — and cannot claim they have no token.'],
  ];
  a.set_aside_rows.forEach(function (r) {
    lines.push(['Set aside — ' + r.reason, r.count, 'e.g. ' + r.examples.join(', ') + ' — almost certainly never issues a token of its own.']);
  });
  lines.forEach(function (l) {
    var tr = document.createElement('tr');
    var c0 = document.createElement('td');
    c0.textContent = l[0];
    var c1 = document.createElement('td');
    c1.className = 'num';
    c1.textContent = String(l[1]);
    var c2 = document.createElement('td');
    c2.textContent = l[2];
    tr.appendChild(c0);
    tr.appendChild(c1);
    tr.appendChild(c2);
    tbody.appendChild(tr);
  });
}

function renderValidation() {
  var v = DATA.validation;
  var f = DATA.fit;
  $('fit-eq').textContent = 'log10(mcap) = ' + f.intercept.toFixed(3) + ' + ' + f.slope.toFixed(3) + '·log10(TVL)';
  $('fit-line').innerHTML =
    'The curve is a Huber fit of <b>log10(market cap) = ' + f.intercept.toFixed(3) + ' + ' + f.slope.toFixed(3) +
    ' · log10(TVL)</b> on <b>' + f.n + ' traded protocols</b> in launchable categories ' +
    '(exchanges, bridges and liquid-staking tokens are left out — their caps price a different thing). ' +
    'A 10× larger TVL is worth only ×' + Math.pow(10, f.slope).toFixed(1) + ' as much; each row adds a shrunk category offset (≤ ±0.3 dex), a growth, seasoning and chain term.';
  var cells = [
    ['Leave-one-out, median miss', v.loo.median_miss + '×', Math.round(v.loo.within_3x * 100) + '% within 3× · rank corr. ' + v.loo.rank_corr.toFixed(2) + ' · n=' + v.loo.n],
    ['Holdout caps in the bands', Math.round(v.loo.in_p25_p75 * 100) + '% / ' + Math.round(v.loo.in_p10_p90 * 100) + '%', 'in the printed P25–P75 / P10–P90 bands (expect ~50% / ~80%)'],
    ['Walk-forward, median miss', v.walk_forward.median_miss + '×', Math.round(v.walk_forward.within_3x * 100) + '% within 3× · rank corr. ' + v.walk_forward.rank_corr.toFixed(2) + ' · train ' + v.walk_forward.train + ' / test ' + v.walk_forward.test + ', cut ' + v.walk_forward.cut],
    ['One flat multiple, median miss', v.flat_multiple.median_miss + '×', 'same leave-one-out test with a single median mcap/TVL'],
  ];
  var grid = $('valgrid');
  cells.forEach(function (c) {
    var wrap = document.createElement('div');
    var dt = document.createElement('dt');
    dt.textContent = c[0];
    var dd = document.createElement('dd');
    dd.textContent = c[1];
    var sm = document.createElement('small');
    sm.textContent = c[2];
    dd.appendChild(sm);
    wrap.appendChild(dt);
    wrap.appendChild(dd);
    grid.appendChild(wrap);
  });
  renderChart();
  $('chart-note').textContent =
    'Blue = traded tokens (the fit); gold = pre-token implied values. The band is the curve’s wobble only — each row’s P10–P90 band also carries protocol scatter, so it is wider.';
}

// ---------------------------------------------------------------- scatter chart

function renderChart() {
  var W = 760;
  var H = 240;
  var L = 52;
  var Rr = 12;
  var T = 14;
  var B = 34;
  var x0 = Math.log10(5e6);
  var x1 = Math.log10(2e10);
  var y0 = Math.log10(3e5);
  var y1 = Math.log10(2e9);
  function X(tvl) {
    return L + ((Math.log10(Math.max(tvl, 5e6)) - x0) / (x1 - x0)) * (W - L - Rr);
  }
  function Y(v) {
    return T + (1 - (Math.log10(Math.max(v, 3e5)) - y0) / (y1 - y0)) * (H - T - B);
  }
  var s = '';
  s += '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Scatter chart: traded tokens and implied values against TVL, with the fitted curve">';
  [5e6, 5e7, 5e8, 5e9].forEach(function (t) {
    s += '<line class="grid" x1="' + X(t).toFixed(1) + '" y1="' + T + '" x2="' + X(t).toFixed(1) + '" y2="' + (H - B) + '"/>';
    s += '<text class="tick" x="' + X(t).toFixed(1) + '" y="' + (H - B + 16) + '" text-anchor="middle">' + usd(t) + ' TVL</text>';
  });
  [1e6, 1e7, 1e8, 1e9].forEach(function (v) {
    s += '<line class="grid" x1="' + L + '" y1="' + Y(v).toFixed(1) + '" x2="' + (W - Rr) + '" y2="' + Y(v).toFixed(1) + '"/>';
    s += '<text class="tick" x="' + (L - 6) + '" y="' + (Y(v) + 3.5).toFixed(1) + '" text-anchor="end">' + usd(v) + '</text>';
  });
  s += '<text class="lbl" x="' + ((W + L) / 2) + '" y="' + (H - 2) + '" text-anchor="middle">TVL (log scale)</text>';
  s += '<text class="lbl" x="12" y="' + ((H + T - B) / 2) + '" text-anchor="middle" transform="rotate(-90 12 ' + ((H + T - B) / 2) + ')">market cap / implied value (log scale)</text>';
  var curve = DATA.fit.curve;
  var band = 'M' + curve.map(function (c) { return X(c.tvl_usd).toFixed(1) + ' ' + Y(c.p75_usd).toFixed(1); }).join(' L');
  band += ' L' + curve.slice().reverse().map(function (c) { return X(c.tvl_usd).toFixed(1) + ' ' + Y(c.p25_usd).toFixed(1); }).join(' L') + ' Z';
  s += '<path class="band" d="' + band + '"/>';
  s += '<path class="curve" d="M' + curve.map(function (c) { return X(c.tvl_usd).toFixed(1) + ' ' + Y(c.p50_usd).toFixed(1); }).join(' L') + '"/>';
  DATA.peers.forEach(function (p) {
    if (p.mcap_usd <= 0 || p.tvl_usd <= 0) return;
    s += '<circle class="pt-traded" cx="' + X(p.tvl_usd).toFixed(1) + '" cy="' + Y(p.mcap_usd).toFixed(1) + '" r="2.6"><title>' + esc(p.name) + ': TVL ' + usd(p.tvl_usd) + ', mcap ' + usd(p.mcap_usd) + '</title></circle>';
  });
  rows.forEach(function (r) {
    s += '<circle class="pt-ranked" cx="' + X(r.tvl_usd).toFixed(1) + '" cy="' + Y(r.implied_value_usd).toFixed(1) + '" r="2.6"><title>#' + r.rank + ' ' + esc(r.name) + ': TVL ' + usd(r.tvl_usd) + ', implied ' + usd(r.implied_value_usd) + '</title></circle>';
  });
  rows.slice(0, 3).forEach(function (r) {
    s += '<circle class="pt-top" cx="' + X(r.tvl_usd).toFixed(1) + '" cy="' + Y(r.implied_value_usd).toFixed(1) + '" r="4.5"><title>#' + r.rank + ' ' + esc(r.name) + '</title></circle>';
  });
  s += '</svg>';
  s += '<p class="legend"><span><i style="background:#7cc4ff"></i>traded token (fit)</span>' +
    '<span><i style="background:#ffd97a"></i>pre-token protocol (implied value)</span>' +
    '<span><i style="background:#f5b544;border-radius:0;height:3px;width:16px;vertical-align:2px"></i>fitted curve, P25–P75 band</span></p>';
  $('chart').innerHTML = s;
}

// ---------------------------------------------------------------- board table

function filteredRows() {
  var q = state.q.trim().toLowerCase();
  return rows.filter(function (r) {
    if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
    if (state.cat && (r.category || '(none)') !== state.cat) return false;
    if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
    if (r.tvl_usd < state.tvl) return false;
    if (state.verdict && r[econKey(state.deposit)].verdict !== state.verdict) return false;
    if (state.watch && !r.watchlist) return false;
    return true;
  });
}

function sortedRows(list) {
  var key = state.sort;
  var dir = state.dir;
  return list.slice().sort(function (a, b) {
    var av = key === 'verdict' ? a[econKey(state.deposit)].verdict : a[key];
    var bv = key === 'verdict' ? b[econKey(state.deposit)].verdict : b[key];
    if (key === 'chains') { av = a.chains.join(', '); bv = b.chains.join(', '); }
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    if (typeof av === 'string') return av.localeCompare(bv) * dir;
    if (av !== bv) return (av - bv) * dir;
    return a.rank - b.rank;
  });
}

function renderBoard() {
  var list = sortedRows(filteredRows());
  var tbody = $('rows');
  tbody.innerHTML = '';
  $('count').textContent = list.length + ' of ' + rows.length + ' protocols';
  if (list.length === 0) {
    var tr0 = document.createElement('tr');
    var td0 = document.createElement('td');
    td0.colSpan = 11;
    td0.className = 'empty';
    td0.textContent = 'No protocol matches these filters.';
    tr0.appendChild(td0);
    tbody.appendChild(tr0);
    return;
  }
  list.forEach(function (r) {
    var tr = document.createElement('tr');
    tr.setAttribute('data-slug', r.slug);
    var cells = [
      ['num', String(r.rank)],
      ['name', null],
      [null, r.category || '—'],
      [null, r.chains.length > 1 ? r.chains[0] + ' +' + (r.chains.length - 1) : (r.chains[0] || '—')],
      ['num', usd(r.tvl_usd)],
      ['num ' + (r.change_7d === null ? 'dim' : r.change_7d >= 0 ? 'pos' : 'neg'), pct(r.change_7d)],
      ['num', ageStr(r.age_days)],
      ['num goldval', usd(r.implied_value_usd)],
      ['num dim', usd(r.band_p10_usd) + '–' + usd(r.band_p90_usd)],
      ['num', Math.round(r.launch_odds * 100) + '%'],
      ['num', null],
    ];
    cells.forEach(function (c, i) {
      var td = document.createElement('td');
      td.className = c[0] || '';
      if (i === 1) {
        var b = document.createElement('b');
        b.textContent = r.name;
        td.appendChild(b);
        if (r.watchlist) {
          var w = document.createElement('span');
          w.className = 'badge watch';
          w.textContent = 'Watchlist';
          td.appendChild(w);
        }
        var sl = document.createElement('span');
        sl.className = 'slug';
        sl.textContent = r.slug;
        td.appendChild(sl);
      } else if (i === 10) {
        td.innerHTML = pill(r[econKey(state.deposit)].verdict);
      } else {
        td.textContent = c[1];
      }
      tr.appendChild(td);
    });
    tr.addEventListener('click', function () { location.hash = '#/protocol/' + r.slug; });
    tbody.appendChild(tr);
  });
  document.querySelectorAll('#board thead th').forEach(function (th) {
    th.classList.toggle('sorted', th.getAttribute('data-sort') === state.sort);
    th.classList.toggle('desc', th.getAttribute('data-sort') === state.sort && state.dir < 0);
  });
}

function renderFilters() {
  var cats = {};
  var chains = {};
  rows.forEach(function (r) {
    cats[r.category || '(none)'] = true;
    r.chains.forEach(function (c) { chains[c] = true; });
  });
  var catSel = $('f-cat');
  catSel.appendChild(new Option('All categories', ''));
  Object.keys(cats).sort().forEach(function (c) { catSel.appendChild(new Option(c, c)); });
  var chainSel = $('f-chain');
  chainSel.appendChild(new Option('All chains', ''));
  Object.keys(chains).sort().forEach(function (c) { chainSel.appendChild(new Option(c, c)); });
}

// ---------------------------------------------------------------- detail view

function peersFor(row) {
  return DATA.peers
    .filter(function (p) { return p.category === row.category && p.mcap_usd > 0 && p.tvl_usd > 0; })
    .sort(function (a, b) { return b.mcap_usd - a.mcap_usd; })
    .slice(0, 5);
}

function renderDetail(slug) {
  var row = bySlug.get(slug);
  var boardView = $('board-view');
  var detailView = $('detail-view');
  if (!row) {
    boardView.hidden = false;
    detailView.hidden = true;
    detailView.innerHTML = '';
    return;
  }
  boardView.hidden = true;
  detailView.hidden = false;
  detailView.innerHTML = '';
  var back = document.createElement('a');
  back.className = 'back';
  back.href = '#';
  back.textContent = '← Back to the board';
  detailView.appendChild(back);
  var box = document.createElement('div');
  box.className = 'detail';
  var h2 = document.createElement('h2');
  h2.appendChild(document.createTextNode(row.name));
  var sl = document.createElement('span');
  sl.className = 'slug';
  sl.textContent = row.slug;
  h2.appendChild(sl);
  if (row.watchlist) {
    var w = document.createElement('span');
    w.className = 'badge watch';
    w.textContent = 'Watchlist';
    h2.appendChild(w);
  }
  box.appendChild(h2);
  var sub = document.createElement('p');
  sub.className = 'sub';
  sub.textContent = 'Rank #' + row.rank + ' of ' + rows.length + ' (rank range ' + row.rank_lo + '–' + row.rank_hi +
    ' across ' + DATA.validation.bootstrap_refits + ' refits) · ' + (row.category || 'no category') + ' · ' +
    row.chains.length + ' chain' + (row.chains.length === 1 ? '' : 's') + ' · Records no token' +
    (row.watchlist ? ' · On the snapshot watchlist' : '');
  box.appendChild(sub);

  box.appendChild(Object.assign(document.createElement('h3'), { textContent: 'Snapshot record' }));
  var kv = document.createElement('dl');
  kv.className = 'kv';
  [
    ['TVL', usdFull(row.tvl_usd)],
    ['7d change', pct(row.change_7d)],
    ['Listed', row.listed_at || 'not reported'],
    ['Age', row.age_days === null ? 'not reported' : row.age_days + ' days'],
    ['Chains', row.chains.join(', ') || '—'],
    ['Token', 'none recorded (no gecko id, no symbol, no market cap)'],
    ['Watchlist floor', usd(DATA.floor_usd)],
    ['Launch odds', Math.round(row.launch_odds * 100) + '%'],
  ].forEach(function (f) {
    var d = document.createElement('div');
    var dt = document.createElement('dt');
    dt.textContent = f[0];
    var dd = document.createElement('dd');
    dd.textContent = f[1];
    d.appendChild(dt);
    d.appendChild(dd);
    kv.appendChild(d);
  });
  box.appendChild(kv);

  box.appendChild(Object.assign(document.createElement('h3'), { textContent: 'Implied value — the working' }));
  var m = row.model;
  var off = Math.pow(10, m.offset_dex);
  var calc = [
    ['Curve: 10^(a + b·log10 TVL)', usdFull(m.curve_usd), 'The fitted size curve at this TVL.'],
    ['× category offset', '×' + off.toFixed(3) + (m.offset_dex >= 0 ? ' (+' : ' (') + m.offset_dex.toFixed(2) + ' dex)', m.offset_peers >= 3 ? 'Shrunk residual mean of ' + m.offset_peers + ' traded peers in ' + (row.category || 'this category') + '.' : 'Fewer than 3 traded peers in this category, so no offset.'],
    ['× growth', '×' + m.growth.toFixed(4), '7d TVL change ' + pct(row.change_7d) + ', clamped to −15%…+25%.'],
    ['× age', '×' + m.age.toFixed(4), row.age_days === null ? 'Listing date not reported, so no age boost.' : 'Listed ' + row.age_days + ' days ago: longer with no token, more pent-up value.'],
    ['× chains', '×' + m.chains_factor.toFixed(4), row.chains.length + ' chain' + (row.chains.length === 1 ? '' : 's') + '.'],
    ['Implied value', usdFull(row.implied_value_usd), 'P10–P90 band ' + usd(row.band_p10_usd) + ' – ' + usd(row.band_p90_usd) + ' (prediction interval over ' + DATA.validation.bootstrap_refits + ' refits).'],
  ];
  var table = document.createElement('table');
  table.className = 'plain';
  var thead = document.createElement('thead');
  var htr = document.createElement('tr');
  ['Step', 'Figure', 'Why'].forEach(function (t) {
    var th = document.createElement('th');
    th.textContent = t;
    htr.appendChild(th);
  });
  thead.appendChild(htr);
  table.appendChild(thead);
  var tbody = document.createElement('tbody');
  calc.forEach(function (c, i) {
    var tr = document.createElement('tr');
    var a = document.createElement('td');
    a.textContent = c[0];
    var b = document.createElement('td');
    b.textContent = c[1];
    if (i === calc.length - 1) b.className = 'goldval';
    var d = document.createElement('td');
    d.className = 'dim';
    d.textContent = c[2];
    tr.appendChild(a);
    tr.appendChild(b);
    tr.appendChild(d);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  box.appendChild(table);

  box.appendChild(Object.assign(document.createElement('h3'), { textContent: 'Farm economics — at a $' + state.deposit.toLocaleString('en-US') + ' deposit' }));
  var e = econFor(row, state.deposit);
  var et = document.createElement('table');
  et.className = 'plain';
  var ethead = document.createElement('thead');
  var ehtr = document.createElement('tr');
  ['Figure', 'Value', 'What it means'].forEach(function (t) {
    var th = document.createElement('th');
    th.textContent = t;
    ehtr.appendChild(th);
  });
  ethead.appendChild(ehtr);
  et.appendChild(ethead);
  var ebody = document.createElement('tbody');
  [
    ['Plan cost', usdFull(e.cost_usd), 'Gas across the steps below ($' + row.farm_cost_gas_usd + ') plus ' + (row.farm_cost_pct * 100).toFixed(1) + '% of the deposit in swap fees.'],
    ['Slice if it launches', usdFull(e.slice_usd), '5% of the implied value shared among an estimated ' + row.farmers.toLocaleString('en-US') + ' farmers (TVL / $25,000), scaled with the square root of the deposit.'],
    ['Net if it launches', (e.net_usd >= 0 ? '+' : '−') + usdFull(Math.abs(e.net_usd)), 'Slice minus plan cost.'],
    ['Net per active hour', (e.net_per_hour_usd >= 0 ? '+' : '−') + usdFull(Math.abs(e.net_per_hour_usd)) + ' / hour', 'Net spread over ' + row.farm_hours + ' active hours in the plan (holding weeks excluded).'],
    ['Break-even odds', Math.round(e.breakeven_odds * 100) + '%', 'The launch probability at which the plan breaks even. Above 100% it never does.'],
    ['Launch odds', Math.round(row.launch_odds * 100) + '%', 'Category base + watchlist, age, size and growth points (see the method panel).'],
    ['Verdict', e.verdict, e.verdict === 'FARM' ? 'Launch odds clear 1.5× break-even and the net clears $20 an active hour.' : e.verdict === 'MARGINAL' ? 'Launch odds clear break-even, but the margin is thin.' : 'The plan costs more than the launch odds justify — skip it.'],
  ].forEach(function (c, i) {
    var tr = document.createElement('tr');
    var a = document.createElement('td');
    a.textContent = c[0];
    var b = document.createElement('td');
    b.textContent = c[1];
    if (i === 6) b.innerHTML = pill(c[1]);
    else if (i === 2 || i === 3) b.className = e.net_usd >= 0 ? 'pos' : 'neg';
    var d = document.createElement('td');
    d.className = 'dim';
    d.textContent = c[2];
    tr.appendChild(a);
    tr.appendChild(b);
    tr.appendChild(d);
    ebody.appendChild(tr);
  });
  et.appendChild(ebody);
  box.appendChild(et);
  var depNote = document.createElement('p');
  depNote.className = 'note';
  depNote.textContent = 'Switch the deposit size at the top of the board and this panel re-prices: a bigger deposit buys a bigger slice, but also bigger swap fees.';
  box.appendChild(depNote);

  box.appendChild(Object.assign(document.createElement('h3'), { textContent: 'Farm plan — what to do' }));
  var ol = document.createElement('ol');
  ol.className = 'steps';
  farmSteps(row).forEach(function (s) {
    var li = document.createElement('li');
    li.textContent = s;
    ol.appendChild(li);
  });
  box.appendChild(ol);

  box.appendChild(Object.assign(document.createElement('h3'), { textContent: 'Comparable peers — token-bearing protocols in ' + (row.category || 'this category') }));
  var peers = peersFor(row);
  if (peers.length === 0) {
    var np = document.createElement('p');
    np.className = 'note';
    np.textContent = 'No token-bearing protocol in this category is in the snapshot, so this row carries no category offset.';
    box.appendChild(np);
  } else {
    var pt = document.createElement('table');
    pt.className = 'plain';
    var pthead = document.createElement('thead');
    var phtr = document.createElement('tr');
    ['Protocol', 'Market cap', 'TVL', 'mcap / TVL'].forEach(function (t, i) {
      var th = document.createElement('th');
      if (i > 0) th.className = 'num';
      th.textContent = t;
      phtr.appendChild(th);
    });
    pthead.appendChild(phtr);
    pt.appendChild(pthead);
    var ptbody = document.createElement('tbody');
    peers.forEach(function (p) {
      var tr = document.createElement('tr');
      var a = document.createElement('td');
      a.textContent = p.name;
      tr.appendChild(a);
      [usd(p.mcap_usd), usd(p.tvl_usd), (p.mcap_usd / p.tvl_usd).toFixed(3)].forEach(function (v) {
        var td = document.createElement('td');
        td.className = 'num';
        td.textContent = v;
        tr.appendChild(td);
      });
      ptbody.appendChild(tr);
    });
    pt.appendChild(ptbody);
    box.appendChild(pt);
    var pn = document.createElement('p');
    pn.className = 'note';
    pn.textContent = 'Top 5 by market cap in the category. The category offset is the shrunk mean of the log-residuals of all ' + m.offset_peers + ' traded peers in the category, not just these five.';
    box.appendChild(pn);
  }
  detailView.appendChild(box);
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- routing + init

function route() {
  var hash = location.hash || '';
  var match = hash.match(/^#\/protocol\/([A-Za-z0-9._-]+)$/);
  if (match) renderDetail(match[1]);
  else {
    $('board-view').hidden = false;
    var dv = $('detail-view');
    dv.hidden = true;
    dv.innerHTML = '';
    renderBoard();
  }
}

function init() {
  if (!DATA || !DATA.rows) {
    $('rows').innerHTML = '<tr><td colspan="11" class="empty">No data loaded.</td></tr>';
    return;
  }
  renderStats();
  renderAccounting();
  renderValidation();
  renderFilters();
  sealCheck();
  $('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
  $('f-cat').addEventListener('change', function (e) { state.cat = e.target.value; renderBoard(); });
  $('f-chain').addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });
  $('f-tvl').addEventListener('change', function (e) { state.tvl = Number(e.target.value); renderBoard(); });
  $('f-verdict').addEventListener('change', function (e) { state.verdict = e.target.value; renderBoard(); });
  $('f-watch').addEventListener('change', function (e) { state.watch = e.target.checked; renderBoard(); });
  document.querySelectorAll('#deposit button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.deposit = Number(btn.getAttribute('data-dep'));
      document.querySelectorAll('#deposit button').forEach(function (b) { b.classList.toggle('on', b === btn); });
      sealCheck();
      renderBoard();
      route();
    });
  });
  document.querySelectorAll('#board thead th').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      if (!key) return;
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = key === 'name' || key === 'category' || key === 'chains' ? 1 : -1; }
      renderBoard();
    });
  });
  window.addEventListener('hashchange', route);
  route();
}

if (typeof document !== 'undefined' && typeof window !== 'undefined' && DATA) init();

// Node export, so the gate script can verify the page's farm steps and
// economics against board.json.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TEMPLATES: TEMPLATES, capitalTier: capitalTier, holdDaysFor: holdDaysFor, groupFor: groupFor, farmSteps: farmSteps, econFor: econFor };
}
