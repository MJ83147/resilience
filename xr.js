// Resilience xanax runners dashboard
const DATA_URL = 'data/xr.json';
const XANAX_PRICE = 800000; // Used for revenue/net calculations until we wire up live pricing

// Distinct categorical palette for multi-series charts (pharmacists, buyers).
// Green stays the lead colour; the rest are muted earth/teal/gold tones so series
// are easy to tell apart without bright blue or purple.
const CATEGORICAL_COLORS = [
  '#2E7D32', // green
  '#C9A227', // gold
  '#00897B', // teal
  '#EF6C00', // orange
  '#6D4C41', // brown
  '#558B2F', // light olive green
  '#607D8B', // slate
  '#9E9D24', // olive
  '#00838F', // dark cyan
  '#A1574E'  // terracotta
];

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DOW_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const state = {
  raw: null,            // full parsed JSON
  deposits: [],         // deposits with a valid date
  sales: [],            // all sales (negatives kept)
  activeRunners: new Set(), // current roster, used to flag former members
  activityRange: 12,
  selectedRunner: null,
  runnerTableSort: { key: 'date', dir: 'desc' },
  rawSort: { key: 'date', dir: 'desc' },
  rawFilter: { search: '', pharmacist: '', paid: '' },
  charts: {}
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    const resp = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    state.raw = await resp.json();
    // The feed can contain a stray row with no date / zero qty. Drop those for charts.
    state.deposits = (state.raw.deposits || []).filter(d => d && d.date);
    state.sales = state.raw.sales || [];
    state.activeRunners = new Set((state.raw.roster && state.raw.roster.runners_active) || []);

    document.getElementById('setupSection').style.display = 'none';
    document.getElementById('dashboardContent').style.display = 'block';

    applyChartDefaults();
    buildOnce();
    renderAll();
    watchTheme();
  } catch (err) {
    document.getElementById('loadingMessage').style.display = 'none';
    const errEl = document.getElementById('errorMessage');
    errEl.style.display = 'block';
    errEl.textContent = "Couldn't load dashboard data: " + err.message;
  }
}

// One-time setup: things that should not be repeated on re-render.
function buildOnce() {
  populateRawFilters();
  wireUI();
}

// Everything that can be safely re-run (e.g. on theme change).
function renderAll() {
  renderLastUpdated();
  renderKPIs();
  renderSnapshot();
  renderCumulativeChart();
  renderHeatmap();
  renderOverviewCallouts();
  renderActivityChart();
  renderParetoChart();
  renderCohortChart();
  renderRunnerDashboard();
  renderReimbursementChart();
  renderReimbursementCallouts();
  renderLeaderboard();
  renderPriceChart();
  renderPricingCallouts();
  renderPharmacistChart();
  renderSalesTimeChart();
  renderBuyersChart();
  renderSalesScatter();
  renderSalesCallouts();
  renderRawTable();
}

// =====================================================================
// Tab switching (Chart.js needs a resize when revealed from display:none)
// =====================================================================
function showTab(name) {
  document.querySelectorAll('.tab-section').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-buttons button').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  document.getElementById('tabBtn-' + name).classList.add('active');
  // Charts created while their tab was display:none render at zero width and
  // resize() will not recover them. Once the revealed tab has laid out, re-render
  // its charts so they size to the now-visible container.
  setTimeout(() => (TAB_CHARTS[name] || []).forEach(fn => { try { fn(); } catch (e) {} }), 60);
}

// Chart render functions grouped by the tab that contains them.
const TAB_CHARTS = {
  overview: [() => renderCumulativeChart(), () => renderActivityChart()],
  runners: [() => renderParetoChart(), () => renderCohortChart(), () => renderReimbursementChart()],
  lookup: [() => renderRunnerActivityChart()],
  pricing: [() => renderPriceChart(), () => renderPharmacistChart()],
  sales: [() => renderSalesTimeChart(), () => renderBuyersChart(), () => renderSalesScatter()]
};
window.showTab = showTab;

// =====================================================================
// Header + KPIs
// =====================================================================
function renderLastUpdated() {
  const dt = new Date(state.raw.generated_at);
  document.getElementById('lastUpdated').textContent =
    'Last updated: ' + dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function renderKPIs() {
  const deposits = state.deposits;
  const totalXanax = sum(deposits, d => d.qty);
  const totalReimbursed = sum(deposits, d => d.reimbursement);
  const estRevenue = totalXanax * XANAX_PRICE;
  const estNet = estRevenue - totalReimbursed;
  const contributors = new Set(deposits.map(d => d.runner)).size;

  setText('kpiXanax', formatCompact(totalXanax));
  setText('kpiReimbursed', formatMoney(totalReimbursed));
  setText('kpiRevenue', formatMoney(estRevenue));
  setText('kpiNet', formatMoney(estNet));
  setText('kpiPrice', formatMoney(XANAX_PRICE));
  setText('kpiRunners', contributors);
}

// =====================================================================
// Overview: recent-activity snapshot (rolling 7 / 30 days)
// =====================================================================
function renderSnapshot() {
  renderSnapshotColumn('snapWeek', 7, 'This week', 'last 7 days');
  renderSnapshotColumn('snapMonth', 30, 'This month', 'last 30 days');
}

function renderSnapshotColumn(elId, days, title, sub) {
  const curStart = daysAgoStr(days);
  const prevStart = daysAgoStr(days * 2);
  const cur = state.deposits.filter(d => d.date >= curStart);
  const prev = state.deposits.filter(d => d.date >= prevStart && d.date < curStart);

  const runners = new Set(cur.map(d => d.runner)).size;
  const xanax = sum(cur, d => d.qty);
  const reimbursed = sum(cur, d => d.reimbursement);

  const byRunner = groupBy(cur, 'runner');
  const contributors = Object.entries(byRunner)
    .map(([name, d]) => ({ name, count: d.length }))
    .sort((a, b) => b.count - a.count);

  const chips = contributors.length
    ? '<div class="snapshot-chips">' + contributors.map(r =>
        '<span class="snap-chip">' + runnerHTML(r.name) + '<strong>' + r.count + '</strong></span>').join('') + '</div>'
    : '<div class="snapshot-empty">No runs recorded yet. Runs usually land on a Saturday.</div>';

  document.getElementById(elId).innerHTML =
    '<div class="snap-col-head"><span class="snap-col-title">' + title + '</span><span class="snap-col-sub">' + sub + '</span></div>' +
    '<div class="snap-hero">' +
      '<span class="snap-hero-num">' + cur.length.toLocaleString() + '</span>' +
      '<span class="snap-hero-unit">' + (cur.length === 1 ? 'run' : 'runs') + '</span>' +
      '<span class="snap-hero-delta">' + deltaHTML(cur.length, prev.length, days) + '</span>' +
    '</div>' +
    '<div class="snap-subline">' +
      '<span><strong>' + runners + '</strong> ' + (runners === 1 ? 'runner' : 'runners') + '</span>' +
      '<span class="snap-sep">&middot;</span>' +
      '<span><strong>' + formatCompact(xanax) + '</strong> xanax</span>' +
      '<span class="snap-sep">&middot;</span>' +
      '<span><strong>' + formatMoney(reimbursed) + '</strong> reimbursed</span>' +
    '</div>' +
    '<div class="snapshot-runners-label">Who ran</div>' + chips;
}

function deltaHTML(cur, prev, days) {
  const d = cur - prev;
  if (d === 0) return '<span class="snap-flat">No change vs prior ' + days + ' days</span>';
  const cls = d > 0 ? 'snap-up' : 'snap-down';
  const arrow = d > 0 ? '▲' : '▼';
  return '<span class="' + cls + '">' + arrow + ' ' + Math.abs(d) + '</span> vs prior ' + days + ' days';
}

// =====================================================================
// Overview: cumulative xanax (area line, time axis)
// =====================================================================
function renderCumulativeChart() {
  const sorted = [...state.deposits].sort((a, b) => a.date < b.date ? -1 : 1);
  let cum = 0;
  const points = sorted.map(d => { cum += d.qty; return { x: d.date, y: cum }; });
  const c = themeColors();

  destroyChart('cumulative');
  state.charts.cumulative = new Chart(ctx('cumulativeChart'), {
    type: 'line',
    data: {
      datasets: [{
        label: 'Total xanax',
        data: points,
        borderColor: c.green,
        backgroundColor: hexA(c.green, 0.15),
        borderWidth: 2, pointRadius: 0, fill: true, tension: 0.1
      }]
    },
    options: baseOptions(c, {
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: {
          title: items => formatLongDate(items[0].parsed.x),
          label: ci => 'Total: ' + formatCompact(ci.parsed.y) + ' xanax'
        } }
      },
      scales: {
        x: timeScale(c, 'Date'),
        y: { beginAtZero: true, title: axisTitle(c, 'Total xanax'),
             ticks: { color: c.textLight, callback: v => formatCompact(v) },
             grid: { color: c.grid } }
      }
    })
  });
}

