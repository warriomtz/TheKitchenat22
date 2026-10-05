// ─── Survey registry ─────────────────────────────────────────────────────────
// To add a new survey: add an entry here, deploy, and POST to /api/surveys/<id>.
// field types: "text" (max chars) · "choice" (one of options) · "multi" (several of options)
// `label` is the CSV column name. `q` / `names` are the Spanish texts shown in the admin dashboard.
export const SURVEYS = {
  "menu-2026-10": {
    title: "Menú, delivery y room service (oct 2026)",
    fields: [
      { key: "menu",        type: "text", max: 600, label: "que_ver_en_el_menu", q: "¿Qué te gustaría ver en el menú?" },
      { key: "delivery",    type: "text", max: 600, label: "tipo_comida_delivery", q: "¿Qué pides más por delivery?" },
      { key: "roomservice", type: "text", max: 600, label: "que_hacer_para_room_service", q: "¿Qué hacer para que pidan room service con nosotros?" },
      { key: "improve",     type: "choice", label: "mejora", q: "Una cosa a mejorar",
        names: { speed: "Rapidez", flavor: "Sabor", portions: "Porciones", temp: "Temperatura", packaging: "Empaque", variety: "Variedad", price: "Precio", service: "Servicio", nothing: "Nada, todo bien" },
        options: ["speed", "flavor", "portions", "temp", "packaging", "variety", "price", "service", "nothing"] },
      { key: "improveText", type: "text", max: 300, label: "mejora_detalle", q: "Detalle de la mejora" },
    ],
  },
};
