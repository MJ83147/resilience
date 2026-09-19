#!/usr/bin/env node
// Step 3: build data/armoury.json for the admin Armoury page from
//   - inv-*.json          (current weapons+armor inventory, one row per holder)
//   - raw-armoryDeposit.jsonl / raw-armoryAction.jsonl  (news, from armoury-download.js)
//
//   node armoury-build.js
//
// Two products, matching the two page sections:
//   tracing: every copy currently in the armoury, walked back through deposits
//            (newest first) to who put it there; copies with no deposit in the
//            downloaded news are flagged unknown.
//   usage:   who used / took / borrowed which item, aggregated by month so the
//            page can group by item, person or timeframe.
//
// Parsing covers both Torn wordings: the pre-2026-03-12 "N x Item" (spaced) form
// and the current "Nx Item" form, plus "gave ... to themselves" which the older
// ledger script did not have a rule for.

const fs = require("fs");
const path = require("path");
const HERE = __dirname;
const OUT = path.join(HERE, "..", "..", "data", "armoury.json");

// ---------- current inventory ----------
// One physical copy per uid. loaned:null rows sit in the armoury; loaned:{id,name}
// rows are with that member. Torn splits an item into one row per holder.
function loadInventory() {
  const copies = [];
  for (const f of fs.readdirSync(HERE)) {
    const m = /^inv-(weapons|armor)-\d+\.json$/.exec(f);
    if (!m) continue;
    const cat = m[1];
    const d = JSON.parse(fs.readFileSync(path.join(HERE, f), "utf8"));
    for (const r of d.inventory || []) {
      for (const uid of r.uids) copies.push({ cat, item: r.name, type: r.type, uid, holder: r.loaned || null });
    }
  }
  return copies;
}

// ---------- news parsing ----------
// Pull the profile links out first so quantities/verbs are easy to match.
function actors(text) {
  const users = [];
  const plain = text.replace(/<a href = "[^"]*XID=(\d+)">(.*?)<\/a>/g, (_, id, name) => {
    users.push({ id: +id, name });
    return `@${users.length - 1}`;
  });
  return { plain, users };
}

const DEP_RULES = [
  [/^@0 deposited (\d+) ?x (.+)$/, (m) => ({ how: "deposit", qty: +m[1], item: m[2] })],
  [/^@0 opened an? (.+?) and gained an? (.+?) which has been placed in the armory$/, (m) => ({ how: "cache", qty: 1, item: m[2], source: m[1] })],
];

