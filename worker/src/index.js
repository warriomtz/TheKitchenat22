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

/** Starting kitchen inventory (Meal Prep). qty:null = not tracked. */
const INV_VERSION = 15;
const INV_DEFAULT = {
  v: INV_VERSION,
  items: {
    "pollo-200": { name: "Pollo 200 g", unit: "unidades", group: "Proteínas", qty: 7, min: 1 },
    "pollo-100": { name: "Pollo 100 g", unit: "unidades", group: "Proteínas", qty: 2, min: 1 },
    "pollo-club": { name: "Pollo para Club sandwich", unit: "unidades", group: "Proteínas", qty: 5, min: 1 },
    "carne-hamburguesa": { name: "Carne de hamburguesa", unit: "unidades", group: "Proteínas", qty: 9, min: 2 },
    "pollo-empanizado": { name: "Pollo empanizado", unit: "unidades", group: "Proteínas", qty: 12, min: 2 },
    "pan-hamburguesa": { name: "Pan de hamburguesa", unit: "unidades", group: "Panes", qty: 2, min: 4 },
    bagel: { name: "Bagel", unit: "unidades", group: "Panes", qty: 9, min: 1 },
    pasta: { name: "Pasta", unit: "unidades", group: "Pastas", qty: 0, min: 1 },
    guacamole: { name: "Guacamole", unit: "porciones", group: "Entradas", qty: 2, min: 1, target: 2 },
    "queso-rayado": { name: "Queso rayado", unit: "g", group: "Lácteos", qty: 1300, min: 200 },
    "queso-suizo": { name: "Queso suizo", unit: "rebanadas", group: "Lácteos", qty: 37, min: 10 },
    salami: { name: "Salami", unit: "g", group: "Carnes frías", qty: 220, min: 32 },
    "pan-rebanada": { name: "Pan de caja (rebanadas)", unit: "rebanadas", group: "Pan", qty: 17, min: 6 },
    atun: { name: "Atún", unit: "unidades", group: "Proteínas", qty: 1, min: 1 },
    "carne-molida": { name: "Carne molida", unit: "unidades", group: "Proteínas", qty: 4, min: 1 },
    res: { name: "Res", unit: "unidades", group: "Proteínas", qty: 4, min: 1 },
    salmon: { name: "Salmón", unit: "unidades", group: "Proteínas", qty: 3, min: 1 },
    arroz: { name: "Arroz", unit: "unidades", group: "Complementos", qty: 12, min: 3 },
    frijol: { name: "Frijol", unit: "unidades", group: "Complementos", qty: 3, min: 1 },
    quinoa: { name: "Quinoa", unit: "unidades", group: "Complementos", qty: 2, min: 1 },
    "sopa-tomate": { name: "Sopa de tomate", unit: "unidades", group: "Complementos", qty: 0, min: 1 },
    "crema-espinaca": { name: "Sopa de espinaca", unit: "unidades", group: "Complementos", qty: 7, min: 2 },
  },
  recipes: {
    // Meal Prep chicken: each size has its own portions. outId = per-option "agotado" id used by the menu.
    "m-pollo-100": [
      { ing: "pollo-200", qty: 1, if: { chickenSize: "200" }, default: true, outId: "mp-chicken-200" },
      { ing: "pollo-100", qty: 1, if: { chickenSize: "100" }, outId: "mp-chicken-100" },
    ],
    "m-atun": [{ ing: "atun", qty: 1 }],
    "m-carne-molida": [{ ing: "carne-molida", qty: 1 }],
    "m-sirloin": [{ ing: "res", qty: 1 }],
    "m-salmon": [{ ing: "salmon", qty: 1 }],
    "f-club": [{ ing: "pollo-club", qty: 1 }, { ing: "pan-rebanada", qty: 3 }],
    "f-grilled": [{ ing: "pan-rebanada", qty: 2 }, { ing: "queso-rayado", qty: 60 }],
    // Burger patty is only used by the beef option; "variant" = blocks that option, never the whole dish
    "f-burger": [
      { ing: "pan-hamburguesa", qty: 1 },
      { ing: "queso-suizo", qty: 1 },
      { ing: "carne-hamburguesa", qty: 1, if: { burger: "beef" }, variant: true, outId: "f-burger-beef" },
      { ing: "pollo-empanizado", qty: 1, if: { burger: "chicken" }, variant: true, outId: "f-burger-chicken" },
    ],
    "f-guac": [{ ing: "guacamole", qty: 1 }],
    "f-pechuga-pomodoro": [{ ing: "pollo-empanizado", qty: 1 }, { ing: "pasta", qty: 1 }],
    "f-bagel-pizza": [{ ing: "bagel", qty: 1 }, { ing: "queso-rayado", qty: 80 }, { ing: "salami", qty: 18 }],
    "f-bagel-h": [{ ing: "bagel", qty: 1 }],
    // 100 g chicken portions also feed these dishes; "optional" = the extra-chicken add-on (+1 portion, never blocks)
    "f-alfredo": [{ ing: "pollo-100", qty: 1 }, { ing: "pasta", qty: 1 }, { ing: "pollo-100", qty: 1, if: { extraChicken: "1" }, optional: true }],
    "f-pesto": [{ ing: "pollo-100", qty: 1 }, { ing: "pasta", qty: 1 }, { ing: "pollo-100", qty: 1, if: { extraChicken: "1" }, optional: true }],
    "f-ensalada": [{ ing: "pollo-100", qty: 1 }, { ing: "pollo-100", qty: 1, if: { extraChicken: "1" }, optional: true }],
    "side:arroz": [{ ing: "arroz", qty: 1 }],
    "side:frijol": [{ ing: "frijol", qty: 1 }],
    "side:quinoa": [{ ing: "quinoa", qty: 1 }],
    "side:sopaTomate": [{ ing: "sopa-tomate", qty: 1 }, { ing: "queso-rayado", qty: 10 }],
    "side:cremaEspinacas": [{ ing: "crema-espinaca", qty: 1 }],
  },
};

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