// =====================================================================
// Overview: heatmap (HTML/CSS grid, day-of-week x last 26 weeks)
// =====================================================================
function renderHeatmap() {
  const WEEKS = 26;
  const today = new Date();
  const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - 7 * WEEKS);
  const firstWeek = mondayOf(cutoff);

  const counts = new Map(); // `${week}_${dow}` -> count
  state.deposits.forEach(dep => {
    const d = new Date(dep.date);
    if (d < firstWeek) return;
    const dow = (d.getDay() + 6) % 7; // Monday = 0
    const wIdx = Math.round((mondayOf(d) - firstWeek) / (7 * 86400000));
    if (wIdx < 0 || wIdx >= WEEKS) return;
    const key = wIdx + '_' + dow;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const maxV = Math.max(1, ...counts.values());
  const c = themeColors();

  const container = document.getElementById('heatmap');
  const cells = [];
  cells.push('<div class="heatmap" style="grid-template-columns: 42px repeat(' + WEEKS + ', 1fr); grid-template-rows: repeat(7, 1fr) auto;">');

  for (let dow = 0; dow < 7; dow++) {
    cells.push('<div class="hm-daylabel" style="grid-row:' + (dow + 1) + ';grid-column:1;">' + DOW[dow] + '</div>');
    for (let w = 0; w < WEEKS; w++) {
      const v = counts.get(w + '_' + dow) || 0;
      const bg = v === 0 ? c.grid : hexA(c.green, 0.15 + 0.85 * (v / maxV));
      const wkDate = new Date(firstWeek); wkDate.setDate(wkDate.getDate() + w * 7 + dow);
      const tip = DOW[dow] + ' ' + wkDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ': ' + v + (v === 1 ? ' deposit' : ' deposits');
      cells.push('<div class="hm-cell" style="grid-row:' + (dow + 1) + ';grid-column:' + (w + 2) + ';background:' + bg + ';" title="' + tip + '"></div>');
    }
  }
  // X axis: month label every 4th week
  for (let w = 0; w < WEEKS; w += 4) {
    const wkDate = new Date(firstWeek); wkDate.setDate(wkDate.getDate() + w * 7);
    cells.push('<div class="hm-xlabel" style="grid-row:8;grid-column:' + (w + 2) + ';">' + MONTHS[wkDate.getMonth()] + '</div>');
  }
  cells.push('</div>');
  cells.push('<div class="hm-axis-x">Week (most recent 26)</div>');
  cells.push('<div class="hm-legend">Fewer'
    + '<span class="hm-legend-cell" style="background:' + c.grid + '"></span>'
    + '<span class="hm-legend-cell" style="background:' + hexA(c.green, 0.4) + '"></span>'
    + '<span class="hm-legend-cell" style="background:' + hexA(c.green, 0.7) + '"></span>'
    + '<span class="hm-legend-cell" style="background:' + hexA(c.green, 1) + '"></span>More</div>');

  container.innerHTML = cells.join('');
}

// =====================================================================
// Overview: callout tiles
// =====================================================================
function renderOverviewCallouts() {
  const dowCounts = new Array(7).fill(0);
  state.deposits.forEach(d => { dowCounts[(new Date(d.date).getDay() + 6) % 7]++; });
  let busiest = 0, quietest = 0;
  for (let i = 1; i < 7; i++) {
    if (dowCounts[i] > dowCounts[busiest]) busiest = i;
    if (dowCounts[i] < dowCounts[quietest]) quietest = i;
  }
  setText('coBusiestDay', DOW_FULL[busiest]);
  setText('coBusiestDayDetail', dowCounts[busiest].toLocaleString() + ' runs all-time');
  setText('coQuietestDay', DOW_FULL[quietest]);
  setText('coQuietestDayDetail', dowCounts[quietest].toLocaleString() + ' runs all-time');

  const cutoff = daysAgoStr(30);
  const recent = state.deposits.filter(d => d.date >= cutoff);
  const activeRunners = new Set(recent.map(d => d.runner)).size;
  setText('coLast30', recent.length.toLocaleString() + ' runs');
  setText('coLast30Detail', activeRunners + (activeRunners === 1 ? ' active runner' : ' active runners'));
}

// =====================================================================
// Overview: monthly volume (bars = tickets, line = avg run price)
// =====================================================================
function renderActivityChart() {
  const monthly = aggregateByMonth(state.deposits, state.activityRange);
  const c = themeColors();

  destroyChart('activity');
  state.charts.activity = new Chart(ctx('activityChart'), {
    data: {
      labels: monthly.map(m => m.label),
      datasets: [
        { type: 'bar', label: 'Tickets', data: monthly.map(m => m.tickets),
          backgroundColor: c.green, borderRadius: 4, yAxisID: 'y', order: 2 },
        { type: 'line', label: 'Avg run price', data: monthly.map(m => m.avgPrice),
          borderColor: c.gold, backgroundColor: c.gold, borderWidth: 2,
          pointRadius: 3, pointBackgroundColor: c.gold, tension: 0.3,
          yAxisID: 'y1', spanGaps: true, order: 1 }
      ]
    },
    options: baseOptions(c, {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { color: c.text, boxWidth: 12, boxHeight: 12, padding: 12 } },
        tooltip: { callbacks: { label: ci => {
          if (ci.parsed.y == null) return null;
          return ci.dataset.yAxisID === 'y1'
            ? 'Avg run price: ' + formatMoney(ci.parsed.y)
            : 'Tickets: ' + ci.parsed.y;
        } } }
      },
      scales: {
        x: { title: axisTitle(c, 'Month'), ticks: { color: c.textLight }, grid: { display: false } },
        y: { position: 'left', beginAtZero: true, title: axisTitle(c, 'Tickets'),
             ticks: { color: c.textLight }, grid: { color: c.grid } },
        y1: { position: 'right', beginAtZero: false, title: axisTitle(c, 'Avg run price ($)'),
              ticks: { color: c.textLight, callback: v => formatMoney(v) }, grid: { display: false } }
      }
    })
  });
}

