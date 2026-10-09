// Smoke test against a running `wrangler dev` (default http://127.0.0.1:8787)
const BASE = process.env.API || "http://127.0.0.1:8787";
const CODE = process.env.ADMIN_CODE || "test-admin-code-123456";
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const call = async (method, path, body, code) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.9", ...(code ? { "X-Admin-Code": code } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch {}
  return [r.status, j];
};

// public reads
let [s, j] = await call("GET", "/api/health"); ok(s === 200, "health");
[s] = await call("GET", "/api/menu"); ok(s === 404, "menu 404 before import");
[s, j] = await call("GET", "/api/hours"); ok(s === 200 && j.open === "14:00", "default hours");

// admin protection
[s] = await call("GET", "/api/orders"); ok(s === 401, "orders blocked without code");
[s] = await call("GET", "/api/orders?code=wrong"); ok(s === 401, "orders blocked wrong code");
[s] = await call("GET", "/api/analytics"); ok(s === 401, "analytics blocked");
[s] = await call("POST", "/api/stock", { outOfStock: ["x"] }); ok(s === 401, "stock write blocked");
[s] = await call("POST", "/api/admin/login", {}, CODE); ok(s === 200, "login ok");

// import
const doc = {
  menu: { food: { subcategories: { main: { items: [
    { id: "f-tacos", name: "Tacos", price: 100 },
    { id: "f-burger", name: "Burger", price: 150 } ] } } } },
  menuOps: { "f-tacos": { isHidden: true, isWeeklySpecial: false, weeklyQty: 0 }, "f-burger": { weeklyQty: 7 } },
  stock: { outOfStock: ["f-burger"] },
  hours: { open: "13:00" },
  orders: [{ id: "old2", createdAt: "2026-09-02T20:00:00Z", status: "open", orderType: "dinein", items: [{ name: "B", qty: 1 }] },
           { id: "old1", createdAt: "2026-09-01T20:00:00Z", status: "completed", orderType: "dinein", items: [{ name: "A", qty: 1 }] }],
  barInventory: { gin: 3 },
};
[s, j] = await call("POST", "/api/admin/import", { data: doc }, CODE); ok(s === 200 && j.imported.orders === 2, "import");
[s] = await call("POST", "/api/admin/import", { data: doc }, CODE); ok(s === 409, "second import refused");
[s, j] = await call("GET", "/api/menu"); 
const items = j.menu.food.subcategories.main.items;
ok(s === 200 && items[0].isHidden === true && items[1].weeklyQty === 7, "menuOps applied on import");
[s, j] = await call("GET", "/api/stock"); ok(j.outOfStock[0] === "f-burger", "stock imported");
[s, j] = await call("GET", "/api/hours"); ok(j.open === "13:00" && j.close === "21:00", "hours normalized");
[s, j] = await call("GET", "/api/bar-inventory", null, CODE); ok(j.inventory.gin === 3, "bar inventory");
[s, j] = await call("GET", "/api/orders", null, CODE); ok(j.orders.length === 2 && j.orders[0].id === "old2", "orders keep newest-first");

// public order create
[s, j] = await call("POST", "/api/orders", { orderType: "apartment", items: [{ name: "Tacos", qty: 2 }] });
ok(s === 400 && j.error === "apartment_required", "apartment validation");
[s, j] = await call("POST", "/api/orders", { orderType: "apartment", apartment: "2417", items: [{ name: "Tacos", qty: 2, customizations: "sin cebolla" }] });
ok(s === 200 && j.order.id && j.order.status === "open", "create order (public)");
const oid = j.order.id;
[s, j] = await call("GET", "/api/orders", null, CODE); ok(j.orders[0].id === oid && j.orders.length === 3, "new order first");

// status / items / delete
[s, j] = await call("POST", "/api/orders", { action: "update", orderId: oid, status: "completed" }, CODE); ok(s === 200 && j.order.status === "completed", "status update");
[s] = await call("POST", "/api/orders", { action: "update", orderId: oid, status: "bogus" }, CODE); ok(s === 400, "bad status rejected");
[s, j] = await call("POST", "/api/orders", { action: "items", orderId: oid, items: [{ name: "Burger", qty: 1 }] }, CODE); ok(s === 200 && j.order.items[0].name === "Burger" && j.order.editedAt, "edit items");
[s, j] = await call("POST", "/api/orders", { action: "delete_completed" }, CODE); ok(s === 200 && j.orders.length === 1 && j.orders[0].id === "old2", "purge completed keeps open");
[s] = await call("POST", "/api/orders", { action: "delete", orderId: "old2" }, CODE); ok(s === 200, "delete one");
[s] = await call("POST", "/api/orders", { action: "delete", orderId: "nope" }, CODE); ok(s === 404, "delete missing 404");

