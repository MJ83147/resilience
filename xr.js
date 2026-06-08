// Resilience XR Dashboard
const DATA_URL = 'data/xr.json';
const XANAX_PRICE = 800000; // Hardcoded for now

const state = {
  data: null,
  activityRange: 12,
  selectedRunner: null,
  rawSort: { key: 'date', dir: 'desc' },
  rawFilter: { search: '', pharmacist: '', paid: '' },
  charts: {}
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    const resp = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    state.data = await resp.json();
    document.getElementById('setupSection').style.display = 'none';
    document.getElementById('dashboardContent').style.display = 'block';
    renderAll();
    wireUI();
  } catch (err) {
    document.getElementById('loadingMessage').style.display = 'none';
    const errEl = document.getElementById('errorMessage');
    errEl.style.display = 'block';
    errEl.textContent = `Couldn't load dashboard data: ${err.message}`;
  }
}

function renderAll() {
  renderLastUpdated();
  renderKPIs();
  renderCumulativeChart();
  renderHeatmap();
  renderActivityChart();
  renderParetoChart();
  renderCohortChart();
  renderRunnerDashboard();
  renderPriceChart();
  renderPharmacistChart();
  renderBuyersChart();
  renderSalesScatter();
  renderRawTable();
  populateRawFilters();
}

// =====================================================================
// Tab switching
// =====================================================================
function showTab(name) {
  document.querySelectorAll('.tab-section').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-buttons button').forEach(el => el.classList.remove('active'));
  document.getElementById(`tab-${name}`).classList.add('active');
  document.getElementById(`tabBtn-${name}`).classList.add('active');
  // Chart.js needs a resize trigger when revealed from display:none
  setTimeout(() => Object.values(state.charts).forEach(c => c && c.resize && c.resize()), 50);
}
window.showTab = showTab;

