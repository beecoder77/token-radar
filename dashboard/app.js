// Token Radar dashboard: a static page, no network. Every byte it shows is
// in data.js (window.RADAR), written by main.ts from the sealed snapshot.
//
// The farm plan is the same derivation main.ts writes to board.json:
// category-aware templates parameterised by the protocol's name, primary
// chain, category and TVL tier. The table below is the one lib/radar.ts
// carries — keep the two in sync; tools/check-gate.mjs verifies every row's
// steps against board.json.

var FARM_TEMPLATES = {
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
  monitor: [
    'Set up a fresh wallet on {chain} that holds only the funds you plan to farm, and write its seed phrase on paper, never in a screenshot. ($2–$4 in gas; about 10 minutes)',
    'Make one small test interaction, about {small}, with {name} on {chain} so the wallet has one completed transaction on record. ($2–$6 in gas; about 10 minutes)',
    'Turn on {name}\u2019s official announcements channel and set an alert for the words token, airdrop and points. (no fee; about 5 minutes)',
    'Do not lock large funds here: {reason}, so treat this as low priority and keep most capital in likely launch candidates. (no cost; about 5 minutes)',
    'Re-check the announcements once a month; if a points program or token plan appears, switch to a full farm plan and move the position up the list. (no fee; 10 minutes a month)',
  ],
};

/** How much capital one farm position needs, from the protocol's TVL tier. */
function capitalTier(tvlUsd) {
  if (tvlUsd >= 500000000) return { capital: '$1,500', range: '$1,000–$2,500' };
  if (tvlUsd >= 100000000) return { capital: '$750', range: '$500–$1,000' };
  if (tvlUsd >= 50000000) return { capital: '$350', range: '$250–$500' };
  return { capital: '$175', range: '$100–$250' };
}

/** How long to hold, from the protocol's age. */
function holdDaysFor(age) {
  if (age === null || age === undefined) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The template group a category belongs to. */
function groupFor(category, discount) {
  if (discount < 1) {
    if (category === 'CEX') return 'cex';
    if (category === 'Bridge' || category === 'Canonical Bridge' || category === 'Cross Chain Bridge') return 'bridge';
    if (category === 'Liquid Staking' || category === 'Liquid Restaking' || category === 'Restaked BTC') return 'lst';
    return 'monitor';
  }
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

/** Fill a template's placeholders for one protocol. */
function fill(template, values) {
  var out = template;
  for (var key in values) out = out.split('{' + key + '}').join(values[key]);
  return out;
}

/** A protocol's farm plan, from its own record — the same steps board.json carries. */
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
    reason: row.model.discount_reason,
  };
  var group = groupFor(row.category, row.model.discount);
  var templates = FARM_TEMPLATES[group] || FARM_TEMPLATES.generic;
  return templates.map(function (t) {
    var step = fill(t, values).trim();
    if (step.length > 600) step = step.slice(0, 597).replace(/\s+\S*$/, '') + '...';
    if (step.length < 20) step = step + ' Keep the transaction hashes as proof of activity.';
    return step;
  });
}

// ---------------------------------------------------------------- formatting