// =====================================================================
// Runners: contribution concentration (horizontal bars, top 15)
// =====================================================================
function renderParetoChart() {
  const byRunner = groupBy(state.deposits, 'runner');
  const top = Object.entries(byRunner)
    .map(([name, d]) => ({ name, count: d.length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);
  const c = themeColors();
  // Former members get a muted grey bar and label; current members stay green.
  const barColors = top.map(r => isFormer(r.name) ? hexA(c.textLight, 0.55) : c.green);

  destroyChart('pareto');
  state.charts.pareto = new Chart(ctx('paretoChart'), {
    type: 'bar',
    data: {
      labels: top.map(r => runnerText(r.name)),
      datasets: [{ label: 'Runs', data: top.map(r => r.count),
        backgroundColor: barColors, borderRadius: 3 }]
    },
    options: baseOptions(c, {
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ci => 'Runs: ' + ci.parsed.x } }
      },
      scales: {
        x: { beginAtZero: true, title: axisTitle(c, 'Runs'),
             ticks: { color: c.textLight, precision: 0 }, grid: { color: c.grid } },
        y: { ticks: { autoSkip: false, color: tc => isFormer(top[tc.index] && top[tc.index].name) ? c.textLight : c.text }, grid: { display: false } }
      }
    })
  });
}

// =====================================================================
// Runners: new vs returning (stacked area, first 90 days vs after)
// =====================================================================
function renderCohortChart() {
  // First deposit date per runner.
  const firstSeen = {};
  state.deposits.forEach(d => {
    if (!firstSeen[d.runner] || d.date < firstSeen[d.runner]) firstSeen[d.runner] = d.date;
  });

  const months = new Set();
  const newByMonth = new Map();
  const oldByMonth = new Map();
  state.deposits.forEach(d => {
    const key = d.date.slice(0, 7);
    months.add(key);
    const ageDays = (new Date(d.date) - new Date(firstSeen[d.runner])) / 86400000;
    const target = ageDays <= 90 ? newByMonth : oldByMonth;
    target.set(key, (target.get(key) || 0) + 1);
  });

  const sortedMonths = [...months].sort();
  const c = themeColors();

  destroyChart('cohort');
  state.charts.cohort = new Chart(ctx('cohortChart'), {
    type: 'line',
    data: {
      labels: sortedMonths.map(monthLabel),
      datasets: [
        { label: 'First 90 days', data: sortedMonths.map(m => newByMonth.get(m) || 0),
          backgroundColor: hexA(c.green, 0.85), borderColor: c.green, fill: true, pointRadius: 0, tension: 0.2 },
        { label: 'After 90 days', data: sortedMonths.map(m => oldByMonth.get(m) || 0),
          backgroundColor: hexA(c.textLight, 0.35), borderColor: c.textLight, fill: true, pointRadius: 0, tension: 0.2 }
      ]
    },
    options: baseOptions(c, {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { color: c.text, boxWidth: 10, boxHeight: 10, padding: 10, font: { size: 11 } } },
        tooltip: { callbacks: { label: ci => ci.dataset.label + ': ' + ci.parsed.y } }
      },
      scales: {
        x: { title: axisTitle(c, 'Month'), stacked: true, ticks: { color: c.textLight, maxTicksLimit: 8 }, grid: { display: false } },
        y: { title: axisTitle(c, 'Tickets'), stacked: true, beginAtZero: true, ticks: { color: c.textLight }, grid: { color: c.grid } }
      }
    })
  });
}

// =====================================================================
// Runners: reimbursement over time + callouts
// =====================================================================
function renderReimbursementChart() {
  const months = new Map();
  state.deposits.forEach(d => {
    const key = d.date.slice(0, 7);
    months.set(key, (months.get(key) || 0) + (d.reimbursement || 0));
  });
  const sortedMonths = [...months.keys()].sort();
  const c = themeColors();

  destroyChart('reimbursement');
  state.charts.reimbursement = new Chart(ctx('reimbursementChart'), {
    type: 'bar',
    data: {
      labels: sortedMonths.map(monthLabel),
      datasets: [{ label: 'Reimbursed', data: sortedMonths.map(m => months.get(m)),
        backgroundColor: c.teal, borderRadius: 3 }]
    },
    options: baseOptions(c, {
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ci => 'Reimbursed: ' + formatMoney(ci.parsed.y) } }
      },
      scales: {
        x: { title: axisTitle(c, 'Month'), ticks: { color: c.textLight, maxTicksLimit: 12 }, grid: { display: false } },
        y: { title: axisTitle(c, 'Reimbursed ($)'), beginAtZero: true, ticks: { color: c.textLight, callback: v => formatMoney(v) }, grid: { color: c.grid } }
      }
    })
  });
}

function renderReimbursementCallouts() {
  const deps = state.deposits;
  const total = sum(deps, d => d.reimbursement);
  const avg = deps.length ? total / deps.length : 0;
  setText('reAvg', formatMoney(avg));
  setText('reAvgDetail', 'Across ' + deps.length.toLocaleString() + ' runs');

  const byRunner = groupBy(deps, 'runner');
  let topName = null, topVal = -1;
  Object.entries(byRunner).forEach(([name, d]) => {
    const v = sum(d, x => x.reimbursement);
    if (v > topVal) { topVal = v; topName = name; }
  });
  setHTML('reTopEarner', topName ? runnerHTML(topName) : 'n/a');
  setText('reTopEarnerDetail', topName ? formatMoney(topVal) + ' reimbursed all-time' : '');

  let biggest = null;
  deps.forEach(d => { if (!biggest || d.reimbursement > biggest.reimbursement) biggest = d; });
  if (biggest) {
    setText('reBiggest', formatMoney(biggest.reimbursement));
    setHTML('reBiggestDetail', runnerHTML(biggest.runner) + ' on ' + formatShortDate(biggest.date));
  }
}

