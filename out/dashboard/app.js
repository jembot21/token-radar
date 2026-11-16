// Token Radar — the dashboard's behaviour. Reads window.RADAR (written by
// main.ts from the sealed snapshot), renders the board, the filters and the
// per-protocol detail view. No network, no framework, no state beyond the URL.
'use strict';

const R = window.RADAR;
const rows = R.rows;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const commas = (n) => n.toLocaleString('en-US');
const usd = (n) => `$${commas(Math.round(n))}`;
const compact = (n) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}K` : usd(n));
const pct = (x) => (x === null ? '—' : `${x > 0 ? '+' : ''}${x.toFixed(1)}%`);
const runLength = (days) => (days === null ? 'unknown' : days >= 730 ? `${commas(days)}d (${(days / 365).toFixed(1)}y)` : `${commas(days)}d`);

// ---------------------------------------------------------------------------
// Masthead, totals, method
// ---------------------------------------------------------------------------

$('snapshot-line').textContent = `Sealed DefiLlama snapshot · as of ${R.as_of} · floor ${compact(R.floor_usd)}`;
$('source-line').textContent = `Source: ${R.source}. The board below is computed from that snapshot alone, by the model stated on this page.`;

const statCards = [
  [commas(R.stats.protocols), 'protocols in the snapshot'],
  [commas(R.stats.tokenized), 'already record a token — set aside'],
  [commas(R.stats.board_rows), 'pre-token protocols ranked'],
  [`${R.stats.watchlist} / ${R.stats.watchlist}`, 'house watchlist covered'],
  [compact(R.stats.board_tvl_usd), 'TVL under watch'],
  [compact(R.stats.board_implied_usd), 'combined implied value'],
];
$('stats').innerHTML = statCards.map(([v, k]) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('');

$('formula').textContent = R.method.formula;
$('method-notes').innerHTML = R.method.notes.map((n) => `<li>${esc(n)}</li>`).join('');
$('multiple-chips').innerHTML =
  R.method.categories.map((c) => `<span class="mchip">${esc(c.category)} <b>${c.multiple.toFixed(3)}×</b> · ${c.peers} peers</span>`).join('') +
  `<span class="mchip">all categories <b>${R.method.global_multiple.toFixed(3)}×</b> · ${R.method.global_peers} peers</span>`;

// ---------------------------------------------------------------------------
// Board: filters and sorting
// ---------------------------------------------------------------------------

const state = { q: '', category: '', chain: '', watchOnly: false, sort: 'rank', dir: 1 };

const categories = [...new Set(rows.map((r) => r.category).filter(Boolean))].sort();
$('category').innerHTML += categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
const chains = [...new Set(rows.flatMap((r) => r.chains))].sort();
$('chain').innerHTML += chains.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');

const sortValue = (r, key) => {
  switch (key) {
    case 'rank': return r.rank;
    case 'name': return r.name.toLowerCase();
    case 'chains': return r.chains.length;
    case 'tvl': return r.tvl_usd;
    case 'change': return r.change_7d === null ? -Infinity : r.change_7d;
    case 'days': return r.days_live === null ? -1 : r.days_live;
    case 'multiple': return r.multiple;
    default: return r.implied_value_usd;
  }
};

function visibleRows() {
  const q = state.q.trim().toLowerCase();
  const list = rows.filter((r) =>
    (q === '' || r.name.toLowerCase().includes(q) || r.slug.includes(q)) &&
    (state.category === '' || r.category === state.category) &&
    (state.chain === '' || r.chains.includes(state.chain)) &&
    (!state.watchOnly || r.on_watchlist));
  const key = state.sort;
  list.sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (va < vb) return -state.dir;
    if (va > vb) return state.dir;
    return a.rank - b.rank;
  });
  return list;
}

function renderBoard() {
  const list = visibleRows();
  $('count').textContent = `${list.length} of ${rows.length} protocols`;
  $('rows').innerHTML = list.map((r) => `
    <tr data-slug="${esc(r.slug)}">
      <td class="rank num">${r.rank}</td>
      <td><span class="pname">${esc(r.name)}</span>${r.on_watchlist ? '<span class="watch">watchlist</span>' : ''}<span class="pcat">${esc(r.category ?? 'Uncategorised')}</span></td>
      <td>${esc(r.chains.slice(0, 3).join(', '))}${r.chains.length > 3 ? ` +${r.chains.length - 3}` : ''}</td>
      <td class="num">${compact(r.tvl_usd)}</td>
      <td class="num ${r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'}">${pct(r.change_7d)}</td>
      <td class="num">${runLength(r.days_live)}</td>
      <td class="num">${r.multiple.toFixed(3)}×</td>
      <td class="num implied">${compact(r.implied_value_usd)}</td>
    </tr>`).join('');
  for (const tr of $('rows').querySelectorAll('tr')) {
    tr.addEventListener('click', () => showDetail(tr.dataset.slug));
  }
  for (const th of document.querySelectorAll('#board thead th')) {
    th.classList.toggle('sorted', th.dataset.sort === state.sort);
  }
}

// ---------------------------------------------------------------------------
// Detail view: one protocol, its value breakdown and its farm plan
// ---------------------------------------------------------------------------

function factorRow(label, note, widthPct, value) {
  return `<div class="factor"><span class="fname">${esc(label)}<br><small>${esc(note)}</small></span><span class="fbar"><i style="width:${widthPct}%"></i></span><span class="fval">${esc(value)}</span></div>`;
}

function showDetail(slug) {
  const r = rows.find((x) => x.slug === slug);
  if (!r) return;
  const basis = r.multiple_basis === 'category'
    ? `${r.category} median, ${r.peer_count} tokenized peers`
    : `global median, ${r.peer_count} tokenized peers (fewer than 3 in its category)`;
  const growthNote = r.change_7d === null ? '7d TVL change unreported — neutral' : `7d TVL change ${pct(r.change_7d)}`;
  const ageNote = r.days_live === null ? 'listing day unknown — neutral' : `tracked since ${r.listed_at}, ${runLength(r.days_live)} with no token`;
  $('detail').innerHTML = `
    <div class="detail-head">
      <div>
        <h2>${esc(r.name)}${r.on_watchlist ? '<span class="watch">watchlist</span>' : ''}</h2>
        <p class="sub">${esc(r.category ?? 'Uncategorised')} · rank #${r.rank} of ${rows.length} · ${esc(r.chains.join(', ') || 'no chains listed')}</p>
      </div>
      <div class="detail-implied"><div class="v">${usd(r.implied_value_usd)}</div><div class="k">implied launch value</div></div>
    </div>
    <div class="detail-grid">
      <div class="stat"><div class="v">${usd(r.tvl_usd)}</div><div class="k">TVL in the snapshot</div></div>
      <div class="stat"><div class="v">${pct(r.change_7d)}</div><div class="k">TVL change, 7 days</div></div>
      <div class="stat"><div class="v">${runLength(r.days_live)}</div><div class="k">run with no token recorded</div></div>
      <div class="stat"><div class="v">${r.listed_at ?? 'unknown'}</div><div class="k">tracked by DefiLlama since</div></div>
    </div>
    <div class="panel">
      <h3>How the implied value is built</h3>
      ${factorRow('TVL', 'the snapshot\u2019s own figure', 100, usd(r.tvl_usd))}
      ${factorRow('Peer multiple', basis, Math.min(100, (r.multiple / 1.3) * 100), `${r.multiple.toFixed(3)}×`)}
      ${factorRow('Base value', 'TVL × peer multiple', Math.min(100, (r.multiple / 1.3) * 100), usd(r.base_value_usd))}
      ${factorRow('Momentum', growthNote, ((r.growth_factor - 0.72) / (1.54 - 0.72)) * 100, `${r.growth_factor.toFixed(3)}×`)}
      ${factorRow('Track record', ageNote, ((r.age_factor - 0.85) / (1.3 - 0.85)) * 100, `${r.age_factor.toFixed(3)}×`)}
      <div class="factor total"><span class="fname">Implied launch value</span><span class="fbar"><i style="width:100%"></i></span><span class="fval">${usd(r.implied_value_usd)}</span></div>
    </div>
    <div class="panel">
      <h3>Farm plan — how to position for a ${esc(r.name)} launch</h3>
      <ol class="steps">${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    </div>`;
  $('board-view').hidden = true;
  $('detail-view').hidden = false;
  document.body.classList.add('detail-mode');
  window.scrollTo(0, 0);
}

$('back').addEventListener('click', () => {
  $('detail-view').hidden = true;
  $('board-view').hidden = false;
  document.body.classList.remove('detail-mode');
});

// ---------------------------------------------------------------------------
// Controls, and the staged views the screenshots use (?view=, ?category=, …)
// ---------------------------------------------------------------------------

$('q').addEventListener('input', (e) => { state.q = e.target.value; renderBoard(); });
$('category').addEventListener('change', (e) => { state.category = e.target.value; renderBoard(); });
$('chain').addEventListener('change', (e) => { state.chain = e.target.value; renderBoard(); });
$('watch-only').addEventListener('change', (e) => { state.watchOnly = e.target.checked; renderBoard(); });
for (const th of document.querySelectorAll('#board thead th')) {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (state.sort === key) state.dir = -state.dir;
    else { state.sort = key; state.dir = key === 'rank' || key === 'name' ? 1 : -1; }
    renderBoard();
  });
}

const params = new URLSearchParams(location.search);
if (params.get('category')) { state.category = params.get('category'); $('category').value = state.category; }
if (params.get('chain')) { state.chain = params.get('chain'); $('chain').value = state.chain; }
if (params.get('q')) { state.q = params.get('q'); $('q').value = state.q; }
if (params.get('watch') === '1') { state.watchOnly = true; $('watch-only').checked = true; }
if (params.get('sort')) {
  state.sort = params.get('sort');
  state.dir = state.sort === 'rank' || state.sort === 'name' ? 1 : -1;
}
renderBoard();
if (params.get('view') === 'detail' && params.get('slug')) showDetail(params.get('slug'));
