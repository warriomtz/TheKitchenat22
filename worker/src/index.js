/**
 * The Kitchen at 22 — API (Cloudflare Worker + Durable Object)
 *
 * Replaces JSONBin. Same routes as the old local server.py so the site's
 * existing "server mode" in js/store.js works unchanged:
 *
 *   GET  /api/stock | /api/hours | /api/menu | /api/announcement      (public)
 *   GET  /api/orders | /api/analytics | /api/bar-inventory            (admin)
 *   POST /api/orders {action:"create"}                                (public)
 *   POST /api/analytics {action:"track"}                              (public)
 *   POST /api/stock | /api/hours | /api/menu/item | /api/announcement
 *        /api/bar-inventory | /api/orders (status/items/delete)
 *        /api/analytics {action:"purge"}                              (admin)
 *   POST /api/admin/login {code}      check the admin code
 *   POST /api/admin/import {data}     one-time import from the JSONBin doc
 *
 * Admin auth: the admin code is a Worker SECRET (env.ADMIN_CODE). It is
 * never shipped to the browser. Clients send it in `X-Admin-Code` (or the
 * legacy `code` query/body field). Wrong codes are rate limited per IP.
 */
import { DurableObject } from "cloudflare:workers";

const MAX_ORDERS = 800;
const MAX_ANALYTICS = 2500;
const DEFAULT_HOURS = {
  closedDays: [2],
  open: "14:00",
  close: "21:00",
  deliveryClose: "20:30",
  forceClosed: false,
  forceOpen: false,
};
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

// ---------------------------------------------------------------- helpers

const enc = new TextEncoder();

async function safeEqual(a, b) {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(String(a))),
    crypto.subtle.digest("SHA-256", enc.encode(String(b))),
  ]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

function hex(n) {
  const bytes = crypto.getRandomValues(new Uint8Array(Math.ceil(n / 2)));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, n);
}

const nowIso = () => new Date().toISOString();
const str = (v, max) => String(v == null ? "" : v).slice(0, max);

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const h = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Code",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
  if (origin && allowedOrigins(env).includes(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
  }
  return h;
}

function reply(request, env, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(request, env),
    },
  });
}

function clientIp(request) {
  return str(request.headers.get("CF-Connecting-IP") || "", 80);
}

// ------------------------------------------------------- notifications

function ntfyWhere(o) {
  if (o.orderType === "dinein") return "Comer aquí";
  if (o.orderType === "apartment") return `Para llevar · Depto ${o.apartment || "—"}`;
  if (o.orderType === "amenity") return `Para llevar · ${o.amenity || o.amenityId || "Amenidad"}`;
  return "Pedido";
}

function ntfyBody(o) {
  const items = o.items || [];
  const lines = items.slice(0, 10).map((it) => {
    let line = `×${it.qty || 1} ${it.name || it.id || "item"}`;
    const extra = [it.customizations, it.notes]
      .map((s) => String(s || "").trim())
      .filter(Boolean)
      .join(" · ");
    if (extra) line += ` (${extra.slice(0, 80)})`;
    return line;
  });
  if (items.length > 10) lines.push(`+${items.length - 10} más`);
  return [ntfyWhere(o), ...lines].join("\n").slice(0, 1200);
}

/** Phone ping for the kitchen. No prices. Never throws. */
async function notifyKitchen(env, order) {
  const topic = String(env.NTFY_TOPIC || "").trim();
  if (!topic) return;
  const url =
    `https://ntfy.sh/${encodeURIComponent(topic)}` +
    `?title=${encodeURIComponent("The Kitchen · nuevo pedido")}` +
    `&priority=5&tags=${encodeURIComponent("rotating_light,fork_and_knife")}` +
    (env.ADMIN_URL ? `&click=${encodeURIComponent(env.ADMIN_URL)}` : "");
  try {
    await fetch(url, { method: "POST", body: ntfyBody(order) });
  } catch (_) {
    /* the order is already saved; ignore */
  }
}

// ----------------------------------------------------------------- Worker

