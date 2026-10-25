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
    "f-burger": "Hamburguesa de res",
  };

  let data = null;
  let busy = false;

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
        <button type="button" class="btn btn--ghost btn--sm" data-act="add">Sumar</button></span></div>
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
    const groups = {};
    for (const [id, it] of Object.entries(items)) (groups[it.group || "Otros"] = groups[it.group || "Otros"] || []).push([id, it]);
    const out = Object.values(items).filter((i) => i.qty != null && i.qty <= 0).length;
    const low = Object.values(items).filter((i) => i.qty != null && i.qty > 0 && i.min != null && i.qty <= i.min).length;
    let html = `<p class="kinv-sum"><strong>${Object.keys(items).length}</strong> ingredientes · <span class="${low ? "is-low" : ""}">${low} bajos</span> · <span class="${out ? "is-empty" : ""}">${out} agotados</span></p>`;
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
      const btn = e.target.closest("button[data-act]");
      if (!btn) return;
      const rowEl = btn.closest(".kinv-row");
      const id = rowEl.dataset.id;
      if (btn.dataset.act === "add") {
        const v = Number($("input[data-f=delta]", rowEl).value);
        if (!Number.isFinite(v) || v === 0) return;
        act(window.__kinvCode || code, { action: "add", id, delta: v });
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
