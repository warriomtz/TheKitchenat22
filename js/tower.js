/**
 * Torre — who orders from The Kitchen at 22, by apartment.
 * Read-only view built from the orders the admin already loads (orderType "apartment").
 * Apartment "3108" = floor 31, unit 08. Layout mirrors the real tower (floors 22–33, no unit 13).
 * Nothing is stored here; everything is computed from state.orders each time.
 */
(function () {
  "use strict";

  /* —— Tower layout (same as the floor plan) —— */
  const STD_TOP = [9, 8, 7, 6, 5, 4, 3, 2, 1, 22, 21, 20];
  const STD_BOT = [10, 11, 12, 14, 15, 16, 17, 18, 19];
  const FLOORS = [{ floor: 22, top: [9, 8, 7, 6], bot: [10, 11, 12, 14, 15] }];
  for (let f = 23; f <= 32; f++) FLOORS.push({ floor: f, top: STD_TOP, bot: STD_BOT });
  FLOORS.push({ floor: 33, top: [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1], bot: [] });

  const pad2 = (n) => String(n).padStart(2, "0");
  const keyOf = (floor, unit) => `${floor}${pad2(unit)}`;
  const ALL_KEYS = [];
  FLOORS.forEach((fl) => [...fl.top, ...fl.bot].forEach((u) => ALL_KEYS.push(keyOf(fl.floor, u))));
  const KEY_SET = new Set(ALL_KEYS);
  const FLOOR_SIZE = {};
  FLOORS.forEach((fl) => (FLOOR_SIZE[fl.floor] = fl.top.length + fl.bot.length));

  const DAY = 86400000;
  const COOL_DAYS = 30;

  const ui = { period: "all", metric: "orders", dismissed: false, sel: "", sig: "" };
  let lastOrders = [];
  let bound = false;

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function parseApt(raw) {
    const digits = String(raw || "").replace(/\D/g, "");
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

  function qtyOf(o) {
    return (o.items || []).reduce((n, it) => n + (Number(it.qty) || 1), 0);
  }

  /* —— Compute —— */
  function compute(orders) {
    const now = Date.now();
    const since = ui.period === "all" ? 0 : now - (ui.period === "7" ? 7 : 30) * DAY;
    const by = new Map(); // key -> record
    const unmapped = new Map(); // raw text -> count
    (orders || []).forEach((o) => {
      if (!o || o.orderType !== "apartment") return;
      if (!ui.dismissed && o.status === "dismissed") return;
      const ts = Date.parse(o.createdAt);
      if (!Number.isFinite(ts)) return;
      const key = parseApt(o.apartment);
      if (!key) {
        const raw = String(o.apartment || "").trim() || "(vacío)";
        unmapped.set(raw, (unmapped.get(raw) || 0) + 1);
        return;
      }
      let r = by.get(key);
      if (!r) {
        r = { key, all: 0, allPieces: 0, n: 0, pieces: 0, first: ts, last: ts, orders: [] };
        by.set(key, r);
      }
      const pcs = qtyOf(o);
      r.all += 1;
      r.allPieces += pcs;
      r.first = Math.min(r.first, ts);
      r.last = Math.max(r.last, ts);
      r.orders.push({ o, ts });
      if (ts >= since) {
        r.n += 1;
        r.pieces += pcs;
      }
    });
    return { now, by, unmapped };
  }

  const val = (r) => (!r ? 0 : ui.metric === "pieces" ? r.pieces : r.n);

  /* —— Render pieces —— */
  function controlsHtml() {
    const per = (id, label) =>
      `<button type="button" class="btn btn--ghost btn--sm${ui.period === id ? " is-period-on" : ""}" data-tw-period="${id}">${label}</button>`;
    const met = (id, label) =>
      `<button type="button" class="btn btn--ghost btn--sm${ui.metric === id ? " is-period-on" : ""}" data-tw-metric="${id}">${label}</button>`;
    return `<div class="tw-controls">
      <div class="report-period" role="group" aria-label="Periodo">${per("all", "Todo")}${per("30", "30 días")}${per("7", "7 días")}</div>
      <div class="report-period" role="group" aria-label="Medir por">${met("orders", "Pedidos")}${met("pieces", "Piezas")}</div>
      <label class="adm-check"><input type="checkbox" data-tw-dismissed ${ui.dismissed ? "checked" : ""} /><span>Incluir descartados</span></label>
    </div>`;
  }

  function summaryHtml(c, stats) {
    const active = stats.activeKeys.length;
    const pct = Math.round((active / ALL_KEYS.length) * 100);
    const top = stats.ranked[0];
    return `<div class="tw-stats">
      <span class="kitchen-stat">Han pedido <strong>${stats.everKeys.length}</strong> de ${ALL_KEYS.length} (${Math.round(
        (stats.everKeys.length / ALL_KEYS.length) * 100
      )}%)</span>
      ${ui.period === "all" ? "" : `<span class="kitchen-stat">En el periodo <strong>${active}</strong> (${pct}%)</span>`}
      <span class="kitchen-stat">Nunca <strong>${ALL_KEYS.length - stats.everKeys.length}</strong></span>
      <span class="kitchen-stat">Recurrentes (2+) <strong>${stats.repeat}</strong></span>
      <span class="kitchen-stat">Pedidos a depto <strong>${stats.totalOrders}</strong></span>
      ${top ? `<span class="kitchen-stat">Top <strong>${esc(top.key)}</strong> (${val(top)})</span>` : ""}
    </div>`;
  }

  function cellHtml(floor, unit, c, max) {
    const key = keyOf(floor, unit);
    const r = c.by.get(key);
    const v = val(r);
    const level = v <= 0 ? 0 : max <= 1 ? 3 : 1 + Math.min(4, Math.floor(4 * Math.sqrt((v - 1) / (max - 1))));
    const tip = r
      ? `${key} · ${r.n} pedidos · ${r.pieces} piezas (periodo) · último ${fmtDay(r.last)}`
      : `${key} · nunca ha pedido`;
    return `<button type="button" class="tw-cell tw-l${level}${ui.sel === key ? " is-sel" : ""}" data-tw-apt="${key}" title="${esc(tip)}">
      <span class="tw-u">${pad2(unit)}</span><span class="tw-n">${v > 0 ? v : ""}</span></button>`;
  }

  function mapHtml(c, max) {
    const rows = FLOORS.map((fl) => {
      const keys = [...fl.top, ...fl.bot].map((u) => keyOf(fl.floor, u));
      const act = keys.filter((k) => c.by.has(k)).length;
      const sum = keys.reduce((n, k) => n + (c.by.get(k) ? c.by.get(k).n : 0), 0);
      const row = (units) =>
        units.length ? `<div class="tw-row">${units.map((u) => cellHtml(fl.floor, u, c, max)).join("")}</div>` : "";
      return `<div class="tw-floor">
        <div class="tw-floor__label"><strong>Piso ${fl.floor}</strong><small>${act}/${keys.length} · ${sum} ped.</small></div>
        <div class="tw-floor__rows">${row(fl.top)}${row(fl.bot)}</div>
      </div>`;
    }).join("");
    const scale = [1, 2, 3, 4, 5].map((l) => `<i class="tw-cell tw-l${l} tw-legend__sw"></i>`).join("");
    return `<div class="adm-card tw-mapcard">
      <div class="tw-legend"><span class="tw-cell tw-l0 tw-legend__sw"></span> nunca <span class="tw-legend__gap"></span> menos ${scale} más (máx ${max || 0})</div>
      <div class="tw-map">${rows}</div>
    </div>`;
  }

  function topHtml(stats, c) {
    const rows = stats.ranked.slice(0, 10);
    return `<div class="report-card">
      <h3>Quién más pide</h3>
      <table><tr><th>Depto</th><th>Pedidos</th><th>Piezas</th><th>Último</th></tr>
      ${
        rows.length
          ? rows
              .map(
                (r) =>
                  `<tr><td><button type="button" class="linkish" data-tw-apt="${r.key}">${r.key}</button></td><td>${r.n}</td><td>${r.pieces}</td><td>${ago(r.last, c.now)}</td></tr>`
              )
              .join("")
          : `<tr><td colspan="4">Sin pedidos en el periodo</td></tr>`
      }
      </table></div>`;
  }

  function coolHtml(stats, c) {
    const rows = stats.cooled.slice(0, 12);
    return `<div class="report-card">
      <h3>Se enfriaron (${COOL_DAYS}+ días sin pedir)</h3>
      <table><tr><th>Depto</th><th>Pedidos</th><th>Último</th></tr>
      ${
        rows.length
          ? rows
              .map(
                (r) =>
                  `<tr><td><button type="button" class="linkish" data-tw-apt="${r.key}">${r.key}</button></td><td>${r.all}</td><td>${ago(r.last, c.now)}</td></tr>`
              )
              .join("")
          : `<tr><td colspan="3">Nadie por ahora</td></tr>`
      }
      </table>
      <p class="adm-muted">Pidieron antes pero ya no. Son los primeros a quienes vale la pena escribirles.</p></div>`;
  }

  function floorsHtml(c) {
    const data = FLOORS.map((fl) => {
      const keys = [...fl.top, ...fl.bot].map((u) => keyOf(fl.floor, u));
      return {
        floor: fl.floor,
        size: keys.length,
        act: keys.filter((k) => c.by.get(k) && c.by.get(k).n > 0).length,
        n: keys.reduce((s, k) => s + (c.by.get(k) ? c.by.get(k).n : 0), 0),
      };
    });
    const max = Math.max(1, ...data.map((d) => d.n));
    return `<div class="report-card">
      <h3>Por piso</h3>
      <table><tr><th>Piso</th><th>Deptos activos</th><th>Pedidos</th></tr>
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
      <summary><strong>Nunca han pedido · ${never.length} deptos</strong> <span class="adm-muted">(histórico, según los pedidos que existen hoy)</span></summary>
      ${lines || '<p class="adm-muted">Todos han pedido al menos una vez.</p>'}
    </details>`;
  }

  function unmappedHtml(c) {
    if (!c.unmapped.size) return "";
    const rows = [...c.unmapped.entries()].sort((a, b) => b[1] - a[1]);
    return `<div class="report-card">
      <h3>Sin ubicar en la torre</h3>
      <table><tr><th>Lo que escribieron</th><th>Pedidos</th></tr>
      ${rows.map(([t, n]) => `<tr><td>${esc(t)}</td><td>${n}</td></tr>`).join("")}</table>
      <p class="adm-muted">No coinciden con un depto de la torre (se espera 4 dígitos, ej. 3108). No cuentan en el mapa.</p></div>`;
  }

  function detailHtml(c) {
    if (!ui.sel) return "";
    const r = c.by.get(ui.sel);
    const head = `<div class="tw-detail__head"><h3>Depto ${esc(ui.sel)}</h3><button type="button" class="btn btn--ghost btn--sm" data-tw-close>Cerrar</button></div>`;
    if (!r) {
      return `<div class="adm-card tw-detail">${head}<p class="adm-muted">Este depto nunca ha pedido.</p></div>`;
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
    return `<div class="adm-card tw-detail">${head}
      <div class="tw-stats">
        <span class="kitchen-stat">Pedidos (histórico) <strong>${r.all}</strong></span>
        <span class="kitchen-stat">Piezas <strong>${r.allPieces}</strong></span>
        <span class="kitchen-stat">Primero <strong>${fmtDay(r.first)}</strong></span>
        <span class="kitchen-stat">Último <strong>${fmtDay(r.last)}</strong> (${ago(r.last, c.now)})</span>
        ${gap != null ? `<span class="kitchen-stat">Pide cada ~<strong>${gap}</strong> d</span>` : ""}
      </div>
      <div class="report-grid" style="margin-top:0.75rem">
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
      </div></div>`;
  }

  /* —— Main render —— */
  function render(orders) {
    const root = document.getElementById("towerRoot");
    if (!root) return;
    lastOrders = Array.isArray(orders) ? orders : [];
    bindOnce(root);

    const c = compute(lastOrders);
    const recs = [...c.by.values()];
    const everSet = new Set(recs.map((r) => r.key));
    const activeRecs = recs.filter((r) => r.n > 0);
    const ranked = activeRecs.slice().sort((a, b) => val(b) - val(a) || b.last - a.last);
    const cooled = recs
      .filter((r) => c.now - r.last > COOL_DAYS * DAY)
      .sort((a, b) => b.all - a.all || a.last - b.last);
    const stats = {
      everSet,
      everKeys: [...everSet],
      activeKeys: activeRecs.map((r) => r.key),
      ranked,
      cooled,
      repeat: recs.filter((r) => r.all >= 2).length,
      totalOrders: recs.reduce((n, r) => n + r.all, 0),
    };
    const max = ranked.length ? val(ranked[0]) : 0;

    root.innerHTML = [
      controlsHtml(),
      summaryHtml(c, stats),
      mapHtml(c, max),
      detailHtml(c),
      `<div class="report-grid" style="margin-top:1rem">${topHtml(stats, c)}${coolHtml(stats, c)}${floorsHtml(c)}${unmappedHtml(c)}${neverHtml(
        stats
      )}</div>`,
    ].join("");
  }

  function bindOnce(root) {
    if (bound) return;
    bound = true;
    root.addEventListener("click", (e) => {
      const t = e.target.closest("[data-tw-period],[data-tw-metric],[data-tw-apt],[data-tw-close]");
      if (!t) return;
      if (t.dataset.twPeriod) ui.period = t.dataset.twPeriod;
      else if (t.dataset.twMetric) ui.metric = t.dataset.twMetric;
      else if (t.dataset.twApt) ui.sel = ui.sel === t.dataset.twApt ? "" : t.dataset.twApt;
      else if ("twClose" in t.dataset) ui.sel = "";
      render(lastOrders);
      if (t.dataset.twApt && ui.sel) root.querySelector(".tw-detail")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    root.addEventListener("change", (e) => {
      if (e.target.matches("[data-tw-dismissed]")) {
        ui.dismissed = e.target.checked;
        render(lastOrders);
      }
    });
  }

  /** Called on every poll while the tab is open: only repaint if the data actually changed. */
  function tick(orders) {
    const list = Array.isArray(orders) ? orders : [];
    const sig = list.length + "|" + list.reduce((m, o) => (String(o.updatedAt || o.createdAt || "") > m ? String(o.updatedAt || o.createdAt || "") : m), "");
    if (sig === ui.sig) return;
    ui.sig = sig;
    render(list);
  }

  window.TowerMap = { render, tick, parseApt, layout: FLOORS, total: ALL_KEYS.length };
})();