// Faction-wide leaderboard (aggregate view lives on the Runners tab).
function renderLeaderboard() {
  const byRunner = groupBy(state.deposits, 'runner');
  const rows = Object.entries(byRunner)
    .map(([name, d]) => ({ name, runs: d.length, xanax: sum(d, x => x.qty), earned: sum(d, x => x.reimbursement) }))
    .sort((a, b) => b.runs - a.runs);

  document.getElementById('leaderboardWrap').innerHTML =
    '<table class="mini-table"><thead><tr><th>#</th><th>Runner</th><th>Runs</th><th>Xanax</th><th>Reimbursed</th></tr></thead><tbody>' +
    rows.map((r, i) =>
      '<tr><td>' + (i + 1) + '</td><td>' + runnerHTML(r.name) + '</td><td>' + r.runs +
      '</td><td>' + formatCompact(r.xanax) + '</td><td>' + formatMoney(r.earned) + '</td></tr>').join('') +
    '</tbody></table>';
}

// =====================================================================
// Runners: lookup mini-dashboard
// =====================================================================
function renderRunnerDashboard() {
  const container = document.getElementById('runnerDashboard');
  const runner = state.selectedRunner;

  if (!runner) {
    container.innerHTML = '<div class="lookup-empty">Search for a runner above to see their xanax delivered, total earned, runs over time, and recent deposits.<br>For the faction-wide picture, see the Runners tab.</div>';
    return;
  }

  const view = computeRunnerView(runner);

  container.innerHTML =
    '<div class="runner-stat-grid">' +
      view.tiles.map(t =>
        '<div class="runner-stat">' +
          '<div class="runner-stat-value">' + t.value + '</div>' +
          '<div class="runner-stat-label">' + t.label + '</div>' +
          '<div class="runner-stat-compare">' + t.compare + '</div>' +
        '</div>').join('') +
    '</div>' +
    '<div class="runner-callout-row">' +
      view.callouts.map(c =>
        '<div class="runner-callout">' +
          '<div class="callout-label">' + c.label + '</div>' +
          '<div class="callout-value">' + c.value + '</div>' +
          '<div class="callout-detail">' + c.detail + '</div>' +
        '</div>').join('') +
    '</div>' +
    '<div class="runner-subpanel">' +
      '<div class="subpanel-title">' + (runner ? runnerHTML(runner) + "'s monthly runs" : 'Faction monthly runs') + '</div>' +
      '<div class="subpanel-subtitle">' + (runner
        ? 'Their runs each month. Dashed line is the faction average runs per runner per month.'
        : 'Total runs each month. Dashed line is the average runs per runner per month.') + '</div>' +
      '<div class="chart-box short"><canvas id="runnerActivityChart"></canvas></div>' +
    '</div>' +
    '<div class="runner-subpanel">' +
      '<div class="subpanel-title">' + (runner ? 'Recent deposits' : 'Leaderboard') + '</div>' +
      '<div class="subpanel-subtitle">' + (runner ? 'Their last 20 tickets.' : 'Top 20 runners by total runs.') + '</div>' +
      '<div class="mini-table-wrap">' + view.tableHTML + '</div>' +
    '</div>';

  renderRunnerActivityChart();
}

function computeRunnerView(runner) {
  const all = state.deposits;
  const byRunner = groupBy(all, 'runner');
  const names = Object.keys(byRunner);
  const totalRuns = all.length;
  const totalRunners = names.length;

  const runsLb = names.map(n => ({ name: n, runs: byRunner[n].length })).sort((a, b) => b.runs - a.runs);
  const xanaxLb = names.map(n => ({ name: n, xanax: sum(byRunner[n], d => d.qty) })).sort((a, b) => b.xanax - a.xanax);
  const earnedLb = names.map(n => ({ name: n, earned: sum(byRunner[n], d => d.reimbursement) })).sort((a, b) => b.earned - a.earned);

  const mine = (byRunner[runner] || []).slice().sort((a, b) => a.date < b.date ? -1 : 1);
  const myRuns = mine.length;
  const myXanax = sum(mine, d => d.qty);
  const myEarned = sum(mine, d => d.reimbursement);
  const first = mine.length ? mine[0].date : '';
  const last = mine.length ? mine[mine.length - 1].date : '';

  const runRank = runsLb.findIndex(r => r.name === runner) + 1;
  const xanaxRank = xanaxLb.findIndex(r => r.name === runner) + 1;
  const earnedRank = earnedLb.findIndex(r => r.name === runner) + 1;
  const factionAvgRuns = totalRuns / totalRunners;
  const myShare = (myRuns / totalRuns) * 100;

  const consistency = consistencyScore(mine);
  const streak = currentStreak(mine);
  const months = bestAndQuietestMonths(mine);

  return {
    tiles: [
      { value: formatCompact(myXanax), label: 'Total xanax', compare: 'Rank <strong>#' + xanaxRank + '</strong> of ' + totalRunners },
      { value: formatMoney(myEarned), label: 'Total earned', compare: 'Rank <strong>#' + earnedRank + '</strong> of ' + totalRunners },
      { value: myRuns.toLocaleString(), label: 'Run count', compare: 'Rank <strong>#' + runRank + '</strong>, <strong>' + (myRuns / factionAvgRuns).toFixed(1) + 'x</strong> avg' },
      { value: formatShortDate(first), label: 'First deposit', compare: daysSinceLabel(first) },
      { value: formatShortDate(last), label: 'Last deposit', compare: daysSinceLabel(last) },
      { value: myShare.toFixed(1) + '%', label: 'Faction share', compare: 'Of all-time runs' }
    ],
    callouts: [
      { label: 'Consistency', value: consistency.label, detail: consistency.detail },
      { label: 'Current streak', value: streak.value, detail: streak.detail },
      { label: 'Best month', value: months.bestLabel, detail: 'Quietest active: ' + months.quietLabel }
    ],
    tableHTML: recentDepositsTable(mine)
  };
}