function fmtUsd(n) {
  if (n === null || n === undefined) return '—';
  var abs = Math.abs(n);
  if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (abs >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n;
}
function fmtInt(n) {
  if (n === null || n === undefined) return '—';
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function fmtPct(n) {
  if (n === null || n === undefined) return '—';
  return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
}
function fmtAge(days) {
  if (days === null || days === undefined) return '—';
  if (days < 30) return days + 'd';
  if (days < 365) return (days / 30).toFixed(0) + 'mo';
  return (days / 365).toFixed(1) + 'y';
}
function fmtFactor(n) { return '×' + n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0'); }
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function el(tag, attrs, children) {
  var node = document.createElement(tag);
  if (attrs) {
    for (var k in attrs) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else node.setAttribute(k, attrs[k]);
    }
  }
  (children || []).forEach(function (c) { if (c !== null && c !== undefined) node.appendChild(c); });
  return node;
}

// ---------------------------------------------------------------- page state

var DATA = (typeof window !== 'undefined' && window.RADAR) ? window.RADAR : null;
var state = { q: '', cat: '', chain: '', minTvl: 0, watch: false, likely: false, sort: 'rank', dir: 1 };

function filteredRows() {
  var q = state.q.trim().toLowerCase();
  return DATA.rows.filter(function (r) {
    if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
    if (state.cat && (r.category || '(none)') !== state.cat) return false;
    if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
    if (r.tvl_usd < state.minTvl) return false;
    if (state.watch && !r.watchlist) return false;
    if (state.likely && r.model.discount < 1) return false;
    return true;
  });
}

function sortedRows(rows) {
  var key = state.sort;
  var dir = state.dir;
  return rows.slice().sort(function (a, b) {
    var av = a[key];
    var bv = b[key];
    if (key === 'chains') { av = a.chains.join(', '); bv = b.chains.join(', '); }
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    if (typeof av === 'string') return av.localeCompare(bv) * dir;
    if (av !== bv) return (av - bv) * dir;
    return (a.rank - b.rank) * 1;
  });
}

function renderStats() {
  var stats = document.getElementById('stats');
  var items = [
    ['Snapshot', DATA.as_of],
    ['Pre-token tracked', fmtInt(DATA.board_size)],
    ['Watchlist', fmtInt(DATA.watchlist_size)],
    ['Chains', fmtInt(DATA.chain_count)],
    ['Total implied value', fmtUsd(DATA.total_implied_usd)],
  ];
  items.forEach(function (it, i) {
    var wrap = el('div', {});
    wrap.appendChild(el('dt', { text: it[0] }));
    wrap.appendChild(el('dd', { text: it[1], 'class': i === 4 ? 'gold' : '' }));
    stats.appendChild(wrap);
  });
}

function renderFilters() {
  var cats = {};
  var chains = {};
  DATA.rows.forEach(function (r) {
    cats[r.category || '(none)'] = true;
    r.chains.forEach(function (c) { chains[c] = true; });
  });
  var catSel = document.getElementById('f-cat');
  catSel.appendChild(el('option', { value: '', text: 'All categories' }));
  Object.keys(cats).sort().forEach(function (c) { catSel.appendChild(el('option', { value: c, text: c })); });
  var chainSel = document.getElementById('f-chain');
  chainSel.appendChild(el('option', { value: '', text: 'All chains' }));
  Object.keys(chains).sort().forEach(function (c) { chainSel.appendChild(el('option', { value: c, text: c })); });
}

function renderBoard() {
  var rows = sortedRows(filteredRows());
  var tbody = document.getElementById('rows');
  tbody.innerHTML = '';
  document.getElementById('count').textContent = rows.length + ' of ' + DATA.board_size + ' protocols';
  if (rows.length === 0) {
    tbody.appendChild(el('tr', {}, [el('td', { colspan: '8', 'class': 'empty', text: 'No protocol matches these filters.' })]));
    return;
  }
  rows.forEach(function (r) {
    var tr = el('tr', { 'data-slug': r.slug });
    tr.appendChild(el('td', { 'class': 'num', text: String(r.rank) }));
    var nameTd = el('td', { 'class': 'name' });
    nameTd.appendChild(el('b', { text: r.name }));
    if (r.watchlist) nameTd.appendChild(el('span', { 'class': 'badge watch', text: 'Watchlist' }));
    if (r.model.discount < 1) nameTd.appendChild(el('span', { 'class': 'badge low', text: 'Unlikely' }));
    nameTd.appendChild(el('span', { 'class': 'slug', text: r.slug }));
    tr.appendChild(nameTd);
    tr.appendChild(el('td', { text: r.category || '—' }));
    tr.appendChild(el('td', { text: r.chains.length > 1 ? r.chains[0] + ' +' + (r.chains.length - 1) : (r.chains[0] || '—') }));
    tr.appendChild(el('td', { 'class': 'num', text: fmtUsd(r.tvl_usd) }));
    var chg = el('td', { 'class': 'num ' + (r.change_7d === null ? 'dim' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) });
    tr.appendChild(chg);
    tr.appendChild(el('td', { 'class': 'num', text: fmtAge(r.age_days) }));
    tr.appendChild(el('td', { 'class': 'num goldval', text: fmtUsd(r.implied_value_usd) }));
    tr.addEventListener('click', function () { location.hash = '#/protocol/' + r.slug; });
    tbody.appendChild(tr);
  });
  document.querySelectorAll('#board thead th').forEach(function (th) {
    th.classList.toggle('sorted', th.getAttribute('data-sort') === state.sort);
    th.classList.toggle('desc', th.getAttribute('data-sort') === state.sort && state.dir < 0);
  });
}

function peersFor(row) {
  return DATA.peers
    .filter(function (p) { return p.category === row.category; })
    .sort(function (a, b) { return b.mcap_usd - a.mcap_usd; })
    .slice(0, 5);
}

function renderDetail(slug) {
  var row = null;
  DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
  var boardView = document.getElementById('board-view');
  var detailView = document.getElementById('detail-view');
  if (!row) {
    boardView.hidden = false;
    detailView.hidden = true;
    detailView.innerHTML = '';
    return;
  }
  boardView.hidden = true;
  detailView.hidden = false;
  detailView.innerHTML = '';
  detailView.appendChild(el('a', { 'class': 'back', href: '#', text: '← Back to the board' }));
  var box = el('div', { 'class': 'detail' });
  var h2 = el('h2', {});
  h2.appendChild(document.createTextNode(row.name));
  h2.appendChild(el('span', { 'class': 'slug', text: row.slug }));
  if (row.watchlist) h2.appendChild(el('span', { 'class': 'badge watch', text: 'Watchlist' }));
  if (row.model.discount < 1) h2.appendChild(el('span', { 'class': 'badge low', text: 'Unlikely to launch' }));
  box.appendChild(h2);
  box.appendChild(el('p', {
    'class': 'sub',
    text: 'Rank #' + row.rank + ' of ' + DATA.board_size + ' · ' + (row.category || 'no category') +
      ' · ' + row.chains.length + ' chain' + (row.chains.length === 1 ? '' : 's') +
      ' · Records no token' + (row.watchlist ? ' · On the snapshot watchlist' : ''),
  }));

  box.appendChild(el('h3', { text: 'Snapshot record' }));
  var kv = el('dl', { 'class': 'kv' });
  var facts = [
    ['TVL', fmtUsd(row.tvl_usd)],
    ['7d change', fmtPct(row.change_7d)],
    ['Listed', row.listed_at || 'not reported'],
    ['Age', row.age_days === null ? 'not reported' : fmtInt(row.age_days) + ' days'],
    ['Chains', row.chains.join(', ') || '—'],
    ['Token', 'none recorded (no gecko id, no symbol, no market cap)'],
    ['Watchlist floor', fmtUsd(DATA.floor_usd)],
  ];
  facts.forEach(function (f) {
    var d = el('div', {});
    d.appendChild(el('dt', { text: f[0] }));
    d.appendChild(el('dd', { text: f[1] }));
    kv.appendChild(d);
  });
  box.appendChild(kv);

  box.appendChild(el('h3', { text: 'Implied value — the working' }));
  var m = row.model;
  var running = row.tvl_usd * m.multiple;
  var calc = [
    ['TVL × category multiple', fmtUsd(row.tvl_usd) + ' × ' + m.multiple.toFixed(4) + ' = ' + fmtUsd(m.base_fdv),
      m.peers >= 3 ? 'Median mcap/TVL of ' + m.peers + ' token-bearing peers in ' + (row.category || 'this category') + '.' : 'Fewer than 3 peers in this category, so the global median ' + DATA.global_multiple.toFixed(4) + ' applies.'],
    ['× growth', fmtFactor(m.growth), '7d TVL change ' + fmtPct(row.change_7d) + ', clamped to −15%…+25%.'],
    ['× age', fmtFactor(m.age), row.age_days === null ? 'Listing date not reported, so no age boost.' : 'Listed ' + fmtInt(row.age_days) + ' days ago: longer with no token, more pent-up value.'],
    ['× chains', fmtFactor(m.chains_factor), row.chains.length + ' chain' + (row.chains.length === 1 ? '' : 's') + '.'],
    ['× discount', fmtFactor(m.discount), m.discount_reason === '' ? 'No discount: nothing about this protocol says it cannot issue a token.' : 'Discounted: ' + m.discount_reason + '.'],
    ['Implied value', fmtUsd(row.implied_value_usd), 'Rounded to whole dollars.'],
  ];
  var table = el('table', { 'class': 'plain' });
  var thead = el('thead', {});
  thead.appendChild(el('tr', {}, [el('th', { text: 'Step' }), el('th', { text: 'Figure' }), el('th', { text: 'Why' })]));
  table.appendChild(thead);
  var tbody = el('tbody', {});
  calc.forEach(function (c, i) {
    var tr = el('tr', {});
    tr.appendChild(el('td', { text: c[0] }));
    tr.appendChild(el('td', { 'class': i === calc.length - 1 ? 'goldval' : '', text: c[1] }));
    tr.appendChild(el('td', { 'class': 'dim', text: c[2] }));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  box.appendChild(table);
  if (m.discount < 1) {
    box.appendChild(el('p', { 'class': 'note warn', text: 'This row is discounted ×' + m.discount + ' because ' + m.discount_reason + '. It is ranked on that discounted value, and the “Likely to launch” filter hides it.' }));
  }

  box.appendChild(el('h3', { text: 'Farm plan — what to do' }));
  var steps = farmSteps(row);
  var ol = el('ol', { 'class': 'steps' });
  steps.forEach(function (s) { ol.appendChild(el('li', { text: s })); });
  box.appendChild(ol);

  box.appendChild(el('h3', { text: 'Comparable peers — token-bearing protocols in ' + (row.category || 'this category') }));
  var peers = peersFor(row);
  if (peers.length === 0) {
    box.appendChild(el('p', { 'class': 'note', text: 'No token-bearing protocol in this category is in the snapshot, so the global median multiple applies to this row.' }));
  } else {
    var pt = el('table', { 'class': 'plain' });
    var pthead = el('thead', {});
    pthead.appendChild(el('tr', {}, [el('th', { text: 'Protocol' }), el('th', { 'class': 'num', text: 'Market cap' }), el('th', { 'class': 'num', text: 'TVL' }), el('th', { 'class': 'num', text: 'mcap / TVL' })]));
    pt.appendChild(pthead);
    var ptbody = el('tbody', {});
    peers.forEach(function (p) {
      var tr = el('tr', {});
      tr.appendChild(el('td', { text: p.name }));
      tr.appendChild(el('td', { 'class': 'num', text: fmtUsd(p.mcap_usd) }));
      tr.appendChild(el('td', { 'class': 'num', text: fmtUsd(p.tvl_usd) }));
      tr.appendChild(el('td', { 'class': 'num', text: (p.mcap_usd / p.tvl_usd).toFixed(3) }));
      ptbody.appendChild(tr);
    });
    pt.appendChild(ptbody);
    box.appendChild(pt);
    box.appendChild(el('p', { 'class': 'note', text: 'The category multiple ' + m.multiple.toFixed(4) + ' is the median of these ratios across all ' + m.peers + ' token-bearing peers in the category (top 5 shown).' }));
  }
  detailView.appendChild(box);
  window.scrollTo(0, 0);
}

function route() {
  var hash = location.hash || '';
  var match = hash.match(/^#\/protocol\/([A-Za-z0-9._-]+)$/);
  if (match) renderDetail(match[1]);
  else {
    document.getElementById('board-view').hidden = false;
    var dv = document.getElementById('detail-view');
    dv.hidden = true;
    dv.innerHTML = '';
    renderBoard();
  }
}

function init() {
  if (!window.RADAR || !window.RADAR.rows) {
    document.getElementById('rows').innerHTML = '<tr><td colspan="8" class="empty">No data loaded.</td></tr>';
    return;
  }
  renderStats();
  renderFilters();
  document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
  document.getElementById('f-cat').addEventListener('change', function (e) { state.cat = e.target.value; renderBoard(); });
  document.getElementById('f-chain').addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });
  document.getElementById('f-tvl').addEventListener('change', function (e) { state.minTvl = Number(e.target.value); renderBoard(); });
  document.getElementById('f-watch').addEventListener('change', function (e) { state.watch = e.target.checked; renderBoard(); });
  document.getElementById('f-likely').addEventListener('change', function (e) { state.likely = e.target.checked; renderBoard(); });
  document.querySelectorAll('#board thead th').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = key === 'name' || key === 'category' || key === 'chains' ? 1 : -1; }
      renderBoard();
    });
  });
  window.addEventListener('hashchange', route);
  route();
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') init();

// Node export, so the gate script can verify the page's farm steps against board.json.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FARM_TEMPLATES: FARM_TEMPLATES, capitalTier: capitalTier, holdDaysFor: holdDaysFor, groupFor: groupFor, farmSteps: farmSteps };
}
