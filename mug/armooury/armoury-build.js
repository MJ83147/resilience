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

// Optional item metadata (damage/accuracy/armor/quality/market_value/description/
// bonus), keyed by Torn item id. Populated by a torn/items pull into
// items-meta.json; absent until that pull runs, in which case items show no stats.
let META = {};
function loadItemMeta() {
  const p = path.join(HERE, "items-meta.json");
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {};
}

// Manual deposit log (a Google Sheet export): per-copy status (Loan / For Sale /
// Faction Owned), stats and, uniquely, the bonus perks the Torn API does not give
// for the armoury. Returns itemName -> [entries]. Matched to inventory by weapon
// name, or armour set + body part (Body -> Body Armor).
function parseCSV(text) {
  const rows = []; let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
function loadLog() {
  const f = fs.readdirSync(HERE).find((n) => /Deposit Log.*\.csv$/i.test(n) || n === "deposit-log.csv");
  if (!f) return { byItem: {}, count: 0, source: null };
  const rows = parseCSV(fs.readFileSync(path.join(HERE, f), "utf8")).filter((r) => r.some((c) => c && c.trim()));
  rows.shift(); // header
  const byItem = {}; let count = 0;
  const add = (item, e) => { (byItem[item] = byItem[item] || []).push(e); count++; };
  const num = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
  for (const r of rows) {
    const who = (r[2] || "").trim(), date = (r[3] || "").trim(), status = (r[4] || "").trim(), gear = (r[5] || "").trim();
    if (/weapon/i.test(gear)) {
      for (const b of [6, 15, 24]) {
        const name = (r[b] || "").trim();
        if (!name) continue;
        const perks = [];
        if ((r[b + 5] || "").trim()) perks.push({ name: r[b + 5].trim(), pct: num(r[b + 6]) });
        if ((r[b + 7] || "").trim()) perks.push({ name: r[b + 7].trim(), pct: num(r[b + 8]) });
        add(name, { who, date, status, gear: "weapon", damage: num(r[b + 1]), accuracy: num(r[b + 2]), quality: num(r[b + 3]), color: (r[b + 4] || "").trim(), perks });
      }
    } else if (/armor|armour/i.test(gear)) {
      const set = (r[33] || "").trim(), part = (r[34] || "").trim();
      if (!set || !part) continue;
      const name = set + " " + (/body/i.test(part) ? "Body Armor" : part);
      const perks = num(r[36]) != null ? [{ name: "", pct: num(r[36]) }] : [];
      add(name, { who, date, status, gear: "armor", set, part, color: (r[35] || "").trim(), armor: num(r[37]), quality: num(r[38]), coverage: num(r[39]), perks });
    }
  }
  return { byItem, count, source: f };
}

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
      for (const uid of r.uids) copies.push({ cat, item: r.name, itemId: r.id, type: r.type, uid, holder: r.loaned || null });
    }
  }
  return copies;
}