function ntfyWhen(o) {
  if (!o || !o.mealPrep) return "";
  if (o.scheduledFor) return `🥗 MEAL PREP PROGRAMADO: ${String(o.scheduledFor).replace("T", " ")}`;
  return "🥗 MEAL PREP · para ahora";
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
  return [ntfyWhen(o), ntfyWhere(o), ...lines].filter(Boolean).join("\n").slice(0, 1200);
}

/** Optional ntfy access token (NTFY_TOKEN secret): avoids ntfy.sh's shared-IP rate limit (429). */
function ntfyHeaders(env) {
  const t = envVar(env, "NTFY_TOKEN");
  return t ? { Authorization: "Bearer " + t } : {};
}

/** Phone ping for the kitchen. No prices. Never throws. */
async function notifyKitchen(env, order) {
  const topic = envVar(env, "NTFY_TOPIC");
  if (!topic) {
    console.log("ntfy_not_configured");
    return;
  }
  const url =
    `https://ntfy.sh/${encodeURIComponent(topic)}` +
    `?title=${encodeURIComponent(
      order.mealPrep && order.scheduledFor ? "The Kitchen · Meal Prep programado" : "The Kitchen · nuevo pedido"
    )}` +
    `&priority=5&tags=${encodeURIComponent("rotating_light,fork_and_knife")}` +
    (env.ADMIN_URL ? `&click=${encodeURIComponent(env.ADMIN_URL)}` : "");
  try {
    const r = await fetch(url, { method: "POST", headers: ntfyHeaders(env), body: ntfyBody(order) });
    if (!r.ok) console.log("ntfy_failed", r.status);
  } catch (e) {
    console.log("ntfy_error", String(e && e.message));
  }
}

/** Read a Worker variable by name, ignoring upper/lower case (Telegram_bot_token == TELEGRAM_BOT_TOKEN). */
function envVar(env, name) {
  if (env[name] != null) return String(env[name]).trim();
  const want = name.toLowerCase();
  for (const k of Object.keys(env || {})) {
    if (k.toLowerCase() === want && env[k] != null) return String(env[k]).trim();
  }
  return "";
}

/** Second channel: Telegram message (set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID secrets). No prices. Never throws. */
async function notifyTelegram(env, order) {
  const token = envVar(env, "TELEGRAM_BOT_TOKEN");
  const chat = envVar(env, "TELEGRAM_CHAT_ID");
  if (!token || !chat) return;
  let late = "";
  if (order.clientCreatedAt) {
    const mins = Math.round((Date.parse(order.createdAt) - Date.parse(order.clientCreatedAt)) / 60000);
    if (Number.isFinite(mins) && mins >= 5) {
      late = `⏱ PEDIDO RETRASADO: lo hicieron hace ${mins >= 120 ? Math.round(mins / 60) + " h" : mins + " min"} y apenas llegó al sistema. Confirma con el cliente.\n`;
    }
  }
  const head = order.mealPrep && order.scheduledFor ? "🥗 Meal Prep programado" : "🔔 Nuevo pedido";
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: `${head}\n${late}${ntfyBody(order)}`.slice(0, 3500) }),
    });
    if (!resp.ok) console.error("telegram_failed", resp.status, await resp.text().catch(() => ""));
  } catch (e) {
    console.error("telegram_error", String(e));
  }
}

