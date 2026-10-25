/**
 * Kitchen inventory tab (admin). Ingredients live on the server; every order deducts its
 * recipe when it arrives (discard/delete gives it back). qty empty = not controlled.
 */
(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const esc = (v) =>
    String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const SIDE_LABELS = {
    ensalada: "Ensalada",
    arroz: "Arroz",
    frijol: "Frijol",
    quinoa: "Quinoa",
    sopaTomate: "Sopa de tomate",
    cremaEspinacas: "Sopa de espinaca",
    vegetales: "Vegetales",
  };
  const ITEM_LABELS = {
    "m-pollo-100": "Meal Prep Pollo",
    "m-atun": "Meal Prep Atún",
    "m-carne-molida": "Meal Prep Carne molida",
    "m-sirloin": "Meal Prep Res",
    "m-salmon": "Meal Prep Salmón",
    "f-club": "Club sandwich",
    "f-burger": "Hamburguesa",
    "f-pechuga-pomodoro": "Pechuga Pomodoro",
    "f-guac": "Guacamole",
    "f-empanadas": "Empanadas (papas a la francesa)",
    "f-papas-t": "Papas trufadas",
    "f-salmon-plate": "Salmón con ensalada y papas gajo",
    "f-waffle-m": "Chicken and Waffle",
    "f-waffle-d": "Waffle dulce",
    "f-boneless": "Boneless",
    "f-bolsa": "Bolsa de papa",
    "f-galletas": "Galletas",
    "f-paletas": "Paletas",
    "f-papas-g": "Papas gajo picantes",
    "f-papas-queso": "Papas con queso suave",
    "f-grilled": "Grilled cheese",
    "f-bagel-pizza": "Bagel pizza",
    "f-bagel-h": "Bagel de huevo con tocino",
    "f-alfredo": "Pasta Alfredo con pollo",
    "f-pesto": "Pasta Pesto con pollo",
    "f-ensalada": "Ensalada con pollo",
  };

  let data = null;
  let busy = false;
  let filter = "all";

  function usedBy(ingId) {
    const rec = (data && data.inventory && data.inventory.recipes) || {};
    const out = [];
    for (const [key, rules] of Object.entries(rec)) {
      const hit = (rules || []).filter((r) => r.ing === ingId);
      if (!hit.length) continue;
      const label = key.startsWith("side:")
        ? "Complemento " + (SIDE_LABELS[key.slice(5)] || key.slice(5))
        : ITEM_LABELS[key] || (window.KITCHEN_ITEM_NAMES && window.KITCHEN_ITEM_NAMES.es && window.KITCHEN_ITEM_NAMES.es[key]) || key;
      const amounts = [...new Set(hit.map((r) => r.qty))].join(" / ");
      out.push(`${label} (${amounts})`);
    }
    return out;
  }

  function status(it) {
    if (it.qty == null) return ["Sin control", "kinv-chip--off"];
    if (it.qty <= 0) return ["Agotado", "kinv-chip--out"];
    if (it.min != null && it.qty <= it.min) return ["Bajo", "kinv-chip--low"];
    return ["OK", "kinv-chip--ok"];
  }

  function row(id, it) {
    const [label, cls] = status(it);
    const used = usedBy(id);
    return `<div class="kinv-row" data-id="${esc(id)}">
      <div class="kinv-row__name"><strong>${esc(it.name)}</strong>
        <span class="kinv-chip ${cls}">${label}</span>
        <small>${used.length ? "Se descuenta con: " + esc(used.join(", ")) : "Sin recetas asignadas"}</small>
      </div>
      <label class="kinv-f">Cantidad (${esc(it.unit || "")})
        <input type="number" min="0" step="any" data-f="qty" value="${it.qty == null ? "" : it.qty}" placeholder="—" /></label>
      <label class="kinv-f">Mínimo
        <input type="number" min="0" step="any" data-f="min" value="${it.min == null ? "" : it.min}" placeholder="—" /></label>
      <div class="kinv-f kinv-f--add">Surtir
        <span><input type="number" min="0" step="any" data-f="delta" placeholder="+ cantidad" />
        <button type="button" class="btn btn--ghost btn--sm" data-act="add">Sumar</button></span>
        ${it.cookFrom ? '<button type="button" class="btn btn--sm" data-act="cook">🍝 Ya cociné pasta</button>' : ""}</div>
      <button type="button" class="btn btn--ghost btn--sm kinv-del" data-act="del" title="Quitar ingrediente">✕</button>
    </div>`;
  }

  function paint() {
    const root = $("#kInvRoot");
    if (!root) return;
    if (!data) {
      root.innerHTML = '<p class="adm-muted">No se pudo cargar el inventario. Revisa tu conexión y toca Actualizar.</p>';
      return;
    }
    const items = data.inventory.items || {};
    const isOut = (i) => i.qty != null && i.qty <= 0;
    const isLow = (i) => i.qty != null && i.qty > 0 && i.min != null && i.qty <= i.min;
    const out = Object.values(items).filter(isOut).length;
    const low = Object.values(items).filter(isLow).length;
    const pass = (i) => filter === "all" || (filter === "low" && isLow(i)) || (filter === "out" && isOut(i)) || (filter === "need" && (isLow(i) || isOut(i)));
    const groups = {};
    for (const [id, it] of Object.entries(items)) if (pass(it)) (groups[it.group || "Otros"] = groups[it.group || "Otros"] || []).push([id, it]);
    const btn = (k, label) => `<button type="button" class="kinv-filter${filter === k ? " is-active" : ""}" data-filter="${k}">${label}</button>`;
    let html = `<div class="kinv-filters">${btn("all", "Todos (" + Object.keys(items).length + ")")}${btn("need", "🛒 Por resurtir (" + (low + out) + ")")}${btn("low", "Bajo (" + low + ")")}${btn("out", "Agotado (" + out + ")")}</div><p class="kinv-sum"><strong>${Object.keys(items).length}</strong> ingredientes · <span class="${low ? "is-low" : ""}">${low} bajos</span> · <span class="${out ? "is-empty" : ""}">${out} agotados</span></p>`;
    if (!Object.keys(groups).length) html += '<p class="adm-muted">No hay ingredientes en esta vista. ✅</p>';
    for (const [g, list] of Object.entries(groups)) {
      html += `<h3 class="kinv-group">${esc(g)}</h3>` + list.map(([id, it]) => row(id, it)).join("");
    }
    root.innerHTML = html;
  }

  async function act(code, payload) {
    if (busy) return;
    busy = true;
    try {
      const res = await KitchenStore.kitchenInventoryAction(payload, code);
      data = { inventory: res.inventory, autoOut: res.autoOut };
    } catch (e) {
      alert("No se pudo guardar: " + (e && e.message ? e.message : e));
    } finally {
      busy = false;
      paint();
    }
  }

  function bind(code) {
    const root = $("#kInvRoot");
    if (!root || root.dataset.bound === "1") return;
    root.dataset.bound = "1";
    root.addEventListener("change", (e) => {
      const input = e.target.closest("input[data-f]");
      if (!input || input.dataset.f === "delta") return;
      const id = input.closest(".kinv-row").dataset.id;
      act(window.__kinvCode || code, { action: "set", id, [input.dataset.f]: input.value === "" ? null : Number(input.value) });
    });
    root.addEventListener("click", (e) => {
      const fb = e.target.closest("button[data-filter]");
      if (fb) {
        filter = fb.dataset.filter;
        paint();
        return;
      }
      const btn = e.target.closest("button[data-act]");
      if (!btn) return;
      const rowEl = btn.closest(".kinv-row");
      const id = rowEl.dataset.id;
      if (btn.dataset.act === "add") {
        const v = Number($("input[data-f=delta]", rowEl).value);
        if (!Number.isFinite(v) || v === 0) return;
        act(window.__kinvCode || code, { action: "add", id, delta: v });
      } else if (btn.dataset.act === "cook") {
        const it = data.inventory.items[id];
        const raw = data.inventory.items[it.cookFrom];
        const def = Math.max(1, (it.target || 6) - (it.qty || 0));
        const ans = prompt(`¿Cuántas porciones cocinaste? (hay ${raw ? raw.qty : "?"} sin hacer)`, String(def));
        if (ans === null) return;
        const n = Number(ans);
        if (!Number.isFinite(n) || n <= 0) return;
        act(window.__kinvCode || code, { action: "cook", id, n });
      } else if (btn.dataset.act === "del") {
        const nm = data.inventory.items[id] && data.inventory.items[id].name;
        if (confirm(`¿Quitar "${nm}" del inventario? Sus recetas dejarán de descontarlo.`)) {
          act(window.__kinvCode || code, { action: "delete", id });
        }
      }
    });
  }

  window.KitchenInventory = {
    async render(code) {
      window.__kinvCode = code;
      bind(code);
      const root = $("#kInvRoot");
      if (root && !data) root.innerHTML = '<p class="adm-muted">Cargando…</p>';
      data = await KitchenStore.kitchenInventory(code);
      paint();
    },
    async addFromForm(code) {
      const name = $("#kInvName").value.trim();
      if (!name) return;
      await act(code, {
        action: "create",
        name,
        unit: $("#kInvUnit").value.trim() || "unidades",
        qty: $("#kInvQty").value === "" ? null : Number($("#kInvQty").value),
        min: $("#kInvMin").value === "" ? null : Number($("#kInvMin").value),
        group: "Otros",
      });
      $("#kInvAdd").reset();
      $("#kInvUnit").value = "unidades";
    },
  };
})();