const PUBLIC_GET = new Set(["/api/stock", "/api/hours", "/api/menu", "/api/announcement"]);
const ADMIN_GET = new Set(["/api/orders", "/api/analytics", "/api/bar-inventory"]);
const POST_ROUTES = new Set([
  "/api/stock",
  "/api/bar-inventory",
  "/api/hours",
  "/api/menu/item",
  "/api/menu/image",
  "/api/announcement",
  "/api/orders",
  "/api/analytics",
  "/api/admin/login",
  "/api/admin/import",
]);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }
    if (path === "/api/health") return reply(request, env, 200, { ok: true });
    if (!path.startsWith("/api/")) return reply(request, env, 404, { error: "not_found" });

    const stub = env.STORE.get(env.STORE.idFromName("main"));
    const ip = clientIp(request);

    // ---------------------------------------------------------- GET
    if (request.method === "GET") {
      if (PUBLIC_GET.has(path)) {
        const [status, body] = await stub.op(path, "GET", {}, ip);
        return reply(request, env, status, body);
      }
      if (ADMIN_GET.has(path)) {
        const code = request.headers.get("X-Admin-Code") || url.searchParams.get("code") || "";
        const denied = await checkAdmin(env, stub, ip, code);
        if (denied) return reply(request, env, denied[0], denied[1]);
        const [status, body] = await stub.op(path, "GET", {}, ip);
        return reply(request, env, status, body);
      }
      return reply(request, env, 404, { error: "not_found" });
    }

    // --------------------------------------------------------- POST
    if (request.method !== "POST" || !POST_ROUTES.has(path)) {
      return reply(request, env, 404, { error: "not_found" });
    }
    const limit = path === "/api/admin/import" ? 8_000_000 : 300_000;
    const len = parseInt(request.headers.get("Content-Length") || "0", 10);
    if (len > limit) return reply(request, env, 413, { error: "too_large" });

    let data;
    try {
      const text = await request.text();
      if (text.length > limit) return reply(request, env, 413, { error: "too_large" });
      data = JSON.parse(text || "{}");
      if (!data || typeof data !== "object" || Array.isArray(data)) data = {};
    } catch {
      return reply(request, env, 400, { error: "invalid_json" });
    }

    const action = String(data.action || "").toLowerCase();

    // Public: create order
    if (path === "/api/orders" && (action === "" || action === "create")) {
      const [status, body] = await stub.op(path, "CREATE", data, ip);
      if (status === 200 && body.order) ctx.waitUntil(notifyKitchen(env, body.order));
      return reply(request, env, status, body);
    }
    // Public: analytics tracking
    if (path === "/api/analytics" && ["", "track", "create"].includes(action)) {
      const events = Array.isArray(data.events) ? data.events : [data];
      const [status, body] = await stub.op(path, "TRACK", { events }, ip);
      return reply(request, env, status, body);
    }

    // Everything else needs the admin code
    const code =
      request.headers.get("X-Admin-Code") || url.searchParams.get("code") || data.code || "";
    const denied = await checkAdmin(env, stub, ip, code);
    if (denied) return reply(request, env, denied[0], denied[1]);

    if (path === "/api/admin/login") return reply(request, env, 200, { ok: true });
    delete data.code;

    const [status, body] = await stub.op(path, "POST", data, ip);
    return reply(request, env, status, body);
  },
};

/** Returns null when authorized, otherwise [status, body]. Fails closed. */
async function checkAdmin(env, stub, ip, code) {
  if (!env.ADMIN_CODE) return [503, { error: "admin_not_configured" }];
  if (await stub.isLocked(ip)) return [429, { error: "too_many_attempts" }];
  if (code && (await safeEqual(code, env.ADMIN_CODE))) return null;
  await stub.recordFailure(ip);
  return [401, { error: "unauthorized" }];
}

// ---------------------------------------------------------- Durable Object

