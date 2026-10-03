/**
 * Copy to config.js. The site talks to the Cloudflare Worker in /worker.
 * No secrets belong in this file: the admin code and the ntfy topic are
 * Worker secrets (see worker/README.md).
 */
window.KITCHEN_CONFIG = {
  jsonbin: { binId: "", masterKey: "" }, // legacy, leave empty
  ntfy: { server: "https://ntfy.sh", topic: "" }, // legacy, alerts are sent by the Worker
  // URL printed by `wrangler deploy`, e.g. "https://kitchen22-api.example.workers.dev"
  apiBase: "",
};
