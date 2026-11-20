/* Magnet tracker — which apartments already got a "Room service" magnet. Own record (/api/magnets), separate from the Tower tab. */
(function () {
  "use strict";
  const STD_TOP = [9, 8, 7, 6, 5, 4, 3, 2, 1, 22, 21, 20];
  const STD_BOT = [10, 11, 12, 14, 15, 16, 17, null, null, null, 18, 19];
  const FLOORS = [{ floor: 22, top: [9, 8, 7, 6], bot: [10, 11, 12, 14, 15] }];
  for (let f = 23; f <= 32; f++) FLOORS.push({ floor: f, top: STD_TOP, bot: STD_BOT });
  FLOORS.push({ floor: 33, top: [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1], bot: [] });

  const pad2 = (n) => String(n).padStart(2, "0");
  const keyOf = (floor, unit) => `${floor}${pad2(unit)}`;
  const unitsOf = (fl) => [...fl.top, ...fl.bot].filter((u) => u != null);
  const ui = { code: "", apts: {}, vacant: {}, ok: true, busy: false, msg: "", bound: false };
  const allKeys = new Set();
  FLOORS.forEach((fl) => unitsOf(fl).forEach((u) => allKeys.add(keyOf(fl.floor, u))));
  const TOTAL = FLOORS.reduce((n, fl) => n + unitsOf(fl).length, 0);
  const root = () => document.getElementById("magnetsRoot");
  const fmt = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
  };

  function cell(floor, unit) {
    if (unit == null) return `<span class="tw-gap" aria-hidden="true"></span>`;
    const key = keyOf(floor, unit);
    if (ui.vacant[key]) return `<button type="button" class="tw-cell mg-cell is-vacant" disabled title="${key} · VACÍO, no pegar imán"><span class="tw-u">${pad2(unit)}</span><span class="tw-n">✕</span></button>`;
    const at = ui.apts[key];
    const title = at ? `${key} · imán puesto el ${fmt(at)}` : `${key} · sin imán`;
    return `<button type="button" class="tw-cell mg-cell${at ? " is-on" : " tw-l0"}" data-mg-apt="${key}" aria-pressed="${at ? "true" : "false"}" title="${title}"><span class="tw-u">${pad2(unit)}</span><span class="tw-n">${at ? "🧲" : ""}</span></button>`;
  }

  function render() {
    const el = root();
    if (!el) return;
    bind(el);
    const vacN = Object.keys(ui.vacant).filter((k) => allKeys.has(k)).length;
    const total = Object.keys(ui.apts).filter((k) => allKeys.has(k) && !ui.vacant[k]).length;
    const target = TOTAL - vacN;
    const rows = FLOORS.map((fl) => {
      const keys = unitsOf(fl).map((u) => keyOf(fl.floor, u)).filter((k) => !ui.vacant[k]);
      const vf = unitsOf(fl).length - keys.length;
      const n = keys.filter((k) => ui.apts[k]).length;
      const row = (units) => (units.length ? `<div class="tw-row">${units.map((u) => cell(fl.floor, u)).join("")}</div>` : "");
      const all = keys.length > 0 && n === keys.length;
      return `<div class="tw-floor">
        <div class="tw-floor__label"><strong>Piso ${fl.floor}</strong><small>${n}/${keys.length}${vf ? ` · ${vf} vacíos` : ""}</small>
          <button type="button" class="btn btn--ghost btn--sm" data-mg-floor="${fl.floor}" data-mg-placed="${all ? "0" : "1"}">${all ? "Quitar piso" : "Marcar piso"}</button></div>
        <div class="tw-floor__rows">${row(fl.top)}${row(fl.bot)}</div>
      </div>`;
    }).join("");
    el.innerHTML = `<div class="adm-card tw-mapcard">
      <div class="tw-stats"><span class="kitchen-stat"><strong>${total}</strong> de ${target} con imán</span><span class="kitchen-stat">${target - total} faltan</span><span class="kitchen-stat mg-vacstat">Vacíos (no pegar) <strong>${vacN}</strong></span>${ui.msg ? `<span class="kitchen-stat">${ui.msg}</span>` : ""}${ui.ok ? "" : `<span class="kitchen-stat">Sin conexión con el servidor</span>`}</div>
      <div class="tw-map">${rows}</div>
    </div>`;
  }

  async function load(code) {
    if (code) ui.code = code;
    if (!window.KitchenStore || !KitchenStore.magnetsView) return;
    try {
      const d = await KitchenStore.magnetsView(ui.code);
      ui.apts = (d && d.magnets && d.magnets.apts) || {};
      ui.ok = true;
      try {
        const t = await KitchenStore.towerView(ui.code);
        ui.vacant = (t && t.tower && t.tower.vacant) || {};
      } catch {
        /* vacancy is read-only context; keep going without it */
      }
    } catch {
      ui.ok = false;
    }
    render();
  }

  async function act(payload) {
    if (ui.busy) return;
    ui.busy = true;
    // optimistic update so taps feel instant
    const prev = { ...ui.apts };
    if (payload.action === "toggle") {
      if (ui.apts[payload.apt]) delete ui.apts[payload.apt];
      else ui.apts[payload.apt] = new Date().toISOString();
    } else if (payload.action === "bulk") {
      payload.apts.forEach((k) => (payload.placed ? (ui.apts[k] = ui.apts[k] || new Date().toISOString()) : delete ui.apts[k]));
    }
    ui.msg = "";
    render();
    try {
      const r = await KitchenStore.magnetsAction(payload, ui.code);
      if (r && r.magnets && r.magnets.apts) ui.apts = r.magnets.apts;
      ui.ok = true;
    } catch (e) {
      ui.apts = prev;
      ui.msg = "No se pudo guardar.";
    }
    ui.busy = false;
    render();
  }

  function bind(el) {
    if (ui.bound) return;
    ui.bound = true;
    el.addEventListener("click", (e) => {
      const c = e.target.closest("[data-mg-apt]");
      if (c) return act({ action: "toggle", apt: c.getAttribute("data-mg-apt") });
      const f = e.target.closest("[data-mg-floor]");
      if (f) {
        const fl = FLOORS.find((x) => x.floor === Number(f.getAttribute("data-mg-floor")));
        if (fl) act({ action: "bulk", apts: unitsOf(fl).map((u) => keyOf(fl.floor, u)).filter((k) => !ui.vacant[k]), placed: f.getAttribute("data-mg-placed") === "1" });
      }
    });
  }

  window.MagnetsMap = { load, render };
})();
