#!/usr/bin/env node
// Step 2: build the ledger from raw-armoryAction.jsonl + raw-armoryDeposit.jsonl
// (written by armoury-download.js) and a live inventory pull.
//
//   TORN_KEY=xxx node armoury-ledger.js [--cats weapons] [--usage-since 2026-07-19]
//
// Every pattern below matches a line wording seen in Resilience's own API output
// (19 Sep 2026). Lines matching none of them go to unparsed.csv and are not counted.

const fs = require("fs");
const KEY = process.env.TORN_KEY;
if (!KEY) { console.error("Set TORN_KEY"); process.exit(1); }
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const CATS = arg("--cats", "weapons").split(",");
const SINCE = Math.floor(new Date(arg("--usage-since", "2026-01-01") + "T00:00:00Z") / 1000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (ts) => (ts ? new Date(ts * 1000).toISOString().slice(0, 16).replace("T", " ") : "");
const csv = (rows) => rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");

// ---------- parsing ----------
const RULES = [
  [/^@0 deposited (\d+)x (.+)$/, (m) => ({ action: "deposit", qty: +m[1], item: m[2] })],
  [/^@0 opened an? (.+) and gained an? (.+) which has been placed in the armory$/, (m) => ({ action: "cache", qty: 1, item: m[2], source: m[1] })],
  [/^@0 used one of the faction's (.+) items$/, (m) => ({ action: "used", qty: 1, item: m[1] })],
  [/^@0 used (\d+) of the faction's points to (.+)$/, (m) => ({ action: "points", qty: +m[1], item: "Points", purpose: m[2] })],
  [/^@0 filled one of the faction's Empty Blood Bags to create a (.+)$/, (m) => ({ action: "filled", qty: 1, item: "Empty Blood Bag", output: m[1] })],
  [/^@0 gave (\d+)x (.+) to @1 from the faction armory$/, (m) => ({ action: "gave", qty: +m[1], item: m[2], toOther: true })],
  [/^@0 loaned (\d+)x (.+) to themselves from the faction armory$/, (m) => ({ action: "loaned", qty: +m[1], item: m[2], toSelf: true })],
  [/^@0 loaned (\d+)x (.+) to @1 from the faction armory$/, (m) => ({ action: "loaned", qty: +m[1], item: m[2], toOther: true })],
  [/^@0 returned (\d+)x (.+)$/, (m) => ({ action: "returned", qty: +m[1], item: m[2], toSelf: true })],
  [/^@0 retrieved (\d+)x (.+) from @1$/, (m) => ({ action: "retrieved", qty: +m[1], item: m[2], toOther: true })],
];

function parse(row) {
  const users = [];
  const plain = row.text.replace(/<a href = "[^"]*XID=(\d+)">(.*?)<\/a>/g, (_, id, name) => { users.push({ id: +id, name }); return `@${users.length - 1}`; });
  const base = { id: row.id, ts: row.timestamp, actor: users[0] || null, raw: plain };
  for (const [re, build] of RULES) {
    const m = re.exec(plain);
    if (!m) continue;
    const e = { ...base, ...build(m) };
    // holder = the member the item is with (loans) or went to (gave)
    e.other = e.toOther ? users[1] : e.toSelf ? users[0] : null;
    return e;
  }
  return { ...base, action: "unparsed" };
}

// ---------- inventory ----------
async function api(path, params) {
  for (;;) {
    const res = await fetch(`https://api.torn.com/v2${path}?${new URLSearchParams({ ...params, comment: "res-armoury" })}`, { headers: { Authorization: `ApiKey ${KEY}` } });
    const d = await res.json();
    if (!d.error) { await sleep(700); return d; }
    if (d.error.code === 5) { await sleep(60000); continue; }
    throw new Error(`API error ${d.error.code}: ${d.error.error}`);
  }
}
async function fetchInventory() {
  const copies = []; let stamp = 0;
  for (const cat of CATS) for (let offset = 0; ; offset += 100) {
    const d = await api("/faction/inventory", { cat, limit: 100, offset });
    stamp = d.inventory_timestamp;
    for (const r of d.inventory) for (const uid of r.uids) copies.push({ cat, itemId: r.id, item: r.name, type: r.type, uid, holder: r.loaned });
    if (d.inventory.length < 100) break;
  }
  fs.mkdirSync("snapshots", { recursive: true });
  fs.writeFileSync(`snapshots/inventory-${stamp}.json`, JSON.stringify(copies));
  return copies;
}

// ---------- main ----------
(async () => {
  const load = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  const seen = new Set();
  const events = [...load("raw-armoryAction.jsonl"), ...load("raw-armoryDeposit.jsonl")]
    .filter((r) => !seen.has(r.id) && seen.add(r.id)).map(parse).sort((a, b) => a.ts - b.ts);
  if (!events.length) { console.error("No raw files found. Run armoury-download.js first."); process.exit(1); }
  const copies = await fetchInventory();
  const tracked = new Set(copies.map((c) => c.item));

  // loans: pair loaned with returned/retrieved on item name + holder ID
  const open = new Map(); const loans = [];
  for (const e of events) {
    if (!tracked.has(e.item) || !e.other) continue;
    const k = `${e.item}|${e.other.id}`;
    if (e.action === "loaned") for (let i = 0; i < e.qty; i++) open.set(k, [...(open.get(k) || []), e]);
    if (e.action === "returned" || e.action === "retrieved") for (let i = 0; i < e.qty; i++) {
      const s = (open.get(k) || []).shift();
      loans.push({ item: e.item, holder: e.other, by: s && s.actor, start: s && s.ts, end: e.ts, how: e.action });
    }
  }
  for (const list of open.values()) for (const s of list) loans.push({ item: s.item, holder: s.other, by: s.actor, start: s.ts, end: null, how: "open" });

  // weapons.csv: one row per physical copy
  const now = Math.floor(Date.now() / 1000);
  const perName = new Map(); copies.forEach((c) => perName.set(c.item, (perName.get(c.item) || 0) + 1));
  const wRows = [["item", "type", "uid", "holder_id", "holder", "on_loan_since", "days_on_loan", "copies_of_item", "depositor_id", "depositor", "deposited_at", "depositor_basis"]];
  for (const c of copies) {
    let since = "", days = "";
    if (c.holder) {
      const mine = loans.filter((l) => l.how === "open" && l.item === c.item && l.holder.id === c.holder.id);
      const sameHolderCopies = copies.filter((x) => x.item === c.item && x.holder && x.holder.id === c.holder.id).length;
      if (mine.length === 1 && sameHolderCopies === 1) { since = iso(mine[0].start); days = ((now - mine[0].start) / 86400).toFixed(1); }
    }
    let dep = null, basis = "";
    if (perName.get(c.item) === 1) {
      const ins = events.filter((e) => e.item === c.item && (e.action === "deposit" || e.action === "cache"));
      const outs = events.filter((e) => e.item === c.item && e.action === "gave");
      dep = ins[ins.length - 1];
      if (!dep) basis = "no deposit in downloaded history";
      else if (outs.some((o) => o.ts > dep.ts)) { dep = null; basis = "given away after last deposit, check by hand"; }
      else basis = ins.length === 1 ? "only copy, only deposit" : `only copy, latest of ${ins.length} deposits`;
    } else basis = "several copies, news cannot identify which";
    wRows.push([c.item, c.type, c.uid, c.holder && c.holder.id, c.holder && c.holder.name, since, days, perName.get(c.item),
      dep && dep.actor.id, dep && dep.actor.name, dep && iso(dep.ts), basis]);
  }
  fs.writeFileSync("weapons.csv", csv(wRows));

  // loans.csv, with a check against live inventory for loans still open in news
  const held = new Set(copies.filter((c) => c.holder).map((c) => `${c.item}|${c.holder.id}`));
  const lRows = [["item", "holder_id", "holder", "loaned_by", "start", "end", "days", "status"]];
  for (const l of loans.sort((a, b) => (b.start || 0) - (a.start || 0))) {
    const status = l.how !== "open" ? l.how : held.has(`${l.item}|${l.holder.id}`) ? "on loan now" : "open in news, not held in inventory";
    const end = l.end || (status === "on loan now" ? now : null);
    lRows.push([l.item, l.holder.id, l.holder.name, l.by && l.by.name, iso(l.start), iso(l.end), l.start && end ? ((end - l.start) / 86400).toFixed(1) : "", l.start ? status : `${status}, loan start before downloaded history`]);
  }
  fs.writeFileSync("loans.csv", csv(lRows));

  // deposits of tracked items, for the multi-copy pools
  fs.writeFileSync("weapon-deposits.csv", csv([["time", "member_id", "member", "how", "qty", "item"],
    ...events.filter((e) => tracked.has(e.item) && (e.action === "deposit" || e.action === "cache")).reverse().map((e) => [iso(e.ts), e.actor.id, e.actor.name, e.action, e.qty, e.item])]));

  // usage.csv: counts only
  const u = new Map();
  const bump = (who, item, field, qty) => { const k = `${who.id}|${item}`; const r = u.get(k) || { who, item, used: 0, received: 0, deposited: 0 }; r[field] += qty; u.set(k, r); };
  for (const e of events) {
    if (e.ts < SINCE) continue;
    if (e.action === "used" || e.action === "filled" || e.action === "points") bump(e.actor, e.item, "used", e.qty);
    if (e.action === "gave") bump(e.other, e.item, "received", e.qty);
    if (e.action === "deposit") bump(e.actor, e.item, "deposited", e.qty);
  }
  fs.writeFileSync("usage.csv", csv([["member_id", "member", "item", "used", "given_to_them", "deposited"],
    ...[...u.values()].sort((a, b) => b.used + b.received - (a.used + a.received)).map((r) => [r.who.id, r.who.name, r.item, r.used, r.received, r.deposited])]));

  const bad = events.filter((e) => e.action === "unparsed");
  fs.writeFileSync("unparsed.csv", csv([["time", "text"], ...bad.map((e) => [iso(e.ts), e.raw])]));
  console.log(`${events.length} events, ${bad.length} unparsed, ${copies.length} copies in ${CATS.join(",")}.`);
  console.log("Wrote weapons.csv, loans.csv, weapon-deposits.csv, usage.csv, unparsed.csv");
})();