/** Generic alert (inventory etc.) to ntfy + Telegram. Never throws. */
async function notifyText(env, title, lines) {
  const text = (Array.isArray(lines) ? lines : [String(lines)]).join("\n").slice(0, 1200);
  if (!text) return;
  const topic = envVar(env, "NTFY_TOPIC");
  if (topic) {
    try {
      const r = await fetch(
        `https://ntfy.sh/${encodeURIComponent(topic)}?title=${encodeURIComponent(title)}&priority=4&tags=${encodeURIComponent("warning,package")}`,
        { method: "POST", headers: ntfyHeaders(env), body: text }
      );
      if (!r.ok) console.log("ntfy_failed", r.status);
    } catch (e) {
      console.log("ntfy_error", String(e && e.message));
    }
  }
  const token = envVar(env, "TELEGRAM_BOT_TOKEN");
  const chat = envVar(env, "TELEGRAM_CHAT_ID");
  if (token && chat) {
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text: `${title}\n${text}`.slice(0, 3500) }),
      });
    } catch (e) {
      console.error("telegram_error", String(e));
    }
  }
}

// ----------------------------------------------------------------- Worker

const PUBLIC_GET = new Set(["/api/stock", "/api/hours", "/api/menu", "/api/announcement"]);
const ADMIN_GET = new Set(["/api/orders", "/api/analytics", "/api/bar-inventory", "/api/kitchen-inventory"]);
const POST_ROUTES = new Set([
  "/api/stock",
  "/api/bar-inventory",
  "/api/kitchen-inventory",
  "/api/hours",
  "/api/menu/item",
  "/api/menu/image",
  "/api/announcement",
  "/api/orders",
  "/api/analytics",
  "/api/admin/login",
  "/api/admin/import",
  "/api/admin/telegram-test",
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
      if (status === 200 && body.order && !body.duplicate) {
        ctx.waitUntil(notifyKitchen(env, body.order));
        ctx.waitUntil(notifyTelegram(env, body.order));
      }
      if (body && body.inventoryAlerts) {
        if (body.inventoryAlerts.length) ctx.waitUntil(notifyText(env, "The Kitchen · Inventario", body.inventoryAlerts));
        delete body.inventoryAlerts;
      }
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
    if (path === "/api/admin/telegram-test") {
      let ntfy = "NTFY: falta la variable NTFY_TOPIC en el Worker.";
      const nt = envVar(env, "NTFY_TOPIC");
      if (nt) {
        try {
          const nr = await fetch(`https://ntfy.sh/${encodeURIComponent(nt)}?title=${encodeURIComponent("The Kitchen · prueba")}&priority=5`, {
            method: "POST",
            headers: ntfyHeaders(env),
            body: "✅ Prueba de ntfy",
          });
          ntfy = nr.ok
            ? "NTFY: enviado"
            : "NTFY: error " + nr.status + (nr.status === 429 ? " (límite de ntfy.sh; falta NTFY_TOKEN)" : "");
        } catch (e) {
          ntfy = "NTFY: no se pudo contactar";
        }
      }
      const token = envVar(env, "TELEGRAM_BOT_TOKEN");
      const chat = envVar(env, "TELEGRAM_CHAT_ID");
      if (!token || !chat) {
        return reply(request, env, 200, {
          ok: false,
          configured: false,
          hasToken: !!token,
          hasChatId: !!chat,
          ntfy,
          description: "Faltan TELEGRAM_BOT_TOKEN y/o TELEGRAM_CHAT_ID en el Worker (o falta volver a desplegar).",
        });
      }
      try {
        const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chat, text: "✅ Prueba de The Kitchen: Telegram está conectado." }),
        });
        const j = await r.json().catch(() => ({}));
        return reply(request, env, 200, { ok: !!j.ok, configured: true, status: r.status, ntfy, description: j.description || "" });
      } catch (e) {
        return reply(request, env, 200, { ok: false, configured: true, description: "No se pudo contactar a Telegram." });
      }
    }
    delete data.code;

    const [status, body] = await stub.op(path, "POST", data, ip);
    if (body && body.inventoryAlerts) {
      if (body.inventoryAlerts.length) ctx.waitUntil(notifyText(env, "The Kitchen · Inventario", body.inventoryAlerts));
      delete body.inventoryAlerts;
    }
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

  // ---- kitchen inventory (ingredients deducted from orders)
  invRead() {
    let inv = this.kvGet("kitchenInv", null);
    if (!inv || !inv.items) {
      inv = JSON.parse(JSON.stringify(INV_DEFAULT));
      this.kvSet("kitchenInv", inv);
    }
    inv.recipes = inv.recipes || {};
    if ((inv.v || 1) < INV_VERSION) {
      // v2-v4: separate 100 g chicken, club chicken, burger patty/bun/breaded chicken, pasta/salad chicken, bagels. Keeps quantities already edited.
      for (const [id, it] of Object.entries(INV_DEFAULT.items)) if (!inv.items[id]) inv.items[id] = { ...it };
      for (const k of ["m-pollo-100", "f-club", "f-burger", "f-alfredo", "f-pesto", "f-ensalada", "f-pechuga-pomodoro", "f-bagel-pizza", "f-bagel-h", "f-guac", "f-grilled", "side:sopaTomate"]) inv.recipes[k] = JSON.parse(JSON.stringify(INV_DEFAULT.recipes[k]));
      // v5: alert thresholds requested by Mario (burger buns at 4, bagels at 1)
      if ((inv.v || 1) < 5) {
        if (inv.items["pan-hamburguesa"]) inv.items["pan-hamburguesa"].min = 4;
        if (inv.items.bagel) inv.items.bagel.min = 1;
      }
      if ((inv.v || 1) < 9 && inv.items.guacamole && inv.items.guacamole.target == null) inv.items.guacamole.target = 2;
      // v12: queso rayado alert at 200 g (Mario)
      if ((inv.v || 1) < 12 && inv.items["queso-rayado"]) inv.items["queso-rayado"].min = 200;
      // v15: salami alert at 32 g (Mario)
      if ((inv.v || 1) < 15 && inv.items.salami) inv.items.salami.min = 32;
      inv.v = INV_VERSION;
      this.kvSet("kitchenInv", inv);
    }
    return inv;
  }
  /** Which ingredients does this order use? -> { ingredientId: amount } */
  invConsumption(items, inv) {
    const used = {};
    const add = (ing, q) => {
      used[ing] = Math.round(((used[ing] || 0) + q) * 100) / 100;
    };
    const rulesFor = (rules, opts) => {
      const list = Array.isArray(rules) ? rules : [];
      const match = (r) => r.if && Object.entries(r.if).every(([k, v]) => String((opts || {})[k] || "") === String(v));
      const always = list.filter((r) => !r.if);
      const hit = list.filter(match);
      // alternatives (e.g. chicken size) fall back to their default when no option was recorded
      const hasAlt = list.some((r) => r.if && !r.optional);
      const altHit = hit.filter((r) => !r.optional);
      const fallback = hasAlt && !altHit.length ? list.filter((r) => r.default) : [];
      return [...always, ...hit, ...fallback.filter((r) => !hit.includes(r))];
    };
    for (const it of items || []) {
      const mult = Math.max(1, parseInt(it.qty, 10) || 1);
      for (const r of rulesFor(inv.recipes[it.id], it.opts)) add(r.ing, r.qty * mult);
      for (const [k, n] of Object.entries((it.opts && it.opts.mpSides) || {})) {
        for (const r of inv.recipes["side:" + k] || []) add(r.ing, r.qty * n * mult);
      }
    }
    return used;
  }
  /** Deduct this order's ingredients (tracked ones only). Returns alert lines. */
  invApply(order) {
    const inv = this.invRead();
    const used = this.invConsumption(order.items, inv);
    const applied = {};
    const alerts = [];
    for (const [ing, q] of Object.entries(used)) {
      const it = inv.items[ing];
      if (!it || it.qty == null) continue;
      const before = it.qty;
      const after = Math.max(0, Math.round((before - q) * 100) / 100);
      it.qty = after;
      applied[ing] = Math.round((before - after) * 100) / 100;
      if (after <= 0 && before > 0) alerts.push(`🚫 AGOTADO: ${it.name}. Se bloquean en el menú los platillos que lo usan.`);
      else if (it.min != null && after <= it.min && before > it.min) alerts.push(`⚠️ Inventario bajo: ${it.name} · quedan ${after} ${it.unit || ""}${it.target ? ` · resurtir a ${it.target}` : ""}`.trim());
    }
    if (Object.keys(applied).length) {
      this.kvSet("kitchenInv", inv);
      order.inv = applied;
    }
    return alerts;
  }
  /** Give back what this order deducted (discarded / deleted / edited). */
  invRelease(order) {
    if (!order || !order.inv) return;
    const inv = this.invRead();
    for (const [ing, q] of Object.entries(order.inv)) {
      const it = inv.items[ing];
      if (it && it.qty != null) it.qty = Math.round((it.qty + q) * 100) / 100;
    }
    this.kvSet("kitchenInv", inv);
    delete order.inv;
  }
  /** Menu ids that can't be served because a tracked ingredient ran out. */
  invAutoOut() {
    const inv = this.kvGet("kitchenInv", null);
    if (!inv || !inv.items) return [];
    const out = new Set();
    const blocked = (r) => {
      const it = inv.items[r.ing];
      return !!(it && it.qty != null && it.qty < r.qty);
    };
    for (const [key, rules] of Object.entries(inv.recipes || {})) {
      const list = Array.isArray(rules) ? rules : [];
      const must = list.filter((r) => !r.if && !r.variant && !r.optional);
      const alts = list.filter((r) => r.if && !r.variant && !r.optional);
      const whole = must.some(blocked) || (alts.length > 0 && alts.every(blocked));
      if (whole) out.add(key.startsWith("side:") ? "mp-side-" + key.slice(5) : key);
      for (const r of list) if (r.outId && !r.optional && blocked(r)) out.add(r.outId);
    }
    return [...out];
  }
  invAdmin(data) {
    const act = String(data.action || "").toLowerCase();
    const inv = this.invRead();
    const num = (v) => {
      if (v === null || v === "" || v === undefined) return null;
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined;
    };
    const id = str(data.id, 60).trim();
    if (act === "set") {
      const it = inv.items[id];
      if (!it) return [404, { error: "not_found" }];
      if ("qty" in data) {
        const n = num(data.qty);
        if (n === undefined) return [400, { error: "bad_qty" }];
        it.qty = n;
      }
      if ("min" in data) {
        const n = num(data.min);
        if (n === undefined) return [400, { error: "bad_min" }];
        it.min = n;
      }
      if (data.name) it.name = str(data.name, 80);
      if (data.unit != null) it.unit = str(data.unit, 20);
    } else if (act === "add") {
      const it = inv.items[id];
      if (!it) return [404, { error: "not_found" }];
      const n = Number(data.delta);
      if (!Number.isFinite(n)) return [400, { error: "bad_delta" }];
      it.qty = Math.max(0, Math.round(((it.qty == null ? 0 : it.qty) + n) * 100) / 100);
    } else if (act === "create") {
      const name = str(data.name, 80).trim();
      if (!name) return [400, { error: "name_required" }];
      const nid = id || name.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
      if (!nid || inv.items[nid]) return [400, { error: "id_taken" }];
      const q = num(data.qty);
      inv.items[nid] = { name, unit: str(data.unit, 20) || "unidades", group: str(data.group, 30), qty: q === undefined ? null : q, min: num(data.min) ?? null };
    } else if (act === "delete") {
      delete inv.items[id];
      for (const k of Object.keys(inv.recipes)) inv.recipes[k] = (inv.recipes[k] || []).filter((r) => r.ing !== id);
    } else if (act === "recipe") {
      const key = str(data.itemId, 80).trim();
      if (!key) return [400, { error: "item_required" }];
      const rules = (Array.isArray(data.rules) ? data.rules : []).slice(0, 20).map((r) => ({ ing: str(r.ing, 60), qty: Number(r.qty), ...(r.if && typeof r.if === "object" ? { if: r.if } : {}), ...(r.default ? { default: true } : {}) })).filter((r) => inv.items[r.ing] && Number.isFinite(r.qty) && r.qty > 0);
      if (rules.length) inv.recipes[key] = rules;
      else delete inv.recipes[key];
    } else {
      return [400, { error: "bad_action" }];
    }
    this.kvSet("kitchenInv", inv);
    return [200, { ok: true, inventory: inv, autoOut: this.invAutoOut() }];
  }

  // ---- stock / hours / announcement / bar
  readStock() {
    const s = this.kvGet("stock", {});
    const ids = Array.isArray(s.outOfStock) ? s.outOfStock : [];
    const auto = this.invAutoOut();
    return { outOfStock: [...new Set([...ids.map(String), ...auto])].sort(), auto };
  }
  writeStock(ids) {
    // ingredient-driven "agotado" is derived, never saved into the manual list
    const auto = new Set(this.invAutoOut());
    const clean = [...new Set(ids.filter(Boolean).map(String))].filter((x) => !auto.has(x)).sort();
    this.kvSet("stock", { outOfStock: clean });
    return this.readStock();
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
  /** One-time: create the Meal Prep section (first) with the starting dishes. */
  seedMealPrep(menu) {
    if (this.kvGet("mealprepSeeded", false)) return;
    if (!menu.mealprep) {
      const rest = { ...menu };
      for (const k of Object.keys(menu)) delete menu[k];
      menu.mealprep = {
        id: "mealprep",
        title: "MEAL PREP",
        icon: "🥗",
        subcategories: { Plan: { label: "Meal Prep", items: [] } },
      };
      Object.assign(menu, rest);
    }
    const sub = menu.mealprep.subcategories.Plan || Object.values(menu.mealprep.subcategories)[0];
    if (sub && !(sub.items || []).length) {
      const mk = (id, name, en, ja, price) => ({
        id,
        name,
        price,
        notes: "",
        notesKey: "mpIncludesSides",
        flags: ["sides2"],
        img: "",
        name_en: en,
        name_ja: ja,
      });
      sub.items = [
        mk("m-pollo-100", "Pollo · 100 g", "Chicken · 100 g", "チキン · 100g", 119),
        mk("m-pollo-200", "Pollo · 200 g", "Chicken · 200 g", "チキン · 200g", 179),
        mk("m-atun", "Atún · 1 pieza (~160 g)", "Tuna · 1 piece (~160 g)", "ツナ · 1枚 (約160g)", 169),
        mk("m-carne-molida", "Carne molida · 180 g", "Ground beef · 180 g", "牛ひき肉 · 180g", 199),
        mk("m-sirloin", "Res · 1 pieza (230-250 g)", "Beef · 1 piece (230-250 g)", "牛肉 · 1枚 (230-250g)", 259),
        mk("m-salmon", "Salmón · 1 pieza (180-200 g)", "Salmon · 1 piece (180-200 g)", "サーモン · 1枚 (180-200g)", 259),
      ];
    }
    this.kvSet("menu", menu);
    this.kvSet("mealprepSeeded", true);
  }
  /** One-time: add "Cerveza sin alcohol" ($65) inside the bar's Cerveza subcategory. */
  seedBeerNA(menu) {
    if (this.kvGet("beerNASeeded", false)) {
      // one-time photo swap for the item seeded earlier (only if still the placeholder photo)
      const subs0 = (menu.bar && menu.bar.subcategories) || {};
      let changed = false;
      for (const sb of Object.values(subs0)) {
        for (const it of sb.items || []) {
          if (it.id === "b-cerveza-na" && it.img === "assets/products/b-cerveza.jpg") {
            it.img = "assets/products/b-cerveza-na.jpg";
            changed = true;
          }
        }
      }
      if (changed) this.kvSet("menu", menu);
      return;
    }
    const subs = (menu.bar && menu.bar.subcategories) || null;
    const sub = subs && (subs.Cerveza || Object.values(subs).find((x) => /cerveza/i.test(x.label || "")));
    if (sub) {
      sub.items = sub.items || [];
      if (!sub.items.some((i) => i.id === "b-cerveza-na")) {
        sub.items.push({
          id: "b-cerveza-na",
          name: "Cerveza sin alcohol",
          price: 65,
          notes: "",
          notesKey: "",
          flags: [],
          img: "assets/products/b-cerveza-na.jpg",
          name_en: "Non-alcoholic beer",
          name_ja: "ノンアルコールビール",
        });
      }
      this.kvSet("menu", menu);
    }
    this.kvSet("beerNASeeded", true);
  }
  /** One-time: add "Ensalada sin proteína" ($100) next to the chicken salad (same dressings, same photo). */
  seedSaladNoProtein(menu) {
    if (this.kvGet("saladNoProtein", false)) return;
    for (const cat of Object.values(menu || {})) {
      for (const sb of Object.values((cat && cat.subcategories) || {})) {
        const items = sb.items || [];
        const idx = items.findIndex((i) => i.id === "f-ensalada");
        if (idx < 0) continue;
        if (!items.some((i) => i.id === "f-ensalada-sin")) {
          items.splice(idx + 1, 0, {
            id: "f-ensalada-sin",
            name: "Ensalada sin proteína",
            price: 100,
            notes: "",
            notesKey: "dressingNote",
            flags: ["dressing"],
            img: items[idx].img || "assets/products/f-ensalada.jpg",
            name_en: "Salad, no protein",
            name_ja: "サラダ（プロテインなし）",
          });
          sb.items = items;
        }
        this.kvSet("menu", menu);
        this.kvSet("saladNoProtein", true);
        return;
      }
    }
  }
  /** One-time: add "Papas con queso amarillo suave" ($119) right before the truffle fries. */
  seedCheeseFries(menu) {
    if (this.kvGet("cheeseFries", false)) return;
    for (const cat of Object.values(menu || {})) {
      for (const sb of Object.values((cat && cat.subcategories) || {})) {
        const items = sb.items || [];
        const idx = items.findIndex((i) => i.id === "f-papas-t");
        if (idx < 0) continue;
        if (!items.some((i) => i.id === "f-papas-queso")) {
          items.splice(idx, 0, {
            id: "f-papas-queso",
            name: "Papas con queso amarillo suave",
            price: 119,
            notes: "",
            flags: [],
            img: "",
            name_en: "Fries with mild yellow cheese",
            name_ja: "マイルドなイエローチーズのポテト",
          });
          sb.items = items;
        }
        this.kvSet("menu", menu);
        this.kvSet("cheeseFries", true);
        return;
      }
    }
  }
  /** One-time: Meal Prep "Sirloin" is now called "Res" (keeps id, price, photo and stock). */
  seedRenameSirloin(menu) {
    if (this.kvGet("sirloinRenamed", false)) return;
    let changed = false;
    for (const sb of Object.values((menu.mealprep && menu.mealprep.subcategories) || {})) {
      for (const it of sb.items || []) {
        if (it.id === "m-sirloin" && /sirloin/i.test(it.name || "")) {
          it.name = "Res · 1 pieza (230-250 g)";
          it.name_en = "Beef · 1 piece (230-250 g)";
          it.name_ja = "牛肉 · 1枚 (230-250g)";
          changed = true;
        }
      }
    }
    if (changed) this.kvSet("menu", menu);
    this.kvSet("sirloinRenamed", true);
  }
  /** One-time: add the Meal Prep "Solo complementos" option (no protein, up to 3 sides, $120). */
  seedMealPrepSidesOnly(menu) {
    if (this.kvGet("mealprepSidesOnlySeeded", false)) return;
    const sub = menu.mealprep && (menu.mealprep.subcategories.Plan || Object.values(menu.mealprep.subcategories)[0]);
    if (sub) {
      sub.items = sub.items || [];
      if (!sub.items.some((i) => i.id === "m-solo-complementos")) {
        sub.items.push({
          id: "m-solo-complementos",
          name: "Solo complementos · sin proteína",
          price: 120,
          notes: "",
          notesKey: "mpIncludesSides3",
          flags: ["sides3"],
          img: "",
          name_en: "Sides only · no protein",
          name_ja: "サイドのみ · プロテインなし",
        });
      }
      this.kvSet("menu", menu);
      this.kvSet("mealprepSidesOnlySeeded", true);
    }
  }
  /** One-time: Meal Prep sides-only becomes "Solo complementos": choose 1 ($60) or 3 ($120); no price on the card. */
  seedSidesOnlyChoice(menu) {
    if (this.kvGet("sidesOnlyChoice", false)) return;
    for (const sb of Object.values((menu.mealprep && menu.mealprep.subcategories) || {})) {
      for (const it of sb.items || []) {
        if (it.id !== "m-solo-complementos") continue;
        it.name = "Solo complementos";
        it.name_en = "Sides only";
        it.name_ja = "サイドのみ";
        it.price = 120; // base = 3 sides; the client subtracts $60 for the 1-side option
        it.notes = "";
        it.notesKey = "mpSidesOnlyNote";
        it.flags = ["sides3", "sidesOnly"];
      }
    }
    this.kvSet("menu", menu);
    this.kvSet("sidesOnlyChoice", true);
  }
  /** One-time: merge Meal Prep "Pollo 100 g" + "Pollo 200 g" into one "Pollo" dish with a portion option. */
  seedMergeChicken(menu) {
    if (this.kvGet("chickenMerged", false)) return;
    let changed = false;
    for (const sb of Object.values((menu.mealprep && menu.mealprep.subcategories) || {})) {
      const items = sb.items || [];
      const p100 = items.find((i) => i.id === "m-pollo-100");
      if (!p100) continue;
      p100.name = "Pollo";
      p100.name_en = "Chicken";
      p100.name_ja = "チキン";
      p100.price = 179;
      p100.flags = Array.from(new Set([...(p100.flags || []), "chickenSize"]));
      sb.items = items.filter((i) => i.id !== "m-pollo-200");
      changed = true;
    }
    if (changed) this.kvSet("menu", menu);
    this.kvSet("chickenMerged", true);
  }
  /** One-time: the merged "Pollo" now defaults to 200 g ($179); 100 g is the -$60 option. */
  seedChickenDefault200(menu) {
    if (this.kvGet("chickenDefault200", false)) return;
    let changed = false;
    for (const sb of Object.values((menu.mealprep && menu.mealprep.subcategories) || {})) {
      for (const it of sb.items || []) {
        if (it.id === "m-pollo-100" && (it.flags || []).includes("chickenSize") && it.price === 119) {
          it.price = 179;
          changed = true;
        }
      }
    }
    if (changed) this.kvSet("menu", menu);
    this.kvSet("chickenDefault200", true);
  }
  /** One-time: the Ramen is discontinued — remove it from the menu. */
  seedRemoveRamen(menu) {
    if (this.kvGet("ramenRemoved", false)) return;
    let changed = false;
    for (const sec of Object.values(menu)) {
      for (const sb of Object.values((sec && sec.subcategories) || {})) {
        const before = (sb.items || []).length;
        sb.items = (sb.items || []).filter((it) => it.id !== "f-ramen-chicharron");
        if (sb.items.length !== before) changed = true;
      }
    }
    if (changed) this.kvSet("menu", menu);
    this.kvSet("ramenRemoved", true);
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
      if (!menu[section] && section === "mealprep") {
        // Meal Prep section is created on demand and always listed first
        const rest = { ...menu };
        for (const k of Object.keys(menu)) delete menu[k];
        menu.mealprep = {
          id: "mealprep",
          title: "MEAL PREP",
          icon: "🥗",
          subcategories: { Plan: { label: "Meal Prep", items: [] } },
        };
        Object.assign(menu, rest);
      }
      if (!menu[section]) return [400, { error: "bad_section" }];
      menu[section].subcategories = menu[section].subcategories || {};
      const subs = menu[section].subcategories;
      if (!subs[subKey]) return [400, { error: "bad_subcategory" }];
      const name = String(data.name || "").trim();
      if (!name) return [400, { error: "name_required" }];
      const price = Math.trunc(Number(data.price == null ? 0 : data.price));
      if (!Number.isFinite(price) || price < 0) return [400, { error: "bad_price" }];
      const prefix = { drinks: "d", bar: "b", food: "f", mealprep: "m" }[section] || "x";
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
      ...this.sanitizeOpts(raw.opts),
    };
  }
  /** Machine-readable choices used by the kitchen inventory (chicken size, Meal Prep sides). */
  sanitizeOpts(raw) {
    if (!raw || typeof raw !== "object") return {};
    const opts = {};
    const cs = str(raw.chickenSize, 10).trim();
    if (cs) opts.chickenSize = cs;
    const bg = str(raw.burger, 20).trim();
    if (bg) opts.burger = bg;
    if (str(raw.extraChicken, 4).trim() === "1") opts.extraChicken = "1";
    if (raw.mpSides && typeof raw.mpSides === "object") {
      const sides = {};
      for (const [k, v] of Object.entries(raw.mpSides).slice(0, 12)) {
        const n = parseInt(v, 10);
        if (Number.isFinite(n) && n > 0) sides[str(k, 30)] = Math.min(9, n);
      }
      if (Object.keys(sides).length) opts.mpSides = sides;
    }
    return Object.keys(opts).length ? { opts } : {};
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

    const mealPrep = data.mealPrep === true;
    let scheduledFor = "";
    if (mealPrep && data.scheduledFor) {
      const sf = String(data.scheduledFor);
      const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(sf);
      if (!m) return [400, { error: "bad_schedule" }];
      const ms = Date.parse(`${sf}:00Z`);
      const now = Date.now();
      // Local Mexico time vs UTC: allow ±1 day slack around a 0..30 day window
      if (!Number.isFinite(ms) || ms < now - 86400000 || ms > now + 30 * 86400000) {
        return [400, { error: "bad_schedule" }];
      }
      scheduledFor = sf;
    }

    // Idempotency: the browser may re-send the same order (retry / back online)
    const clientRef = str(data.clientRef, 40).trim();
    if (clientRef) {
      const dup = this.sql
        .exec("SELECT json FROM orders WHERE json LIKE ?", `%"clientRef":${JSON.stringify(clientRef)}%`)
        .toArray()[0];
      if (dup) return [200, { ok: true, order: JSON.parse(dup.json), duplicate: true }];
    }
    let clientCreatedAt = "";
    const cc = str(data.clientCreatedAt, 40);
    const ccMs = Date.parse(cc);
    if (cc && Number.isFinite(ccMs) && ccMs <= Date.now() + 60000 && ccMs > Date.now() - 7 * 86400000) {
      clientCreatedAt = new Date(ccMs).toISOString();
    }
    const order = {
      id: hex(12),
      ...(clientRef ? { clientRef } : {}),
      ...(clientCreatedAt ? { clientCreatedAt } : {}),
      createdAt: nowIso(),
      status: "open",
      orderType,
      apartment: orderType === "apartment" ? apartment : "",
      amenity: orderType === "amenity" ? amenity : "",
      amenityId: orderType === "amenity" ? amenityId : "",
      items,
      ...(mealPrep ? { mealPrep: true, scheduledFor } : {}),
      source: "whatsapp",
    };
    let inventoryAlerts = [];
    this.ctx.storage.transactionSync(() => {
      try {
        inventoryAlerts = this.invApply(order);
      } catch (e) {
        console.error("inventory_apply_failed", String(e));
      }
      this.sql.exec("INSERT INTO orders (id, json) VALUES (?, ?)", order.id, JSON.stringify(order));
      this.sql.exec(
        "DELETE FROM orders WHERE seq NOT IN (SELECT seq FROM orders ORDER BY seq DESC LIMIT ?)",
        MAX_ORDERS
      );
    });
    return [200, { ok: true, order, inventoryAlerts }];
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
      const gone = this.getOrder(id);
      if (gone && String(gone.status || "open") === "open") this.invRelease(gone);
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
      this.invRelease(o);
      o.items = items;
      o.updatedAt = now;
      o.editedAt = now;
      const inventoryAlerts = String(o.status || "open") === "dismissed" ? [] : this.invApply(o);
      this.saveOrder(o);
      return [200, { ok: true, order: o, inventoryAlerts }];
    }
    // status update
    const id = String(data.orderId || data.id || "").trim();
    const status = String(data.status || "").trim().toLowerCase();
    if (!["open", "completed", "dismissed"].includes(status)) return [400, { error: "bad_status" }];
    const o = this.getOrder(id);
    if (!o) return [404, { error: "not_found" }];
    const prev = String(o.status || "open");
    let inventoryAlerts = [];
    if (status === "dismissed" && prev !== "dismissed") this.invRelease(o);
    else if (prev === "dismissed" && status !== "dismissed" && !o.inv) inventoryAlerts = this.invApply(o);
    o.status = status;
    o.updatedAt = nowIso();
    this.saveOrder(o);
    return [200, { ok: true, order: o, inventoryAlerts }];
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
          this.seedMealPrep(menu);
          this.seedBeerNA(menu);
          this.seedRemoveRamen(menu);
          this.seedRenameSirloin(menu);
          this.seedSaladNoProtein(menu);
          this.seedCheeseFries(menu);
          this.seedMealPrepSidesOnly(menu);
          this.seedSidesOnlyChoice(menu);
          this.seedMergeChicken(menu);
          this.seedChickenDefault200(menu);
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
        case "/api/kitchen-inventory":
          return [200, { inventory: this.invRead(), autoOut: this.invAutoOut() }];
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
      case "/api/kitchen-inventory":
        return this.invAdmin(data);
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