function renderRunnerActivityChart() {
  const el = document.getElementById('runnerActivityChart');
  if (!el) return;
  const c = themeColors();
  const all = state.deposits;
  const allMonthly = aggregateByMonth(all, 'all');
  const labels = allMonthly.map(m => m.label);
  const totalRunners = new Set(all.map(d => d.runner)).size;
  const avgData = allMonthly.map(m => m.tickets / totalRunners);

  let mineData;
  if (state.selectedRunner) {
    const mine = aggregateByMonth(all.filter(d => d.runner === state.selectedRunner), 'all');
    const byLabel = new Map(mine.map(m => [m.label, m.tickets]));
    mineData = labels.map(l => byLabel.get(l) || 0);
  } else {
    mineData = allMonthly.map(m => m.tickets);
  }

  destroyChart('runnerActivity');
  state.charts.runnerActivity = new Chart(ctx('runnerActivityChart'), {
    data: {
      labels,
      datasets: [
        { type: 'bar', label: state.selectedRunner ? 'Their runs' : 'Total runs', data: mineData,
          backgroundColor: c.green, borderRadius: 3, order: 2 },
        { type: 'line', label: 'Faction average per runner', data: avgData,
          borderColor: c.textLight, borderWidth: 2, borderDash: [5, 4], pointRadius: 0, tension: 0.3, order: 1 }
      ]
    },
    options: baseOptions(c, {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { color: c.text, boxWidth: 12, padding: 10 } }
      },
      scales: {
        x: { title: axisTitle(c, 'Month'), ticks: { color: c.textLight, maxTicksLimit: 10 }, grid: { display: false } },
        y: { title: axisTitle(c, 'Runs'), beginAtZero: true, ticks: { color: c.textLight }, grid: { color: c.grid } }
      }
    })
  });
}

function recentDepositsTable(allSorted) {
  if (!allSorted.length) return '<div class="mini-empty">No deposits yet.</div>';
  const recent = allSorted.slice(-20);
  const { key, dir } = state.runnerTableSort;
  const sorted = recent.slice().sort((a, b) => {
    let av = a[key], bv = b[key];
    if (key === 'paid') { av = av ? 1 : 0; bv = bv ? 1 : 0; }
    if (av < bv) return dir === 'asc' ? -1 : 1;
    if (av > bv) return dir === 'asc' ? 1 : -1;
    return 0;
  });
  const cls = k => k === key ? (dir === 'asc' ? ' class="sorted-asc"' : ' class="sorted-desc"') : '';
  return '<table class="mini-table" id="runnerDepTable"><thead><tr>' +
    '<th data-rsort="date"' + cls('date') + '>Date</th>' +
    '<th data-rsort="processed_by"' + cls('processed_by') + '>Pharmacist</th>' +
    '<th data-rsort="reimbursement"' + cls('reimbursement') + '>Reimbursed</th>' +
    '<th data-rsort="paid"' + cls('paid') + '>Paid</th>' +
    '</tr></thead><tbody>' +
    sorted.map(r => '<tr>' +
      '<td>' + formatShortDate(r.date) + '</td>' +
      '<td>' + esc(r.processed_by) + '</td>' +
      '<td>' + formatMoney(r.reimbursement) + '</td>' +
      '<td class="' + (r.paid ? 'paid-yes' : 'paid-no') + '">' + (r.paid ? 'Yes' : 'No') + '</td>' +
      '</tr>').join('') +
    '</tbody></table>';
}

// =====================================================================
// Pricing: cheapest run price over time
// =====================================================================
function dailyPriceSeries() {
  const byDate = new Map();
  state.deposits.forEach(d => {
    if (!d.cheapest_run || d.cheapest_run <= 1) return; // skip junk / unpriced
    if (!byDate.has(d.date) || d.cheapest_run < byDate.get(d.date)) byDate.set(d.date, d.cheapest_run);
  });
  return [...byDate.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([date, price]) => ({ x: date, y: price }));
}

function renderPriceChart() {
  const points = dailyPriceSeries();
  const ma = points.map((p, i) => {
    const win = points.slice(Math.max(0, i - 29), i + 1);
    return { x: p.x, y: win.reduce((s, q) => s + q.y, 0) / win.length };
  });
  const c = themeColors();

  destroyChart('price');
  state.charts.price = new Chart(ctx('priceChart'), {
    type: 'line',
    data: {
      datasets: [
        { label: 'Daily lowest price', data: points, borderColor: 'transparent',
          backgroundColor: hexA(c.slate, 0.55), pointRadius: 2.5, pointBackgroundColor: hexA(c.slate, 0.55), showLine: false },
        { label: '30-day moving average', data: ma, borderColor: c.green,
          backgroundColor: 'transparent', borderWidth: 2.5, pointRadius: 0, tension: 0.2 }
      ]
    },
    options: baseOptions(c, {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { color: c.text, boxWidth: 12, padding: 10 } },
        tooltip: { callbacks: {
          title: items => formatLongDate(items[0].parsed.x),
          label: ci => ci.dataset.label + ': ' + formatMoney(ci.parsed.y)
        } }
      },
      scales: {
        x: timeScale(c, 'Date'),
        y: { title: axisTitle(c, 'Price per run ($)'), ticks: { color: c.textLight, callback: v => formatMoney(v) }, grid: { color: c.grid } }
      }
    })
  });
}

function renderPricingCallouts() {
  const points = dailyPriceSeries();
  if (!points.length) {
    ['prCurrent', 'prLow', 'prHigh'].forEach(id => setText(id, 'n/a'));
    return;
  }
  const current = points[points.length - 1];
  let low = points[0], high = points[0];
  points.forEach(p => { if (p.y < low.y) low = p; if (p.y > high.y) high = p; });

  setText('prCurrent', formatMoney(current.y));
  setText('prCurrentDetail', 'As of ' + formatShortDate(current.x));
  setText('prLow', formatMoney(low.y));
  setText('prLowDetail', 'On ' + formatShortDate(low.x));
  setText('prHigh', formatMoney(high.y));
  setText('prHighDetail', 'On ' + formatShortDate(high.x));
}

function renderPharmacistChart() {
  const months = new Map(); // monthKey -> Map(pharmacist -> count)
  state.deposits.forEach(d => {
    const key = d.date.slice(0, 7);
    if (!months.has(key)) months.set(key, new Map());
    const p = d.processed_by || 'Unknown';
    const m = months.get(key);
    m.set(p, (m.get(p) || 0) + 1);
  });
  const sortedMonths = [...months.keys()].sort();
  const pharmacists = new Set();
  months.forEach(m => m.forEach((_, k) => pharmacists.add(k)));
  const pList = [...pharmacists].sort();
  const palette = categoricalPalette(pList.length);
  const c = themeColors();

  destroyChart('pharmacist');
  state.charts.pharmacist = new Chart(ctx('pharmacistChart'), {
    type: 'bar',
    data: {
      labels: sortedMonths.map(monthLabel),
      datasets: pList.map((p, i) => ({
        label: p, data: sortedMonths.map(m => months.get(m).get(p) || 0),
        backgroundColor: palette[i], borderRadius: 2
      }))
    },
    options: baseOptions(c, {
      plugins: {
        legend: { position: 'top', labels: { color: c.text, boxWidth: 12, padding: 10 } }
      },
      scales: {
        x: { title: axisTitle(c, 'Month'), stacked: true, ticks: { color: c.textLight, maxTicksLimit: 12 }, grid: { display: false } },
        y: { title: axisTitle(c, 'Tickets'), stacked: true, beginAtZero: true, ticks: { color: c.textLight }, grid: { color: c.grid } }
      }
    })
  });
}