export class KitchenStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS orders (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT UNIQUE NOT NULL,
        json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS analytics (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ratelimit (
        k TEXT PRIMARY KEY, ws INTEGER NOT NULL, n INTEGER NOT NULL
      );
    `);
  }

  // ---- key/value docs
  kvGet(key, fallback) {
    const rows = this.sql.exec("SELECT v FROM kv WHERE k = ?", key).toArray();
    if (!rows.length) return fallback;
    try {
      return JSON.parse(rows[0].v);
    } catch {
      return fallback;
    }
  }
  kvSet(key, value) {
    this.sql.exec(
      "INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
      key,
      JSON.stringify(value)
    );
    return value;
  }

  // ---- rate limiting (admin failures)
  async isLocked(ip) {
    if (!ip) return false;
    const row = this.sql.exec("SELECT ws, n FROM ratelimit WHERE k = ?", `fail:${ip}`).toArray()[0];
    if (!row) return false;
    if (Date.now() - row.ws > 10 * 60_000) return false;
    return row.n >= 10;
  }
  async recordFailure(ip) {
    if (!ip) return;
    const k = `fail:${ip}`;
    const now = Date.now();
    const row = this.sql.exec("SELECT ws, n FROM ratelimit WHERE k = ?", k).toArray()[0];
    if (!row || now - row.ws > 10 * 60_000) {
      this.sql.exec(
        "INSERT INTO ratelimit (k, ws, n) VALUES (?, ?, 1) ON CONFLICT(k) DO UPDATE SET ws = excluded.ws, n = 1",
        k,
        now
      );
    } else {
      this.sql.exec("UPDATE ratelimit SET n = n + 1 WHERE k = ?", k);
    }
  }
  /** Public endpoint throttle. Returns true when the call is allowed. */
  throttle(kind, ip, max) {
    if (!ip) return true;
    const k = `${kind}:${ip}`;
    const now = Date.now();
    const row = this.sql.exec("SELECT ws, n FROM ratelimit WHERE k = ?", k).toArray()[0];
    if (!row || now - row.ws > 10 * 60_000) {
      this.sql.exec(
        "INSERT INTO ratelimit (k, ws, n) VALUES (?, ?, 1) ON CONFLICT(k) DO UPDATE SET ws = excluded.ws, n = 1",
        k,
        now
      );
      return true;
    }
    if (row.n >= max) return false;
    this.sql.exec("UPDATE ratelimit SET n = n + 1 WHERE k = ?", k);
    return true;
  }

  // ---- stock / hours / announcement / bar
  readStock() {
    const s = this.kvGet("stock", {});
    const ids = Array.isArray(s.outOfStock) ? s.outOfStock : [];
    return { outOfStock: ids.map(String) };
  }
  writeStock(ids) {
    const clean = [...new Set(ids.filter(Boolean).map(String))].sort();
    return this.kvSet("stock", { outOfStock: clean });
  }
  normalizeHours(raw) {
    const base = { ...DEFAULT_HOURS };
    if (!raw || typeof raw !== "object") return base;
    if (Array.isArray(raw.closedDays)) {
      base.closedDays = [
        ...new Set(
          raw.closedDays
            .map((d) => parseInt(d, 10))
            .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
        ),
      ].sort((a, b) => a - b);
    }
    for (const key of ["open", "close", "deliveryClose"]) {
      const val = String(raw[key] == null ? base[key] : raw[key]).trim();
      const m = TIME_RE.exec(val);
      if (m) base[key] = `${m[1].padStart(2, "0")}:${m[2]}`;
    }
    base.forceClosed = !!raw.forceClosed;
    base.forceOpen = !!raw.forceOpen;
    if (base.forceClosed && base.forceOpen) base.forceOpen = false;
    return base;
  }
  readAnnouncement() {
    return this.normalizeAnnouncement(this.kvGet("announcement", null));
  }
  normalizeAnnouncement(raw) {
    const a = raw && typeof raw === "object" ? raw : {};
    return {
      enabled: !!a.enabled,
      messageEs: str(a.messageEs, 2000),
      messageEn: str(a.messageEn, 2000),
      updatedAt: a.updatedAt || null,
    };
  }

  // ---- menu
  findItem(menu, itemId) {
    for (const [secKey, section] of Object.entries(menu || {})) {
      const subs = (section && section.subcategories) || {};
      for (const [subKey, sub] of Object.entries(subs)) {
        const items = (sub && sub.items) || [];
        for (let idx = 0; idx < items.length; idx++) {
          if (String(items[idx].id) === String(itemId)) return { secKey, subKey, idx, item: items[idx] };
        }
      }
    }
    return null;
  }
  slugId(name, prefix) {
    const base =
      String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "item";
    return `${prefix}-${base}-${hex(6)}`;
  }
  menuItem(data) {
    const menu = this.kvGet("menu", null);
    if (!menu || !Object.keys(menu).length) {
      return [500, { error: "menu_missing", message: "Menu not imported yet." }];
    }
    const action = String(data.action || "").toLowerCase();

    if (action === "add") {
      const section = String(data.section || "");
      const subKey = String(data.subKey || "");
      if (!menu[section]) return [400, { error: "bad_section" }];
      menu[section].subcategories = menu[section].subcategories || {};
      const subs = menu[section].subcategories;
      if (!subs[subKey]) return [400, { error: "bad_subcategory" }];
      const name = String(data.name || "").trim();
      if (!name) return [400, { error: "name_required" }];
      const price = Math.trunc(Number(data.price == null ? 0 : data.price));
      if (!Number.isFinite(price) || price < 0) return [400, { error: "bad_price" }];
      const prefix = { drinks: "d", bar: "b", food: "f" }[section] || "x";
      let itemId = String(data.id || "").trim() || this.slugId(name, prefix);
      if (this.findItem(menu, itemId)) itemId = this.slugId(name, prefix);
      const item = {
        id: itemId,
        name,
        price,
        notes: String(data.notes || ""),
        notesKey: String(data.notesKey || ""),
        flags: Array.isArray(data.flags) ? data.flags.map(String) : [],
        img: String(data.img || ""),
        name_en: String(data.name_en || name),
        name_ja: String(data.name_ja || name),
      };
      (subs[subKey].items = subs[subKey].items || []).push(item);
      this.kvSet("menu", menu);
      return [200, { ok: true, item, menu }];
    }

    if (action === "delete") {
      const itemId = String(data.itemId || data.id || "").trim();
      const found = this.findItem(menu, itemId);
      if (!found) return [404, { error: "not_found" }];
      menu[found.secKey].subcategories[found.subKey].items.splice(found.idx, 1);
      const stock = this.readStock().outOfStock;
      if (stock.includes(itemId)) this.writeStock(stock.filter((x) => x !== itemId));
      this.kvSet("menu", menu);
      return [200, { ok: true, deleted: itemId, menu }];
    }

    if (action === "update") {
      const itemId = String(data.itemId || data.id || "").trim();
      const found = this.findItem(menu, itemId);
      if (!found) return [404, { error: "not_found" }];
      const item = found.item;
      if ("name" in data && String(data.name).trim()) item.name = String(data.name).trim();
      if ("name_en" in data) item.name_en = String(data.name_en).trim();
      if ("name_ja" in data) item.name_ja = String(data.name_ja).trim();
      if ("price" in data) {
        const p = Math.trunc(Number(data.price));
        if (!Number.isFinite(p)) return [400, { error: "bad_price" }];
        item.price = p;
      }
      if ("notes" in data) item.notes = String(data.notes);
      if ("img" in data && data.img) item.img = String(data.img);
      if ("flags" in data && Array.isArray(data.flags)) item.flags = data.flags.map(String);
      if ("isNew" in data) item.isNew = !!data.isNew;
      if ("isWeeklySpecial" in data) item.isWeeklySpecial = !!data.isWeeklySpecial;
      if ("weeklyQty" in data) {
        const n = Math.trunc(Number(data.weeklyQty));
        if (!Number.isFinite(n)) return [400, { error: "bad_weekly_qty" }];
        item.weeklyQty = Math.max(0, n);
      }
      if ("dineInOnly" in data) item.dineInOnly = !!data.dineInOnly;
      if ("isHidden" in data) item.isHidden = !!data.isHidden;
      this.kvSet("menu", menu);
      return [200, { ok: true, item, menu }];
    }

    return [400, { error: "bad_action" }];
  }

  // ---- orders
  sanitizeOrderItem(raw) {
    if (!raw || typeof raw !== "object") return null;
    const name = str(raw.name, 200).trim();
    if (!name) return null;
    let qty = parseInt(raw.qty, 10);
    if (!Number.isFinite(qty)) qty = 1;
    qty = Math.max(1, Math.min(99, qty));
    return {
      id: str(raw.id, 80),
      name,
      qty,
      customizations: str(raw.customizations, 500),
      notes: str(raw.notes, 500),
      dineInOnly: !!raw.dineInOnly,
      sectionId: str(raw.sectionId || raw.section, 40),
      subKey: str(raw.subKey, 40),
    };
  }
  listOrders() {
    return this.sql
      .exec("SELECT json FROM orders ORDER BY seq DESC")
      .toArray()
      .map((r) => JSON.parse(r.json));
  }
  saveOrder(o) {
    this.sql.exec("UPDATE orders SET json = ? WHERE id = ?", JSON.stringify(o), String(o.id));
  }
  getOrder(id) {
    const r = this.sql.exec("SELECT json FROM orders WHERE id = ?", String(id)).toArray()[0];
    return r ? JSON.parse(r.json) : null;
  }
  createOrder(data) {
    const orderType = String(data.orderType || "").trim();
    if (!["dinein", "apartment", "amenity"].includes(orderType)) return [400, { error: "bad_order_type" }];
    const itemsIn = Array.isArray(data.items) ? data.items : [];
    const items = itemsIn.slice(0, 40).map((r) => this.sanitizeOrderItem(r)).filter(Boolean);
    if (!items.length) return [400, { error: "items_required" }];
    const apartment = str(data.apartment, 40).trim();
    const amenity = str(data.amenity, 120).trim();
    const amenityId = str(data.amenityId, 40).trim();
    if (orderType === "apartment" && !apartment) return [400, { error: "apartment_required" }];
    if (orderType === "amenity" && !amenity && !amenityId) return [400, { error: "amenity_required" }];

    const order = {
      id: hex(12),
      createdAt: nowIso(),
      status: "open",
      orderType,
      apartment: orderType === "apartment" ? apartment : "",
      amenity: orderType === "amenity" ? amenity : "",
      amenityId: orderType === "amenity" ? amenityId : "",
      items,
      source: "whatsapp",
    };
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("INSERT INTO orders (id, json) VALUES (?, ?)", order.id, JSON.stringify(order));
      this.sql.exec(
        "DELETE FROM orders WHERE seq NOT IN (SELECT seq FROM orders ORDER BY seq DESC LIMIT ?)",
        MAX_ORDERS
      );
    });
    return [200, { ok: true, order }];
  }
  orderAdmin(data) {
    const act = String(data.action || "update").toLowerCase();
    if (act === "delete_completed" || act === "purge_completed") {
      const before = this.sql.exec("SELECT COUNT(*) AS c FROM orders").one().c;
      const kept = this.listOrders().filter((o) => String(o.status || "open") === "open");
      this.ctx.storage.transactionSync(() => {
        this.sql.exec("DELETE FROM orders");
        for (const o of [...kept].reverse()) {
          this.sql.exec("INSERT INTO orders (id, json) VALUES (?, ?)", String(o.id), JSON.stringify(o));
        }
      });
      return [200, { ok: true, deleted: before - kept.length, orders: kept }];
    }
    if (act === "delete") {
      const id = String(data.orderId || data.id || "").trim();
      if (!id) return [400, { error: "order_id_required" }];
      const res = this.sql.exec("DELETE FROM orders WHERE id = ?", id);
      if (!res.rowsWritten) return [404, { error: "not_found" }];
      return [200, { ok: true, deleted: 1, orderId: id, orders: this.listOrders() }];
    }
    if (act === "items" || act === "set_items" || act === "update_items") {
      const id = String(data.orderId || data.id || "").trim();
      if (!id) return [400, { error: "order_id_required" }];
      if (!Array.isArray(data.items)) return [400, { error: "items_required" }];
      const items = data.items.slice(0, 40).map((r) => this.sanitizeOrderItem(r)).filter(Boolean);
      const o = this.getOrder(id);
      if (!o) return [404, { error: "not_found" }];
      const now = nowIso();
      o.items = items;
      o.updatedAt = now;
      o.editedAt = now;
      this.saveOrder(o);
      return [200, { ok: true, order: o }];
    }
    // status update
    const id = String(data.orderId || data.id || "").trim();
    const status = String(data.status || "").trim().toLowerCase();
    if (!["open", "completed", "dismissed"].includes(status)) return [400, { error: "bad_status" }];
    const o = this.getOrder(id);
    if (!o) return [404, { error: "not_found" }];
    o.status = status;
    o.updatedAt = nowIso();
    this.saveOrder(o);
    return [200, { ok: true, order: o }];
  }

  // ---- analytics
  trackAnalytics(events, ip) {
    if (!Array.isArray(events) || !events.length) return [400, { error: "events_required" }];
    let added = 0;
    this.ctx.storage.transactionSync(() => {
      for (const raw of events.slice(0, 40)) {
        if (!raw || typeof raw !== "object") continue;
        let kind = String(raw.type || "pageview").toLowerCase().slice(0, 20);
        if (!["pageview", "click", "section", "order"].includes(kind)) kind = "pageview";
        const ev = {
          id: hex(10),
          t: raw.t && !Number.isNaN(Date.parse(raw.t)) ? String(raw.t).slice(0, 40) : nowIso(),
          type: kind,
          path: str(raw.path || "/", 120),
          label: str(raw.label, 180),
          visitor: str(raw.visitor, 40),
          ip: str(raw.ip || ip, 80),
          ref: str(raw.ref, 180),
          lang: str(raw.lang, 12),
          ua: str(raw.ua, 180),
        };
        this.sql.exec("INSERT INTO analytics (json) VALUES (?)", JSON.stringify(ev));
        added++;
      }
      this.sql.exec(
        "DELETE FROM analytics WHERE seq NOT IN (SELECT seq FROM analytics ORDER BY seq DESC LIMIT ?)",
        MAX_ANALYTICS
      );
    });
    return [200, { ok: true, added }];
  }
  listAnalytics() {
    return this.sql
      .exec("SELECT json FROM analytics ORDER BY seq ASC")
      .toArray()
      .map((r) => JSON.parse(r.json));
  }

  // ---- one-time import of the old JSONBin document
  importDoc(data) {
    const doc = data.data && typeof data.data === "object" ? data.data : {};
    const hasOrders = this.sql.exec("SELECT COUNT(*) AS c FROM orders").one().c > 0;
    const hasMenu = !!this.kvGet("menu", null);
    if ((hasOrders || hasMenu) && !data.force) {
      return [409, { error: "already_imported", message: "Data exists. Send force:true to overwrite." }];
    }
    const menu = doc.menu && typeof doc.menu === "object" ? doc.menu : null;
    if (!menu) return [400, { error: "menu_required" }];

    // Re-apply live admin changes (hidden / weekly specials / quantities)
    const ops = doc.menuOps && typeof doc.menuOps === "object" ? doc.menuOps : {};
    for (const section of Object.values(menu)) {
      for (const sub of Object.values((section && section.subcategories) || {})) {
        for (const item of (sub && sub.items) || []) {
          const o = ops[item.id];
          if (!o) continue;
          if (o.isHidden != null) item.isHidden = !!o.isHidden;
          if (o.isWeeklySpecial != null) item.isWeeklySpecial = !!o.isWeeklySpecial;
          if (o.weeklyQty != null) {
            const n = parseInt(o.weeklyQty, 10);
            item.weeklyQty = Number.isFinite(n) && n >= 0 ? n : 0;
          }
        }
      }
    }
    const orders = Array.isArray(doc.orders) ? doc.orders : [];
    const events = Array.isArray(doc.analytics) ? doc.analytics : [];

    this.ctx.storage.transactionSync(() => {
      this.kvSet("menu", menu);
      this.writeStock((doc.stock && doc.stock.outOfStock) || []);
      this.kvSet("hours", this.normalizeHours(doc.hours));
      this.kvSet("announcement", this.normalizeAnnouncement(doc.announcement));
      if (doc.barInventory && typeof doc.barInventory === "object") this.kvSet("barInventory", doc.barInventory);
      this.sql.exec("DELETE FROM orders");
      this.sql.exec("DELETE FROM analytics");
      // docs list newest first; insert oldest first so ordering is preserved
      for (const o of orders.slice(0, MAX_ORDERS).reverse()) {
        if (!o || !o.id) continue;
        this.sql.exec(
          "INSERT OR REPLACE INTO orders (id, json) VALUES (?, ?)",
          String(o.id),
          JSON.stringify(o)
        );
      }
      for (const e of events.slice(-MAX_ANALYTICS)) {
        this.sql.exec("INSERT INTO analytics (json) VALUES (?)", JSON.stringify(e));
      }
    });
    return [
      200,
      { ok: true, imported: { menu: true, orders: orders.length, analytics: events.length } },
    ];
  }

  // ---- router
  async op(path, mode, data, ip) {
    if (mode === "CREATE") {
      if (!this.throttle("order", ip, 60)) return [429, { error: "too_many_requests" }];
      return this.createOrder(data);
    }
    if (mode === "TRACK") {
      if (!this.throttle("track", ip, 300)) return [429, { error: "too_many_requests" }];
      return this.trackAnalytics(data.events, ip);
    }

    if (mode === "GET") {
      switch (path) {
        case "/api/stock":
          return [200, this.readStock()];
        case "/api/hours":
          return [200, this.normalizeHours(this.kvGet("hours", null))];
        case "/api/menu": {
          const menu = this.kvGet("menu", null);
          if (!menu || !Object.keys(menu).length) return [404, { error: "menu_missing" }];
          return [200, { menu }];
        }
        case "/api/announcement":
          return [200, this.readAnnouncement()];
        case "/api/orders":
          return [200, { orders: this.listOrders() }];
        case "/api/analytics":
          return [200, { events: this.listAnalytics() }];
        case "/api/bar-inventory":
          return [200, { inventory: this.kvGet("barInventory", {}) }];
      }
      return [404, { error: "not_found" }];
    }

    // admin POST
    switch (path) {
      case "/api/stock": {
        if (!Array.isArray(data.outOfStock)) return [400, { error: "outOfStock must be a list" }];
        return [200, this.writeStock(data.outOfStock)];
      }
      case "/api/hours": {
        const raw = data.hours && typeof data.hours === "object" ? data.hours : data;
        return [200, this.kvSet("hours", this.normalizeHours(raw))];
      }
      case "/api/bar-inventory": {
        let inv = data.inventory && typeof data.inventory === "object" ? data.inventory : data;
        if (inv === data) {
          inv = { ...data };
          delete inv.action;
        }
        this.kvSet("barInventory", inv);
        return [200, { ok: true, inventory: inv }];
      }
      case "/api/announcement": {
        const a = this.normalizeAnnouncement(data);
        a.updatedAt = nowIso();
        return [200, this.kvSet("announcement", a)];
      }
      case "/api/menu/item":
        return this.menuItem(data);
      case "/api/menu/image":
        return [
          501,
          {
            error: "not_supported",
            message: "Upload product photos by adding them to assets/products/ in the repo.",
          },
        ];
      case "/api/orders":
        return this.orderAdmin(data);
      case "/api/analytics":
        this.sql.exec("DELETE FROM analytics");
        return [200, { ok: true, events: [] }];
      case "/api/admin/import":
        return this.importDoc(data);
    }
    return [404, { error: "not_found" }];
  }
}
