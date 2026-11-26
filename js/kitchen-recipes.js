/**
 * Admin tabs "Recetas" and "Costeo".
 * Recipes come from the kitchen inventory (what each dish deducts); costs come from the
 * purchase data of each ingredient (cost of the presentation / quantity per presentation).
 */
(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const esc = (v) =>
    String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const money = (n) => "$" + (Math.round(n * 100) / 100).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const num = (n) => String(Math.round(n * 100) / 100);

  const SIDE_LABELS = {
    rollosPrimavera: "Rollos primavera",
    mozzarellaSticks: "Palitos de mozzarella",
    edamames: "Edamames preparados",
    ensalada: "Ensalada",
    arroz: "Arroz",
    frijol: "Frijol",
    quinoa: "Quinoa",
    sopaTomate: "Sopa de tomate",
    sopaCebolla: "Sopa de cebolla",
    cremaEspinacas: "Crema de espinaca",
    vegetales: "Vegetales",
  };

  const IF_LABELS = {
    chickenSize: { 100: "Pollo de 100 g", 200: "Pollo de 200 g" },
    burger: { beef: "Hamburguesa de res", chicken: "Hamburguesa de pollo" },
    side: { salad: "Complemento: ensalada", fries: "Complemento: chips", french: "Complemento: papas a la francesa", wedges: "Complemento: papas gajo" },
    bacon: { 1: "Con tocino extra" },
    extraChicken: { 1: "Con pollo extra" },
    mozzaExtra: { 1: "Con dedos de queso" },
    dressing: { cesar: "Aderezo César", ranch: "Aderezo ranch" },
    flavor: { buffalo: "Sabor Buffalo", bbq: "Sabor BBQ", cfa_original: "Sabor CFA original", cfa_bbq: "Sabor CFA BBQ", cfa_honey_mustard: "Sabor CFA honey mustard" },
    burgerSauce: { buffalo: "Salsa Buffalo", cfa_original: "Salsa CFA original", cfa_honey_mustard: "Salsa CFA honey mustard" },
    paleta: { choc: "Paleta de chocolate", fruta: "Paleta de frutas" },
    xsBuffalo: { 1: "Salsa extra Buffalo" },
    xsBbq: { 1: "Salsa extra BBQ" },
    xsCfaOriginal: { 1: "Salsa extra CFA original" },
    xsCfaBbq: { 1: "Salsa extra CFA BBQ" },
    xsCfaHoney: { 1: "Salsa extra CFA honey mustard" },
  };

  const cache = { inv: null };

  function ifText(cond) {
    return Object.entries(cond || {})
      .map(([k, v]) => (IF_LABELS[k] && IF_LABELS[k][v]) || `${k}=${v}`)
      .join(" + ");
  }

  /** Cost per unit of an ingredient: its own purchase data, or (portions) the bulk ingredient it is cut from. */
  function unitCost(it, items) {
    if (!it) return null;
    if (it.costFrom && items && items[it.costFrom]) {
      const base = unitCost(items[it.costFrom], null);
      return base != null && it.costGrams > 0 ? base * it.costGrams : null;
    }
    if (Array.isArray(it.cookRecipe) && it.cookBatch > 0 && items) {
      // cooked in batches (e.g. soup): the batch cost is split among the portions it yields
      let total = 0;
      for (const r of it.cookRecipe) {
        const uc = unitCost(items[r.ing], items);
        if (uc == null) return null;
        total += r.qty * uc;
      }
      return total / it.cookBatch;
    }
    return it.packQty > 0 && it.packCost > 0 ? it.packCost / it.packQty : null;
  }

  function itemName(key) {
    if (key === "order:takeout") return "Platillo para llevar (por platillo, no comer aquí)";
    if (key.startsWith("side:")) return "Complemento Meal Prep: " + (SIDE_LABELS[key.slice(5)] || key.slice(5));
    const names = window.KITCHEN_ITEM_NAMES && window.KITCHEN_ITEM_NAMES.es;
    const flat = (window.KITCHEN_FLAT || []).find((x) => x.id === key);
    return (names && names[key]) || (flat && flat.name) || key;
  }

  /** Dishes of the food menu (+ Meal Prep sides) with their recipe rules. */
  function dishes(inv) {
    const rec = inv.recipes || {};
    const out = [];
    const seen = new Set();
    (window.KITCHEN_FLAT || []).forEach((it) => {
      const sec = String(it.sectionId || "").toLowerCase();
      if (sec === "drinks" || sec === "bar" || String(it.id).startsWith("b-") || String(it.id).startsWith("d-")) return;
      seen.add(it.id);
      out.push({ key: it.id, name: itemName(it.id), price: Number(it.price) || 0, group: [it.sectionTitle, it.subLabel].filter(Boolean).join(" · ") || "Menú", rules: rec[it.id] || [] });
    });
    Object.keys(rec).forEach((k) => {
      if (k.startsWith("side:")) out.push({ key: k, name: itemName(k), price: 0, group: "Complementos de Meal Prep", rules: rec[k] });
      else if (!seen.has(k)) out.push({ key: k, name: itemName(k), price: 0, group: "Otros", rules: rec[k] });
    });
    return out;
  }

  function ruleLine(r, items, withCost) {
    const it = items[r.ing];
    const name = it ? it.name : r.ing;
    const unit = it && it.unit ? " " + it.unit : "";
    const uc = unitCost(it, items);
    const line = uc != null ? r.qty * uc : null;
    const tags = [];
    if (r.if) tags.push(ifText(r.if));
    if (r.optional) tags.push("extra");
    return `<li><span class="krec-ing">${esc(name)}</span> <b>${num(r.qty)}${esc(unit)}</b>${it && it.recipeNote ? ` <em class="krec-tag">${esc(it.recipeNote)}</em>` : ""}${tags.length ? ` <em class="krec-tag">${esc(tags.join(" · "))}</em>` : ""}${
      withCost ? ` <span class="krec-cost">${line != null ? money(line) : '<span class="adm-muted">pendiente</span>'}</span>` : ""
    }</li>`;
  }

  /** base = always-on rules; groups = alternatives by option; extras = optional add-ons. */
  function costOf(rules, items) {
    const base = rules.filter((r) => !r.if);
    const alts = rules.filter((r) => r.if && !r.optional);
    const extras = rules.filter((r) => r.if && r.optional);
    const missing = new Set();
    const cost = (list) =>
      list.reduce((sum, r) => {
        const uc = unitCost(items[r.ing], items);
        if (uc == null) {
          missing.add((items[r.ing] && items[r.ing].name) || r.ing);
          return sum;
        }
        return sum + r.qty * uc;
      }, 0);
    // group alternatives by the option they depend on (first key of "if")
    const groups = {};
    alts.forEach((r) => {
      const gk = Object.keys(r.if).sort().join("+");
      const lab = ifText(r.if);
      ((groups[gk] = groups[gk] || {})[lab] = groups[gk][lab] || []).push(r);
    });
    const groupCosts = Object.values(groups).map((g) => Object.entries(g).map(([label, list]) => ({ label, cost: cost(list) })));
    const baseCost = cost(base);
    const maxCost = baseCost + groupCosts.reduce((s, g) => s + Math.max(...g.map((o) => o.cost)), 0);
    const minCost = baseCost + groupCosts.reduce((s, g) => s + Math.min(...g.map((o) => o.cost)), 0);
    return { baseCost, minCost, maxCost, groupCosts, extras: extras.map((r) => ({ label: ifText(r.if), cost: cost([r]) })), missing: [...missing] };
  }

  async function load(code) {
    const d = await KitchenStore.kitchenInventory(code);
    cache.inv = d.inventory;
    return d.inventory;
  }

  function groupBy(list) {
    const g = {};
    list.forEach((d) => (g[d.group] = g[d.group] || []).push(d));
    return g;
  }

  let showAllRecipes = false; // "Ver todas las recetas" toggle while there are open orders
  let lastOpenOrders = [];
  let lastCode = "";

  /** Rules of a recipe that apply to one order line (same logic the server uses to deduct). */
  function matchedRules(rules, opts) {
    const list = Array.isArray(rules) ? rules : [];
    const hit = (r) => r.if && Object.entries(r.if).every(([k, v]) => String((opts || {})[k] || "") === String(v));
    const always = list.filter((r) => !r.if);
    const hits = list.filter(hit);
    const hasAlt = list.some((r) => r.if && !r.optional);
    const fallback = hasAlt && !hits.some((r) => !r.optional) ? list.filter((r) => r.default) : [];
    return [...always, ...hits, ...fallback.filter((r) => !hits.includes(r))];
  }

  /** What the open orders are preparing: recipe key -> { qty, lines: [{qty, opts}] } (dishes + Meal Prep sides). */
  function collectActive(orders) {
    const act = new Map();
    const add = (key, qty, opts, name) => {
      const e = act.get(key) || { qty: 0, lines: [], name };
      e.qty += qty;
      e.lines.push({ qty, opts });
      act.set(key, e);
    };
    (orders || []).forEach((o) => {
      if (!o || o.status !== "open") return;
      (o.items || []).forEach((it) => {
        const q = Math.max(1, parseInt(it.qty, 10) || 1);
        add(String(it.id), q, it.opts, it.name);
        Object.entries((it.opts && it.opts.mpSides) || {}).forEach(([k, n]) => add("side:" + k, q * (Number(n) || 1), null, ""));
        if (it.opts && it.opts.mozzaExtra === "1") add("side:mozzarellaSticks", q, null, "");
      });
    });
    return act;
  }

  async function renderRecipes(code, openOrders, silent) {
    const root = $("#kRecRoot");
    if (!root) return;
    if (Array.isArray(openOrders)) lastOpenOrders = openOrders;
    if (code) lastCode = code;
    if (!silent) root.innerHTML = '<p class="adm-muted">Cargando…</p>';
    let inv;
    try {
      inv = await load(code);
    } catch {
      root.innerHTML = '<p class="adm-muted">No se pudieron cargar las recetas. Toca Actualizar.</p>';
      return;
    }
    const items = inv.items || {};
    const q = (($("#kRecSearch") || {}).value || "").trim().toLowerCase();
    let html = "";
    const active = collectActive(lastOpenOrders);
    if (active.size && !q && !showAllRecipes) {
      // Only what the kitchen is making right now (open orders)
      const all = dishes(inv);
      const byKey = Object.fromEntries(all.map((d) => [d.key, d]));
      const nOrders = lastOpenOrders.filter((o) => o && o.status === "open").length;
      html += `<div class="krec-live"><p class="kinv-sum"><strong>🔥 ${nOrders} pedido${nOrders === 1 ? "" : "s"} abierto${nOrders === 1 ? "" : "s"}</strong> · mostrando solo lo que se está preparando</p><button type="button" class="btn btn--ghost btn--sm" data-rec-all="1">Ver todas las recetas</button></div>`;
      [...active.entries()].forEach(([key, a]) => {
        const d = byKey[key] || { key, name: a.name || itemName(key), price: 0, rules: [] };
        const rules = new Map();
        a.lines.forEach((l) => matchedRules(d.rules, l.opts).forEach((r) => rules.set(JSON.stringify(r), r)));
        const base = [...rules.values()].filter((r) => !r.if);
        const opts = [...rules.values()].filter((r) => r.if);
        html += `<article class="krec-card krec-card--live"><h4>${esc(d.name)} <span class="krec-price">×${a.qty}</span></h4>`;
        if (!d.rules.length) html += '<p class="adm-muted">Sin receta registrada (no descuenta inventario).</p>';
        if (base.length) html += `<p class="krec-sub">Siempre lleva</p><ul>${base.map((r) => ruleLine(r, items, false)).join("")}</ul>`;
        if (opts.length) html += `<p class="krec-sub">Según lo que eligieron</p><ul>${opts.map((r) => ruleLine(r, items, false)).join("")}</ul>`;
        html += "</article>";
      });
      root.innerHTML = html;
      return;
    }
    if (active.size && !q) html += '<div class="krec-live"><p class="kinv-sum">Mostrando todas las recetas</p><button type="button" class="btn btn--ghost btn--sm" data-rec-live="1">Solo pedidos abiertos</button></div>';
    Object.entries(groupBy(dishes(inv))).forEach(([g, list]) => {
      const shown = list.filter((d) => !q || d.name.toLowerCase().includes(q) || d.rules.some((r) => ((items[r.ing] && items[r.ing].name) || r.ing).toLowerCase().includes(q)));
      if (!shown.length) return;
      html += `<h3 class="kinv-group">${esc(g)}</h3>`;
      shown.forEach((d) => {
        const base = d.rules.filter((r) => !r.if);
        const opts = d.rules.filter((r) => r.if);
        html += `<article class="krec-card"><h4>${esc(d.name)}${d.price ? ` <span class="krec-price">${money(d.price)}</span>` : ""}</h4>`;
        if (!d.rules.length) html += '<p class="adm-muted">Sin receta registrada (no descuenta inventario).</p>';
        if (base.length) html += `<p class="krec-sub">Siempre lleva</p><ul>${base.map((r) => ruleLine(r, items, false)).join("")}</ul>`;
        if (opts.length) html += `<p class="krec-sub">Según lo que elija el cliente</p><ul>${opts.map((r) => ruleLine(r, items, false)).join("")}</ul>`;
        html += "</article>";
      });
    });
    root.innerHTML = html || '<p class="adm-muted">No hay recetas que coincidan.</p>';
  }

  /* Pricing model (Mario's costeo_platillos sheet): rent, taxes, utilities, grease trap, terminal fee and desired
     margin are % of NET sales, so  net price = ingredient cost / (1 - sum of %)  and customer price = net x (1 + IVA). */
  const COST_PARAM_DEFAULTS = { rent: 10, resico: 2, services: 3.36, grease: 0.84, terminal: 3.19, margin: 30, iva: 16 };
  const COST_PARAM_LABELS = {
    rent: "Renta",
    resico: "Impuestos RESICO",
    services: "Servicios (luz, agua, gas)",
    grease: "Limpieza de trampa de grasa",
    terminal: "Comisión de terminal",
    margin: "Margen de utilidad deseado",
    iva: "IVA (se suma al final)",
  };
  const costParams = (inv) => ({ ...COST_PARAM_DEFAULTS, ...((inv && inv.costParams) || {}) });
  const opexPct = (p) => p.rent + p.resico + p.services + p.grease + p.terminal;

  function paramsHtml(p) {
    const total = opexPct(p) + p.margin;
    return `<details class="krec-detail krec-params"><summary>⚙️ Parámetros del negocio · % sobre ventas ${Math.round(total * 100) / 100}% + IVA ${p.iva}%</summary>
      <p class="adm-muted">Son % sobre las ventas (sin IVA). Precio sin IVA = costo de ingredientes ÷ (1 − suma de %). Precio al cliente = precio sin IVA × (1 + IVA). Los datos vienen de tu hoja costeo_platillos (ventas de julio 2026 como base para servicios y trampa de grasa).</p>
      <div class="krec-params__grid">${Object.keys(COST_PARAM_LABELS)
        .map((k) => `<label class="adm-field"><span>${COST_PARAM_LABELS[k]} (%)</span><input type="number" step="0.01" min="0" max="99" data-cp="${k}" value="${p[k]}" /></label>`)
        .join("")}</div>
      <p class="adm-muted">Disponible para ingredientes: <strong>${Math.round((100 - total) * 100) / 100}%</strong> de la venta sin IVA.</p>
      <button type="button" class="btn btn--primary btn--sm" data-cp-save>Guardar parámetros</button> <span class="adm-muted" data-cp-msg></span></details>`;
  }

  async function renderCosting(code) {
    const root = $("#kCostRoot");
    if (!root) return;
    if (code) lastCode = code;
    root.innerHTML = '<p class="adm-muted">Cargando…</p>';
    let inv;
    try {
      inv = await load(code);
    } catch {
      root.innerHTML = '<p class="adm-muted">No se pudo cargar el costeo. Toca Actualizar.</p>';
      return;
    }
    const items = inv.items || {};
    const noCost = Object.values(items).filter((it) => it.qty !== undefined && unitCost(it, items) == null);
    let html = `<p class="kinv-sum"><strong>${Object.keys(items).length - noCost.length}</strong> ingredientes con costo · <span class="${noCost.length ? "is-low" : ""}">${noCost.length} pendientes</span>. El costo por unidad sale de <em>Costo de la presentación ÷ Cantidad por presentación</em>, que capturas en Inventario → 🛒 Compra.</p>`;
    const cp = costParams(inv);
    const opex = opexPct(cp) / 100;
    html += paramsHtml(cp);
    html += `<div class="krec-table-wrap"><table class="krec-table"><thead><tr><th>Platillo</th><th>Precio</th><th>Costo</th><th>Utilidad</th><th>Costo %</th><th title="Con el modelo de la hoja: costo ÷ (1 − %) × (1 + IVA)">Precio sugerido</th><th title="Utilidad real después de renta, impuestos, servicios y comisión, sobre la venta sin IVA">Utilidad real</th></tr></thead><tbody>`;
    let detail = "";
    Object.entries(groupBy(dishes(inv).filter((d) => d.price > 0 && d.rules.length))).forEach(([g, list]) => {
      html += `<tr class="krec-group"><td colspan="7">${esc(g)}</td></tr>`;
      list.forEach((d) => {
        const c = costOf(d.rules, items);
        const pending = c.missing.length > 0;
        const range = c.maxCost > c.minCost + 0.005 ? `${money(c.minCost)} – ${money(c.maxCost)}` : money(c.maxCost);
        const profit = d.price - c.maxCost;
        html += `<tr><td>${esc(d.name)}</td><td>${money(d.price)}</td>`;
        if (pending && c.maxCost === 0) html += `<td colspan="5" class="adm-muted">Pendiente · faltan ${c.missing.length} costos</td>`;
        else {
          const sugg = Math.ceil((c.maxCost / (1 - (opex + cp.margin / 100))) * (1 + cp.iva / 100));
          const net = d.price / (1 + cp.iva / 100);
          const real = 1 - c.maxCost / net - opex;
          const ok = d.price >= sugg;
          html += `<td>${pending ? "≥ " : ""}${range}</td><td>${money(profit)}</td><td>${Math.round((c.maxCost / d.price) * 100)}%</td>
            <td class="${ok ? "" : "is-low"}">${pending ? "≥ " : ""}${money(sugg)}${ok ? "" : ` <small>(+${money(sugg - d.price)})</small>`}</td>
            <td class="${real < cp.margin / 100 - 0.0005 ? "is-low" : ""}">${Math.round(real * 1000) / 10}%</td>`;
        }
        html += "</tr>";
        detail += `<details class="krec-detail"><summary>${esc(d.name)}</summary>
          <ul>${d.rules.filter((r) => !r.if).map((r) => ruleLine(r, items, true)).join("")}</ul>
          ${c.groupCosts.length ? `<p class="krec-sub">Opciones</p><ul>${c.groupCosts.map((g) => g.map((o) => `<li>${esc(o.label)} <span class="krec-cost">${o.cost > 0 ? money(o.cost) : '<span class="adm-muted">—</span>'}</span></li>`).join("")).join("")}</ul>` : ""}
          ${c.extras.length ? `<p class="krec-sub">Extras (no incluidos en el costo)</p><ul>${c.extras.map((o) => `<li>${esc(o.label)} <span class="krec-cost">${o.cost > 0 ? money(o.cost) : "—"}</span></li>`).join("")}</ul>` : ""}
          ${pending ? `<p class="adm-muted">Faltan costos de: ${esc(c.missing.join(", "))}</p>` : ""}
        </details>`;
      });
    });
    html += "</tbody></table></div>";
    html += `<p class="adm-muted">Con opciones (tamaño, sabor, complemento) el costo se muestra como rango y la utilidad se calcula con el costo más alto. <strong>Precio sugerido</strong>: el precio al cliente (con IVA, redondeado hacia arriba) que cubre renta, impuestos, servicios, comisión y tu margen deseado (${cp.margin}%). <strong>Utilidad real</strong>: lo que queda con el precio actual; en rojo si es menor al margen deseado.</p>`;
    html += `<h3 class="kinv-group">Detalle por platillo</h3>${detail}`;
    if (noCost.length) html += `<h3 class="kinv-group">Ingredientes sin costo</h3><p class="adm-muted">${esc(noCost.map((i) => i.name).join(" · "))}</p>`;
    root.innerHTML = html;
  }

  document.addEventListener("click", async (e) => {
    const sv = e.target.closest && e.target.closest("#kCostRoot [data-cp-save]");
    if (sv) {
      const root = $("#kCostRoot");
      const msg = root.querySelector("[data-cp-msg]");
      const params = {};
      root.querySelectorAll("[data-cp]").forEach((i) => (params[i.dataset.cp] = Number(i.value)));
      try {
        await KitchenStore.kitchenInventoryAction({ action: "cost_params", params }, lastCode);
        renderCosting(lastCode);
      } catch (err) {
        if (msg) msg.textContent = "No se pudo guardar (" + (err && err.message ? err.message : "error") + ").";
      }
      return;
    }
    const b = e.target.closest && e.target.closest("#kRecRoot [data-rec-all], #kRecRoot [data-rec-live]");
    if (!b) return;
    showAllRecipes = b.hasAttribute("data-rec-all");
    renderRecipes(lastCode, undefined, true);
  });

  /* ---- Simulator tab: play with a dish/ingredient cost and with the pricing parameters. Nothing is saved unless asked. ---- */
  const sim = { inv: null, params: null, dish: "", lines: [], manual: 50, price: 0 };

  function simLoadDish(key) {
    sim.dish = key;
    sim.lines = [];
    if (!key) return;
    const items = sim.inv.items || {};
    const d = dishes(sim.inv).find((x) => x.key === key);
    if (!d) return;
    sim.price = d.price || 0;
    d.rules.filter((r) => !r.if).forEach((r) => {
      const it = items[r.ing];
      sim.lines.push({ label: (it && it.name) || r.ing, unit: (it && it.unit) || "", qty: r.qty, uc: unitCost(it, items) });
    });
    // options (size, flavor...): the most expensive one counts, like in Costeo
    const c = costOf(d.rules, items);
    c.groupCosts.forEach((g) => {
      const top = g.slice().sort((a, b) => b.cost - a.cost)[0];
      if (top) sim.lines.push({ label: "Opción: " + top.label, unit: "", qty: 1, uc: top.cost, fixed: true });
    });
  }

  function simCalc() {
    const p = sim.params;
    const opex = opexPct(p) / 100;
    const cost = sim.dish ? sim.lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.uc) || 0), 0) : Number(sim.manual) || 0;
    const room = 1 - (opex + p.margin / 100);
    const net = room > 0 ? cost / room : NaN;
    const customer = net * (1 + p.iva / 100);
    return { p, opex, cost, room, net, customer };
  }

  function simOutHtml() {
    const r = simCalc();
    const p = r.p;
    if (!(r.room > 0)) return '<p class="kinv-warn">Los % suman 100% o más: no hay forma de cubrir el costo. Baja alguno.</p>';
    const rows = [
      ["Ingredientes", r.cost],
      ["Renta", r.net * p.rent / 100],
      ["Impuestos RESICO", r.net * p.resico / 100],
      ["Servicios", r.net * p.services / 100],
      ["Trampa de grasa", r.net * p.grease / 100],
      ["Comisión de terminal", r.net * p.terminal / 100],
      ["Utilidad (margen)", r.net * p.margin / 100],
    ];
    let html = `<div class="ksim-big"><span>Precio sin IVA</span><strong>${money(r.net)}</strong></div>
      <div class="ksim-big"><span>Precio al cliente (con IVA)</span><strong>${money(r.customer)}</strong><small>redondeado: ${money(Math.ceil(r.customer))}</small></div>
      <table class="krec-table ksim-table"><thead><tr><th>A dónde va cada venta (sin IVA)</th><th>$</th><th>%</th></tr></thead><tbody>${rows
        .map(([l, v]) => `<tr><td>${l}</td><td>${money(v)}</td><td>${Math.round((v / r.net) * 1000) / 10}%</td></tr>`)
        .join("")}</tbody></table>`;
    if (sim.dish || sim.price > 0) {
      const price = Number(sim.price) || 0;
      if (price > 0) {
        const n2 = price / (1 + p.iva / 100);
        const real = 1 - r.cost / n2 - r.opex;
        html += `<div class="ksim-what"><strong>Si lo vendes a ${money(price)}</strong>: precio sin IVA ${money(n2)} · utilidad real <span class="${real < p.margin / 100 - 0.0005 ? "is-low" : ""}"><strong>${Math.round(real * 1000) / 10}%</strong></span> (${money(n2 * real)} por platillo) · ingredientes ${Math.round((r.cost / n2) * 1000) / 10}% de la venta.</div>`;
      }
    }
    return html;
  }

  function simUpdate() {
    const out = $("#kSimOut");
    if (out) out.innerHTML = simOutHtml();
    const tot = $("#kSimCost");
    if (tot) tot.textContent = money(simCalc().cost);
  }

  function simHtml() {
    const list = dishes(sim.inv).filter((d) => d.rules.length && d.price > 0 || d.key === sim.dish);
    const opts = ['<option value="">— Costo manual (sin platillo) —</option>']
      .concat(list.map((d) => `<option value="${esc(d.key)}"${d.key === sim.dish ? " selected" : ""}>${esc(d.name)} · ${money(d.price)}</option>`))
      .join("");
    const lines = sim.lines
      .map(
        (l, i) =>
          `<tr><td>${esc(l.label)}</td><td>${l.fixed ? "—" : `<input type="number" step="any" min="0" data-sim-q="${i}" value="${num(l.qty)}" />${esc(l.unit)}`}</td><td><input type="number" step="any" min="0" data-sim-u="${i}" value="${l.uc == null ? "" : Math.round(l.uc * 10000) / 10000}" placeholder="sin costo" />${l.fixed ? " total" : " c/u"}</td></tr>`
      )
      .join("");
    return `<div class="ksim">
      <div class="ksim-col">
        <label class="adm-field"><span>Platillo</span><select data-sim-dish>${opts}</select></label>
        ${
          sim.dish
            ? `<table class="krec-table ksim-lines"><thead><tr><th>Ingrediente</th><th>Cantidad</th><th>Costo</th></tr></thead><tbody>${lines}</tbody></table><p class="adm-muted">Cambia cantidades o costos para ver qué pasa. Costo total: <strong id="kSimCost"></strong></p>`
            : `<label class="adm-field"><span>Costo de ingredientes ($)</span><input type="number" step="any" min="0" data-sim-manual value="${sim.manual}" /></label><p class="adm-muted">Total: <strong id="kSimCost"></strong></p>`
        }
        <label class="adm-field"><span>Precio de venta a comparar, con IVA ($) <small class="adm-muted">(opcional)</small></span><input type="number" step="any" min="0" data-sim-price value="${sim.price || ""}" /></label>
        <p class="krec-sub">Parámetros (% sobre ventas sin IVA)</p>
        <div class="krec-params__grid">${Object.keys(COST_PARAM_LABELS)
          .map((k) => `<label class="adm-field"><span>${COST_PARAM_LABELS[k]}</span><input type="number" step="0.01" min="0" max="99" data-sim-p="${k}" value="${sim.params[k]}" /></label>`)
          .join("")}</div>
        <p><button type="button" class="btn btn--ghost btn--sm" data-sim-reset>Volver a los parámetros guardados</button> <button type="button" class="btn btn--primary btn--sm" data-sim-save>Guardar estos parámetros</button> <span class="adm-muted" data-sim-msg></span></p>
      </div>
      <div class="ksim-col" id="kSimOut"></div>
    </div>`;
  }

  async function renderSimulator(code) {
    const root = $("#kSimRoot");
    if (!root) return;
    if (code) lastCode = code;
    if (!sim.inv) root.innerHTML = '<p class="adm-muted">Cargando…</p>';
    try {
      sim.inv = await load(code);
    } catch {
      root.innerHTML = '<p class="adm-muted">No se pudo cargar el simulador. Abre la pestaña de nuevo.</p>';
      return;
    }
    sim.saved = costParams(sim.inv);
    if (!sim.params) sim.params = { ...sim.saved };
    root.innerHTML = simHtml();
    simUpdate();
  }

  document.addEventListener("input", (e) => {
    const t = e.target;
    if (!t.closest || !t.closest("#kSimRoot")) return;
    const n = Number(t.value);
    if (t.matches("[data-sim-q]")) sim.lines[Number(t.dataset.simQ)].qty = n;
    else if (t.matches("[data-sim-u]")) sim.lines[Number(t.dataset.simU)].uc = t.value === "" ? null : n;
    else if (t.matches("[data-sim-manual]")) sim.manual = n;
    else if (t.matches("[data-sim-price]")) sim.price = n;
    else if (t.matches("[data-sim-p]")) sim.params[t.dataset.simP] = Number.isFinite(n) ? n : 0;
    else return;
    simUpdate();
  });
  document.addEventListener("change", (e) => {
    if (e.target.matches && e.target.matches("#kSimRoot [data-sim-dish]")) {
      simLoadDish(e.target.value);
      $("#kSimRoot").innerHTML = simHtml();
      simUpdate();
    }
  });
  document.addEventListener("click", async (e) => {
    const b = e.target.closest && e.target.closest("#kSimRoot [data-sim-reset], #kSimRoot [data-sim-save]");
    if (!b) return;
    if (b.hasAttribute("data-sim-reset")) {
      sim.params = { ...sim.saved };
      $("#kSimRoot").innerHTML = simHtml();
      simUpdate();
      return;
    }
    const msg = $("#kSimRoot [data-sim-msg]");
    try {
      await KitchenStore.kitchenInventoryAction({ action: "cost_params", params: sim.params }, lastCode);
      sim.saved = { ...sim.params };
      if (msg) msg.textContent = "Guardados. Ya cuentan en Costeo.";
    } catch (err) {
      if (msg) msg.textContent = "No se pudo guardar (" + (err && err.message ? err.message : "error") + ").";
    }
  });
  window.KitchenRecipes = { renderRecipes, renderCosting, renderSimulator };
})();