// =====================================================================
// Sales
// =====================================================================
function renderSalesTimeChart() {
  // Monthly xanax sold and value, real purchases only (exclude refunds).
  const months = new Map(); // monthKey -> { qty, value }
  state.sales.forEach(s => {
    if (s.price_per <= 0 || s.qty <= 0 || !s.date) return;
    const key = s.date.slice(0, 7);
    if (!months.has(key)) months.set(key, { qty: 0, value: 0 });
    const m = months.get(key);
    m.qty += s.qty; m.value += (s.total_value || 0);
  });
  const sortedMonths = [...months.keys()].sort();
  const c = themeColors();

  destroyChart('salesTime');
  state.charts.salesTime = new Chart(ctx('salesTimeChart'), {
    data: {
      labels: sortedMonths.map(monthLabel),
      datasets: [
        { type: 'bar', label: 'Xanax sold', data: sortedMonths.map(m => months.get(m).qty),
          backgroundColor: c.gold, borderRadius: 3, yAxisID: 'y', order: 2 },
        { type: 'line', label: 'Sale value', data: sortedMonths.map(m => months.get(m).value),
          borderColor: c.green, backgroundColor: c.green, borderWidth: 2, pointRadius: 2, tension: 0.3, yAxisID: 'y1', order: 1 }
      ]
    },
    options: baseOptions(c, {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { color: c.text, boxWidth: 12, padding: 10 } },
        tooltip: { callbacks: { label: ci => ci.dataset.yAxisID === 'y1'
          ? 'Value: ' + formatMoney(ci.parsed.y)
          : 'Xanax sold: ' + ci.parsed.y.toLocaleString() } }
      },
      scales: {
        x: { title: axisTitle(c, 'Month'), ticks: { color: c.textLight, maxTicksLimit: 12 }, grid: { display: false } },
        y: { position: 'left', beginAtZero: true, title: axisTitle(c, 'Xanax sold'), ticks: { color: c.textLight, callback: v => formatCompact(v) }, grid: { color: c.grid } },
        y1: { position: 'right', beginAtZero: true, title: axisTitle(c, 'Value ($)'), ticks: { color: c.textLight, callback: v => formatMoney(v) }, grid: { display: false } }
      }
    })
  });
}

function renderBuyersChart() {
  const byBuyer = new Map();
  state.sales.forEach(s => {
    if (s.price_per <= 0 || s.qty <= 0) return; // skip refunds / non-purchases
    byBuyer.set(s.purchaser, (byBuyer.get(s.purchaser) || 0) + s.qty);
  });
  const top = [...byBuyer.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const palette = categoricalPalette(top.length);
  const c = themeColors();

  destroyChart('buyers');
  state.charts.buyers = new Chart(ctx('buyersChart'), {
    type: 'doughnut',
    data: { labels: top.map(t => t[0]), datasets: [{ data: top.map(t => t[1]), backgroundColor: palette, borderColor: c.bg, borderWidth: 2 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { color: c.text, boxWidth: 12, padding: 8, font: { size: 11 } } },
        tooltip: { callbacks: { label: ci => ci.label + ': ' + formatCompact(ci.parsed) + ' xanax' } }
      },
      cutout: '58%'
    }
  });
}

function renderSalesScatter() {
  const points = state.sales
    .filter(s => s.qty > 0 && s.price_per > 0)
    .map(s => ({ x: s.qty, y: s.price_per, buyer: s.purchaser, date: s.date }));
  const c = themeColors();

  destroyChart('salesScatter');
  state.charts.salesScatter = new Chart(ctx('salesScatterChart'), {
    type: 'scatter',
    data: { datasets: [{ label: 'Sales', data: points, backgroundColor: hexA(c.green, 0.6), pointRadius: 5, pointHoverRadius: 7 }] },
    options: baseOptions(c, {
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ci =>
          ci.raw.buyer + ', ' + ci.raw.x.toLocaleString() + ' @ ' + formatMoney(ci.raw.y) + ' (' + formatShortDate(ci.raw.date) + ')'
        } }
      },
      scales: {
        x: { title: axisTitle(c, 'Quantity'), beginAtZero: true, ticks: { color: c.textLight }, grid: { color: c.grid } },
        y: { title: axisTitle(c, 'Price per xanax ($)'), ticks: { color: c.textLight, callback: v => formatMoney(v) }, grid: { color: c.grid } }
      }
    })
  });
}

function renderSalesCallouts() {
  const sales = state.sales;
  const totalValue = sum(sales, s => s.total_value || 0);
  setText('saTotal', formatMoney(totalValue));
  setText('saTotalDetail', sales.length + (sales.length === 1 ? ' transaction' : ' transactions') + ' (net of refunds)');

  let biggest = null;
  sales.forEach(s => { if ((s.total_value || 0) > 0 && (!biggest || s.total_value > biggest.total_value)) biggest = s; });
  if (biggest) {
    setText('saBiggest', formatMoney(biggest.total_value));
    setText('saBiggestDetail', esc(biggest.purchaser) + ' on ' + formatShortDate(biggest.date));
  } else {
    setText('saBiggest', 'n/a');
  }
}

// =====================================================================
// Raw data
// =====================================================================
function populateRawFilters() {
  const pharmacists = [...new Set(state.deposits.map(d => d.processed_by).filter(Boolean))].sort();
  const sel = document.getElementById('rawPharmacist');
  pharmacists.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p; opt.textContent = p;
    sel.appendChild(opt);
  });
}