// =====================================================================
// Last updated + KPIs
// =====================================================================
function renderLastUpdated() {
  const dt = new Date(state.data.generated_at);
  document.getElementById('lastUpdated').textContent =
    `Last updated: ${dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

function renderKPIs() {
  const { deposits } = state.data;
  const totalXanax = deposits.reduce((s, d) => s + d.qty, 0);
  const totalReimbursed = deposits.reduce((s, d) => s + d.reimbursement, 0);
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
// Overview: cumulative chart
// =====================================================================
function renderCumulativeChart() {
  const sorted = [...state.data.deposits].sort((a, b) => a.date < b.date ? -1 : 1);
  let cumXanax = 0;
  const points = sorted.map(d => {
    cumXanax += d.qty;
    return { x: d.date, y: cumXanax };
  });

  const labels = points.map(p => p.x);
  const data = points.map(p => p.y);

  const ctx = document.getElementById('cumulativeChart').getContext('2d');
  destroyChart('cumulative');
  const colors = themeColors();

  state.charts.cumulative = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Cumulative Xanax',
        data,
        borderColor: colors.green,
        backgroundColor: hexA(colors.green, 0.15),
        borderWidth: 2,
        pointRadius: 0,
        fill: true,
        tension: 0.1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: items => formatLongDate(items[0].label),
            label: ctx => `Cumulative: ${formatCompact(ctx.parsed.y)} xanax`
          }
        }
      },
      scales: {
        x: {
          type: 'time',
          time: { unit: 'month', displayFormats: { month: 'MMM yy' } },
          grid: { display: false }
        },
        y: { beginAtZero: true, ticks: { callback: v => formatCompact(v) }, grid: { color: colors.grid } }
      }
    }
  });
}

// =====================================================================
// Overview: heatmap (day of week x hour)
// =====================================================================
function renderHeatmap() {
  // Build 7x24 grid using deposit timestamps from Date Submitted (we have date only on the JSON deposit, so derive day-of-week from date and assume UTC hour distribution from a secondary pass)
  // Since we only have dates not full timestamps in the JSON, fall back to day-of-week density only and use a calendar-week heatmap instead.
  // 7 rows (Mon-Sun) x weeks columns from earliest to latest, or simpler: 7 rows x month columns.
  // Cleanest: 7 days x 53 weeks-of-year is too sparse. Use 7 days (rows) x last 26 weeks (cols).
  const buckets = new Map(); // key: `${weekIdx}_${dow}` -> count
  const today = new Date();
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - 7 * 26);
  const weekStart = d => {
    const date = new Date(d);
    const diff = (date.getDay() + 6) % 7; // make Monday=0
    date.setDate(date.getDate() - diff);
    date.setHours(0, 0, 0, 0);
    return date;
  };
  const firstWeek = weekStart(cutoff);

  state.data.deposits.forEach(dep => {
    const d = new Date(dep.date);
    if (d < cutoff) return;
    const dow = (d.getDay() + 6) % 7; // Mon=0
    const wStart = weekStart(d);
    const weekIdx = Math.round((wStart - firstWeek) / (7 * 86400000));
    const key = `${weekIdx}_${dow}`;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  });

  const cells = [];
  for (let w = 0; w < 26; w++) {
    for (let dow = 0; dow < 7; dow++) {
      cells.push({ x: w, y: dow, v: buckets.get(`${w}_${dow}`) || 0 });
    }
  }
  const maxV = Math.max(1, ...cells.map(c => c.v));

  const ctx = document.getElementById('heatmapChart').getContext('2d');
  destroyChart('heatmap');
  const colors = themeColors();

  state.charts.heatmap = new Chart(ctx, {
    type: 'matrix',
    data: {
      datasets: [{
        label: 'Deposits',
        data: cells,
        backgroundColor: c => {
          const v = c.raw.v;
          if (v === 0) return colors.grid;
          const alpha = 0.15 + 0.85 * (v / maxV);
          return hexA(colors.green, alpha);
        },
        borderWidth: 1,
        borderColor: colors.bg,
        width: ({ chart }) => (chart.chartArea || {}).width / 26 - 2,
        height: ({ chart }) => (chart.chartArea || {}).height / 7 - 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: () => '',
            label: ctx => {
              const dow = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][ctx.raw.y];
              const weekDate = new Date(firstWeek);
              weekDate.setDate(weekDate.getDate() + ctx.raw.x * 7 + ctx.raw.y);
              return `${dow} ${weekDate.toLocaleDateString('en-GB',{day:'numeric',month:'short'})}: ${ctx.raw.v} deposits`;
            }
          }
        }
      },
      scales: {
        x: {
          type: 'linear',
          min: -0.5, max: 25.5,
          ticks: {
            stepSize: 4,
            callback: v => {
              const date = new Date(firstWeek);
              date.setDate(date.getDate() + v * 7);
              return date.toLocaleDateString('en-GB', { month: 'short' });
            }
          },
          grid: { display: false }
        },
        y: {
          type: 'linear',
          min: -0.5, max: 6.5, reverse: true,
          ticks: {
            stepSize: 1,
            callback: v => ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][v] || ''
          },
          grid: { display: false }
        }
      }
    }
  });
}

// =====================================================================
// Overview: monthly activity (bar + price line)
// =====================================================================
function renderActivityChart() {
  const monthly = aggregateByMonth(state.data.deposits, state.activityRange);
  const labels = monthly.map(m => m.label);
  const values = monthly.map(m => m.tickets);
  const prices = monthly.map(m => m.avgPrice);

  destroyChart('activity');
  const ctx = document.getElementById('activityChart').getContext('2d');
  const colors = themeColors();

  state.charts.activity = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        { type: 'bar', label: 'Tickets', data: values, backgroundColor: colors.green, borderRadius: 4, yAxisID: 'y' },
        { type: 'line', label: 'Avg run price', data: prices, borderColor: colors.textLight, borderWidth: 2, pointRadius: 3, pointBackgroundColor: colors.textLight, tension: 0.3, yAxisID: 'y1', spanGaps: true }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 12, boxHeight: 12, padding: 12 } },
        tooltip: {
          callbacks: {
            label: ctx => {
              if (ctx.parsed.y == null) return null;
              if (ctx.dataset.yAxisID === 'y1') return `Avg price: ${formatMoney(ctx.parsed.y)}`;
              return `Tickets: ${ctx.parsed.y}`;
            }
          }
        }
      },
      scales: {
        x: { grid: { display: false } },
        y: { position: 'left', beginAtZero: true, grid: { color: colors.grid } },
        y1: { position: 'right', beginAtZero: false, grid: { display: false }, ticks: { callback: v => formatMoney(v) } }
      }
    }
  });
}

// =====================================================================
// Runners: pareto chart
// =====================================================================
function renderParetoChart() {
  const byRunner = groupBy(state.data.deposits, 'runner');
  const sorted = Object.entries(byRunner)
    .map(([name, deps]) => ({ name, count: deps.length }))
    .sort((a, b) => b.count - a.count);

  const total = sorted.reduce((s, r) => s + r.count, 0);
  let cum = 0;
  const cumPct = sorted.map(r => {
    cum += r.count;
    return (cum / total) * 100;
  });

  destroyChart('pareto');
  const ctx = document.getElementById('paretoChart').getContext('2d');
  const colors = themeColors();

  state.charts.pareto = new Chart(ctx, {
    data: {
      labels: sorted.map(r => r.name),
      datasets: [
        { type: 'bar', label: 'Runs', data: sorted.map(r => r.count), backgroundColor: colors.green, yAxisID: 'y' },
        { type: 'line', label: 'Cumulative %', data: cumPct, borderColor: colors.textLight, borderWidth: 2, pointRadius: 0, tension: 0.1, yAxisID: 'y1' }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              if (ctx.dataset.yAxisID === 'y1') return `Cumulative: ${ctx.parsed.y.toFixed(1)}%`;
              return `Runs: ${ctx.parsed.y}`;
            }
          }
        }
      },
      scales: {
        x: { ticks: { display: false }, grid: { display: false } },
        y: { beginAtZero: true, grid: { color: colors.grid } },
        y1: { position: 'right', beginAtZero: true, max: 100, ticks: { callback: v => v + '%' }, grid: { display: false } }
      }
    }
  });
}

// =====================================================================
// Runners: cohort area
// =====================================================================
function renderCohortChart() {
  // Cohort = month each runner first deposited
  const runners = {};
  state.data.deposits.forEach(d => {
    if (!runners[d.runner] || d.date < runners[d.runner]) runners[d.runner] = d.date;
  });
  const cohortByRunner = Object.fromEntries(
    Object.entries(runners).map(([r, firstDate]) => [r, firstDate.slice(0, 7)])
  );

  // Per month, count tickets by cohort
  const months = new Set();
  const cohortTotals = new Map(); // cohort -> total tickets
  const grid = new Map(); // monthKey -> cohort -> count
  state.data.deposits.forEach(d => {
    const monthKey = d.date.slice(0, 7);
    months.add(monthKey);
    const cohort = cohortByRunner[d.runner];
    if (!grid.has(monthKey)) grid.set(monthKey, new Map());
    const m = grid.get(monthKey);
    m.set(cohort, (m.get(cohort) || 0) + 1);
    cohortTotals.set(cohort, (cohortTotals.get(cohort) || 0) + 1);
  });

  const sortedMonths = Array.from(months).sort();
  // Take top 6 cohorts by total contribution, group rest as "Other"
  const topCohorts = Array.from(cohortTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(e => e[0])
    .sort();

  const datasets = topCohorts.map((cohort, i) => {
    const data = sortedMonths.map(m => {
      const v = grid.get(m).get(cohort) || 0;
      return v;
    });
    const palette = greenPalette(topCohorts.length);
    return {
      label: `Joined ${monthLabel(cohort)}`,
      data,
      backgroundColor: palette[i],
      borderColor: palette[i],
      fill: true,
      pointRadius: 0,
      tension: 0.2
    };
  });

  // "Other" cohorts grouped
  const otherData = sortedMonths.map(m => {
    let total = 0;
    grid.get(m).forEach((v, k) => { if (!topCohorts.includes(k)) total += v; });
    return total;
  });
  if (otherData.some(v => v > 0)) {
    const colors = themeColors();
    datasets.push({
      label: 'Other cohorts',
      data: otherData,
      backgroundColor: hexA(colors.textLight, 0.3),
      borderColor: hexA(colors.textLight, 0.3),
      fill: true,
      pointRadius: 0,
      tension: 0.2
    });
  }

  destroyChart('cohort');
  const ctx = document.getElementById('cohortChart').getContext('2d');
  const colors = themeColors();

  state.charts.cohort = new Chart(ctx, {
    type: 'line',
    data: { labels: sortedMonths.map(monthLabel), datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, padding: 8, font: { size: 11 } } },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y}` } }
      },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, stacked: true, grid: { color: colors.grid } }
      }
    }
  });
}

