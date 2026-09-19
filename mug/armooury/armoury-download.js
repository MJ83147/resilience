#!/usr/bin/env node
// Step 1 of the armoury ledger: download raw faction news. No parsing.
// Node 18+, no dependencies.
//
//   TORN_KEY=xxx node armoury-download.js armoryAction  2026-01-01
//   TORN_KEY=xxx node armoury-download.js armoryDeposit 2019-01-01
//
// Writes raw-<cat>.jsonl (one API row per line, untouched) and shapes-<cat>.csv
// (every distinct line wording found, with a count and one real example).
// Rerun the same command to resume after a stop or the daily read limit.

const fs = require("fs");
const [cat, sinceArg] = process.argv.slice(2);
const KEY = process.env.TORN_KEY;
if (!KEY || !cat || !sinceArg) { console.error("Usage: TORN_KEY=xxx node armoury-download.js <armoryAction|armoryDeposit> <YYYY-MM-DD>"); process.exit(1); }
const SINCE = Math.floor(new Date(sinceArg + "T00:00:00Z") / 1000);
const RAW = `raw-${cat}.jsonl`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (ts) => new Date(ts * 1000).toISOString().slice(0, 16).replace("T", " ");

async function page(to) {
  const qs = new URLSearchParams({ cat, limit: 100, sort: "desc", striptags: "false", to, comment: "res-armoury" });
  for (;;) {
    const res = await fetch(`https://api.torn.com/v2/faction/news?${qs}`, { headers: { Authorization: `ApiKey ${KEY}` } });
    const d = await res.json();
    if (!d.error) { await sleep(700); return d.news; }
    if (d.error.code === 5) { console.log("Rate limited. Waiting 60s."); await sleep(60000); continue; }
    const e = new Error(`API error ${d.error.code}: ${d.error.error}`); e.code = d.error.code; throw e;
  }
}

function shape(text) {
  return text
    .replace(/<a [^>]*>.*?<\/a>/g, "{user}")
    .replace(/[A-Z0-9][^\s]*(?:\s+(?:of|the|and|&|:|[A-Z0-9+\-][^\s]*))*/g, "{x}");
}

function writeShapes(rows) {
  const m = new Map();
  for (const r of rows) {
    const k = shape(r.text);
    const e = m.get(k) || { n: 0, example: r.text, ts: r.timestamp };
    e.n++; m.set(k, e);
  }
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const out = [["count", "shape", "example", "example_time"].join(",")];
  for (const [k, e] of [...m].sort((a, b) => b[1].n - a[1].n)) out.push([e.n, q(k), q(e.example), q(iso(e.ts))].join(","));
  fs.writeFileSync(`shapes-${cat}.csv`, out.join("\n"));
  console.log(`${m.size} distinct line wordings written to shapes-${cat}.csv`);
}

(async () => {
  const rows = fs.existsSync(RAW) ? fs.readFileSync(RAW, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  const seen = new Set(rows.map((r) => r.id));
  const save = (n) => { seen.add(n.id); rows.push(n); fs.appendFileSync(RAW, JSON.stringify(n) + "\n"); };
  const newest = rows.length ? Math.max(...rows.map((r) => r.timestamp)) : 0;
  try {
    // Phase A (ongoing monitoring): pick up events newer than what we already
    // hold. Page from now backward, stopping as soon as we overlap stored data.
    if (rows.length) {
      let to = Math.floor(Date.now() / 1000);
      for (;;) {
        const news = await page(to);
        if (!news.length) break;
        const fresh = news.filter((n) => !seen.has(n.id));
        for (const n of fresh) save(n);
        const oldest = Math.min(...news.map((n) => n.timestamp));
        if (oldest <= newest || fresh.length < news.length) break;   // reached stored territory
        to = oldest;
        console.log(`catch-up ${iso(to)}  rows=${rows.length}`);
      }
    }
    // Phase B (backfill): extend older history down to SINCE, resumable.
    let to = rows.length ? Math.min(...rows.map((r) => r.timestamp)) : Math.floor(Date.now() / 1000);
    if (rows.length) console.log(`Backfilling from ${iso(to)} with ${rows.length} rows stored`);
    while (to >= SINCE) {
      const news = await page(to);
      if (!news.length) { console.log("No older news available."); break; }
      const fresh = news.filter((n) => !seen.has(n.id));
      for (const n of fresh) save(n);
      const oldest = Math.min(...news.map((n) => n.timestamp));
      to = fresh.length === 0 ? to - 1 : oldest;   // page made of one repeated second: step past it
      console.log(`${iso(to)}  rows=${rows.length}`);
    }
  } catch (e) {
    console.log(`${e.message}. Progress saved in ${RAW}. Rerun to resume.`);
  }
  writeShapes(rows);
})();
