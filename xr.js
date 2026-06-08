// Resilience XR Dashboard
const DATA_URL = 'data/xr.json';

let state = {
  data: null,
  activityChart: null,
  activityMetric: 'tickets',
  activityRange: 12
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    const resp = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    state.data = await resp.json();
    document.getElementById('setupSection').style.display = 'none';
    document.getElementById('dashboardContent').style.display = 'block';
    render();
    wireFilters();
  } catch (err) {
    document.getElementById('loadingMessage').style.display = 'none';
    const errEl = document.getElementById('errorMessage');
    errEl.style.display = 'block';
    errEl.textContent = `Couldn't load dashboard data: ${err.message}`;
  }
}

function render() {
  renderLastUpdated();
  renderKPIs();
  renderActivityChart();
}

function renderLastUpdated() {
  const dt = new Date(state.data.generated_at);
  document.getElementById('lastUpdated').textContent =
    `Last updated: ${dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

function renderKPIs() {
  const { deposits, sales } = state.data;
  const totalXanax = deposits.reduce((s, d) => s + d.qty, 0);
  const totalReimbursed = deposits.reduce((s, d) => s + d.reimbursement, 0);
  const totalRevenue = sales.reduce((s, x) => s + x.total_value, 0);
  const netProfit = totalRevenue - totalReimbursed;
  const contributors = new Set(deposits.map(d => d.runner)).size;
  const months = monthsBetween(earliestDate(deposits), new Date());

  document.getElementById('kpiXanax').textContent = formatCompact(totalXanax);
  document.getElementById('kpiReimbursed').textContent = formatMoney(totalReimbursed);
  document.getElementById('kpiRevenue').textContent = formatMoney(totalRevenue);
  document.getElementById('kpiProfit').textContent = formatMoney(netProfit);
  document.getElementById('kpiRunners').textContent = contributors;
  document.getElementById('kpiMonths').textContent = months;
}

function renderActivityChart() {
  const monthlyData = aggregateByMonth(state.data.deposits, state.activityRange);
  const labels = monthlyData.map(m => m.label);
  const values = monthlyData.map(m => m[state.activityMetric]);

  const metricLabels = {
    tickets: 'Tickets',
    xanax: 'Xanax Deposited',
    reimbursed: 'Reimbursed ($)'
  };

  if (state.activityChart) state.activityChart.destroy();
  const ctx = document.getElementById('activityChart').getContext('2d');
  const greenColor = getComputedStyle(document.documentElement).getPropertyValue('--green').trim();

  state.activityChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: metricLabels[state.activityMetric],
        data: values,
        backgroundColor: greenColor,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed.y;
              return state.activityMetric === 'reimbursed' ? formatMoney(v) : formatCompact(v);
            }
          }
        }
      },
      scales: {
        x: { grid: { display: false } },
        y: {
          beginAtZero: true,
          ticks: {
            callback: (v) => state.activityMetric === 'reimbursed' ? formatCompact(v) : v
          }
        }
      }
    }
  });
}

function wireFilters() {
  document.querySelectorAll('#activityMetricFilter .filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#activityMetricFilter .filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activityMetric = btn.dataset.metric;
      renderActivityChart();
    });
  });
  document.querySelectorAll('#activityRangeFilter .filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#activityRangeFilter .filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activityRange = btn.dataset.range === 'all' ? 'all' : Number(btn.dataset.range);
      renderActivityChart();
    });
  });
}

// --- Aggregation ---
function aggregateByMonth(deposits, rangeMonths) {
  const cutoff = rangeMonths === 'all' ? null : monthsAgo(rangeMonths);
  const filtered = cutoff ? deposits.filter(d => d.date >= cutoff) : deposits;

  const buckets = new Map();
  filtered.forEach(d => {
    const key = d.date.slice(0, 7); // YYYY-MM
    if (!buckets.has(key)) buckets.set(key, { tickets: 0, xanax: 0, reimbursed: 0 });
    const b = buckets.get(key);
    b.tickets += 1;
    b.xanax += d.qty;
    b.reimbursed += d.reimbursement;
  });

  const sorted = Array.from(buckets.entries()).sort((a, b) => a[0] < b[0] ? -1 : 1);
  return sorted.map(([key, vals]) => ({
    label: monthLabel(key),
    ...vals
  }));
}

// --- Helpers ---
function earliestDate(deposits) {
  return deposits.reduce((min, d) => !min || d.date < min ? d.date : min, null);
}

function monthsBetween(startStr, endDate) {
  if (!startStr) return 0;
  const start = new Date(startStr);
  return (endDate.getFullYear() - start.getFullYear()) * 12 + (endDate.getMonth() - start.getMonth());
}

function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

function monthLabel(yyyymm) {
  const [y, m] = yyyymm.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[Number(m) - 1]} ${y.slice(2)}`;
}

function formatMoney(n) {
  if (n < 0) return `-$${formatCompact(Math.abs(n))}`;
  return `$${formatCompact(n)}`;
}

function formatCompact(n) {
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toLocaleString();
}