// admin writes
[s, j] = await call("POST", "/api/stock", { outOfStock: ["b", "a", "a"] }, CODE); ok(JSON.stringify(j.outOfStock) === '["a","b"]', "stock dedup/sort");
[s, j] = await call("POST", "/api/hours", { open: "99:00", closedDays: [2, 9, "3"], forceOpen: true, forceClosed: true }, CODE);
ok(j.open === "14:00" && JSON.stringify(j.closedDays) === "[2,3]" && j.forceOpen === false, "hours validation");
[s, j] = await call("POST", "/api/announcement", { enabled: true, messageEs: "Hola", messageEn: "Hi" }, CODE); ok(j.enabled && j.updatedAt, "announcement");
[s, j] = await call("GET", "/api/announcement"); ok(j.messageEn === "Hi", "announcement public read");
[s, j] = await call("POST", "/api/menu/item", { action: "add", section: "food", subKey: "main", name: "Pizza", price: 120 }, CODE); ok(s === 200 && j.item.id.startsWith("f-pizza"), "menu add");
const pid = j.item.id;
[s, j] = await call("POST", "/api/menu/item", { action: "update", itemId: pid, price: 130, isHidden: true, weeklyQty: 4 }, CODE); ok(j.item.price === 130 && j.item.isHidden && j.item.weeklyQty === 4, "menu update");
[s, j] = await call("POST", "/api/menu/item", { action: "delete", itemId: "f-burger" }, CODE);
ok(s === 200, "menu delete");
[s, j] = await call("GET", "/api/stock"); ok(!j.outOfStock.includes("f-burger"), "deleted item cleaned from stock");
[s] = await call("POST", "/api/menu/image", { itemId: pid, data: "x" }, CODE); ok(s === 501, "image upload not supported (explicit)");

// meal prep
[s, j] = await call("GET", "/api/menu");
ok(Object.keys(j.menu)[0] === "mealprep" && j.menu.mealprep.subcategories.Plan.items.length === 6 && j.menu.mealprep.subcategories.Plan.items[0].flags.includes("sides2"), "mealprep seeded with 6 dishes (first section)");
[s, j] = await call("POST", "/api/menu/item", { action: "add", section: "mealprep", subKey: "Plan", name: "Bowl Pollo", price: 150 }, CODE);
ok(s === 200 && j.item.id.startsWith("m-bowl") && Object.keys(j.menu)[0] === "mealprep", "mealprep add creates section first");
const fut = new Date(Date.now() + 3 * 86400000); const p2 = (n) => String(n).padStart(2, "0");
const sched = `${fut.getUTCFullYear()}-${p2(fut.getUTCMonth() + 1)}-${p2(fut.getUTCDate())}T12:30`;
[s, j] = await call("POST", "/api/orders", { action: "create", orderType: "dinein", items: [{ id: j.item.id, name: "Bowl Pollo", qty: 2 }], mealPrep: true, scheduledFor: sched });
ok(s === 200 && j.order.mealPrep === true && j.order.scheduledFor === sched, "scheduled mealprep order saved");
[s, j] = await call("POST", "/api/orders", { action: "create", orderType: "dinein", items: [{ id: "x", name: "Bowl", qty: 1 }], mealPrep: true, scheduledFor: "hola" });
ok(s === 400 && j.error === "bad_schedule", "bad schedule rejected");
[s, j] = await call("POST", "/api/orders", { action: "create", orderType: "dinein", items: [{ id: "x", name: "Bowl", qty: 1 }], mealPrep: true });
ok(s === 200 && j.order.mealPrep === true && j.order.scheduledFor === "", "mealprep now order");
[s, j] = await call("POST", "/api/orders", { action: "create", orderType: "dinein", items: [{ id: "x", name: "Taco", qty: 1 }], scheduledFor: sched });
ok(s === 200 && !("mealPrep" in j.order), "scheduledFor ignored without mealPrep flag");

// analytics
[s, j] = await call("POST", "/api/analytics", { action: "track", events: [{ type: "pageview", path: "/" }, { type: "weird" }] }); ok(s === 200 && j.added === 2, "analytics track (public)");
[s, j] = await call("GET", "/api/analytics", null, CODE); ok(j.events.length === 2 && j.events[1].type === "pageview", "analytics read (admin)");
[s] = await call("POST", "/api/analytics", { action: "purge" }, CODE); ok(s === 200, "analytics purge");

// brute force lock
for (let i = 0; i < 11; i++) await call("GET", "/api/orders?code=bad" + i);
[s] = await call("GET", "/api/orders", null, CODE); ok(s === 429, "ip locked after repeated failures (even with right code)");

console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