// =====================================================================
// Runner mini-dashboard (with search)
// =====================================================================
function renderRunnerDashboard() {
  const container = document.getElementById('runnerDashboard');
  const stats = computeRunnerStats(state.selectedRunner);
  container.innerHTML = `
    <div class="runner-stat-grid">
      ${stats.tiles.map(t => `
        <div class="runner-stat">
          <div class="runner-stat-value">${t.value}</div>
          <div class="runner-stat-label">${t.label}</div>
          <div class="runner-stat-compare">${t.compare}</div>
        </div>
      `).join('')}
    </div>

    <div class="callout-row">
      ${stats.callouts.map(c => `
        <div class="callout">
          <div class="callout-label">${c.label}</div>
          <div class="callout-value">${c.value}</div>
          <div class="callout-detail">${c.detail}</div>
        </div>
      `).join('')}
    </div>

    <div class="two-col">
      <div class="panel" style="margin:0">
        <div class="panel-header">
          <div>
            <div class="panel-title">${state.selectedRunner ? state.selectedRunner + "'s activity" : 'Faction monthly activity'}</div>
            <div class="panel-subtitle">${state.selectedRunner ? 'Their monthly runs. Line shows faction average.' : 'Total runs per month across all runners.'}</div>
          </div>
        </div>
        <div class="chart-canvas-container short"><canvas id="runnerActivityChart"></canvas></div>
      </div>

      <div class="panel" style="margin:0">
        <div class="panel-header">
          <div>
            <div class="panel-title">${state.selectedRunner ? 'Recent deposits' : 'Leaderboard'}</div>
            <div class="panel-subtitle">${state.selectedRunner ? 'Last 20 tickets.' : 'Top 20 runners by total runs.'}</div>
          </div>
        </div>
        ${stats.tableHTML}
      </div>
    </div>
  `;
  renderRunnerActivityChart();
}

