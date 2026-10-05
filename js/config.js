// Public configuration. No secrets here: the admin code and the kitchen alert
// topic are stored as secrets in the Cloudflare Worker (see worker/README.md).
window.KITCHEN_CONFIG = {
  jsonbin: { binId: "", masterKey: "" }, // legacy, unused
  ntfy: { server: "https://ntfy.sh", topic: "" }, // legacy, alerts are sent by the Worker
  apiBase: "https://kitchen22-api.mariodiaz25.workers.dev",
  // Customer surveys Worker (surveys-worker/). Admin tab "Encuestas" reads it with the admin code.
  surveysApi: "https://kitchen22-surveys.mariodiaz25.workers.dev",
};
