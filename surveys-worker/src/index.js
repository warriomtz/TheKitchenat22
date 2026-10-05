import { DurableObject } from "cloudflare:workers";
import { SURVEYS } from "./surveys.js";

// ── helpers ──────────────────────────────────────────────────────────────────
const json = (o, status = 200, h = {}) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...h } });

function corsHeaders(req, env) {
  const origin = req.headers.get("Origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const h = { Vary: "Origin", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Admin-Code, X-Export-Key" };
  if (allowed.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

const ctl = /[\u0000-\u001f\u007f]/g;
function sanitize(spec, body) {
  const out = {};
  let any = false;
  for (const f of spec.fields) {
    const v = body?.[f.key];
    if (f.type === "text") out[f.key] = String(v ?? "").replace(ctl, " ").trim().slice(0, f.max);
    else if (f.type === "choice") out[f.key] = f.options.includes(v) ? v : "";
    else if (f.type === "multi") out[f.key] = (Array.isArray(v) ? v : []).filter((x) => f.options.includes(x));
    const val = out[f.key];
    if (Array.isArray(val) ? val.length : val) any = true;
  }
  return { out, any };
}

async function sha(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].slice(0, 12).map((x) => x.toString(16).padStart(2, "0")).join("");
}

// Spreadsheet formula-injection guard + CSV quoting
const cell = (v) => {
  let s = Array.isArray(v) ? v.join("|") : String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
};

// Private routes accept the export key (EXPORT_KEY) or the admin dashboard code (ADMIN_CODE, same
// one typed at the admin login). Both are Worker secrets; neither is ever shipped to a page.
function authorized(req, url, env) {
  const k = url.searchParams.get("key") || req.headers.get("X-Export-Key") || "";
  if (env.EXPORT_KEY && k.length > 0 && k === env.EXPORT_KEY) return true;
  const a = req.headers.get("X-Admin-Code") || "";
  return !!env.ADMIN_CODE && a.length > 0 && a === env.ADMIN_CODE;
}

// ── Worker ───────────────────────────────────────────────────────────────────
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = corsHeaders(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    if (url.pathname === "/api/surveys" && req.method === "GET") {
      if (!authorized(req, url, env)) return new Response("forbidden", { status: 403, headers: cors });
      return json(Object.entries(SURVEYS).map(([id, v]) => ({ id, title: v.title })), 200, cors);
    }

    const m = url.pathname.match(/^\/api\/surveys\/([a-z0-9-]{1,40})(?:\/(export\.csv|summary|responses\.json|responses))?$/);
    if (!m) return new Response("not found", { status: 404, headers: cors });
    const [, id, action] = m;
    const spec = SURVEYS[id];
    if (!spec) return new Response("unknown survey", { status: 404, headers: cors });
    const store = env.SURVEYS.get(env.SURVEYS.idFromName("main"));

    // submit
    if (!action && req.method === "POST") {
      const origin = req.headers.get("Origin");
      if (origin && !cors["Access-Control-Allow-Origin"]) return new Response("forbidden", { status: 403, headers: cors });
      if (Number(req.headers.get("Content-Length") || 0) > 8192) return new Response("too large", { status: 413, headers: cors });
      let body;
      try { body = await req.json(); } catch { return new Response("bad json", { status: 400, headers: cors }); }
      const { out, any } = sanitize(spec, body);
      if (!any) return new Response("empty", { status: 400, headers: cors });
      const day = new Date().toISOString().slice(0, 10);
      const ip = req.headers.get("CF-Connecting-IP") || "unknown";
      const hash = await sha(`${ip}|${day}|${id}`); // not stored with the answer; rotates daily
      const rec = {
        lang: body?.lang === "en" ? "en" : "es",
        src: String(body?.src ?? "").replace(/[^\w-]/g, "").slice(0, 24),
        data: out,
      };
      const r = await store.submit(id, rec, hash, day, Number(env.DAILY_LIMIT) || 30);
      if (r === "limited") return new Response("too many", { status: 429, headers: cors });
      return new Response(null, { status: 204, headers: cors });
    }

    // private: wipe all responses of one survey (DELETE ...?key=...&confirm=yes)
    if (action === "responses" && req.method === "DELETE") {
      if (!authorized(req, url, env)) return new Response("forbidden", { status: 403 });
      if (url.searchParams.get("confirm") !== "yes") return new Response("add &confirm=yes", { status: 400 });
      return json({ survey: id, deleted: await store.wipe(id) });
    }

    // private: export + summary + json (for the admin dashboard)
    if ((action === "export.csv" || action === "summary" || action === "responses.json") && req.method === "GET") {
      if (!authorized(req, url, env)) return new Response("forbidden", { status: 403, headers: cors });
      const rows = await store.list(id);
      if (action === "export.csv") {
        const head = ["fecha", "idioma", "origen", ...spec.fields.map((f) => f.label)];
        const lines = [head.map(cell).join(",")];
        for (const r of rows) {
          const d = JSON.parse(r.data);
          lines.push([r.ts, r.lang, r.src, ...spec.fields.map((f) => d[f.key])].map(cell).join(","));
        }
        return new Response("﻿" + lines.join("\n"), {
          headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${id}.csv"`, ...cors },
        });
      }
      const count = (arr) => arr.reduce((a, k) => ((a[k || "(vacío)"] = (a[k || "(vacío)"] || 0) + 1), a), {});
      const summary = { survey: id, title: spec.title, total: rows.length, by_lang: count(rows.map((r) => r.lang)), by_src: count(rows.map((r) => r.src)), choices: {}, answered: {} };
      for (const f of spec.fields) {
        const vals = rows.map((r) => JSON.parse(r.data)[f.key]);
        summary.answered[f.label] = vals.filter((v) => (Array.isArray(v) ? v.length : v)).length;
        if (f.type === "choice") summary.choices[f.label] = count(vals.filter(Boolean));
        if (f.type === "multi") summary.choices[f.label] = count(vals.flat());
      }
      if (action === "responses.json") {
        const fields = spec.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, q: f.q || f.label, names: f.names || null }));
        const out = rows.map((r) => ({ ts: r.ts, lang: r.lang, src: r.src, data: JSON.parse(r.data) })).reverse(); // newest first
        return json({ ...summary, fields, rows: out }, 200, cors);
      }
      return json(summary, 200, cors);
    }
    return new Response("method not allowed", { status: 405, headers: cors });
  },
};