function computeRunnerStats(runner) {
  const allDeposits = state.data.deposits;
  const allByRunner = groupBy(allDeposits, 'runner');
  const runnerNames = Object.keys(allByRunner);
  const totalFactionRuns = allDeposits.length;

  // Leaderboards
  const runsLb = runnerNames.map(n => ({ name: n, runs: allByRunner[n].length })).sort((a,b) => b.runs - a.runs);
  const xanaxLb = runnerNames.map(n => ({ name: n, xanax: allByRunner[n].reduce((s,d)=>s+d.qty,0) })).sort((a,b) => b.xanax - a.xanax);
  const earnedLb = runnerNames.map(n => ({ name: n, earned: allByRunner[n].reduce((s,d)=>s+d.reimbursement,0) })).sort((a,b) => b.earned - a.earned);

  if (!runner) {
    // Aggregate view
    const totalXanax = allDeposits.reduce((s,d)=>s+d.qty,0);
    const totalEarned = allDeposits.reduce((s,d)=>s+d.reimbursement,0);
    const avgRunsPerRunner = (totalFactionRuns / runnerNames.length).toFixed(1);
    const sorted = [...allDeposits].sort((a,b)=> a.date < b.date ? -1 : 1);
    const first = sorted[0]?.date || '';
    const last = sorted[sorted.length-1]?.date || '';
    const daysActive = first && last ? Math.round((new Date(last) - new Date(first)) / 86400000) : 0;

    return {
      tiles: [
        { value: formatCompact(totalXanax), label: 'Total Xanax', compare: `Top runner: <strong>${xanaxLb[0]?.name}</strong>` },
        { value: formatMoney(totalEarned), label: 'Total Earned', compare: `Top earner: <strong>${earnedLb[0]?.name}</strong>` },
        { value: totalFactionRuns.toLocaleString(), label: 'Total Runs', compare: `Top runner: <strong>${runsLb[0]?.name}</strong>` },
        { value: runnerNames.length, label: 'Contributors', compare: `Avg <strong>${avgRunsPerRunner}</strong> runs each` },
        { value: formatShortDate(first), label: 'First Deposit', compare: `By <strong>${sorted[0]?.runner}</strong>` },
        { value: daysActive, label: 'Days Active', compare: `Since first run` }
      ],
      callouts: [
        { label: 'Most Recent Run', value: sorted[sorted.length-1]?.runner || '—', detail: formatShortDate(last) },
        { label: 'Busiest Month', value: busiestMonth(allDeposits), detail: 'Across all runners' },
        { label: 'Faction Concentration', value: paretoLine(runsLb), detail: 'Top runners share of all runs' }
      ],
      tableHTML: leaderboardTable(runsLb.slice(0, 20), runnerNames.length)
    };
  }

  // Per-runner view
  const myDeposits = allByRunner[runner] || [];
  const myRuns = myDeposits.length;
  const myXanax = myDeposits.reduce((s,d)=>s+d.qty,0);
  const myEarned = myDeposits.reduce((s,d)=>s+d.reimbursement,0);
  const sorted = [...myDeposits].sort((a,b)=> a.date < b.date ? -1 : 1);
  const first = sorted[0]?.date || '';
  const last = sorted[sorted.length-1]?.date || '';
  const daysActive = first && last ? Math.round((new Date(last) - new Date(first)) / 86400000) : 0;

  const runRank = runsLb.findIndex(r => r.name === runner) + 1;
  const xanaxRank = xanaxLb.findIndex(r => r.name === runner) + 1;
  const earnedRank = earnedLb.findIndex(r => r.name === runner) + 1;
  const totalRunners = runnerNames.length;
  const factionAvgRuns = totalFactionRuns / totalRunners;
  const myPctOfTotal = (myRuns / totalFactionRuns) * 100;

  const consistency = consistencyScore(sorted);
  const streak = streakInfo(sorted);
  const bestQuiet = bestAndQuietestMonths(sorted);

  return {
    tiles: [
      { value: formatCompact(myXanax), label: 'Total Xanax', compare: `Rank <strong>#${xanaxRank}</strong> of ${totalRunners}` },
      { value: formatMoney(myEarned), label: 'Total Earned', compare: `Rank <strong>#${earnedRank}</strong> of ${totalRunners}` },
      { value: myRuns, label: 'Run Count', compare: `<strong>${(myRuns / factionAvgRuns).toFixed(1)}×</strong> faction avg` },
      { value: formatShortDate(first), label: 'First Deposit', compare: `${daysActive} days ago` },
      { value: formatShortDate(last), label: 'Last Deposit', compare: daysSinceLabel(last) },
      { value: myPctOfTotal.toFixed(1) + '%', label: 'Faction Share', compare: `of all-time runs` }
    ],
    callouts: [
      { label: 'Consistency', value: consistency.label, detail: consistency.detail },
      { label: 'Streaks', value: streak.current, detail: `Longest: ${streak.longest}` },
      { label: 'Best Month', value: bestQuiet.bestLabel, detail: `Quietest active: ${bestQuiet.quietLabel}` }
    ],
    tableHTML: recentDepositsTable(sorted.slice(-20).reverse())
  };
}