const ACT_RULES = [
  [/^@0 used one of the faction's (.+) items$/, (m) => ({ type: "used", qty: 1, item: m[1] })],
  [/^@0 filled one of the faction's (.+) to create an? (.+)$/, (m) => ({ type: "filled", qty: 1, item: m[2], from: m[1] })],
  [/^@0 used (\d+) of the faction's points to (.+)$/, (m) => ({ type: "points", qty: +m[1], item: "Points", purpose: m[2] })],
  [/^@0 gave (\d+) ?x (.+) to themselves from the faction armory$/, (m) => ({ type: "took", qty: +m[1], item: m[2], self: true })],
  [/^@0 gave (\d+) ?x (.+) to @1 from the faction armory$/, (m) => ({ type: "given", qty: +m[1], item: m[2], other: 1 })],
  [/^@0 loaned (\d+) ?x (.+) to themselves from the faction armory$/, (m) => ({ type: "loaned", qty: +m[1], item: m[2], self: true })],
  [/^@0 loaned (\d+) ?x (.+) to @1 from the faction armory$/, (m) => ({ type: "loaned", qty: +m[1], item: m[2], other: 1 })],
  [/^@0 returned (\d+) ?x (.+)$/, (m) => ({ type: "returned", qty: +m[1], item: m[2], self: true })],
  [/^@0 retrieved (\d+) ?x (.+) from @1$/, (m) => ({ type: "retrieved", qty: +m[1], item: m[2], other: 1 })],
];

function load(file) {
  const p = path.join(HERE, file);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function parseAll(rows, rules) {
  const out = [];
  let unparsed = 0;
  const seen = new Set();
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const { plain, users } = actors(r.text);
    let hit = null;
    for (const [re, build] of rules) {
      const m = re.exec(plain);
      if (!m) continue;
      hit = build(m);
      break;
    }
    if (!hit) { unparsed++; continue; }
    out.push({ ts: r.timestamp, actor: users[0] || null, other: hit.other != null ? users[hit.other] || null : null, ...hit });
  }
  return { events: out.sort((a, b) => a.ts - b.ts), unparsed };
}

// ---------- tracing ----------
// Current copies are the anchor. Walk deposits newest-first, crediting depositors
// to each item until its current count is covered. Anything left is unknown.
function trace(copies, deposits) {
  const byItem = new Map();
  for (const c of copies) {
    const e = byItem.get(c.item) || { item: c.item, cat: c.cat, type: c.type, copies: 0, onLoan: 0, holders: [] };
    e.copies++;
    if (c.holder) { e.onLoan++; e.holders.push(c.holder.name); }
    byItem.set(c.item, e);
  }
  const need = new Map([...byItem].map(([k, v]) => [k, v.copies]));
  const credit = new Map(); // item -> Map(name -> qty)
  const desc = [...deposits].sort((a, b) => b.ts - a.ts);
  let lastDepTs = new Map(); // item -> ts of most recent deposit seen
  for (const e of desc) {
    if (!need.has(e.item)) continue;
    if (!lastDepTs.has(e.item)) lastDepTs.set(e.item, e.ts);
    const left = need.get(e.item);
    if (left <= 0) continue;
    const take = Math.min(left, e.qty);
    const cm = credit.get(e.item) || new Map();
    const key = e.actor ? e.actor.name : "(unknown)";
    cm.set(key, (cm.get(key) || 0) + take);
    credit.set(e.item, cm);
    need.set(e.item, left - take);
  }
  const items = [...byItem.values()].map((e) => {
    const cm = credit.get(e.item) || new Map();
    const depositors = [...cm].map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty);
    const unknown = need.get(e.item) || 0;
    return {
      item: e.item, cat: e.cat, copies: e.copies, onLoan: e.onLoan,
      holders: e.holders.sort(),
      depositors, unknown,
      // Copies map to item name and quantity only; with more than one copy the
      // news cannot say which physical copy came from which deposit.
      exact: e.copies === 1,
      lastDeposit: lastDepTs.get(e.item) || null,
    };
  }).sort((a, b) => b.copies - a.copies);
  return items;
}

// ---------- usage ----------
// Aggregate to month|user|item|type so the page can sum by any of them.
// "user" is the person using the item: the actor for self actions, the recipient
// for gives/loans to someone else.
function usage(events) {
  const members = new Map(); // id -> name
  const rows = new Map();    // key -> {m, uid, item, type, n}
  const monthOf = (ts) => new Date(ts * 1000).toISOString().slice(0, 7);
  for (const e of events) {
    let who = e.actor;
    if ((e.type === "given" || e.type === "loaned") && e.other) who = e.other;
    if (!who) continue;
    members.set(who.id, who.name);
    const m = monthOf(e.ts);
    const k = `${m}|${who.id}|${e.item}|${e.type}`;
    const row = rows.get(k) || { m, uid: who.id, item: e.item, type: e.type, n: 0 };
    row.n += e.qty;
    rows.set(k, row);
  }
  return {
    members: [...members].map(([id, name]) => ({ id, name })),
    rows: [...rows.values()],
  };
}

// ---------- main ----------
(function () {
  const copies = loadInventory();
  if (!copies.length) { console.error("No inv-*.json found. Pull current inventory first."); process.exit(1); }
  const dep = parseAll(load("raw-armoryDeposit.jsonl"), DEP_RULES);
  const act = parseAll(load("raw-armoryAction.jsonl"), ACT_RULES);

  const tracing = trace(copies, dep.events);
  const use = usage(act.events);

  const depTs = dep.events.map((e) => e.ts);
  const actTs = act.events.map((e) => e.ts);
  const data = {
    generated: Math.floor(fs.statSync(path.join(HERE, "raw-armoryDeposit.jsonl")).mtimeMs / 1000),
    inventory: { copies: copies.length, items: new Set(copies.map((c) => c.item)).size, onLoan: copies.filter((c) => c.holder).length },
    depositWindow: depTs.length ? { from: Math.min(...depTs), to: Math.max(...depTs), count: dep.events.length, unparsed: dep.unparsed } : null,
    actionWindow: actTs.length ? { from: Math.min(...actTs), to: Math.max(...actTs), count: act.events.length, unparsed: act.unparsed } : null,
    tracing,
    usage: use,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(data));
  const unknownItems = tracing.filter((t) => t.unknown > 0);
  const unknownCopies = unknownItems.reduce((s, t) => s + t.unknown, 0);
  console.log(`inventory: ${data.inventory.copies} copies, ${data.inventory.items} items, ${data.inventory.onLoan} on loan`);
  console.log(`deposits: ${dep.events.length} parsed, ${dep.unparsed} unparsed`);
  console.log(`actions:  ${act.events.length} parsed, ${act.unparsed} unparsed`);
  console.log(`tracing:  ${tracing.length - unknownItems.length}/${tracing.length} items fully sourced, ${unknownCopies} unknown copies across ${unknownItems.length} items`);
  console.log(`usage:    ${use.rows.length} month/person/item/type rows, ${use.members.length} members`);
  console.log(`wrote ${path.relative(process.cwd(), OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
})();
