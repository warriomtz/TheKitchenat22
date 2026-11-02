/**
 * Deportes — calendario de eventos deportivos del mes (NFL, NBA, F1, Liga MX, béisbol).
 * Todos los horarios están en hora de Guadalajara (UTC-6, sin horario de verano).
 * Para actualizar o agregar eventos, edita la lista EVENTS de abajo.
 *   d      fecha "AAAA-MM-DD"            to     (opcional) último día si dura varios días
 *   t      hora "HH:MM" en 24 h o null    s      nfl | nba | f1 | mx | mlb
 *   approx true = hora convertida de otra zona o sin confirmar al 100 %
 */
(function () {
  "use strict";

  const MONTH = { y: 2026, m: 11 };

  const SPORTS = {
    nfl: { label: "NFL", icon: "🏈" },
    nba: { label: "NBA", icon: "🏀" },
    f1: { label: "F1", icon: "🏎" },
    mx: { label: "Liga MX", icon: "⚽" },
    mlb: { label: "Béisbol", icon: "⚾" },
  };

  const EVENTS = [
    /* —— NFL —— */
    { d: "2026-11-02", s: "nfl", title: "Bears @ Seahawks", note: "Lunes por la noche · hora por confirmar" },
    { d: "2026-11-05", s: "nfl", title: "Jaguars @ Ravens", note: "Jueves por la noche" },
    { d: "2026-11-08", t: "08:30", s: "nfl", title: "Bengals @ Falcons", where: "Madrid", approx: true },
    { d: "2026-11-08", t: "15:25", s: "nfl", title: "Packers @ Patriots", approx: true },
    { d: "2026-11-08", t: "19:20", s: "nfl", title: "Buccaneers @ Bears", note: "Sunday Night · NBC", approx: true },
    { d: "2026-11-09", t: "19:15", s: "nfl", title: "Bills @ Vikings", note: "Monday Night · ESPN", approx: true },
    { d: "2026-11-12", s: "nfl", title: "Commanders @ Giants", note: "Jueves por la noche · Amazon" },
    { d: "2026-11-15", t: "08:30", s: "nfl", title: "Patriots vs Lions", where: "Múnich", approx: true },
    { d: "2026-11-16", s: "nfl", title: "Chargers @ Ravens", note: "Lunes por la noche" },
    { d: "2026-11-19", s: "nfl", title: "Colts @ Texans", note: "Jueves por la noche" },
    { d: "2026-11-22", t: "19:20", s: "nfl", title: "Vikings vs 49ers", where: "Estadio Banorte, CDMX", note: "Sunday Night · NBC / Telemundo" },
    { d: "2026-11-25", t: "19:00", s: "nfl", title: "Packers @ Rams", note: "Víspera de Thanksgiving · Netflix", approx: true },
    { d: "2026-11-26", t: "12:00", s: "nfl", title: "Bears @ Lions", note: "Thanksgiving · CBS", approx: true },
    { d: "2026-11-26", t: "19:20", s: "nfl", title: "Chiefs @ Bills", note: "Thanksgiving noche · NBC", approx: true },
    { d: "2026-11-27", s: "nfl", title: "Juego de Black Friday", where: "Pittsburgh", note: "Amazon" },
    { d: "2026-11-29", s: "nfl", title: "Domingo de 10 juegos", note: "Semana 12" },
    { d: "2026-11-30", s: "nfl", title: "Panthers @ Buccaneers", note: "Monday Night · ESPN" },

    /* —— NBA —— */
    { d: "2026-11-02", s: "nba", title: "Juegan los 30 equipos", note: "El martes 3 (elecciones) no hay partidos" },
    { d: "2026-11-06", s: "nba", title: "NBA Cup · fase de grupos", note: "Trae Young regresa a Atlanta" },
    { d: "2026-11-07", t: "20:00", s: "nba", title: "Nuggets vs Pacers", where: "Arena CDMX", note: "ESPN · la NBA aún no anuncia hora (suelen ser 8–8:30 pm)", approx: true },
    { d: "2026-11-13", s: "nba", title: "NBA Cup · fase de grupos" },
    { d: "2026-11-20", s: "nba", title: "NBA Cup · fase de grupos" },
    { d: "2026-11-24", s: "nba", title: "NBA Cup · Cup Night" },
    { d: "2026-11-25", s: "nba", title: "NBA Cup · Cup Night" },
    { d: "2026-11-27", s: "nba", title: "NBA Cup · cierra fase de grupos" },

    /* —— F1 —— */
    { d: "2026-11-06", to: "2026-11-08", s: "f1", title: "GP de Brasil (fin de semana)", where: "Interlagos" },
    { d: "2026-11-08", t: "11:00", s: "f1", title: "Carrera · GP de Brasil", where: "São Paulo" },
    { d: "2026-11-19", to: "2026-11-21", s: "f1", title: "GP de Las Vegas (fin de semana)" },
    { d: "2026-11-21", t: "22:00", s: "f1", title: "Carrera · GP de Las Vegas", note: "Carrera nocturna, sábado" },
    { d: "2026-11-27", to: "2026-11-29", s: "f1", title: "GP de Qatar (fin de semana)", where: "Lusail" },
    { d: "2026-11-29", t: "10:00", s: "f1", title: "Carrera · GP de Qatar", where: "Lusail" },

    /* —— Liga MX (Apertura 2026) —— */
    { d: "2026-11-07", t: "18:00", s: "mx", title: "Tigres vs Cruz Azul", note: "Jornada 16" },
    { d: "2026-11-07", t: "21:00", s: "mx", title: "Pumas vs América", note: "Jornada 16" },
    { d: "2026-11-07", s: "mx", title: "Atlas vs Pachuca", where: "Estadio Jalisco", note: "Jornada 16 · hora por confirmar" },
    { d: "2026-11-09", to: "2026-11-17", s: "mx", title: "Pausa por Fecha FIFA" },
    { d: "2026-11-20", to: "2026-11-22", s: "mx", title: "Jornada 17 (última de la fase regular)" },
    { d: "2026-11-21", t: "22:00", s: "mx", title: "Tigres vs América", note: "Jornada 17" },
    { d: "2026-11-22", t: "18:07", s: "mx", title: "Chivas vs Cruz Azul", note: "Jornada 17" },
    { d: "2026-11-25", to: "2026-11-26", s: "mx", title: "Liguilla · cuartos de final (ida)" },
    { d: "2026-11-28", to: "2026-11-29", s: "mx", title: "Liguilla · cuartos de final (vuelta)" },

    /* —— Béisbol —— */
    { d: "2026-11-01", s: "mlb", title: "MLB terminó: Brewers campeones", note: "Sin juegos de MLB en noviembre" },
    { d: "2026-11-22", s: "mlb", title: "Cierra la primera vuelta de la LMP", note: "Liga Mexicana del Pacífico · Charros de Jalisco, bicampeones" },
  ];

  /* —— Después de noviembre (para ir planeando) —— */
  const NEXT = [
    "2 · 3 · 5 · 6 dic — Liguilla: semifinales",
    "4 · 5 dic — NBA Cup: cuartos de final",
    "9 dic — Toluca debuta en la Copa Intercontinental (Qatar)",
    "24 dic — posible final del Apertura 2026 si Toluca avanza",
  ];

  const DOW = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const DOW_LONG = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const MONTH_NAME = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

  const ui = { view: "month", filter: new Set(Object.keys(SPORTS)), sel: "", bound: false };

  const pad2 = (n) => String(n).padStart(2, "0");
  const keyOf = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;
  const parse = (k) => {
    const [y, m, d] = k.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  function todayKey() {
    const n = new Date();
    return keyOf(n.getFullYear(), n.getMonth() + 1, n.getDate());
  }

  function fmtTime(t) {
    if (!t) return "";
    const [h, m] = t.split(":").map(Number);
    const ap = h >= 12 ? "pm" : "am";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${pad2(m)} ${ap}`;
  }

  /* Expande eventos de varios días a un evento por día. */
  function expand() {
    const by = {};
    EVENTS.forEach((ev) => {
      if (!ev.to) {
        (by[ev.d] = by[ev.d] || []).push({ ...ev, span: 0, spanOf: 1 });
        return;
      }
      const a = parse(ev.d);
      const b = parse(ev.to);
      const n = Math.round((b - a) / 86400000) + 1;
      for (let i = 0; i < n; i++) {
        const dt = new Date(a.getFullYear(), a.getMonth(), a.getDate() + i);
        const k = keyOf(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
        (by[k] = by[k] || []).push({ ...ev, span: i, spanOf: n });
      }
    });
    Object.values(by).forEach((list) =>
      list.sort((x, y) => {
        // con hora primero y en orden; sin hora después
        if (x.t && y.t) return x.t.localeCompare(y.t);
        if (x.t) return -1;
        if (y.t) return 1;
        return 0;
      })
    );
    return by;
  }

  function visible(list) {
    return (list || []).filter((e) => ui.filter.has(e.s));
  }

  function evLine(e, opts) {
    const sp = SPORTS[e.s];
    const time = e.t ? `${fmtTime(e.t)}${e.approx ? " ≈" : ""}` : "sin hora";
    const multi = e.spanOf > 1 ? ` <span class="sp-ev__multi">día ${e.span + 1} de ${e.spanOf}</span>` : "";
    const meta = [e.where, e.note].filter(Boolean).map(esc).join(" · ");
    return `<li class="sp-ev sp-ev--${e.s}">
      <span class="sp-ev__time">${esc(time)}</span>
      <span class="sp-ev__body">
        <strong>${sp.icon} ${esc(e.title)}</strong>${multi}
        ${meta ? `<small>${meta}</small>` : ""}
      </span>
      ${opts && opts.tag ? `<span class="sp-tag sp-tag--${e.s}">${esc(sp.label)}</span>` : ""}
    </li>`;
  }

  function renderFilters() {
    const all = Object.keys(SPORTS).every((k) => ui.filter.has(k));
    const chips = Object.entries(SPORTS)
      .map(
        ([k, v]) =>
          `<button type="button" class="sp-chip sp-chip--${k}${ui.filter.has(k) ? " is-on" : ""}" data-sp="${k}">${v.icon} ${esc(v.label)}</button>`
      )
      .join("");
    return `<div class="sp-controls">
      <div class="sp-chips">
        <button type="button" class="sp-chip${all ? " is-on" : ""}" data-sp="all">Todos</button>${chips}
      </div>
      <div class="sp-views">
        <button type="button" class="sp-chip${ui.view === "month" ? " is-on" : ""}" data-view="month">Calendario</button>
        <button type="button" class="sp-chip${ui.view === "agenda" ? " is-on" : ""}" data-view="agenda">Agenda</button>
      </div>
    </div>`;
  }

  function renderMonth(by, today) {
    const first = new Date(MONTH.y, MONTH.m - 1, 1);
    const daysIn = new Date(MONTH.y, MONTH.m, 0).getDate();
    const lead = (first.getDay() + 6) % 7; // semana empieza en lunes
    const heads = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => `<div class="sp-dow">${d}</div>`).join("");
    let cells = "";
    for (let i = 0; i < lead; i++) cells += `<div class="sp-day sp-day--off"></div>`;
    for (let d = 1; d <= daysIn; d++) {
      const k = keyOf(MONTH.y, MONTH.m, d);
      const evs = visible(by[k]);
      const chips = evs
        .slice(0, 3)
        .map((e) => `<span class="sp-mini sp-mini--${e.s}" title="${esc(e.title)}">${esc(e.title)}</span>`)
        .join("");
      const dots = evs.map((e) => `<i class="sp-dot sp-dot--${e.s}"></i>`).join("");
      const more = evs.length > 3 ? `<span class="sp-more">+${evs.length - 3}</span>` : "";
      const cls = ["sp-day", k === today ? "is-today" : "", k === ui.sel ? "is-sel" : "", evs.length ? "has-ev" : ""].filter(Boolean).join(" ");
      cells += `<button type="button" class="${cls}" data-day="${k}">
        <span class="sp-day__n">${d}</span>
        <span class="sp-day__chips">${chips}${more}</span>
        <span class="sp-day__dots">${dots}</span>
      </button>`;
    }
    const sel = ui.sel || (by[today] ? today : "");
    return `<div class="sp-grid">${heads}${cells}</div>${renderDetail(by, sel)}`;
  }

  function renderDetail(by, k) {
    if (!k) return `<p class="admin-empty sp-hint">Toca un día para ver sus eventos.</p>`;
    const dt = parse(k);
    const title = `${DOW_LONG[dt.getDay()]} ${dt.getDate()} de ${MONTH_NAME[dt.getMonth()]}`;
    const evs = visible(by[k]);
    return `<div class="adm-card sp-detail">
      <h3 class="report-apt-title">${esc(title)}</h3>
      ${evs.length ? `<ul class="sp-list">${evs.map((e) => evLine(e, { tag: true })).join("")}</ul>` : `<p class="admin-empty">Sin eventos con estos filtros.</p>`}
    </div>`;
  }

  function renderAgenda(by, today) {
    const days = Object.keys(by).filter((k) => visible(by[k]).length).sort();
    if (!days.length) return `<p class="admin-empty">Sin eventos con estos filtros.</p>`;
    return days
      .map((k) => {
        const dt = parse(k);
        const past = k < today;
        return `<div class="adm-card sp-agenda-day${k === today ? " is-today" : ""}${past ? " is-past" : ""}">
          <h3 class="report-apt-title">${DOW[dt.getDay()]} ${dt.getDate()} de ${MONTH_NAME[dt.getMonth()]}${k === today ? " · hoy" : ""}</h3>
          <ul class="sp-list">${visible(by[k]).map((e) => evLine(e, { tag: true })).join("")}</ul>
        </div>`;
      })
      .join("");
  }

  function render() {
    const root = document.getElementById("sportsRoot");
    if (!root) return;
    const by = expand();
    const today = todayKey();
    const body = ui.view === "agenda" ? renderAgenda(by, today) : renderMonth(by, today);
    root.innerHTML = `${renderFilters()}${body}
      <p class="sp-foot">Horarios en hora de Guadalajara. «≈» = hora convertida desde otra zona o por confirmar; revisa antes de apartar el salón o la cocina.</p>
      <div class="adm-card sp-next"><h3 class="report-apt-title">Lo que sigue en diciembre</h3><ul class="sp-nextlist">${NEXT.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>`;
    bind(root);
  }

  function bind(root) {
    root.querySelectorAll("[data-sp]").forEach((b) =>
      b.addEventListener("click", () => {
        const k = b.dataset.sp;
        const keys = Object.keys(SPORTS);
        if (k === "all") {
          ui.filter = new Set(keys);
        } else if (keys.every((x) => ui.filter.has(x))) {
          ui.filter = new Set([k]); // desde "todos", un toque deja solo ese deporte
        } else if (ui.filter.has(k)) {
          ui.filter.delete(k);
          if (!ui.filter.size) ui.filter = new Set(keys);
        } else {
          ui.filter.add(k);
        }
        render();
      })
    );
    root.querySelectorAll("[data-view]").forEach((b) =>
      b.addEventListener("click", () => {
        ui.view = b.dataset.view;
        render();
      })
    );
    root.querySelectorAll("[data-day]").forEach((b) =>
      b.addEventListener("click", () => {
        ui.sel = b.dataset.day;
        render();
        document.querySelector(".sp-detail")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      })
    );
  }

  window.SportsCal = { render, events: EVENTS };
})();