function renderRawTable() {
  const f = state.rawFilter;
  let rows = state.deposits.slice();
  if (f.search) {
    const q = f.search.toLowerCase();
    rows = rows.filter(r => (r.runner || '').toLowerCase().includes(q) || (r.ticket || '').toLowerCase().includes(q));
  }
  if (f.pharmacist) rows = rows.filter(r => r.processed_by === f.pharmacist);
  if (f.paid) rows = rows.filter(r => f.paid === 'paid' ? r.paid : !r.paid);

  const { key, dir } = state.rawSort;
  rows.sort((a, b) => {
    let av = a[key], bv = b[key];
    if (key === 'paid') { av = av ? 1 : 0; bv = bv ? 1 : 0; }
    if (av < bv) return dir === 'asc' ? -1 : 1;
    if (av > bv) return dir === 'asc' ? 1 : -1;
    return 0;
  });

  setText('rawCount', rows.length.toLocaleString() + ' of ' + state.deposits.length.toLocaleString() + ' rows');

  const display = rows.slice(0, 500);
  document.getElementById('rawTableBody').innerHTML = display.map(r =>
    '<tr>' +
      '<td>' + formatShortDate(r.date) + '</td>' +
      '<td>' + runnerHTML(r.runner) + '</td>' +
      '<td>' + esc(r.ticket) + '</td>' +
      '<td>' + formatMoney(r.cheapest_run) + '</td>' +
      '<td>' + r.qty + '</td>' +
      '<td>' + esc(r.processed_by) + '</td>' +
      '<td>' + formatMoney(r.reimbursement) + '</td>' +
      '<td class="' + (r.paid ? 'paid-yes' : 'paid-no') + '">' + (r.paid ? 'Yes' : 'No') + '</td>' +
    '</tr>').join('');

  document.querySelectorAll('#rawTable th').forEach(th => {
    th.classList.remove('sorted-asc', 'sorted-desc');
    if (th.dataset.sort === key) th.classList.add(dir === 'asc' ? 'sorted-asc' : 'sorted-desc');
  });
}

// =====================================================================
// UI wiring (one-time)
// =====================================================================
function wireUI() {
  // Monthly volume range buttons
  document.querySelectorAll('#activityRangeFilter .filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#activityRangeFilter .filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activityRange = btn.dataset.range === 'all' ? 'all' : Number(btn.dataset.range);
      renderActivityChart();
    });
  });

  // Runner search autocomplete
  const input = document.getElementById('runnerSearch');
  const suggestions = document.getElementById('runnerSuggestions');
  const clearBtn = document.getElementById('runnerClear');
  const names = Object.keys(groupBy(state.deposits, 'runner')).sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : 1);
  let highlight = -1;

  function renderSuggestions(q) {
    const matches = names.filter(n => n.toLowerCase().includes(q)).slice(0, 8);
    highlight = -1;
    if (!matches.length) {
      suggestions.innerHTML = '<div class="runner-suggestion" style="color:var(--text-light);cursor:default;">No matches</div>';
    } else {
      suggestions.innerHTML = matches.map(n => {
        const runs = state.deposits.filter(d => d.runner === n).length;
        return '<div class="runner-suggestion" data-name="' + esc(n) + '"><span>' + runnerHTML(n) +
          '</span><span class="runner-suggestion-meta">' + runs + ' runs</span></div>';
      }).join('');
    }
    suggestions.classList.add('open');
  }

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    clearBtn.style.display = input.value ? 'block' : 'none';
    if (!q) { suggestions.classList.remove('open'); return; }
    renderSuggestions(q);
  });

  input.addEventListener('focus', () => {
    const q = input.value.trim().toLowerCase();
    if (q) renderSuggestions(q);
  });

  input.addEventListener('keydown', e => {
    const items = [...suggestions.querySelectorAll('.runner-suggestion[data-name]')];
    if (!suggestions.classList.contains('open') || !items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); highlight = Math.min(highlight + 1, items.length - 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlight = Math.max(highlight - 1, 0); }
    else if (e.key === 'Enter') { e.preventDefault(); if (highlight >= 0) selectRunner(items[highlight].dataset.name); else if (items.length === 1) selectRunner(items[0].dataset.name); return; }
    else if (e.key === 'Escape') { suggestions.classList.remove('open'); return; }
    else return;
    items.forEach((it, i) => it.classList.toggle('highlighted', i === highlight));
  });

  suggestions.addEventListener('click', e => {
    const item = e.target.closest('.runner-suggestion');
    if (item && item.dataset.name) selectRunner(item.dataset.name);
  });

  clearBtn.addEventListener('click', () => selectRunner(null));

  document.addEventListener('click', e => {
    if (!e.target.closest('.runner-search-wrapper')) suggestions.classList.remove('open');
  });

  // Recent-deposits sortable headers (delegated; table is re-rendered)
  document.getElementById('runnerDashboard').addEventListener('click', e => {
    const th = e.target.closest('th[data-rsort]');
    if (!th) return;
    const key = th.dataset.rsort;
    if (state.runnerTableSort.key === key) {
      state.runnerTableSort.dir = state.runnerTableSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      state.runnerTableSort.key = key;
      state.runnerTableSort.dir = key === 'date' ? 'desc' : 'asc';
    }
    renderRunnerDashboard();
  });

  // Raw data controls
  document.getElementById('rawSearch').addEventListener('input', e => { state.rawFilter.search = e.target.value; renderRawTable(); });
  document.getElementById('rawPharmacist').addEventListener('change', e => { state.rawFilter.pharmacist = e.target.value; renderRawTable(); });
  document.getElementById('rawPaid').addEventListener('change', e => { state.rawFilter.paid = e.target.value; renderRawTable(); });
  document.querySelectorAll('#rawTable th').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.rawSort.key === key) state.rawSort.dir = state.rawSort.dir === 'asc' ? 'desc' : 'asc';
      else { state.rawSort.key = key; state.rawSort.dir = key === 'date' ? 'desc' : 'asc'; }
      renderRawTable();
    });
  });
}

function selectRunner(name) {
  state.selectedRunner = name;
  state.runnerTableSort = { key: 'date', dir: 'desc' };
  document.getElementById('runnerSearch').value = name || '';
  document.getElementById('runnerClear').style.display = name ? 'block' : 'none';
  document.getElementById('runnerSuggestions').classList.remove('open');
  renderRunnerDashboard();
}

// Re-render charts/heatmap with new theme colours when the toggle flips.
function watchTheme() {
  let last = document.documentElement.getAttribute('data-theme');
  new MutationObserver(() => {
    const now = document.documentElement.getAttribute('data-theme');
    if (now === last) return;
    last = now;
    applyChartDefaults();
    renderAll();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

// =====================================================================
// Aggregation helpers
// =====================================================================
function aggregateByMonth(deposits, rangeMonths) {
  const cutoff = rangeMonths === 'all' ? null : monthsAgoStr(rangeMonths);
  const filtered = cutoff ? deposits.filter(d => d.date >= cutoff) : deposits;
  const buckets = new Map();
  filtered.forEach(d => {
    const key = d.date.slice(0, 7);
    if (!buckets.has(key)) buckets.set(key, { tickets: 0, xanax: 0, priceSum: 0, priceCount: 0 });
    const b = buckets.get(key);
    b.tickets++; b.xanax += d.qty;
    if (d.cheapest_run > 1) { b.priceSum += d.cheapest_run; b.priceCount++; }
  });
  return [...buckets.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([key, v]) => ({
    label: monthLabel(key), tickets: v.tickets, xanax: v.xanax,
    avgPrice: v.priceCount ? v.priceSum / v.priceCount : null
  }));
}

function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    (acc[item[key]] = acc[item[key]] || []).push(item);
    return acc;
  }, {});
}