function renderRunnerActivityChart() {
  const ctx = document.getElementById('runnerActivityChart')?.getContext('2d');
  if (!ctx) return;
  destroyChart('runnerActivity');

  const all = state.data.deposits;
  const allMonthly = aggregateByMonth(all, 'all');
  const colors = themeColors();

  if (state.selectedRunner) {
    const mine = all.filter(d => d.runner === state.selectedRunner);
    const myMonthly = aggregateByMonth(mine, 'all');
    const monthLabels = allMonthly.map(m => m.label);
    const myByMonth = new Map(myMonthly.map(m => [m.label, m.tickets]));
    const myData = monthLabels.map(l => myByMonth.get(l) || 0);
    const totalRunners = new Set(all.map(d => d.runner)).size;
    const avgData = allMonthly.map(m => m.tickets / totalRunners);

    state.charts.runnerActivity = new Chart(ctx, {
      data: {
        labels: monthLabels,
        datasets: [
          { type: 'bar', label: state.selectedRunner, data: myData, backgroundColor: colors.green, borderRadius: 4 },
          { type: 'line', label: 'Faction avg', data: avgData, borderColor: colors.textLight, borderWidth: 2, borderDash: [4, 4], pointRadius: 0, tension: 0.3 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { boxWidth: 12, padding: 10 } } },
        scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: colors.grid } } }
      }
    });
  } else {
    state.charts.runnerActivity = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: allMonthly.map(m => m.label),
        datasets: [{ label: 'Total tickets', data: allMonthly.map(m => m.tickets), backgroundColor: colors.green, borderRadius: 4 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: colors.grid } } }
      }
    });
  }
}

function leaderboardTable(rows, totalRunners) {
  return `<table class="mini-table">
    <thead><tr><th>#</th><th>Runner</th><th>Runs</th></tr></thead>
    <tbody>
      ${rows.map((r, i) => `
        <tr><td>${i + 1}</td><td>${escape(r.name)}</td><td>${r.runs}</td></tr>
      `).join('')}
    </tbody>
  </table>`;
}

function recentDepositsTable(rows) {
  if (!rows.length) return '<div style="padding:24px;text-align:center;color:var(--text-light);">No deposits yet</div>';
  return `<table class="mini-table">
    <thead><tr><th>Date</th><th>Pharmacist</th><th>Reimbursed</th><th>Paid</th></tr></thead>
    <tbody>
      ${rows.map(r => `
        <tr>
          <td>${formatShortDate(r.date)}</td>
          <td>${escape(r.processed_by)}</td>
          <td>${formatMoney(r.reimbursement)}</td>
          <td class="${r.paid ? 'paid-yes' : 'paid-no'}">${r.paid ? 'Yes' : 'No'}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>`;
}

// =====================================================================
// Pricing tab
// =====================================================================
function renderPriceChart() {
  // Daily cheapest run price
  const byDate = new Map();
  state.data.deposits.forEach(d => {
    if (!d.cheapest_run) return;
    if (!byDate.has(d.date) || d.cheapest_run < byDate.get(d.date)) {
      byDate.set(d.date, d.cheapest_run);
    }
  });
  const points = Array.from(byDate.entries()).sort().map(([date, price]) => ({ x: date, y: price }));

  // 30-day moving average
  const ma = points.map((p, i) => {
    const window = points.slice(Math.max(0, i - 29), i + 1);
    const avg = window.reduce((s, p) => s + p.y, 0) / window.length;
    return { x: p.x, y: avg };
  });

  destroyChart('price');
  const ctx = document.getElementById('priceChart').getContext('2d');
  const colors = themeColors();

  state.charts.price = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        { label: 'Daily cheapest run', data: points, borderColor: hexA(colors.green, 0.4), backgroundColor: 'transparent', borderWidth: 1, pointRadius: 1.5, pointBackgroundColor: hexA(colors.green, 0.4) },
        { label: '30-day average', data: ma, borderColor: colors.green, backgroundColor: 'transparent', borderWidth: 2.5, pointRadius: 0, tension: 0.2 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 12, padding: 10 } },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatMoney(ctx.parsed.y)}` } }
      },
      scales: {
        x: { type: 'time', time: { unit: 'month', displayFormats: { month: 'MMM yy' } }, grid: { display: false } },
        y: { ticks: { callback: v => formatMoney(v) }, grid: { color: colors.grid } }
      }
    }
  });
}

function renderPharmacistChart() {
  // Monthly tickets stacked by pharmacist
  const months = new Map();
  state.data.deposits.forEach(d => {
    const monthKey = d.date.slice(0, 7);
    if (!months.has(monthKey)) months.set(monthKey, new Map());
    const m = months.get(monthKey);
    const p = d.processed_by || 'Unknown';
    m.set(p, (m.get(p) || 0) + 1);
  });

  const sortedMonths = Array.from(months.keys()).sort();
  const pharmacists = new Set();
  months.forEach(m => m.forEach((_, k) => pharmacists.add(k)));
  const pList = Array.from(pharmacists);
  const palette = greenPalette(pList.length);

  const datasets = pList.map((p, i) => ({
    label: p,
    data: sortedMonths.map(m => months.get(m).get(p) || 0),
    backgroundColor: palette[i],
    borderRadius: 3
  }));

  destroyChart('pharmacist');
  const ctx = document.getElementById('pharmacistChart').getContext('2d');
  const colors = themeColors();

  state.charts.pharmacist = new Chart(ctx, {
    type: 'bar',
    data: { labels: sortedMonths.map(monthLabel), datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top', labels: { boxWidth: 12, padding: 10 } } },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, beginAtZero: true, grid: { color: colors.grid } }
      }
    }
  });
}

