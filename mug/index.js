/* ===== CONFIG ===== */
const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSkwwZmosyQpHUhgquaC7Ey4M7Ntvk9NtMsediYByuo-NINTpvKOFRW4vAsanJVRgpi1UvWLSj8473y/pub?gid=1674054078&single=true&output=csv";
/* ================== */

let DATA = [];
let moneyChart = null;
let countChart = null;

init();

function init() {
  fetch(CSV_URL)
    .then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    })
    .then((csv) => {
      const parsed = Papa.parse(csv, {
        header: true,
        dynamicTyping: false, // keep strings; we'll strip currency
        skipEmptyLines: true,
        transformHeader: (h) => String(h || "").trim()
      });
      const rows = parsed.data || [];
      if (!rows.length) throw new Error("No rows");

      // detect latest date column header
      const headers = (
        parsed.meta.fields || Object.keys(rows[0] || {})
      ).map((h) => String(h || "").trim());
      const dateCols = headers
        .map((h, i) => ({ h, i, d: headerToDate(h) }))
        .filter((x) => x.d instanceof Date && !isNaN(x.d))
        .sort((a, b) => a.d - b.d);
      const latest = dateCols.length ? dateCols[dateCols.length - 1] : null;
      const latestDate = latest ? latest.h : null;

      // build DATA with delta = latest - baseline
      DATA = rows
        .map((r) => {
          const baseline = num(r["money_mugged_start"]);
          const latestVal = latestDate ? num(r[latestDate]) : 0;
          const delta = Math.max(0, latestVal - baseline);

          return {
            id: String(r["members/id"] ?? "").trim(),
            name: String(r["members/name"] ?? r["members/id"] ?? "").trim(),
            level: num(r["members/level"]),
            mug_count: num(r["mug_count"]),
            money_total: delta
          };
        })
        .filter((x) => x.id || x.name);

      // sort default
      DATA.sort(
        (a, b) => b.money_total - a.money_total || b.mug_count - a.mug_count
      );

      // header badges
      const totalMoney = DATA.reduce(
        (t, v) => t + (Number(v.money_total) || 0),
        0
      );
      document.getElementById("summary").textContent = `${
        DATA.length
      } members • $${totalMoney.toLocaleString("en-GB")}`;
      document.getElementById("dateCol").textContent = latestDate
        ? `Latest: ${latestDate}`
        : "No date cols";

      drawCharts();
      bindUI();
      renderTable();
    })
    .catch((err) => {
      document.getElementById("summary").textContent = "Load error";
      console.error(err);
    });
}

function headerToDate(h) {
  h = h.trim();
  let m = h.match(/^(\d{4})[-/](\d{2})[-/](\d{2})(?:\s+\d{2}:\d{2}:\d{2})?$/); // 2025-08-14 or 2025/08/14
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  m = h.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); // 14/08/2025
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00Z`);
  return null;
}

function bindUI() {
  document.getElementById("sort").addEventListener("change", renderTable);
  document.getElementById("limit").addEventListener("change", renderTable);
  document.getElementById("q").addEventListener("input", renderTable);
  
}

function renderTable() {
  const sort = document.getElementById("sort").value;
  const limSel = document.getElementById("limit").value;
  const q = document.getElementById("q").value.toLowerCase().trim();

  // Start with all data for sorting
  let rows = [...DATA];

  // Sort first
  rows.sort((a, b) => {
    if (sort === "money")
      return b.money_total - a.money_total || b.mug_count - a.mug_count;
    if (sort === "count")
      return b.mug_count - a.mug_count || b.money_total - a.money_total;
    if (sort === "level") return b.level - a.level;
    if (sort === "name")
      return String(a.name || "").localeCompare(String(b.name || ""));
    return 0;
  });

  // Apply search filter first
  rows = rows.filter(
    (r) =>
      !q ||
      String(r.name || "")
        .toLowerCase()
        .includes(q)
  );

  // Then apply limit (only affects table display, not charts)
  const limit = limSel === "All" ? rows.length : Number(limSel);
  rows = rows.slice(0, limit);

  const tbody = document.querySelector("#tbl tbody");
  tbody.innerHTML = "";
  rows.forEach((r, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${esc(r.name)}</td>
      <td>${r.level || 0}</td>
      <td>${r.mug_count || 0}</td>
      <td>$${Number(r.money_total || 0).toLocaleString("en-GB")}</td>`;
    tbody.appendChild(tr);
  });
}

function drawCharts() {
  const topMoney = [...DATA]
    .sort((a, b) => b.money_total - a.money_total)
    .slice(0, 10);
  const topCount = [...DATA]
    .sort((a, b) => b.mug_count - a.mug_count)
    .slice(0, 10);

  if (moneyChart) moneyChart.destroy();
  moneyChart = new Chart(document.getElementById("moneyChart"), {
    type: "bar",
    data: {
      labels: topMoney.map((r) => r.name),
      datasets: [
        {
          label: "$",
          data: topMoney.map((r) => r.money_total),
          backgroundColor: "rgba(242,152,115,0.7)"
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } }
    }
  });

  if (countChart) countChart.destroy();
  countChart = new Chart(document.getElementById("countChart"), {
    type: "bar",
    data: {
      labels: topCount.map((r) => r.name),
      datasets: [
        {
          label: "Mugs",
          data: topCount.map((r) => r.mug_count),
          backgroundColor: "rgba(99,196,177,0.7)"
        }
      ]
    },
    options: {
      responsive: true,
            maintainAspectRatio: false,

      plugins: { legend: { display: false } },
      indexAxis: "y",
      scales: { x: { beginAtZero: true } }
    }
  });
}

/* utils */
function esc(s) {
  return String(s || "").replace(
    /[&<>"']/g,
    (m) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        m
      ])
  );
}
// strip currency, commas, spaces
function num(v) {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const s = v.replace(/[^\d.\-]/g, "").trim();
    if (!s) return 0;
    const n = Number(s);
    return isFinite(n) ? n : 0;
  }
  return 0;
}
