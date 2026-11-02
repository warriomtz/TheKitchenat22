// Tower test against a running `wrangler dev` (default http://127.0.0.1:8787)
const BASE = process.env.API || "http://127.0.0.1:8787";
const CODE = process.env.ADMIN_CODE || "test-admin-code-123456";
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const call = async (method, path, body, code) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.11", ...(code ? { "X-Admin-Code": code } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch {}
  return [r.status, j];
};
let [s, j] = await call("GET", "/api/tower"); ok(s === 401, "tower read blocked without code");
[s] = await call("POST", "/api/tower", { action: "set_name", apt: "3108", name: "X" }); ok(s === 401, "tower write blocked without code");
[s, j] = await call("GET", "/api/tower", null, CODE); ok(s === 200 && j.tower && Object.keys(j.tower.apts).length === 0, "empty at start");
[s, j] = await call("POST", "/api/tower", { action: "set_name", apt: "3108", name: "  María   López " }, CODE);
ok(s === 200 && j.tower.apts["3108"].name === "María López", "set name (trimmed)");
[s, j] = await call("POST", "/api/tower", { action: "add_visit", apt: "3108" }, CODE);
ok(s === 200 && j.tower.apts["3108"].visits.length === 1, "add visit");
[s, j] = await call("POST", "/api/tower", { action: "add_visit", apt: "31-08", count: 3, at: "2026-10-20T18:00:00.000Z" }, CODE);
ok(s === 200 && j.tower.apts["3108"].visits.length === 4 && j.tower.apts["3108"].visits[0].startsWith("2026-10-20"), "add 3 backdated visits (apt normalized)");
[s, j] = await call("POST", "/api/tower", { action: "remove_visit", apt: "3108" }, CODE);
ok(s === 200 && j.tower.apts["3108"].visits.length === 3 && j.tower.apts["3108"].visits.every((v) => v.startsWith("2026-10-20")), "remove_visit removes the most recent");
[s] = await call("POST", "/api/tower", { action: "add_visit", apt: "3313" }, CODE); ok(s === 400, "apartment 13 rejected");
[s] = await call("POST", "/api/tower", { action: "add_visit", apt: "2108" }, CODE); ok(s === 400, "floor outside tower rejected");
[s] = await call("POST", "/api/tower", { action: "add_visit", apt: "3108", at: "2999-01-01" }, CODE); ok(s === 400, "future date rejected");
[s] = await call("POST", "/api/tower", { action: "nope", apt: "3108" }, CODE); ok(s === 400, "bad action rejected");
[s, j] = await call("GET", "/api/tower", null, CODE); ok(j.tower.apts["3108"].name === "María López" && j.tower.apts["3108"].visits.length === 3, "persisted");
await call("POST", "/api/tower", { action: "set_name", apt: "3108", name: "" }, CODE);
await call("POST", "/api/tower", { action: "remove_visit", apt: "3108" }, CODE);
await call("POST", "/api/tower", { action: "remove_visit", apt: "3108" }, CODE);
[s, j] = await call("POST", "/api/tower", { action: "remove_visit", apt: "3108" }, CODE);
ok(s === 200 && !j.tower.apts["3108"], "empty record is dropped");
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