// =====================================================================
// Sales tab
// =====================================================================
function renderBuyersChart() {
  const byBuyer = new Map();
  state.data.sales.forEach(s => {
    if (s.qty <= 0) return;
    byBuyer.set(s.purchaser, (byBuyer.get(s.purchaser) || 0) + s.qty);
  });
  const top = Array.from(byBuyer.entries()).sort((a,b) => b[1] - a[1]).slice(0, 10);
  const palette = greenPalette(top.length);

  destroyChart('buyers');
  const ctx = document.getElementById('buyersChart').getContext('2d');

  state.charts.buyers = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: top.map(t => t[0]),
      datasets: [{ data: top.map(t => t[1]), backgroundColor: palette, borderWidth: 0 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { boxWidth: 12, padding: 8, font: { size: 11 } } },
        tooltip: { callbacks: { label: ctx => `${ctx.label}: ${formatCompact(ctx.parsed)} xanax` } }
      },
      cutout: '60%'
    }
  });
}

function renderSalesScatter() {
  const points = state.data.sales
    .filter(s => s.qty > 0 && s.price_per > 0)
    .map(s => ({ x: s.qty, y: s.price_per, buyer: s.purchaser, date: s.date }));

  destroyChart('salesScatter');
  const ctx = document.getElementById('salesScatterChart').getContext('2d');
  const colors = themeColors();

  state.charts.salesScatter = new Chart(ctx, {
    type: 'scatter',
    data: { datasets: [{ label: 'Sales', data: points, backgroundColor: hexA(colors.green, 0.6), pointRadius: 5 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.raw.buyer} — ${ctx.raw.x.toLocaleString()} @ ${formatMoney(ctx.raw.y)} (${formatShortDate(ctx.raw.date)})`
          }
        }
      },
      scales: {
        x: { title: { display: true, text: 'Quantity' }, beginAtZero: true, grid: { color: colors.grid } },
        y: { title: { display: true, text: 'Price per xanax' }, ticks: { callback: v => formatMoney(v) }, grid: { color: colors.grid } }
      }
    }
  });
}

// =====================================================================
// Raw data tab
// =====================================================================
function populateRawFilters() {
  const pharmacists = Array.from(new Set(state.data.deposits.map(d => d.processed_by).filter(Boolean))).sort();
  const sel = document.getElementById('rawPharmacist');
  pharmacists.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p; opt.textContent = p;
    sel.appendChild(opt);
  });
}

function renderRawTable() {
  const tbody = document.getElementById('rawTableBody');
  let rows = state.data.deposits.slice();

  if (state.rawFilter.search) {
    const q = state.rawFilter.search.toLowerCase();
    rows = rows.filter(r => r.runner.toLowerCase().includes(q) || r.ticket.toLowerCase().includes(q));
  }
  if (state.rawFilter.pharmacist) {
    rows = rows.filter(r => r.processed_by === state.rawFilter.pharmacist);
  }
  if (state.rawFilter.paid) {
    rows = rows.filter(r => state.rawFilter.paid === 'paid' ? r.paid : !r.paid);
  }

  const { key, dir } = state.rawSort;
  rows.sort((a, b) => {
    const av = a[key], bv = b[key];
    if (av < bv) return dir === 'asc' ? -1 : 1;
    if (av > bv) return dir === 'asc' ? 1 : -1;
    return 0;
  });

  document.getElementById('rawCount').textContent = `${rows.length} of ${state.data.deposits.length} rows`;

  // Limit DOM to top 500 for perf, since 1500 rows is fine but more would lag
  const display = rows.slice(0, 500);
  tbody.innerHTML = display.map(r => `
    <tr>
      <td>${formatShortDate(r.date)}</td>
      <td>${escape(r.runner)}</td>
      <td>${escape(r.ticket)}</td>
      <td>${formatMoney(r.cheapest_run)}</td>
      <td>${r.qty}</td>
      <td>${escape(r.processed_by)}</td>
      <td>${formatMoney(r.reimbursement)}</td>
      <td class="${r.paid ? 'paid-yes' : 'paid-no'}">${r.paid ? 'Yes' : 'No'}</td>
    </tr>
  `).join('');

  // Sort indicators
  document.querySelectorAll('#rawTable th').forEach(th => {
    th.classList.remove('sorted-asc', 'sorted-desc');
    if (th.dataset.sort === key) th.classList.add(dir === 'asc' ? 'sorted-asc' : 'sorted-desc');
  });
}

// =====================================================================
// UI wiring
// =====================================================================
function wireUI() {
  document.querySelectorAll('#activityRangeFilter .filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#activityRangeFilter .filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activityRange = btn.dataset.range === 'all' ? 'all' : Number(btn.dataset.range);
      renderActivityChart();
    });
  });

  // Runner search
  const input = document.getElementById('runnerSearch');
  const suggestions = document.getElementById('runnerSuggestions');
  const clearBtn = document.getElementById('runnerClear');
  const runnerNames = Object.keys(groupBy(state.data.deposits, 'runner')).sort();

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    clearBtn.style.display = q ? 'block' : 'none';
    if (!q) { suggestions.classList.remove('open'); return; }
    const matches = runnerNames
      .filter(n => n.toLowerCase().includes(q))
      .slice(0, 8)
      .map(n => {
        const runs = state.data.deposits.filter(d => d.runner === n).length;
        return `<div class="runner-suggestion" data-name="${escape(n)}">
          <span>${escape(n)}</span>
          <span class="runner-suggestion-meta">${runs} runs</span>
        </div>`;
      }).join('');
    suggestions.innerHTML = matches || '<div class="runner-suggestion" style="color:var(--text-light)">No matches</div>';
    suggestions.classList.add('open');
  });

  suggestions.addEventListener('click', e => {
    const item = e.target.closest('.runner-suggestion');
    if (!item || !item.dataset.name) return;
    selectRunner(item.dataset.name);
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.style.display = 'none';
    suggestions.classList.remove('open');
    selectRunner(null);
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.runner-search-wrapper')) suggestions.classList.remove('open');
  });

  // Raw data table
  document.getElementById('rawSearch').addEventListener('input', e => {
    state.rawFilter.search = e.target.value;
    renderRawTable();
  });
  document.getElementById('rawPharmacist').addEventListener('change', e => {
    state.rawFilter.pharmacist = e.target.value;
    renderRawTable();
  });
  document.getElementById('rawPaid').addEventListener('change', e => {
    state.rawFilter.paid = e.target.value;
    renderRawTable();
  });
  document.querySelectorAll('#rawTable th').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.rawSort.key === key) {
        state.rawSort.dir = state.rawSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.rawSort.key = key;
        state.rawSort.dir = 'desc';
      }
      renderRawTable();
    });
  });
}

function selectRunner(name) {
  state.selectedRunner = name;
  document.getElementById('runnerSearch').value = name || '';
  document.getElementById('runnerClear').style.display = name ? 'block' : 'none';
  document.getElementById('runnerSuggestions').classList.remove('open');
  renderRunnerDashboard();
}

// =====================================================================
// Helpers
// =====================================================================
function aggregateByMonth(deposits, rangeMonths) {
  const cutoff = rangeMonths === 'all' ? null : monthsAgo(rangeMonths);
  const filtered = cutoff ? deposits.filter(d => d.date >= cutoff) : deposits;
  const buckets = new Map();
  filtered.forEach(d => {
    const key = d.date.slice(0, 7);
    if (!buckets.has(key)) buckets.set(key, { tickets: 0, xanax: 0, reimbursed: 0, priceSum: 0, priceCount: 0 });
    const b = buckets.get(key);
    b.tickets += 1; b.xanax += d.qty; b.reimbursed += d.reimbursement;
    if (d.cheapest_run > 0) { b.priceSum += d.cheapest_run; b.priceCount += 1; }
  });
  return Array.from(buckets.entries()).sort((a,b)=> a[0]<b[0]?-1:1).map(([key, v]) => ({
    label: monthLabel(key),
    tickets: v.tickets, xanax: v.xanax, reimbursed: v.reimbursed,
    avgPrice: v.priceCount ? v.priceSum / v.priceCount : null
  }));
}

function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    const k = item[key];
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {});
}

function consistencyScore(sortedDeposits) {
  if (sortedDeposits.length < 3) return { label: 'New runner', detail: 'Not enough data yet' };
  const dates = sortedDeposits.map(d => new Date(d.date));
  const gaps = [];
  for (let i = 1; i < dates.length; i++) {
    gaps.push((dates[i] - dates[i-1]) / 86400000);
  }
  const avg = gaps.reduce((s,g)=>s+g,0) / gaps.length;
  const variance = gaps.reduce((s,g)=>s+(g-avg)**2,0) / gaps.length;
  const sd = Math.sqrt(variance);
  const cv = sd / avg;
  let label;
  if (cv < 0.6) label = 'Clockwork';
  else if (cv < 1.2) label = 'Steady';
  else if (cv < 2) label = 'Streaky';
  else label = 'Sporadic';
  return { label, detail: `Avg ${avg.toFixed(1)} days between runs` };
}

function streakInfo(sortedDeposits) {
  if (!sortedDeposits.length) return { current: '—', longest: '—' };
  // Define a "week" as 7 days. A streak = consecutive weeks with at least one deposit.
  const weeks = new Set();
  sortedDeposits.forEach(d => {
    const date = new Date(d.date);
    const diff = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - diff);
    weeks.add(date.toISOString().slice(0,10));
  });
  const sortedWeeks = Array.from(weeks).sort().map(w => new Date(w));
  let longest = 1, current = 1;
  for (let i = 1; i < sortedWeeks.length; i++) {
    const diff = (sortedWeeks[i] - sortedWeeks[i-1]) / 86400000;
    if (diff <= 7.5) current++;
    else { longest = Math.max(longest, current); current = 1; }
  }
  longest = Math.max(longest, current);

  // Current streak: is the most recent week within last 7 days?
  const lastWeek = sortedWeeks[sortedWeeks.length - 1];
  const daysSinceLast = (Date.now() - lastWeek) / 86400000;
  const activeCurrent = daysSinceLast <= 14 ? current : 0;

  return {
    current: activeCurrent > 0 ? `${activeCurrent} week${activeCurrent === 1 ? '' : 's'}` : 'Inactive',
    longest: `${longest} week${longest === 1 ? '' : 's'}`
  };
}

function bestAndQuietestMonths(sortedDeposits) {
  if (!sortedDeposits.length) return { bestLabel: '—', quietLabel: '—' };
  const byMonth = new Map();
  sortedDeposits.forEach(d => {
    const k = d.date.slice(0,7);
    byMonth.set(k, (byMonth.get(k) || 0) + 1);
  });
  const entries = Array.from(byMonth.entries());
  const best = entries.reduce((a,b) => b[1] > a[1] ? b : a);
  const quiet = entries.reduce((a,b) => b[1] < a[1] ? b : a);
  return {
    bestLabel: `${monthLabel(best[0])} (${best[1]})`,
    quietLabel: `${monthLabel(quiet[0])} (${quiet[1]})`
  };
}

function busiestMonth(deposits) {
  const m = new Map();
  deposits.forEach(d => { const k = d.date.slice(0,7); m.set(k, (m.get(k)||0)+1); });
  const best = Array.from(m.entries()).reduce((a,b) => b[1] > a[1] ? b : a, ['', 0]);
  return `${monthLabel(best[0])} (${best[1]})`;
}

function paretoLine(sortedRuns) {
  const total = sortedRuns.reduce((s,r)=>s+r.runs,0);
  const top10 = sortedRuns.slice(0, 10).reduce((s,r)=>s+r.runs,0);
  const pct = (top10 / total) * 100;
  return `Top 10 = ${pct.toFixed(0)}%`;
}

function daysSinceLabel(dateStr) {
  if (!dateStr) return '';
  const days = Math.round((Date.now() - new Date(dateStr)) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days/7)} weeks ago`;
  return `${Math.floor(days/30)} months ago`;
}

function destroyChart(key) {
  if (state.charts[key]) { state.charts[key].destroy(); delete state.charts[key]; }
}

function themeColors() {
  const r = getComputedStyle(document.documentElement);
  return {
    green: r.getPropertyValue('--green').trim(),
    red: r.getPropertyValue('--red').trim(),
    textLight: r.getPropertyValue('--text-light').trim(),
    grid: r.getPropertyValue('--gray-200').trim(),
    bg: r.getPropertyValue('--white').trim()
  };
}

function greenPalette(n) {
  // Generate n shades from a base green
  const base = themeColors().green;
  // Convert hex to RGB
  const m = base.match(/#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return Array(n).fill(base);
  const [r, g, b] = [parseInt(m[1],16), parseInt(m[2],16), parseInt(m[3],16)];
  return Array.from({length: n}, (_, i) => {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const factor = 0.5 + t * 0.7;
    const blend = c => Math.round(c * factor + 255 * (1 - factor) * 0.3);
    return `rgb(${blend(r)}, ${blend(g)}, ${blend(b)})`;
  });
}

function hexA(hex, a) {
  const m = hex.match(/#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return hex;
  return `rgba(${parseInt(m[1],16)}, ${parseInt(m[2],16)}, ${parseInt(m[3],16)}, ${a})`;
}

function earliestDate(deposits) {
  return deposits.reduce((min, d) => !min || d.date < min ? d.date : min, null);
}
function monthsAgo(n) {
  const d = new Date(); d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0,10);
}
function monthLabel(yyyymm) {
  if (!yyyymm) return '';
  const [y, m] = yyyymm.split('-');
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${names[Number(m)-1]} ${y.slice(2)}`;
}
function formatMoney(n) {
  if (n == null) return '$0';
  if (n < 0) return `-$${formatCompact(Math.abs(n))}`;
  return `$${formatCompact(n)}`;
}
function formatCompact(n) {
  if (n == null) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n/1e9).toFixed(2)+'B';
  if (abs >= 1e6) return (n/1e6).toFixed(1)+'M';
  if (abs >= 1e3) return (n/1e3).toFixed(1)+'K';
  return n.toLocaleString();
}
function formatShortDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
}
function formatLongDate(s) {
  if (!s) return '';
  return new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
function escape(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function setText(id, text) { document.getElementById(id).textContent = text; }
