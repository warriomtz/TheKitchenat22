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
    ensalada: "Ensalada",
    arroz: "Arroz",
    frijol: "Frijol",
    quinoa: "Quinoa",
    sopaTomate: "Sopa de tomate",
    cremaEspinacas: "Crema de espinaca",
    vegetales: "Vegetales",
  };

  const IF_LABELS = {
    chickenSize: { 100: "Pollo de 100 g", 200: "Pollo de 200 g" },
    burger: { beef: "Hamburguesa de res", chicken: "Hamburguesa de pollo" },
    side: { salad: "Complemento: ensalada", fries: "Complemento: chips", french: "Complemento: papas a la francesa", wedges: "Complemento: papas gajo" },
    bacon: { 1: "Con tocino extra" },
    extraChicken: { 1: "Con pollo extra" },
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
    return `<li><span class="krec-ing">${esc(name)}</span> <b>${num(r.qty)}${esc(unit)}</b>${tags.length ? ` <em class="krec-tag">${esc(tags.join(" · "))}</em>` : ""}${
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

  async function renderRecipes(code) {
    const root = $("#kRecRoot");
    if (!root) return;
    root.innerHTML = '<p class="adm-muted">Cargando…</p>';
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

  async function renderCosting(code) {
    const root = $("#kCostRoot");
    if (!root) return;
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
    html += `<div class="krec-table-wrap"><table class="krec-table"><thead><tr><th>Platillo</th><th>Precio</th><th>Costo</th><th>Utilidad</th><th>Costo %</th></tr></thead><tbody>`;
    let detail = "";
    Object.entries(groupBy(dishes(inv).filter((d) => d.price > 0 && d.rules.length))).forEach(([g, list]) => {
      html += `<tr class="krec-group"><td colspan="5">${esc(g)}</td></tr>`;
      list.forEach((d) => {
        const c = costOf(d.rules, items);
        const pending = c.missing.length > 0;
        const range = c.maxCost > c.minCost + 0.005 ? `${money(c.minCost)} – ${money(c.maxCost)}` : money(c.maxCost);
        const profit = d.price - c.maxCost;
        html += `<tr><td>${esc(d.name)}</td><td>${money(d.price)}</td>`;
        if (pending && c.maxCost === 0) html += `<td colspan="3" class="adm-muted">Pendiente · faltan ${c.missing.length} costos</td>`;
        else
          html += `<td>${pending ? "≥ " : ""}${range}</td><td>${money(profit)}</td><td>${Math.round((c.maxCost / d.price) * 100)}%</td>`;
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
    html += `<p class="adm-muted">Con opciones (tamaño, sabor, complemento) el costo se muestra como rango y la utilidad se calcula con el costo más alto.</p>`;
    html += `<h3 class="kinv-group">Detalle por platillo</h3>${detail}`;
    if (noCost.length) html += `<h3 class="kinv-group">Ingredientes sin costo</h3><p class="adm-muted">${esc(noCost.map((i) => i.name).join(" · "))}</p>`;
    root.innerHTML = html;
  }

  window.KitchenRecipes = { renderRecipes, renderCosting };
})();