// ── Storage: one SQLite-backed Durable Object for all surveys ────────────────
export class SurveyStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS responses(id INTEGER PRIMARY KEY AUTOINCREMENT, survey TEXT NOT NULL, ts TEXT NOT NULL, lang TEXT, src TEXT, data TEXT NOT NULL)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS responses_survey ON responses(survey, id)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS hits(h TEXT PRIMARY KEY, day TEXT NOT NULL, n INTEGER NOT NULL)");
  }
  submit(survey, rec, hash, day, limit) {
    this.sql.exec("DELETE FROM hits WHERE day < ?", day);
    const row = this.sql.exec("SELECT n FROM hits WHERE h = ?", hash).toArray()[0];
    if (row && row.n >= limit) return "limited";
    this.sql.exec("INSERT INTO hits(h, day, n) VALUES(?, ?, 1) ON CONFLICT(h) DO UPDATE SET n = n + 1", hash, day);
    this.sql.exec("INSERT INTO responses(survey, ts, lang, src, data) VALUES(?, ?, ?, ?, ?)", survey, new Date().toISOString(), rec.lang, rec.src, JSON.stringify(rec.data));
    return "ok";
  }
  wipe(survey) {
    const n = this.sql.exec("SELECT COUNT(*) AS n FROM responses WHERE survey = ?", survey).one().n;
    this.sql.exec("DELETE FROM responses WHERE survey = ?", survey);
    this.sql.exec("DELETE FROM hits");
    return n;
  }
  list(survey) {
    return this.sql.exec("SELECT ts, lang, src, data FROM responses WHERE survey = ? ORDER BY id", survey).toArray();
  }
}
