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
    "order:takeout": "Platillo para llevar (por platillo, no comer aquí)",
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
    "f-ensalada-sin": "Ensalada sin proteína",
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
  const openBuy = new Set(); // ingredient ids whose "Compra" block is open
  const photos = {}; // id -> data URL (loaded on demand)
  let filter = "all";
  let catFilter = ""; // "" = all categories (group name otherwise)

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

  const money = (n) => "$" + (Math.round(n * 100) / 100).toLocaleString("es-MX");

  function buyBlock(id, it, extra) {
    const unitCost = it.packQty > 0 && it.packCost > 0 ? it.packCost / it.packQty : null;
    const sum = [it.supplier, it.brand, it.presentation, it.itemNo ? "#" + it.itemNo : ""].filter(Boolean).join(" · ");
    const costTxt = unitCost != null ? ` · ${money(unitCost)} por ${it.unit || "unidad"}` : "";
    const packTxt = it.packText != null ? it.packText : it.packQty != null ? `${it.packQty} ${it.unit || ""}`.trim() : "";
    const packHint = it.packText && it.packQty == null ? `<small class="kinv-warn">⚠️ No pude leer la cantidad. Usa ${it.unit === "g" ? "g o kg (ej. 1 kg)" : it.unit === "ml" ? "ml o l (ej. 1 l)" : "un número (ej. 8 pza)"}.</small>` : it.packQty != null ? `<small class="adm-muted">= ${it.packQty} ${esc(it.unit || "")}</small>` : "";
    const img = photos[id] ? `<img class="kinv-photo" src="${photos[id]}" alt="Foto de ${esc(it.name)}" />` : it.photo ? '<span class="adm-muted">Cargando foto…</span>' : '<span class="adm-muted">Sin foto</span>';
    return `<details class="kinv-buy" data-id="${esc(id)}"${openBuy.has(id) ? " open" : ""}>
      <summary>🛒 Compra${sum ? ": " + esc(sum) : ""}${esc(costTxt)}${it.photo ? " 📷" : ""}</summary>
      <div class="kinv-buy__grid">
        <label class="kinv-f">Proveedor<input type="text" data-m="supplier" maxlength="60" placeholder="Ej. Costco" value="${esc(it.supplier || "")}" /></label>
        <label class="kinv-f"># de artículo del proveedor<input type="text" data-m="itemNo" maxlength="40" placeholder="Ej. 1234567 (Costco)" value="${esc(it.itemNo || "")}" /></label>
        <label class="kinv-f">Marca<input type="text" data-m="brand" maxlength="60" placeholder="Ej. Kirkland" value="${esc(it.brand || "")}" /></label>
        <label class="kinv-f">Tipo de presentación (bolsa, pieza, caja…)<input type="text" data-m="presentation" maxlength="80" placeholder="Ej. bolsa" value="${esc(it.presentation || "")}" /></label>
        <label class="kinv-f">Cantidad por presentación (ej. 8 pza, 1 kg)<input type="text" data-m="packText" maxlength="40" placeholder="Ej. 1 kg" value="${esc(packTxt)}" />${packHint}</label>
        <label class="kinv-f">Costo de la presentación ($)<input type="number" min="0" step="any" data-m="packCost" placeholder="Pendiente" value="${it.packCost == null ? "" : it.packCost}" /></label>
        ${extra || ""}
        <div class="kinv-f kinv-photo-box">Foto
          ${img}
          <span class="kinv-photo-actions">
            <label class="btn btn--ghost btn--sm">${it.photo ? "Cambiar" : "Subir foto"}<input type="file" accept="image/*" data-photo hidden /></label>
            ${it.photo ? '<button type="button" class="btn btn--ghost btn--sm" data-act="photo-del">Quitar</button>' : ""}
          </span>
        </div>
      </div>
    </details>`;
  }

  function resizeImage(file, max = 640) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => {
        const k = Math.min(1, max / Math.max(im.width, im.height));
        const c = document.createElement("canvas");
        c.width = Math.round(im.width * k);
        c.height = Math.round(im.height * k);
        c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        let q = 0.72;
        let out = c.toDataURL("image/jpeg", q);
        while (out.length > 220000 && q > 0.35) {
          q -= 0.1;
          out = c.toDataURL("image/jpeg", q);
        }
        resolve(out);
      };
      im.onerror = () => reject(new Error("bad_image"));
      im.src = url;
    });
  }

  async function loadPhoto(id) {
    if (photos[id] || !data.inventory.items[id] || !data.inventory.items[id].photo) return;
    try {
      const r = await KitchenStore.kitchenInventoryAction({ action: "photo_get", id }, window.__kinvCode);
      if (r.image) {
        photos[id] = r.image;
        const box = $(`.kinv-buy[data-id="${CSS.escape(id)}"] .kinv-photo-box`);
        if (box) {
          const slot = box.querySelector("span.adm-muted");
          if (slot) slot.outerHTML = `<img class="kinv-photo" src="${r.image}" alt="" />`;
        }
      }
    } catch {}
  }

  /** Items cut from one bulk purchase (e.g. the three chicken portions) share a single 🛒 Compra block. */
  function portionsOf(items, srcId) {
    return Object.entries(items).filter(([k, x]) => x.costFrom === srcId);
  }

  function groupCard(srcId, src, items, passFn) {
    const deps = portionsOf(items, srcId);
    const shown = deps.filter(([, x]) => passFn(x));
    const srcCost = src.packQty > 0 && src.packCost > 0 ? src.packCost / src.packQty : null;
    const grams = deps
      .map(([k, x]) => {
        const c = srcCost != null && x.costGrams > 0 ? srcCost * x.costGrams : null;
        return `<label class="kinv-f">Gramos crudos por porción · ${esc(x.name)}<input type="number" min="0" step="any" data-cg="${esc(k)}" placeholder="Ej. 240" value="${x.costGrams == null ? "" : x.costGrams}" /><small class="adm-muted">${c != null ? "Costo por porción: " + money(c) : srcCost == null ? "Falta el costo de la compra" : "Falta capturar los gramos"}</small></label>`;
      })
      .join("");
    return `<div class="kinv-pgroup"><div class="kinv-pgroup__head">${esc(src.name.replace(/\s*\(.*\)/, ""))}: ${deps.map(([, x]) => esc(x.name)).join(" · ")}</div>${shown.map(([k, x]) => row(k, x, true)).join("")}${buyBlock(srcId, src, grams)}</div>`;
  }

  function row(id, it, noBuy) {
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
        ${it.cookFrom ? `<button type="button" class="btn btn--sm" data-act="cook">${esc(it.cookLabel || "Ya cociné")}</button>` : ""}</div>
      <button type="button" class="btn btn--ghost btn--sm kinv-del" data-act="del" title="Quitar ingrediente">✕</button>
      ${it.qty == null ? "" : `<div class="kinv-ownbtn"><input type="number" min="0" step="any" data-f="own" value="${/^(g|ml)$/i.test(it.unit || "") ? 100 : 1}" title="Cantidad (${esc(it.unit || "")})" /> <span class="adm-muted">${esc(it.unit || "")}</span>
        <button type="button" class="btn btn--ghost btn--sm" data-act="own">🍽️ Consumo propio</button></div>`}
      ${noBuy ? "" : buyBlock(id, it)}
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
    const isPortion = (it) => !!(it.costFrom && items[it.costFrom]);
    const isSource = (id) => portionsOf(items, id).length > 0;
    const catCount = {};
    for (const it of Object.values(items)) if (!isPortion(it)) catCount[it.group || "Otros"] = (catCount[it.group || "Otros"] || 0) + 1;
    if (catFilter && !catCount[catFilter]) catFilter = ""; // category disappeared after a refresh
    for (const [id, it] of Object.entries(items)) {
      if (isPortion(it)) continue; // shown inside its source's card
      if (catFilter && (it.group || "Otros") !== catFilter) continue;
      const visible = isSource(id) ? pass(it) || portionsOf(items, id).some(([, x]) => pass(x)) : pass(it);
      if (visible) (groups[it.group || "Otros"] = groups[it.group || "Otros"] || []).push([id, it]);
    }
    const btn = (k, label) => `<button type="button" class="kinv-filter${filter === k ? " is-active" : ""}" data-filter="${k}">${label}</button>`;
    let html = `<div class="kinv-filters">${btn("all", "Todos (" + Object.keys(items).length + ")")}${btn("need", "🛒 Por resurtir (" + (low + out) + ")")}${btn("low", "Bajo (" + low + ")")}${btn("out", "Agotado (" + out + ")")}</div><label class="kinv-cat">Categoría <select data-cat><option value="">Todas las categorías</option>${Object.entries(catCount).map(([g, n]) => `<option value="${esc(g)}"${catFilter === g ? " selected" : ""}>${esc(g)} (${n})</option>`).join("")}</select></label><p class="kinv-sum"><strong>${Object.keys(items).length}</strong> ingredientes · <span class="${low ? "is-low" : ""}">${low} bajos</span> · <span class="${out ? "is-empty" : ""}">${out} agotados</span></p>`;
    if (!Object.keys(groups).length) html += '<p class="adm-muted">No hay ingredientes en esta vista. ✅</p>';
    for (const [g, list] of Object.entries(groups)) {
      html += `<h3 class="kinv-group">${esc(g)}</h3>` + list.map(([id, it]) => (isSource(id) ? groupCard(id, it, items, pass) : row(id, it))).join("");
    }
    root.innerHTML = html;
    openBuy.forEach((id) => loadPhoto(id));
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
    root.addEventListener(
      "toggle",
      (e) => {
        const d = e.target;
        if (!d.classList || !d.classList.contains("kinv-buy")) return;
        if (d.open) {
          openBuy.add(d.dataset.id);
          loadPhoto(d.dataset.id);
        } else openBuy.delete(d.dataset.id);
      },
      true
    );
    root.addEventListener("change", async (e) => {
      const cat = e.target.closest("select[data-cat]");
      if (cat) {
        catFilter = cat.value;
        paint();
        return;
      }
      const meta = e.target.closest("input[data-m], select[data-m]");
      if (meta) {
        const id = meta.closest(".kinv-buy").dataset.id;
        const f = meta.dataset.m;
        const val = meta.type === "number" ? (meta.value === "" ? null : Number(meta.value)) : meta.value;
        act(window.__kinvCode || code, { action: "meta", id, [f]: val });
        return;
      }
      const cg = e.target.closest("input[data-cg]");
      if (cg) {
        act(window.__kinvCode || code, { action: "meta", id: cg.dataset.cg, costGrams: cg.value === "" ? null : Number(cg.value) });
        return;
      }
      const ph = e.target.closest("input[data-photo]");
      if (ph && ph.files && ph.files[0]) {
        const id = ph.closest(".kinv-buy").dataset.id;
        try {
          const image = await resizeImage(ph.files[0]);
          photos[id] = image;
          await act(window.__kinvCode || code, { action: "photo", id, image });
        } catch {
          alert("No se pudo cargar la foto. Prueba con otra imagen.");
        }
        return;
      }
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
        const def = it.cookBatch || Math.max(1, (it.target || 6) - (it.qty || 0));
        const ans = prompt(`¿Cuántas porciones cocinaste? (hay ${raw ? raw.qty : "?"} ${raw ? raw.unit || "" : ""} sin hacer)`, String(def));
        if (ans === null) return;
        const n = Number(ans);
        if (!Number.isFinite(n) || n <= 0) return;
        act(window.__kinvCode || code, { action: "cook", id, n });
      } else if (btn.dataset.act === "own") {
        const q = Number($("input[data-f=own]", rowEl).value);
        if (!Number.isFinite(q) || q <= 0) return;
        const who = ($("#kInvOwnWho") && $("#kInvOwnWho").value) || "Mario";
        btn.disabled = true;
        KitchenStore.kitchenInventoryAction({ action: "own", kind: "consumo", who, ings: [{ id, qty: q }] }, window.__kinvCode || code)
          .then((r) => {
            ownLog = r.ownLog || ownLog;
            data = { inventory: r.inventory, autoOut: r.autoOut };
            paint();
            ownPaint();
          })
          .catch(() => {
            btn.disabled = false;
            alert("No se pudo descontar. Revisa tu conexión.");
          });
      } else if (btn.dataset.act === "photo-del") {
        const idp = btn.closest(".kinv-buy").dataset.id;
        delete photos[idp];
        act(window.__kinvCode || code, { action: "photo_delete", id: idp });
      } else if (btn.dataset.act === "del") {
        const nm = data.inventory.items[id] && data.inventory.items[id].name;
        if (confirm(`¿Quitar "${nm}" del inventario? Sus recetas dejarán de descontarlo.`)) {
          act(window.__kinvCode || code, { action: "delete", id });
        }
      }
    });
  }

  // ---- Consumo propio / merma
  let ownLines = []; // { t: "dish"|"ing", id, qty, label }
  let ownLog = [];

  function dishLabel(key) {
    if (key.startsWith("side:")) return "Complemento " + (SIDE_LABELS[key.slice(5)] || key.slice(5));
    return ITEM_LABELS[key] || (window.KITCHEN_ITEM_NAMES && window.KITCHEN_ITEM_NAMES.es && window.KITCHEN_ITEM_NAMES.es[key]) || key;
  }

  function ownFill() {
    const inv = (data && data.inventory) || {};
    const dish = $("#kInvOwnDish");
    const ing = $("#kInvOwnIng");
    if (!dish || !ing) return;
    const keep = [dish.value, ing.value];
    const keys = Object.keys(inv.recipes || {}).filter((k) => k !== "order:takeout");
    dish.innerHTML = keys
      .map((k) => [k, dishLabel(k)])
      .sort((a, b) => a[1].localeCompare(b[1], "es"))
      .map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`)
      .join("");
    ing.innerHTML = Object.entries(inv.items || {})
      .sort((a, b) => String(a[1].name).localeCompare(String(b[1].name), "es"))
      .map(([k, it]) => `<option value="${esc(k)}">${esc(it.name)} (${esc(it.unit || "")})</option>`)
      .join("");
    if (keep[0]) dish.value = keep[0];
    if (keep[1]) ing.value = keep[1];
  }

  function ownPaint() {
    const ul = $("#kInvOwnLines");
    if (ul)
      ul.innerHTML = ownLines.length
        ? ownLines.map((l, i) => `<li>${esc(l.label)} × <strong>${l.qty}</strong> <button type="button" class="btn btn--ghost btn--sm" data-own-rm="${i}">✕</button></li>`).join("")
        : '<li class="adm-muted">Agrega platillos o ingredientes.</li>';
    const lg = $("#kInvOwnLog");
    if (lg) {
      const f = (ts) => new Date(ts).toLocaleString("es-MX", { timeZone: "America/Mexico_City", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
      const names = (inv) => ((data && data.inventory && data.inventory.items) || {})[inv];
      lg.innerHTML = ownLog.length
        ? ownLog
            .map((e) => {
              const what = (e.lines || []).map((l) => `${l.t === "dish" ? dishLabel(l.id) : (names(l.id) || {}).name || l.id} ×${l.qty}`).join(", ");
              return `<div class="kinv-own-log"><span>${e.kind === "merma" ? "🗑️" : "🍽️"} <strong>${esc(e.who)}</strong> · ${esc(f(e.ts))}<br>${esc(what)}${e.note ? " · " + esc(e.note) : ""}</span><button type="button" class="btn btn--ghost btn--sm" data-own-undo="${esc(e.id)}">Deshacer</button></div>`;
            })
            .join("")
        : "Sin registros todavía.";
    }
  }

  async function ownLoad(code) {
    try {
      const r = await KitchenStore.kitchenInventoryAction({ action: "own_list" }, code);
      ownLog = r.ownLog || [];
    } catch (_) {}
    ownPaint();
  }

  let ownBound = false;
  function ownBind(code) {
    if (ownBound) return;
    const box = $("#kInvOwn");
    if (!box) return;
    ownBound = true;
    box.addEventListener("click", async (e) => {
      const c = window.__kinvCode;
      const t = e.target.closest("button");
      if (!t) return;
      const out = $("#kInvOwnOut");
      if (t.id === "kInvOwnAddDish") {
        const sel = $("#kInvOwnDish");
        const q = Math.max(1, parseInt($("#kInvOwnDishQty").value, 10) || 1);
        if (sel.value) ownLines.push({ t: "dish", id: sel.value, qty: q, label: dishLabel(sel.value) });
        ownPaint();
      } else if (t.id === "kInvOwnAddIng") {
        const sel = $("#kInvOwnIng");
        const q = Number($("#kInvOwnIngQty").value);
        if (sel.value && q > 0) ownLines.push({ t: "ing", id: sel.value, qty: q, label: sel.options[sel.selectedIndex].text });
        ownPaint();
      } else if (t.dataset.ownRm != null) {
        ownLines.splice(Number(t.dataset.ownRm), 1);
        ownPaint();
      } else if (t.id === "kInvOwnApply") {
        if (!ownLines.length) return;
        t.disabled = true;
        try {
          const r = await KitchenStore.kitchenInventoryAction(
            {
              action: "own",
              kind: $("#kInvOwnKind").value,
              who: $("#kInvOwnWho").value,
              note: $("#kInvOwnNote").value,
              dishes: ownLines.filter((l) => l.t === "dish").map((l) => ({ id: l.id, qty: l.qty })),
              ings: ownLines.filter((l) => l.t === "ing").map((l) => ({ id: l.id, qty: l.qty })),
            },
            c
          );
          ownLog = r.ownLog || ownLog;
          data = { inventory: r.inventory, autoOut: r.autoOut };
          ownLines = [];
          $("#kInvOwnNote").value = "";
          if (out) out.innerHTML = '<p><strong>Descontado del inventario.</strong></p>';
          paint();
          ownPaint();
        } catch (err) {
          if (out) out.innerHTML = `<p class="kinv-warn">No se pudo: ${esc(err && err.message ? err.message : err)}</p>`;
        } finally {
          t.disabled = false;
        }
      } else if (t.dataset.ownUndo) {
        try {
          const r = await KitchenStore.kitchenInventoryAction({ action: "own_undo", id: t.dataset.ownUndo }, c);
          ownLog = r.ownLog || [];
          data = { inventory: r.inventory, autoOut: r.autoOut };
          paint();
          ownPaint();
        } catch (_) {}
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
      ownBind(code);
      ownFill();
      ownLoad(code);
    },
    /** Purchase ticket: review (dry run) or apply the pasted lines. */
    async receive(code, apply) {
      const ta = $("#kInvRecvText");
      const out = $("#kInvRecvOut");
      if (!ta || !out) return;
      const text = ta.value.trim();
      if (!text) {
        out.innerHTML = '<p class="adm-muted">Pega primero las líneas de la compra.</p>';
        return;
      }
      out.innerHTML = '<p class="adm-muted">Revisando…</p>';
      try {
        const r = await KitchenStore.kitchenInventoryAction({ action: "receive", text, dry: !apply }, code);
        const label = { ok: "✅", no_match: "❓ No encontré ese # de artículo", no_pack: "⚠️ Falta la cantidad por presentación", not_tracked: "ℹ️ No controla existencia (solo se actualizó el costo)", unreadable: "⚠️ No pude leer la línea" };
        const rows = (r.report || [])
          .map((x) =>
            x.status === "ok"
              ? `<li>✅ <strong>${esc(x.name)}</strong>: ${x.before} → <strong>${x.after}</strong> ${esc(x.unit || "")} (+${x.add}${x.price ? `, $${x.price} c/u` : ""})</li>`
              : `<li>${label[x.status] || x.status}: <code>${esc(x.line)}</code>${x.name ? " · " + esc(x.name) : ""}</li>`
          )
          .join("");
        out.innerHTML = `<ul class="kinv-recv-list">${rows}</ul>` + (apply ? '<p><strong>Compra aplicada al inventario.</strong></p>' : '<p class="adm-muted">Así quedaría. Si está bien, toca "Aplicar compra".</p>');
        if (apply && r.inventory) {
          data = { inventory: r.inventory, autoOut: r.autoOut };
          paint();
          ta.value = "";
        }
      } catch (e) {
        out.innerHTML = `<p class="kinv-warn">No se pudo: ${esc(e && e.message ? e.message : e)}</p>`;
      }
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
