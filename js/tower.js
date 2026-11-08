/**
 * Torre — who orders from The Kitchen at 22 (and who visits the salon), by apartment.
 * Orders come from the orders the admin already loads (orderType "apartment").
 * Resident names and salon visits are typed in by hand (dine-in orders carry no apartment) and live on the
 * server (/api/tower). Apartment "3108" = floor 31, unit 08. Layout mirrors the real tower (floors 22–33, no unit 13).
 */
(function () {
  "use strict";

  /* —— Tower layout (same as the floor plan). null = empty slot so 18/19 sit in the corner under 21/20 —— */
  const STD_TOP = [9, 8, 7, 6, 5, 4, 3, 2, 1, 22, 21, 20];
  const STD_BOT = [10, 11, 12, 14, 15, 16, 17, null, null, null, 18, 19];
  const FLOORS = [{ floor: 22, top: [9, 8, 7, 6], bot: [10, 11, 12, 14, 15] }];
  for (let f = 23; f <= 32; f++) FLOORS.push({ floor: f, top: STD_TOP, bot: STD_BOT });
  FLOORS.push({ floor: 33, top: [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1], bot: [] });

  const pad2 = (n) => String(n).padStart(2, "0");
  const keyOf = (floor, unit) => `${floor}${pad2(unit)}`;
  const unitsOf = (fl) => [...fl.top, ...fl.bot].filter((u) => u != null);
  const ALL_KEYS = [];
  FLOORS.forEach((fl) => unitsOf(fl).forEach((u) => ALL_KEYS.push(keyOf(fl.floor, u))));
  const KEY_SET = new Set(ALL_KEYS);
  const FLOOR_SIZE = {};
  FLOORS.forEach((fl) => (FLOOR_SIZE[fl.floor] = unitsOf(fl).length));

  const DAY = 86400000;
  const COOL_DAYS = 30;

  const ui = {
    period: "all",
    metric: "both", // both = pedidos + visitas al salón (default) | orders | salon | pieces
    dismissed: false,
    sel: "",
    types: false, // optional building view by apartment type (not about the restaurant): off by default
    typeSel: "all", // all | E | 1 | 2 | 3
    q: "",
    sig: "",
    code: "",
    tower: { apts: {}, vacant: {} },
    towerOk: null, // null = not loaded yet, true = server answered, false = could not reach /api/tower
    busy: false,
    msg: "",
  };
  let lastOrders = [];
  let bound = false;

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  const norm = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .trim();

  /**
   * The order form is free text, so people type their apartment in many ways. Understood here:
   *  - "3108", "31-08", "31 08", "Depto 3108, Torre B"  -> 3108
   *  - floor 33 is written with SK (sky): "SK05", "sk-5", "SK 05", "Sky 5", "Depto SK05", "05 SK" -> 3305
   * Anything else returns null and shows up under "Sin ubicar" so you can see how it was typed.
   */
  function parseApt(raw) {
    const text = String(raw || "").trim();
    if (!text) return null;
    const sk = text.match(/\bsk[a-z]*[\s\-_.#:]*0*(\d{1,4})\b/i) || text.match(/\b0*(\d{1,2})[\s\-_.#]*sk[a-z]*\b/i);
    if (sk) {
      const d = sk[1];
      const key = d.length === 4 ? d : "33" + pad2(Number(d));
      return KEY_SET.has(key) ? key : null;
    }
    const four = (text.match(/(?<!\d)\d{4}(?!\d)/g) || []).find((k) => KEY_SET.has(k));
    if (four) return four;
    const digits = text.replace(/\D/g, "");
    return digits.length === 4 && KEY_SET.has(digits) ? digits : null;
  }

  function fmtDay(ts) {
    return new Date(ts).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
  }

  function ago(ts, now) {
    const d = Math.floor((now - ts) / DAY);
    if (d <= 0) return "hoy";
    if (d === 1) return "ayer";
    return `hace ${d} d`;
  }

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function qtyOf(o) {
    return (o.items || []).reduce((n, it) => n + (Number(it.qty) || 1), 0);
  }

  /* —— Compute —— */
  function compute(orders) {
    const now = Date.now();
    const since = ui.period === "all" ? 0 : now - (ui.period === "7" ? 7 : 30) * DAY;
    const by = new Map(); // key -> record
    const unmapped = new Map(); // raw text -> count
    const rec = (key) => {
      let r = by.get(key);
      if (!r) {
        r = { key, name: "", all: 0, allPieces: 0, n: 0, pieces: 0, dnAll: 0, first: null, last: null, orders: [], vall: 0, vn: 0, vfirst: null, vlast: null };
        by.set(key, r);
      }
      return r;
    };

    (orders || []).forEach((o) => {
      if (!o) return;
      const dine = o.orderType === "dinein";
      // delivery to an apartment, or dine in with the (optional) apartment filled in
      if (o.orderType !== "apartment" && !(dine && String(o.apartment || "").trim())) return;
      if (!ui.dismissed && o.status === "dismissed") return;
      const ts = Date.parse(o.createdAt);
      if (!Number.isFinite(ts)) return;
      const key = parseApt(o.apartment);
      if (!key) {
        const raw = String(o.apartment || "").trim() || "(vacío)";
        unmapped.set(raw, (unmapped.get(raw) || 0) + 1);
        return;
      }
      const r = rec(key);
      const pcs = qtyOf(o);
      r.all += 1;
      if (dine) r.dnAll += 1;
      r.allPieces += pcs;
      r.first = r.first == null ? ts : Math.min(r.first, ts);
      r.last = r.last == null ? ts : Math.max(r.last, ts);
      r.orders.push({ o, ts });
      if (ts >= since) {
        r.n += 1;
        r.pieces += pcs;
      }
    });

    // Hand-entered data: resident names and salon visits
    const apts = (ui.tower && ui.tower.apts) || {};
    Object.keys(apts).forEach((raw) => {
      const key = parseApt(raw);
      if (!key) return;
      const t = apts[raw] || {};
      const r = rec(key);
      r.name = String(t.name || "").trim();
      (Array.isArray(t.visits) ? t.visits : []).forEach((iso) => {
        const ts = Date.parse(iso);
        if (!Number.isFinite(ts)) return;
        r.vall += 1;
        r.vfirst = r.vfirst == null ? ts : Math.min(r.vfirst, ts);
        r.vlast = r.vlast == null ? ts : Math.max(r.vlast, ts);
        if (ts >= since) r.vn += 1;
      });
    });

    by.forEach((r) => {
      r.lastAny = Math.max(r.last || 0, r.vlast || 0) || null;
      r.firstAny = [r.first, r.vfirst].filter((x) => x != null).sort((a, b) => a - b)[0] ?? null;
    });
    return { now, by, unmapped };
  }

  const val = (r) => (!r ? 0 : ui.metric === "pieces" ? r.pieces : ui.metric === "both" ? r.n + r.vn : ui.metric === "salon" ? r.vn : r.n);
  const metricShort = () => (ui.metric === "pieces" ? "pzs." : ui.metric === "both" ? "act." : ui.metric === "salon" ? "vis." : "ped.");
  const metricName = () => (ui.metric === "pieces" ? "Piezas" : ui.metric === "both" ? "Pedidos + salón" : ui.metric === "salon" ? "Visitas al salón" : "Pedidos");
  const nameTag = (r) => (r && r.name ? ` <small class="tw-name">${esc(r.name)}</small>` : "");

  /* —— Render pieces —— */
  function controlsHtml() {
    const per = (id, label) =>
      `<button type="button" class="btn btn--ghost btn--sm${ui.period === id ? " is-period-on" : ""}" data-tw-period="${id}">${label}</button>`;
    const met = (id, label) =>
      `<button type="button" class="btn btn--ghost btn--sm${ui.metric === id ? " is-period-on" : ""}" data-tw-metric="${id}">${label}</button>`;
    return `<div class="tw-controls">
      <div class="report-period" role="group" aria-label="Periodo">${per("all", "Todo")}${per("30", "30 días")}${per("7", "7 días")}</div>
      <div class="report-period" role="group" aria-label="Medir por">${met("both", "Pedidos + salón")}${met("orders", "Solo pedidos")}${met("salon", "Solo salón")}${met("pieces", "Piezas")}</div>
      <label class="adm-check"><input type="checkbox" data-tw-dismissed ${ui.dismissed ? "checked" : ""} /><span>Incluir descartados</span></label>
      <input type="search" class="adm-search tw-search" data-tw-q placeholder="Buscar depto o nombre" value="${esc(ui.q)}" autocomplete="off" />
      <span class="adm-muted" data-tw-qcount></span>
    </div>`;
  }

  function summaryHtml(stats) {
    const top = stats.ranked[0];
    return `<div class="tw-stats">
      <span class="kitchen-stat">Han pedido <strong>${stats.ordered}</strong> de ${ALL_KEYS.length} (${Math.round((stats.ordered / ALL_KEYS.length) * 100)}%)</span>
      <span class="kitchen-stat">Visitan el salón <strong>${stats.salon}</strong></span>
      ${vacantCount(ALL_KEYS) ? `<span class="kitchen-stat tw-vacant-stat">Vacíos <strong>${vacantCount(ALL_KEYS)}</strong></span>` : ""}
      ${ui.period === "all" ? "" : `<span class="kitchen-stat">En el periodo <strong>${stats.activeKeys.length}</strong> (${Math.round((stats.activeKeys.length / ALL_KEYS.length) * 100)}%)</span>`}
      <span class="kitchen-stat">Ni pedido ni salón <strong>${ALL_KEYS.length - stats.everKeys.length}</strong></span>
      <span class="kitchen-stat">Recurrentes (2+) <strong>${stats.repeat}</strong></span>
      <span class="kitchen-stat">Pedidos a depto <strong>${stats.totalOrders}</strong></span>
      <span class="kitchen-stat">Visitas al salón <strong>${stats.totalVisits}</strong></span>
      ${top ? `<span class="kitchen-stat">Top <strong>${esc(top.key)}</strong> (${val(top)})</span>` : ""}
    </div>`;
  }

  /** Riga = odd floors (23, 25 … 33), Vitant = even floors (22, 24 … 32). Respects the period / dismissed filters. */
  function compareHtml(c) {
    const T = {
      riga: { name: "Riga", sub: "pisos nones", units: 0, n: 0, vn: 0, pieces: 0, act: 0, v: 0 },
      vitant: { name: "Vitant", sub: "pisos pares", units: 0, n: 0, vn: 0, pieces: 0, act: 0, v: 0 },
    };
    ALL_KEYS.forEach((k) => {
      const t = Number(k.slice(0, 2)) % 2 ? T.riga : T.vitant;
      const r = c.by.get(k);
      t.units += 1;
      if (!r) return;
      t.n += r.n;
      t.vn += r.vn;
      t.pieces += r.pieces;
      t.v += val(r);
      if (r.n > 0 || r.vn > 0) t.act += 1;
    });
    const a = T.riga;
    const b = T.vitant;
    const per = (t) => (t.units ? t.v / t.units : 0);
    const f2 = (x) => (Math.round(x * 100) / 100).toLocaleString("es-MX");
    const pct = (t) => Math.round((t.act / t.units) * 100);
    const lead = (x, y) => (x === y ? "Empate" : x > y ? a.name : b.name);
    const maxV = Math.max(1, a.v, b.v);
    const bar = (t) =>
      `<span class="tw-bar" style="width:${Math.round((t.v / maxV) * 140)}px"></span> ${t.v}`;
    const unmappedN = [...c.unmapped.values()].reduce((n, x) => n + x, 0);
    const verdict =
      a.v + b.v === 0
        ? "Todavía no hay actividad en este periodo."
        : `Por total (${esc(metricName().toLowerCase())}): <strong>${lead(a.v, b.v)}</strong> (${a.v} vs ${b.v}). Por depto, para compensar que una torre tiene más deptos: <strong>${lead(per(a), per(b))}</strong> (${f2(per(a))} vs ${f2(per(b))}).`;
    return `<div class="adm-card tw-compare">
      <h3 class="report-apt-title">Riga vs Vitant</h3>
      <table class="tw-compare__t">
        <tr><th></th><th>Riga <small class="adm-muted">(nones)</small></th><th>Vitant <small class="adm-muted">(pares)</small></th></tr>
        <tr><td>${esc(metricName())}</td><td>${bar(a)}</td><td>${bar(b)}</td></tr>
        <tr><td>Deptos</td><td>${a.units}</td><td>${b.units}</td></tr>
        <tr><td>Deptos activos</td><td>${a.act} (${pct(a)}%)</td><td>${b.act} (${pct(b)}%)</td></tr>
        <tr><td>Pedidos</td><td>${a.n}</td><td>${b.n}</td></tr>
        <tr><td>Visitas al salón</td><td>${a.vn}</td><td>${b.vn}</td></tr>
        <tr><td>Piezas</td><td>${a.pieces}</td><td>${b.pieces}</td></tr>
        <tr><td>${esc(metricName())} por depto</td><td>${f2(per(a))}</td><td>${f2(per(b))}</td></tr>
      </table>
      <p class="tw-compare__v">${verdict}</p>
      ${unmappedN ? `<p class="adm-muted">${unmappedN} pedido(s) sin ubicar no cuentan en ninguna torre.</p>` : ""}
    </div>`;
  }

  /* Apartment types (Mario 2026-11-07), floors 23-32 only (22 and 33 excluded), Riga or Vitant.
     Unit numbers: studio 02,03,05,14,17 · 1BR 07,08,12,15,20 · 3BR 19 · 2BR = all the rest. Only for his own view of the building; unrelated to orders. */
  const TYPES = [
    { id: "E", label: "Estudio", color: "#4da3ff" },
    { id: "1", label: "1 recámara", color: "#5ccf7a" },
    { id: "2", label: "2 recámaras", color: "#f0b429" },
    { id: "3", label: "3 recámaras", color: "#c08bff" },
  ];
  const TYPE_UNITS = { E: [2, 3, 5, 14, 17], 1: [7, 8, 12, 15, 20], 3: [19] };
  const typeOf = (key) => {
    const f = Number(key.slice(0, 2));
    if (f < 23 || f > 32) return null;
    const u = Number(key.slice(2));
    for (const id of ["E", "1", "3"]) if (TYPE_UNITS[id].includes(u)) return id;
    return "2";
  };
  const TYPE_KEYS = {};
  TYPES.forEach((t) => (TYPE_KEYS[t.id] = ALL_KEYS.filter((k) => typeOf(k) === t.id)));
  const typeStats = (keys) => {
    const o = {};
    TYPES.forEach((t) => {
      const ks = keys.filter((k) => typeOf(k) === t.id);
      o[t.id] = { n: ks.length, vac: ks.filter(isVacant).length };
    });
    return o;
  };
  const typeShort = (id) => ({ E: "est.", 1: "1 rec.", 2: "2 rec.", 3: "3 rec." })[id];

  const isVacant = (key) => !!(ui.tower && ui.tower.vacant && ui.tower.vacant[key]);
  const vacantCount = (keys) => keys.filter(isVacant).length;

  function cellHtml(floor, unit, c, max) {
    if (unit == null) return `<span class="tw-gap" aria-hidden="true"></span>`;
    const key = keyOf(floor, unit);
    const r = c.by.get(key);
    const v = val(r);
    const level = v <= 0 ? 0 : max <= 1 ? 3 : 1 + Math.min(4, Math.floor(4 * Math.sqrt((v - 1) / (max - 1))));
    const parts = [key + (r && r.name ? " · " + r.name : "")];
    if (isVacant(key)) parts.push("VACÍO");
    if (ui.types && typeOf(key)) parts.push(TYPES.find((t) => t.id === typeOf(key)).label);
    if (r && (r.all || r.vall)) {
      parts.push(`${r.n} pedidos`);
      parts.push(`${r.vn} visitas al salón`);
      parts.push(`último ${fmtDay(r.lastAny)}`);
    } else parts.push("sin pedidos ni visitas");
    return `<button type="button" class="tw-cell tw-l${level}${r && r.name ? " has-name" : ""}${isVacant(key) ? " is-vacant" : ""}${ui.types && typeOf(key) ? " is-t-" + typeOf(key) : ""}${ui.types && ui.typeSel !== "all" && typeOf(key) !== ui.typeSel ? " is-nonstudio" : ""}${ui.sel === key ? " is-sel" : ""}" data-tw-apt="${key}" title="${esc(parts.join(" · "))}">
      <span class="tw-u">${pad2(unit)}</span><span class="tw-n">${v > 0 ? v : ""}</span></button>`;
  }

  function mapHtml(c, max) {
    const rows = FLOORS.map((fl) => {
      const keys = unitsOf(fl).map((u) => keyOf(fl.floor, u));
      const act = keys.filter((k) => val(c.by.get(k)) > 0).length;
      const sum = keys.reduce((n, k) => n + val(c.by.get(k)), 0);
      const row = (units) =>
        units.length ? `<div class="tw-row">${units.map((u) => cellHtml(fl.floor, u, c, max)).join("")}</div>` : "";
      return `<div class="tw-floor">
        <div class="tw-floor__label"><strong>Piso ${fl.floor}</strong><small>${act}/${keys.length} · ${sum} ${metricShort()}${vacantCount(keys) ? ` · ${vacantCount(keys)} vacíos` : ""}${ui.types ? (() => { const ts = typeStats(keys); return TYPES.filter((t) => ts[t.id].n && (ui.typeSel === "all" || ui.typeSel === t.id)).map((t) => ` · ${typeShort(t.id)} ${ts[t.id].n}${ts[t.id].vac ? " (" + ts[t.id].vac + " vac.)" : ""}`).join(""); })() : ""}</small></div>
        <div class="tw-floor__rows">${row(fl.top)}${row(fl.bot)}</div>
      </div>`;
    }).join("");
    const scale = [1, 2, 3, 4, 5].map((l) => `<i class="tw-cell tw-l${l} tw-legend__sw"></i>`).join("");
    return `<div class="adm-card tw-mapcard">
      <div class="tw-mapopts">
        <label class="adm-check"><input type="checkbox" data-tw-types ${ui.types ? "checked" : ""} /><span>Ver tipos de depto</span></label>
        ${ui.types ? `<select class="adm-select" data-tw-typesel aria-label="Tipo de depto"><option value="all"${ui.typeSel === "all" ? " selected" : ""}>Todos los tipos</option>${TYPES.map((t) => `<option value="${t.id}"${ui.typeSel === t.id ? " selected" : ""}>${t.label}</option>`).join("")}</select>` : ""}
      </div>
      <div class="tw-legend"><span class="tw-cell tw-l0 tw-legend__sw"></span> sin actividad <span class="tw-legend__gap"></span> menos ${scale} más (máx ${max || 0}) <span class="tw-legend__gap"></span> <span class="tw-dotkey"></span> tiene nombre <span class="tw-legend__gap"></span> <span class="tw-cell tw-legend__sw is-vacant"></span> vacío${ui.types ? TYPES.map((t) => ` <span class="tw-legend__gap"></span> <span class="tw-cell tw-legend__sw is-t-${t.id}"></span> ${t.label.toLowerCase()}`).join("") : ""}</div>
      <div class="tw-map">${rows}</div>
      ${ui.types ? typeTableHtml(c) : ""}
    </div>`;
  }

  function typeTableHtml(c) {
    const rows = TYPES.map((t) => {
      const ks = TYPE_KEYS[t.id];
      const recs = ks.map((k) => c.by.get(k)).filter(Boolean);
      const vac = ks.filter(isVacant).length;
      const occ = ks.length - vac;
      const ped = recs.reduce((n, r) => n + r.n, 0);
      const vis = recs.reduce((n, r) => n + r.vn, 0);
      const act = ks.filter((k) => val(c.by.get(k)) > 0).length;
      const avg = occ ? (ped / occ).toFixed(1) : "–";
      const top = recs
        .filter((r) => val(r) > 0)
        .sort((x, y) => val(y) - val(x) || (y.lastAny || 0) - (x.lastAny || 0))
        .slice(0, 3)
        .map((r) => `<strong>${r.key}</strong>${r.name ? " " + esc(r.name) : ""} (${val(r)})`)
        .join(", ") || "–";
      return `<tr><td><i class="tw-cell tw-legend__sw is-t-${t.id}"></i> ${t.label}</td><td>${ks.length}</td><td>${vac}</td><td>${ped}</td><td>${vis}</td><td>${act}/${occ}</td><td>${avg}</td><td class="tw-typetop">${top}</td></tr>`;
    }).join("");
    return `<div class="tw-typetable"><table class="adm-table"><thead><tr><th>Tipo</th><th>Deptos</th><th>Vacíos</th><th>Pedidos</th><th>Salón</th><th>Activos</th><th>Pedidos/depto ocupado</th><th>Quién más pide (top 3)</th></tr></thead><tbody>${rows}</tbody></table><small class="adm-muted">Pisos 23–32 · el periodo y descartados siguen los filtros de arriba · vacíos no cuentan en el promedio · entre paréntesis, la métrica activa (${metricShort()})</small></div>`;
  }

  function topHtml(stats, c) {
    const rows = stats.ranked.slice(0, 10);
    return `<div class="report-card">
      <h3>Quién más ${ui.metric === "both" ? "viene y pide" : ui.metric === "salon" ? "viene al salón" : "pide"}</h3>
      <table><tr><th>Depto</th><th>Pedidos</th><th>Salón</th><th>Último</th></tr>
      ${
        rows.length
          ? rows
              .map(
                (r) =>
                  `<tr><td><button type="button" class="linkish" data-tw-apt="${r.key}">${r.key}</button>${nameTag(r)}</td><td>${r.n}</td><td>${r.vn}</td><td>${ago(r.lastAny, c.now)}</td></tr>`
              )
              .join("")
          : `<tr><td colspan="4">Sin actividad en el periodo</td></tr>`
      }
      </table></div>`;
  }

  function coolHtml(stats, c) {
    const rows = stats.cooled.slice(0, 12);
    return `<div class="report-card">
      <h3>Se enfriaron (${COOL_DAYS}+ días sin venir ni pedir)</h3>
      <table><tr><th>Depto</th><th>Veces</th><th>Último</th></tr>
      ${
        rows.length
          ? rows
              .map(
                (r) =>
                  `<tr><td><button type="button" class="linkish" data-tw-apt="${r.key}">${r.key}</button>${nameTag(r)}</td><td>${r.all + r.vall}</td><td>${ago(r.lastAny, c.now)}</td></tr>`
              )
              .join("")
          : `<tr><td colspan="3">Nadie por ahora</td></tr>`
      }
      </table>
      <p class="adm-muted">Ya nos habían pedido o visitado, pero llevan tiempo sin hacerlo. Son los primeros a quienes vale la pena escribirles.</p></div>`;
  }

  function floorsHtml(c) {
    const data = FLOORS.map((fl) => {
      const keys = unitsOf(fl).map((u) => keyOf(fl.floor, u));
      return {
        floor: fl.floor,
        size: keys.length,
        act: keys.filter((k) => val(c.by.get(k)) > 0).length,
        n: keys.reduce((s, k) => s + val(c.by.get(k)), 0),
      };
    });
    const max = Math.max(1, ...data.map((d) => d.n));
    return `<div class="report-card">
      <h3>Por piso</h3>
      <table><tr><th>Piso</th><th>Deptos activos</th><th>${esc(metricName())}</th></tr>
      ${data
        .slice()
        .sort((a, b) => b.n - a.n)
        .map(
          (d) =>
            `<tr><td>${d.floor}</td><td>${d.act}/${d.size}</td><td><span class="tw-bar" style="width:${Math.round(
              (d.n / max) * 60
            )}px"></span> ${d.n}</td></tr>`
        )
        .join("")}
      </table></div>`;
  }

  function neverHtml(stats) {
    const never = ALL_KEYS.filter((k) => !stats.everSet.has(k));
    const byFloor = {};
    never.forEach((k) => (byFloor[k.slice(0, 2)] = (byFloor[k.slice(0, 2)] || []).concat(k.slice(2))));
    const lines = Object.keys(byFloor)
      .map(
        (f) =>
          `<p class="tw-never__line"><strong>Piso ${f}</strong> <span class="adm-muted">(${byFloor[f].length}/${FLOOR_SIZE[f]})</span> ${byFloor[f].join(" · ")}</p>`
      )
      .join("");
    return `<details class="report-card report-card--wide tw-never">
      <summary><strong>Nunca han pedido ni venido al salón · ${never.length} deptos</strong> <span class="adm-muted">(histórico, según los pedidos que existen hoy y las visitas registradas)</span></summary>
      ${lines || '<p class="adm-muted">Todos han pedido o venido al menos una vez.</p>'}
    </details>`;
  }

  function unmappedHtml(c) {
    if (!c.unmapped.size) return "";
    const rows = [...c.unmapped.entries()].sort((a, b) => b[1] - a[1]);
    return `<div class="report-card">
      <h3>Sin ubicar en la torre</h3>
      <table><tr><th>Lo que escribieron</th><th>Pedidos</th></tr>
      ${rows.map(([t, n]) => `<tr><td>${esc(t)}</td><td>${n}</td></tr>`).join("")}</table>
      <p class="adm-muted">No coinciden con un depto de la torre (se espera 4 dígitos, ej. 3108, o SK05 para el piso 33). No cuentan en el mapa.</p></div>`;
  }

  function detailHtml(c) {
    if (!ui.sel) return "";
    const r = c.by.get(ui.sel);
    const dis = ui.busy || ui.towerOk === false ? " disabled" : "";
    const head = `<div class="tw-detail__head"><h3>Depto ${esc(ui.sel)}${nameTag(r)}</h3><button type="button" class="btn btn--ghost btn--sm" data-tw-close>Cerrar</button></div>`;
    const warn =
      ui.towerOk === false
        ? `<p class="kinv-warn">No se pudo conectar con el servidor para guardar nombres y visitas. Falta publicar la actualización del worker (ver worker/README.md).</p>`
        : "";
    const manual = `${warn}
      <div class="tw-manual">
        <label class="adm-field tw-manual__name"><span>Nombre del residente</span>
          <span class="tw-inline"><input type="text" data-tw-name maxlength="60" value="${esc(r ? r.name : "")}" placeholder="Ej. María López"${dis} />
          <button type="button" class="btn btn--primary btn--sm" data-tw-savename${dis}>Guardar</button></span></label>
        <div class="adm-field tw-manual__visits"><span>Visitas al salón <small class="adm-muted">(a mano; los pedidos de "Comer aquí" con depto ya cuentan solos como pedidos)</small></span>
          <span class="tw-inline"><input type="number" data-tw-vcount min="1" max="20" step="1" value="1" title="Cuántas visitas"${dis} />
          <input type="date" data-tw-vdate value="${todayStr()}" max="${todayStr()}" title="Fecha de la visita"${dis} />
          <button type="button" class="btn btn--primary btn--sm" data-tw-addvisit${dis}>+ Agregar</button>
          <button type="button" class="btn btn--ghost btn--sm" data-tw-rmvisit${dis}${r && r.vall ? "" : " disabled"}>− Quitar la última</button></span></div>
        <div class="adm-field"><span>Ocupación</span>
          <span class="tw-inline"><button type="button" class="btn btn--ghost btn--sm" data-tw-vacant="${isVacant(ui.sel) ? "0" : "1"}"${dis}>${isVacant(ui.sel) ? "Quitar marca de vacío" : "Marcar como vacío"}</button>
          ${isVacant(ui.sel) ? '<small class="adm-muted">Este depto está marcado como vacío (rojo en el mapa).</small>' : ""}</span></div>
        ${ui.msg ? `<p class="adm-muted tw-msg">${esc(ui.msg)}</p>` : ""}
      </div>`;
    if (!r || (!r.all && !r.vall)) {
      return `<div class="adm-card tw-detail">${head}${manual}<p class="adm-muted">Este depto no tiene pedidos ni visitas al salón registradas.</p></div>`;
    }
    const items = {};
    r.orders.forEach(({ o }) =>
      (o.items || []).forEach((it) => {
        const k = it.name || it.id || "?";
        items[k] = (items[k] || 0) + (Number(it.qty) || 1);
      })
    );
    const top = Object.entries(items)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
    const recent = r.orders
      .slice()
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 6);
    const gap = r.all > 1 ? Math.round((r.last - r.first) / DAY / (r.all - 1)) : null;
    return `<div class="adm-card tw-detail">${head}${manual}
      <div class="tw-stats" style="margin-top:0.85rem">
        <span class="kitchen-stat">Pedidos (histórico) <strong>${r.all}</strong>${r.dnAll ? ` <small class="adm-muted">(${r.dnAll} comiendo aquí)</small>` : ""}</span>
        <span class="kitchen-stat">Piezas <strong>${r.allPieces}</strong></span>
        <span class="kitchen-stat">Visitas al salón <strong>${r.vall}</strong></span>
        ${r.firstAny != null ? `<span class="kitchen-stat">Primera vez <strong>${fmtDay(r.firstAny)}</strong></span>` : ""}
        ${r.lastAny != null ? `<span class="kitchen-stat">Última vez <strong>${fmtDay(r.lastAny)}</strong> (${ago(r.lastAny, c.now)})</span>` : ""}
        ${gap != null ? `<span class="kitchen-stat">Pide cada ~<strong>${gap}</strong> d</span>` : ""}
      </div>
      ${
        r.all
          ? `<div class="report-grid" style="margin-top:0.75rem">
        <div class="report-card"><h3>Lo que pide</h3>
          <table><tr><th>Producto</th><th>Cant.</th></tr>${top
            .map(([n, q]) => `<tr><td>${esc(n)}</td><td>${q}</td></tr>`)
            .join("")}</table></div>
        <div class="report-card"><h3>Últimos pedidos</h3>
          <table><tr><th>Fecha</th><th>Items</th></tr>${recent
            .map(
              ({ o, ts }) =>
                `<tr><td>${fmtDay(ts)}</td><td>${esc(
                  (o.items || []).map((it) => `×${it.qty || 1} ${it.name || it.id}`).join(", ")
                )}</td></tr>`
            )
            .join("")}</table></div>
      </div>`
          : ""
      }</div>`;
  }

  /* —— Search (no re-render, so typing never loses focus) —— */
  function applySearch(root) {
    const q = norm(ui.q);
    const qd = q.replace(/\D/g, "");
    const apts = (ui.tower && ui.tower.apts) || {};
    let n = 0;
    root.querySelectorAll(".tw-cell[data-tw-apt]").forEach((el) => {
      const key = el.dataset.twApt;
      const hit = !!q && ((qd.length >= 2 && key.includes(qd)) || norm((apts[key] || {}).name).includes(q));
      if (hit) n += 1;
      el.classList.toggle("is-match", !!q && hit);
      el.classList.toggle("is-dim", !!q && !hit);
    });
    const cnt = root.querySelector("[data-tw-qcount]");
    if (cnt) cnt.textContent = q ? `${n} coincidencia${n === 1 ? "" : "s"}` : "";
  }

  /* —— Main render —— */
  function render(orders) {
    const root = document.getElementById("towerRoot");
    if (!root) return;
    lastOrders = Array.isArray(orders) ? orders : [];
    bindOnce(root);

    const c = compute(lastOrders);
    const recs = [...c.by.values()];
    const ever = recs.filter((r) => r.all > 0 || r.vall > 0);
    const everSet = new Set(ever.map((r) => r.key));
    const activeKeys = recs.filter((r) => r.n > 0 || r.vn > 0).map((r) => r.key);
    const ranked = recs
      .filter((r) => val(r) > 0)
      .sort((a, b) => val(b) - val(a) || (b.lastAny || 0) - (a.lastAny || 0));
    const cooled = ever
      .filter((r) => c.now - r.lastAny > COOL_DAYS * DAY)
      .sort((a, b) => b.all + b.vall - (a.all + a.vall) || a.lastAny - b.lastAny);
    const stats = {
      everSet,
      everKeys: [...everSet],
      activeKeys,
      ranked,
      cooled,
      ordered: recs.filter((r) => r.all > 0).length,
      salon: recs.filter((r) => r.vall > 0).length,
      repeat: ever.filter((r) => r.all + r.vall >= 2).length,
      totalOrders: recs.reduce((n, r) => n + r.all, 0),
      totalVisits: recs.reduce((n, r) => n + r.vall, 0),
    };
    const max = ranked.length ? val(ranked[0]) : 0;

    root.innerHTML = [
      controlsHtml(),
      summaryHtml(stats),
      compareHtml(c),
      mapHtml(c, max),
      detailHtml(c),
      `<div class="report-grid" style="margin-top:1rem">${topHtml(stats, c)}${coolHtml(stats, c)}${floorsHtml(c)}${unmappedHtml(c)}${neverHtml(
        stats
      )}</div>`,
    ].join("");
    applySearch(root);
  }

  /* —— Server (names + salon visits) —— */
  async function load(code) {
    if (code) ui.code = code;
    if (!window.KitchenStore || !KitchenStore.towerView) return;
    try {
      const data = await KitchenStore.towerView(ui.code);
      ui.tower = data && data.tower && data.tower.apts ? data.tower : { apts: {}, vacant: {} };
      ui.towerOk = true;
    } catch {
      ui.towerOk = false;
    }
    if (!editing()) render(lastOrders);
  }

  async function act(payload, okMsg) {
    if (ui.busy) return;
    ui.busy = true;
    ui.msg = "";
    render(lastOrders);
    try {
      const r = await KitchenStore.towerAction(payload, ui.code);
      if (r && r.tower && r.tower.apts) ui.tower = r.tower;
      ui.towerOk = true;
      const rec = ui.tower.apts && ui.tower.apts[payload.apt];
      ui.msg = payload.action === "set_name" || payload.action === "set_vacant" ? okMsg : `${okMsg} Total en el salón: ${rec ? rec.visits.length : 0}.`;
    } catch (e) {
      ui.msg = "No se pudo guardar" + (e && e.message ? ` (${e.message})` : "") + ".";
      if (/_404$|failed|fetch/i.test((e && e.message) || "")) ui.towerOk = false;
    }
    ui.busy = false;
    render(lastOrders);
  }

  function editing() {
    const a = document.activeElement;
    const root = document.getElementById("towerRoot");
    return !!(root && a && root.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
  }

  function bindOnce(root) {
    if (bound) return;
    bound = true;

    const saveName = () => {
      const v = root.querySelector("[data-tw-name]");
      if (v && ui.sel) act({ action: "set_name", apt: ui.sel, name: v.value }, "Nombre guardado.");
    };

    root.addEventListener("click", (e) => {
      const t = e.target.closest(
        "[data-tw-period],[data-tw-metric],[data-tw-apt],[data-tw-close],[data-tw-savename],[data-tw-addvisit],[data-tw-rmvisit],[data-tw-vacant]"
      );
      if (!t) return;
      if ("twSavename" in t.dataset) return saveName();
      if ("twAddvisit" in t.dataset) {
        const cnt = parseInt(root.querySelector("[data-tw-vcount]")?.value, 10) || 1;
        const date = root.querySelector("[data-tw-vdate]")?.value || todayStr();
        const payload = { action: "add_visit", apt: ui.sel, count: Math.max(1, Math.min(20, cnt)) };
        if (date && date !== todayStr()) payload.at = new Date(`${date}T12:00:00`).toISOString();
        return act(payload, payload.count === 1 ? "Visita registrada." : `${payload.count} visitas registradas.`);
      }
      if ("twVacant" in t.dataset) {
        const on = t.dataset.twVacant === "1";
        return act({ action: "set_vacant", apt: ui.sel, vacant: on }, on ? "Marcado como vacío." : "Marca de vacío quitada.");
      }
      if ("twRmvisit" in t.dataset) {
        if (!confirm(`¿Quitar la última visita al salón del depto ${ui.sel}?`)) return;
        return act({ action: "remove_visit", apt: ui.sel }, "Última visita quitada.");
      }
      ui.msg = "";
      if (t.dataset.twPeriod) ui.period = t.dataset.twPeriod;
      else if (t.dataset.twMetric) ui.metric = t.dataset.twMetric;
      else if (t.dataset.twApt) ui.sel = ui.sel === t.dataset.twApt ? "" : t.dataset.twApt;
      else if ("twClose" in t.dataset) ui.sel = "";
      render(lastOrders);
      if (t.dataset.twApt && ui.sel) root.querySelector(".tw-detail")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });

    root.addEventListener("change", (e) => {
      if (e.target.matches("[data-tw-types]")) {
        ui.types = e.target.checked;
        if (!ui.types) ui.typeSel = "all";
        render(lastOrders);
        return;
      }
      if (e.target.matches("[data-tw-typesel]")) {
        ui.typeSel = e.target.value;
        render(lastOrders);
        return;
      }
      if (e.target.matches("[data-tw-dismissed]")) {
        ui.dismissed = e.target.checked;
        render(lastOrders);
      }
    });

    root.addEventListener("input", (e) => {
      if (e.target.matches("[data-tw-q]")) {
        ui.q = e.target.value;
        applySearch(root);
      }
    });

    root.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.matches("[data-tw-name]")) {
        e.preventDefault();
        saveName();
      }
    });
  }

  /** Called on every poll while the tab is open: only repaint if the data changed and nobody is typing. */
  function tick(orders) {
    const list = Array.isArray(orders) ? orders : [];
    const sig =
      list.length +
      "|" +
      list.reduce((m, o) => (String(o.updatedAt || o.createdAt || "") > m ? String(o.updatedAt || o.createdAt || "") : m), "");
    if (sig === ui.sig) return;
    if (editing()) return;
    ui.sig = sig;
    render(list);
  }

  window.TowerMap = { render, tick, load, parseApt, layout: FLOORS, total: ALL_KEYS.length };
})();