// Organized-crime item rewards. OC completions pay items into the armory:
// "...successfully completed <Scenario> receiving 1x A, 2x B, and 1x C which has
// been deposited into the faction armory (+X.XX)". No single depositor, so these
// count as faction-owned, credited to a sentinel "Organized crime" depositor.
function parseCrimeRewards(rows) {
  const events = [];
  for (const r of rows) {
    const plain = r.text.replace(/<[^>]+>/g, "");
    const m = /successfully completed (.+?) receiving (.+?) which has been deposited into the faction armory/i.exec(plain);
    if (!m) continue;
    const scenario = m[1].trim();
    for (const part of m[2].split(/,\s*|\s+and\s+/)) {
      const im = /^(\d+)x\s+(.+)$/.exec(part.trim());
      if (!im) continue;
      events.push({ ts: r.timestamp, item: im[2].trim(), qty: +im[1], actor: { id: -1, name: "Organized crime" }, how: "oc", scenario });
    }
  }
  return events;
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
// The current inventory grouped by item, enriched from the deposit-log
// spreadsheet (the source of truth). Ownership is spreadsheet-driven: a copy is
// player-owned when a current roster member has it logged as their loan or sale;
// everything else is faction-owned. Colour and perks come from the log too.
function trace(copies, roster, log) {
  const byItem = new Map();
  for (const c of copies) {
    const e = byItem.get(c.item) || { item: c.item, cat: c.cat, itemId: c.itemId, type: c.type, copies: 0, onLoan: 0, holders: [] };
    e.copies++;
    if (c.holder) { e.onLoan++; e.holders.push(c.holder.name); }
    byItem.set(c.item, e);
  }
  const items = [...byItem.values()].map((e) => {
    const logs = log.byItem[e.item] || [];
    let player = 0, forSale = false, loan = 0, factionLogged = 0;
    const colours = {};
    for (const le of logs) {
      const who = String(le.who || "").trim().toLowerCase();
      const inRoster = roster.names.has(who);
      const isFaction = /faction/i.test(le.status || "");
      const isSale = /sale/i.test(le.status || "");
      if (isSale) forSale = true;
      if (/loan/i.test(le.status || "")) loan++;
      if (isFaction) factionLogged++;
      if (inRoster && !isFaction) player++;
      const col = (le.color || "").trim().toLowerCase() || "none";
      colours[col] = (colours[col] || 0) + 1;
    }
    player = Math.min(player, e.copies);
    return {
      item: e.item, cat: e.cat, itemId: e.itemId, type: e.type, copies: e.copies, onLoan: e.onLoan,
      meta: META[e.itemId] || null,
      holders: e.holders.sort(),
      log: logs,
      own: { player, faction: e.copies - player },
      forSale, colours,
    };
  }).sort((a, b) => b.copies - a.copies);
  return items;
}

// One row per individual weapon/armour piece. Sheet entries (source of truth)
// are matched to inventory copies of the same item; a piece with a sheet entry
// carries its colour, perks, owner and status, otherwise it is faction stock.
function buildPieces(copies, tracing, log, roster) {
  const metaOf = {};
  tracing.forEach((t) => { metaOf[t.item] = t.meta; });
  const byItem = {};
  for (const c of copies) (byItem[c.item] = byItem[c.item] || []).push(c);
  const pieces = [];
  for (const item in byItem) {
    const cs = byItem[item];
    const logs = log.byItem[item] || [];
    const meta = metaOf[item] || null;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      const le = logs[i] || null;   // match sheet entry to a copy by order
      let ownership = "faction", who = null, status = null, colour = null, perks = [], damage = null, accuracy = null, quality = null;
      if (le) {
        who = le.who || null;
        status = le.status || null;
        colour = (le.color || "").trim().toLowerCase() || null;
        perks = le.perks || [];
        damage = le.damage; accuracy = le.accuracy; quality = le.quality;
        const inRoster = roster.names.has(String(le.who || "").trim().toLowerCase());
        ownership = inRoster && !/faction/i.test(le.status || "") ? "player" : "faction";
      }
      pieces.push({
        item, cat: c.cat, type: c.type, itemId: c.itemId, uid: c.uid,
        holder: c.holder ? c.holder.name : null,
        who, ownership, status, colour, perks, damage, accuracy, quality,
        market: meta ? meta.market_value : null,
      });
    }
  }
  const rank = (p) => (p.colour === "red" ? 0 : p.colour === "orange" ? 1 : p.colour === "yellow" ? 2 : p.who ? 3 : 4);
  return pieces.sort((a, b) => rank(a) - rank(b) || a.item.localeCompare(b.item));
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
// Current roster: members still in the faction. A depositor in this set means
// the copy is player-owned; a depositor who has left makes it faction-owned.
function loadRoster() {
  for (const p of [path.join(HERE, "roster.json"), path.join(HERE, "..", "..", "current-roster-sept.json")]) {
    if (fs.existsSync(p)) {
      const d = JSON.parse(fs.readFileSync(p, "utf8"));
      const list = d.members || d;
      const arr = Array.isArray(list) ? list : Object.values(list);
      const set = new Set(arr.map((m) => m.id));
      const names = new Set(arr.map((m) => String(m.name || "").trim().toLowerCase()));
      return { set, names, count: set.size, source: path.basename(p) };
    }
  }
  return { set: new Set(), names: new Set(), count: 0, source: null };
}

(function () {
  const copies = loadInventory();
  if (!copies.length) { console.error("No inv-*.json found. Pull current inventory first."); process.exit(1); }
  const dep = parseAll(load("raw-armoryDeposit.jsonl"), DEP_RULES);
  const act = parseAll(load("raw-armoryAction.jsonl"), ACT_RULES);
  const ocEvents = parseCrimeRewards(load("raw-crime.jsonl"));
  const roster = loadRoster();
  if (!roster.count) console.warn("No roster file found; ownership will treat every copy as faction-owned.");
  META = loadItemMeta();
  const log = loadLog();

  const tracing = trace(copies, roster, log);
  const use = usage(act.events);

  // Per-item timeline for weapons/armour: every deposit and loan-movement for a
  // currently-held item, oldest first, so the page can show its life from the
  // first deposit to now. Deposits reach back to 2019; loan movements only as
  // far as the action feed has been downloaded.
  const tracked = new Set(copies.map((c) => c.item));
  const timeline = new Map();
  const pushEv = (e, type) => {
    if (!tracked.has(e.item)) return;
    const arr = timeline.get(e.item) || [];
    arr.push({ ts: e.ts, type, by: e.actor ? e.actor.name : null, to: e.other ? e.other.name : null, qty: e.qty || 1, note: e.scenario });
    timeline.set(e.item, arr);
  };
  for (const e of dep.events) pushEv(e, e.how);          // deposit / cache
  for (const e of act.events) pushEv(e, e.type);         // loaned / returned / retrieved / given / took / used
  for (const e of ocEvents) pushEv(e, "oc");             // organized-crime armory rewards
  for (const t of tracing) t.events = (timeline.get(t.item) || []).sort((a, b) => a.ts - b.ts);
  const logMatched = tracing.reduce((s, t) => s + (t.log ? t.log.length : 0), 0);

  // pieces: one row per individual weapon/armour piece, NOT grouped by item.
  // The spreadsheet is the source of truth for colour, perks, owner and status;
  // inventory copies with no sheet entry are generic faction stock.
  const pieces = buildPieces(copies, tracing, log, roster);

  const depTs = dep.events.map((e) => e.ts);
  const actTs = act.events.map((e) => e.ts);
  const data = {
    generated: Math.floor(fs.statSync(path.join(HERE, "raw-armoryDeposit.jsonl")).mtimeMs / 1000),
    inventory: { copies: copies.length, items: new Set(copies.map((c) => c.item)).size, onLoan: copies.filter((c) => c.holder).length },
    depositWindow: depTs.length ? { from: Math.min(...depTs), to: Math.max(...depTs), count: dep.events.length, unparsed: dep.unparsed } : null,
    actionWindow: actTs.length ? { from: Math.min(...actTs), to: Math.max(...actTs), count: act.events.length, unparsed: act.unparsed } : null,
    roster: { count: roster.count, source: roster.source },
    pieces,
    tracing,
    usage: use,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(data));
  console.log(`inventory: ${data.inventory.copies} copies, ${data.inventory.items} items, ${data.inventory.onLoan} on loan`);
  console.log(`actions:  ${act.events.length} parsed (usage/ledger), ${act.unparsed} unparsed`);
  const ownSum = tracing.reduce((s, t) => ({ player: s.player + t.own.player, faction: s.faction + t.own.faction }), { player: 0, faction: 0 });
  console.log(`log:      ${log.count} entries (${log.source || "none"}), ${logMatched} matched to current items`);
  console.log(`ownership (spreadsheet-driven): player-owned ${ownSum.player}, faction-owned ${ownSum.faction} copies (roster ${roster.count})`);
  console.log(`usage:    ${use.rows.length} month/person/item/type rows, ${use.members.length} members`);
  console.log(`wrote ${path.relative(process.cwd(), OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
})();
