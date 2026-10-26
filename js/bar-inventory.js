/**
 * Bar inventory — bottled / canned drinks only (no prep food).
 * Same model as the kitchen inventory: the SERVER keeps the stock and deducts every order when it arrives
 * (and gives it back when an order is discarded). This file only shows it and sends counts.
 */
(function () {
  "use strict";

  let adminCode = "";
  let view = null; // { day, groups }
  let busy = false;
  let err = "";

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function panelVisible() {
    const root = document.getElementById("barInvRoot");
    return !!root && !root.closest(".admin-panel")?.hidden;
  }

  function editing() {
    const a = document.activeElement;
    return !!(a && a.closest && a.closest("#barInvRoot") && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
  }

  async function load(code) {
    adminCode = code || adminCode || "";
    const data = await KitchenStore.barInventoryView(adminCode);
    view = data.bar || null;
    return view;
  }

  function paint() {
    const root = document.getElementById("barInvRoot");
    if (!root) return;
    if (!view) {
      root.innerHTML = '<p class="adm-muted">No se pudo cargar el inventario de barra.</p>';
      return;
    }
    const all = view.groups.flatMap((g) => g.rows);
    const tracked = all.filter((r) => r.tracked);
    const lowN = tracked.filter((r) => r.low && !r.empty).length;
    const emptyN = tracked.filter((r) => r.empty).length;
    const summary = `<div class="bar-inv-summary">
      <span>Hoy <strong>${escapeHtml(view.day)}</strong></span>
      <span>Con conteo <strong>${tracked.length}</strong></span>
      <span class="${lowN ? "is-low" : ""}">≤20% <strong>${lowN}</strong></span>
      <span class="${emptyN ? "is-empty" : ""}">Agotados <strong>${emptyN}</strong></span>
    </div>
    <p class="adm-muted">Cada pedido descuenta aquí al entrar y se devuelve si lo descartas. Lo que escribes es lo que hay ahora; deja vacío lo que no controlas.</p>`;

    root.innerHTML =
      (err ? `<p class="kinv-warn">${escapeHtml(err)}</p>` : "") +
      summary +
      view.groups
        .map((g) => {
          const body = g.rows
            .map((r) => {
              const bottle = !!r.perBot;
              const pctLabel = r.tracked && r.pct != null ? `${Math.round(r.pct * 100)}%` : "—";
              const barW = r.tracked && r.pct != null ? Math.round(Math.max(0, Math.min(100, r.pct * 100))) : 0;
              const cls = r.empty ? "is-empty" : r.low ? "is-low" : r.tracked ? "" : "is-off";
              const leftLabel = !r.tracked ? "—" : bottle ? `${r.qty.toFixed(1)} serv · ${r.leftFull} bot + ${r.leftOpenPct}%` : `${r.qty} ${g.unit}`;
              const extra = bottle ? `<div class="bar-inv-row__note">${r.perBot.toFixed(1)} servicios / botella (${r.pourOz} oz)</div>` : "";
              const inputs = bottle
                ? `<label class="bar-inv-row__start"><span>Botellas 750ml</span>
                    <input type="number" min="0" step="1" value="${r.tracked ? r.bottles : ""}" placeholder="—" data-bar-bottles="${escapeHtml(r.id)}" /></label>
                   <label class="bar-inv-row__start"><span>% botella abierta</span>
                    <input type="number" min="0" max="100" step="1" value="${r.tracked ? r.openPct : ""}" placeholder="100" data-bar-openpct="${escapeHtml(r.id)}" /></label>`
                : `<label class="bar-inv-row__start"><span>Existencia</span>
                    <input type="number" min="0" step="1" value="${r.tracked ? r.qty : ""}" placeholder="—" data-bar-qty="${escapeHtml(r.id)}" /></label>`;
              return `<div class="bar-inv-row ${cls}${bottle ? " is-bottle" : ""}" data-sku="${escapeHtml(r.id)}">
                <div class="bar-inv-row__name">${escapeHtml(r.name)}${r.empty ? ` <span class="bar-inv-oos">Agotado</span>` : ""}${extra}</div>
                ${inputs}
                ${r.tracked ? `<div class="kinv-ownbtn"><input type="number" min="0" step="any" value="1" data-bar-ownq="${escapeHtml(r.id)}" title="Cantidad (${bottle ? "servicios" : escapeHtml(g.unit)})" /> <span class="adm-muted">${bottle ? "serv" : escapeHtml(g.unit)}</span>
                  <button type="button" class="btn btn--ghost btn--sm" data-bar-own="${escapeHtml(r.id)}">🍽️ Consumo propio</button></div>` : ""}
                <div class="bar-inv-row__stat">Vend. <strong>${r.sold}</strong></div>
                <div class="bar-inv-row__stat">Quedan <strong>${escapeHtml(leftLabel)}</strong></div>
                <div class="bar-inv-row__bar" title="${pctLabel}">
                  <div class="bar-inv-row__fill" style="width:${barW}%"></div>
                  <span>${pctLabel}</span>
                </div>
              </div>`;
            })
            .join("");
          return `<section class="bar-inv-group">
            <h3>${escapeHtml(g.label)}</h3>
            ${g.note ? `<p class="bar-inv-group__note">${escapeHtml(g.note)}</p>` : ""}
            ${body}
          </section>`;
        })
        .join("");

    const send = async (payload) => {
      if (busy) return;
      busy = true;
      try {
        const r = await KitchenStore.barInventoryAction({ action: "set", ...payload }, adminCode);
        if (r && r.bar) view = r.bar;
        err = "";
      } catch (_) {
        err = "No se pudo guardar el conteo. Revisa tu conexión e inténtalo de nuevo.";
      } finally {
        busy = false;
      }
      paint();
    };
    root.querySelectorAll("[data-bar-own]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (busy) return;
        const id = btn.dataset.barOwn;
        const q = Number(root.querySelector(`[data-bar-ownq="${id}"]`).value);
        if (!Number.isFinite(q) || q <= 0) return;
        const who = (document.getElementById("kInvOwnWho") || {}).value || "Mario";
        busy = true;
        try {
          const r = await KitchenStore.barInventoryAction({ action: "own", id, qty: q, who, kind: "consumo" }, adminCode);
          if (r && r.bar) view = r.bar;
          err = "";
        } catch (_) {
          err = "No se pudo descontar. Revisa tu conexión e inténtalo de nuevo.";
        } finally {
          busy = false;
        }
        paint();
      });
    });
    root.querySelectorAll("[data-bar-qty]").forEach((input) => {
      input.addEventListener("change", () => {
        const v = input.value.trim();
        send({ id: input.dataset.barQty, qty: v === "" ? null : Math.max(0, parseFloat(v) || 0) });
      });
    });
    root.querySelectorAll("[data-bar-bottles]").forEach((input) => {
      input.addEventListener("change", () => {
        const v = input.value.trim();
        if (v === "") return send({ id: input.dataset.barBottles, qty: null });
        send({ id: input.dataset.barBottles, bottles: Math.max(0, parseFloat(v) || 0) });
      });
    });
    root.querySelectorAll("[data-bar-openpct]").forEach((input) => {
      input.addEventListener("change", () => {
        const v = input.value.trim();
        send({ id: input.dataset.barOpenpct, openPct: v === "" ? 100 : Math.max(0, Math.min(100, parseFloat(v) || 0)) });
      });
    });
  }

  async function refresh() {
    if (editing()) return;
    try {
      await load();
    } catch (_) {
      if (!view) view = null;
    }
    paint();
  }

  window.BarInventory = {
    /** Repaint from the server (the orders argument is no longer needed; kept for older callers). */
    async render() {
      const root = document.getElementById("barInvRoot");
      if (root && !view) root.innerHTML = '<p class="adm-muted">Cargando…</p>';
      try {
        await load();
      } catch (_) {
        view = null;
      }
      paint();
    },
    /** Called after every orders poll: refresh the bar tab if it is open and not being edited. */
    tick() {
      if (panelVisible()) refresh();
    },
    refresh,
    async hydrate(code) {
      adminCode = code || adminCode || "";
      try {
        await load(adminCode);
      } catch (_) {}
      return view;
    },
    copyYesterdayStarts() {
      return false; // stock now carries over by itself
    },
    pingLows() {
      return 0;
    },
    load() {
      return view || {};
    },
  };
})();
