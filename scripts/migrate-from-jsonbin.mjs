#!/usr/bin/env node
/**
 * One-time migration: JSONBin document -> Cloudflare Worker API.
 *
 * Run with no arguments and it will ask for each value, or set env vars:
 *   API=https://<your-worker>.workers.dev  ADMIN_CODE=...  \
 *   node scripts/migrate-from-jsonbin.mjs [--dry-run] [--force]
 *
 * - Reads the live bin (read-only GET; never writes to JSONBin).
 * - Saves a local backup file (contains resident orders -> git-ignored).
 * - Re-applies menuOps (hidden items, weekly specials, quantities).
 * - Points product photos at this repo instead of the old one.
 * - POSTs everything to /api/admin/import (refuses to overwrite unless --force).
 *
 * After a successful migration, revoke the old JSONBin key.
 */
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";

const dry = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");

// Values come from the environment, or are asked for here (easier on Windows).
const rl = createInterface({ input: process.stdin, output: process.stdout });
async function ask(name, label) {
  if (process.env[name]) return process.env[name].trim();
  return (await rl.question(label + ": ")).trim();
}
const JSONBIN_BIN_ID = await ask("JSONBIN_BIN_ID", "Bin ID de JSONBin");
const JSONBIN_KEY = await ask("JSONBIN_KEY", "Master Key actual de JSONBin");
const API = dry
  ? ""
  : await ask("API", "Direccion del servidor (https://kitchen22-api.mariodiaz25.workers.dev)");
const ADMIN_CODE = dry ? "" : await ask("ADMIN_CODE", "Codigo de admin NUEVO");
rl.close();
const OLD = "https://raw.githubusercontent.com/TheKitchenat22/The-Kitchen/main/";
const NEW = "https://raw.githubusercontent.com/warriomtz/TheKitchenat22/main/";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

if (!JSONBIN_BIN_ID || !JSONBIN_KEY) die("Set JSONBIN_BIN_ID and JSONBIN_KEY");
if (!dry && (!API || !ADMIN_CODE)) die("Set API and ADMIN_CODE (or use --dry-run)");

function die(msg) {
  console.error(msg);
  process.exit(1);
}

const res = await fetch(`https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}/latest`, {
  headers: { "X-Master-Key": JSONBIN_KEY, "X-Bin-Meta": "false", "User-Agent": UA },
});
if (!res.ok) die(`JSONBin GET failed: ${res.status}`);
let doc = await res.json();
if (doc && doc.record) doc = doc.record;

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backup = `backup-jsonbin-${stamp}.json`;
writeFileSync(backup, JSON.stringify(doc, null, 2));
console.log(`Backup saved: ${backup}`);

const rewrite = (v) =>
  typeof v === "string"
    ? v.split(OLD).join(NEW)
    : Array.isArray(v)
      ? v.map(rewrite)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rewrite(x)]))
        : v;
doc.menu = rewrite(doc.menu);

const count = (x) => (Array.isArray(x) ? x.length : 0);
console.log(
  `Found: menu=${doc.menu ? "yes" : "NO"}  menuOps=${Object.keys(doc.menuOps || {}).length}  ` +
    `orders=${count(doc.orders)}  analytics=${count(doc.analytics)}  ` +
    `outOfStock=${count(doc.stock && doc.stock.outOfStock)}  bar=${doc.barInventory ? "yes" : "no"}`
);
if (!doc.menu) die("The bin has no menu; aborting.");
if (dry) {
  console.log("Dry run: nothing was sent.");
  process.exit(0);
}

const out = await fetch(`${API.replace(/\/$/, "")}/api/admin/import`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Admin-Code": ADMIN_CODE },
  body: JSON.stringify({ data: doc, force }),
});
const body = await out.json().catch(() => ({}));
console.log(out.status, JSON.stringify(body));
process.exit(out.ok ? 0 : 1);
