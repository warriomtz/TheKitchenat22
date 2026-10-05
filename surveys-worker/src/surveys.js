// ─── Survey registry ─────────────────────────────────────────────────────────
// To add a new survey: add an entry here, deploy, and POST to /api/surveys/<id>.
// field types: "text" (max chars) · "choice" (one of options) · "multi" (several of options)
// `label` is the CSV column name.
export const SURVEYS = {
  "menu-2026-10": {
    title: "Menú, delivery y room service (oct 2026)",
    fields: [
      { key: "menu",        type: "text", max: 600, label: "que_ver_en_el_menu" },
      { key: "delivery",    type: "text", max: 600, label: "tipo_comida_delivery" },
      { key: "roomservice", type: "text", max: 600, label: "que_hacer_para_room_service" },
      { key: "improve",     type: "choice", label: "mejora",
        options: ["speed", "flavor", "portions", "temp", "packaging", "variety", "price", "service", "nothing"] },
      { key: "improveText", type: "text", max: 300, label: "mejora_detalle" },
    ],
  },
};