function consistencyScore(sorted) {
  if (sorted.length < 3) return { label: 'New', detail: 'Not enough runs yet' };
  const dates = sorted.map(d => new Date(d.date));
  const gaps = [];
  for (let i = 1; i < dates.length; i++) gaps.push((dates[i] - dates[i - 1]) / 86400000);
  const avg = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  if (avg === 0) return { label: 'Clockwork', detail: 'Multiple runs per day' };
  const variance = gaps.reduce((s, g) => s + (g - avg) ** 2, 0) / gaps.length;
  const cv = Math.sqrt(variance) / avg;
  let label;
  if (cv < 0.6) label = 'Clockwork';
  else if (cv < 1.2) label = 'Steady';
  else if (cv < 2) label = 'Streaky';
  else label = 'Sporadic';
  return { label, detail: 'About ' + avg.toFixed(1) + ' days between runs' };
}

function currentStreak(sorted) {
  if (!sorted.length) return { value: 'None', detail: 'No runs yet' };
  const weeks = new Set();
  sorted.forEach(d => weeks.add(mondayOf(new Date(d.date)).getTime()));
  const sortedWeeks = [...weeks].sort((a, b) => a - b);
  const WEEK = 7 * 86400000;
  const thisMonday = mondayOf(new Date()).getTime();
  const lastMonday = sortedWeeks[sortedWeeks.length - 1];

  // Active only if the latest week is this week or last week.
  if (thisMonday - lastMonday > WEEK + 1000) {
    return { value: 'Inactive', detail: 'Last run ' + daysSinceLabel(sorted[sorted.length - 1].date).toLowerCase() };
  }
  let streak = 1;
  for (let i = sortedWeeks.length - 1; i > 0; i--) {
    if (sortedWeeks[i] - sortedWeeks[i - 1] <= WEEK + 1000) streak++;
    else break;
  }
  return { value: streak + (streak === 1 ? ' week' : ' weeks'), detail: 'Consecutive weeks with a run' };
}

function bestAndQuietestMonths(sorted) {
  if (!sorted.length) return { bestLabel: 'n/a', quietLabel: 'n/a' };
  const byMonth = new Map();
  sorted.forEach(d => { const k = d.date.slice(0, 7); byMonth.set(k, (byMonth.get(k) || 0) + 1); });
  const entries = [...byMonth.entries()];
  const best = entries.reduce((a, b) => b[1] > a[1] ? b : a);
  const quiet = entries.reduce((a, b) => b[1] < a[1] ? b : a);
  return {
    bestLabel: monthLabel(best[0]) + ' (' + best[1] + ')',
    quietLabel: monthLabel(quiet[0]) + ' (' + quiet[1] + ')'
  };
}

// =====================================================================
// Chart helpers
// =====================================================================
function applyChartDefaults() {
  const c = themeColors();
  Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  Chart.defaults.color = c.textLight;
}

function baseOptions(c, extra) {
  return Object.assign({ responsive: true, maintainAspectRatio: false }, extra);
}

function axisTitle(c, text) {
  return { display: true, text, color: c.textLight, font: { size: 12, weight: '500' } };
}

function timeScale(c, title) {
  return {
    type: 'time',
    time: { unit: 'month', displayFormats: { month: 'MMM yy' } },
    title: axisTitle(c, title),
    ticks: { color: c.textLight },
    grid: { display: false }
  };
}

function ctx(id) { return document.getElementById(id).getContext('2d'); }
function destroyChart(key) { if (state.charts[key]) { state.charts[key].destroy(); delete state.charts[key]; } }

function themeColors() {
  const r = getComputedStyle(document.documentElement);
  return {
    green: r.getPropertyValue('--c-green').trim() || r.getPropertyValue('--green').trim(),
    teal: r.getPropertyValue('--c-teal').trim(),
    gold: r.getPropertyValue('--c-gold').trim(),
    olive: r.getPropertyValue('--c-olive').trim(),
    slate: r.getPropertyValue('--c-slate').trim(),
    rust: r.getPropertyValue('--c-rust').trim(),
    red: r.getPropertyValue('--red').trim(),
    text: r.getPropertyValue('--text').trim(),
    textLight: r.getPropertyValue('--text-light').trim(),
    grid: r.getPropertyValue('--gray-200').trim(),
    bg: r.getPropertyValue('--white').trim()
  };
}

function categoricalPalette(n) {
  return Array.from({ length: n }, (_, i) => CATEGORICAL_COLORS[i % CATEGORICAL_COLORS.length]);
}

function hexA(hex, a) {
  const m = hex.match(/#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return hex;
  return 'rgba(' + parseInt(m[1], 16) + ', ' + parseInt(m[2], 16) + ', ' + parseInt(m[3], 16) + ', ' + a + ')';
}

// =====================================================================
// Small utilities
// =====================================================================
function sum(arr, fn) { return arr.reduce((s, x) => s + (fn(x) || 0), 0); }

// A runner is "former" if there is a roster and they are not on it.
function isFormer(name) { return state.activeRunners.size > 0 && !state.activeRunners.has(name); }
function runnerText(name) { return isFormer(name) ? name + ' *' : name; } // plain text (chart labels)
function runnerHTML(name) {
  return esc(name) + (isFormer(name) ? '<span class="former-mark" title="No longer in the faction">*</span>' : '');
}


function mondayOf(date) {
  const d = new Date(date);
  const diff = (d.getDay() + 6) % 7;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - diff);
  return d;
}

function monthsAgoStr(n) { const d = new Date(); d.setMonth(d.getMonth() - n); return d.toISOString().slice(0, 10); }
function daysAgoStr(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }

function monthLabel(yyyymm) {
  if (!yyyymm) return '';
  const [y, m] = yyyymm.split('-');
  return MONTHS[Number(m) - 1] + ' ' + y.slice(2);
}

function formatMoney(n) {
  if (n == null) return '$0';
  return (n < 0 ? '-$' : '$') + formatCompact(Math.abs(n));
}

function formatCompact(n) {
  if (n == null) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return Math.round(n).toLocaleString();
}

function formatShortDate(s) {
  if (!s) return 'n/a';
  return new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
}

function formatLongDate(s) {
  if (!s) return '';
  return new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function daysSinceLabel(dateStr) {
  if (!dateStr) return '';
  const days = Math.round((Date.now() - new Date(dateStr)) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return days + ' days ago';
  if (days < 30) return Math.floor(days / 7) + ' weeks ago';
  if (days < 365) return Math.floor(days / 30) + ' months ago';
  return Math.floor(days / 365) + ' years ago';
}

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
function setHTML(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html; }
