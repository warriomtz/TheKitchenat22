// Inventory test against a running `wrangler dev` (default http://127.0.0.1:8787)
const BASE = process.env.API || "http://127.0.0.1:8787";
const CODE = process.env.ADMIN_CODE || "test-admin-code-123456";
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const call = async (method, path, body, code) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7", ...(code ? { "X-Admin-Code": code } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch {}
  return [r.status, j];
};
await call("POST", "/api/admin/import", { data: { menu: { mealprep: { subcategories: { Plan: { items: [{ id: "m-salmon", name: "Salmón", price: 259 }] } } } } } }, CODE);
let [s, j] = await call("GET", "/api/kitchen-inventory", null, CODE);
ok(s === 200 && j.inventory.items.salmon.qty === 3, "seeded salmon 3");
ok(j.autoOut.includes("mp-side-sopaTomate"), "sopa de tomate auto agotada");
[s, j] = await call("POST", "/api/orders", { orderType: "dinein", items: [
  { id: "m-salmon", name: "Salmón", qty: 2, opts: { mpSides: { arroz: 2, quinoa: 1 } } },
  { id: "m-pollo-100", name: "Pollo", qty: 1, opts: { chickenSize: "100", mpSides: { arroz: 1, frijol: 1 } } } ] });
ok(s === 200 && j.order.inv && j.order.inv.salmon === 2, "order deducts salmon x2");
const oid = j.order.id;
[s, j] = await call("GET", "/api/kitchen-inventory", null, CODE);
const it = j.inventory.items;
ok(it.salmon.qty === 1 && it["pollo-100"].qty === 1 && it["pollo-200"].qty === 7 && it.arroz.qty === 12 - 2 * 2 - 1 && it.quinoa.qty === 0 && it.frijol.qty === 2, "quantities after order");
ok(j.autoOut.includes("m-sirloin") === false && j.autoOut.includes("mp-side-quinoa"), "quinoa now agotada");
[s, j] = await call("POST", "/api/orders", { action: "update", orderId: oid, status: "dismissed" }, CODE);
[s, j] = await call("GET", "/api/kitchen-inventory", null, CODE);
ok(j.inventory.items.salmon.qty === 3 && j.inventory.items.quinoa.qty === 2, "dismiss gives back");
[s, j] = await call("POST", "/api/orders", { action: "update", orderId: oid, status: "open" }, CODE);
[s, j] = await call("GET", "/api/kitchen-inventory", null, CODE);
ok(j.inventory.items.salmon.qty === 1, "reopen deducts again");
[s, j] = await call("POST", "/api/kitchen-inventory", { action: "add", id: "salmon", delta: 5 }, CODE);
ok(s === 200 && j.inventory.items.salmon.qty === 6, "restock +5");
[s, j] = await call("POST", "/api/orders", { action: "delete", orderId: oid }, CODE);
[s, j] = await call("GET", "/api/kitchen-inventory", null, CODE);
ok(j.inventory.items.salmon.qty === 8, "delete open order gives back");
[s, j] = await call("POST", "/api/stock", { outOfStock: ["f-x", "mp-side-sopaTomate"] }, CODE);
[s, j] = await call("GET", "/api/stock");
ok(j.outOfStock.includes("f-x") && j.outOfStock.includes("mp-side-sopaTomate") && j.auto.includes("mp-side-sopaTomate"), "stock = manual + auto");
// club chicken + burger patty
[s, j] = await call("POST", "/api/orders", { orderType: "dinein", items: [
  { id: "f-club", name: "Club", qty: 2 },
  { id: "f-burger", name: "Hamburguesa", qty: 1, opts: { burger: "chicken" } },
  { id: "f-burger", name: "Hamburguesa", qty: 1, opts: { burger: "beef" } } ] });
[s, j] = await call("GET", "/api/kitchen-inventory", null, CODE);
ok(j.inventory.items["pollo-club"].qty === 3 && j.inventory.items["carne-hamburguesa"].qty === 8, "club + beef burger deduct; chicken burger doesn't");
await call("POST", "/api/kitchen-inventory", { action: "set", id: "pan-hamburguesa", qty: 5 }, CODE);
[s, j] = await call("POST", "/api/kitchen-inventory", { action: "set", id: "carne-hamburguesa", qty: 0 }, CODE);
ok(j.autoOut.includes("f-burger-beef") && !j.autoOut.includes("f-burger"), "beef option blocked, burger still available");
[s, j] = await call("POST", "/api/kitchen-inventory", { action: "set", id: "pollo-100", qty: 0 }, CODE);
ok(j.autoOut.includes("mp-chicken-100") && !j.autoOut.includes("m-pollo-100"), "100 g option blocked only");
[s, j] = await call("POST", "/api/kitchen-inventory", { action: "set", id: "pollo-200", qty: 0 }, CODE);
ok(j.autoOut.includes("m-pollo-100"), "both sizes out -> dish out");
// pollo 100 g also used by pasta/ensalada (+1 with extra chicken)
[s, j] = await call("POST", "/api/kitchen-inventory", { action: "set", id: "pollo-100", qty: 10 }, CODE);
[s, j] = await call("POST", "/api/orders", { orderType: "dinein", items: [
  { id: "f-alfredo", name: "Alfredo", qty: 1 },
  { id: "f-pesto", name: "Pesto", qty: 1, opts: { extraChicken: "1" } },
  { id: "f-ensalada", name: "Ensalada", qty: 2 },
  { id: "m-pollo-100", name: "Pollo", qty: 1, opts: { chickenSize: "100" } } ] });
[s, j] = await call("GET", "/api/kitchen-inventory", null, CODE);
ok(j.inventory.items["pollo-100"].qty === 10 - 1 - 2 - 2 - 1, "pollo 100 g shared by pasta, ensalada, meal prep (+extra)");
[s, j] = await call("POST", "/api/kitchen-inventory", { action: "set", id: "pollo-100", qty: 0 }, CODE);
ok(j.autoOut.includes("f-alfredo") && j.autoOut.includes("f-pesto") && j.autoOut.includes("f-ensalada"), "pollo 100 g out blocks pasta and ensalada");
// breaded chicken, buns, bagels
[s, j] = await call("POST", "/api/orders", { orderType: "dinein", items: [
  { id: "f-burger", name: "Hamburguesa", qty: 1, opts: { burger: "chicken" } },
  { id: "f-pechuga-pomodoro", name: "Pomodoro", qty: 2 },
  { id: "f-bagel-pizza", name: "Bagel pizza", qty: 1 },
  { id: "f-bagel-h", name: "Bagel huevo", qty: 2 } ] });
[s, j] = await call("GET", "/api/kitchen-inventory", null, CODE);
const q = j.inventory.items;
ok(q["pollo-empanizado"].qty === 12 - 1 - 1 - 2 && q.bagel.qty === 9 - 3 && q["pan-hamburguesa"].qty === 4, "breaded chicken / bagels / bun deduct");
[s, j] = await call("POST", "/api/kitchen-inventory", { action: "set", id: "pan-hamburguesa", qty: 0 }, CODE);
ok(j.autoOut.includes("f-burger"), "burger blocked when buns reach 0");
// receipt: item # + packs -> stock
[s, j] = await call("POST", "/api/kitchen-inventory", { action: "set", id: "pan-hamburguesa", qty: 4 }, CODE);
[s, j] = await call("POST", "/api/kitchen-inventory", { action: "meta", id: "pan-hamburguesa", itemNo: "TEST-77", packText: "8 pza" }, CODE);
[s, j] = await call("POST", "/api/kitchen-inventory", { action: "receive", text: "TEST-77 2 150\nNOPE 1\nbasura", dry: true }, CODE);
ok(j.report[0].status === "ok" && j.report[0].after === 20 && j.report[1].status === "no_match" && j.report[2].status === "unreadable", "receipt dry run");
[s, j] = await call("GET", "/api/kitchen-inventory", null, CODE);
ok(j.inventory.items["pan-hamburguesa"].qty === 4, "dry run does not change stock");
[s, j] = await call("POST", "/api/kitchen-inventory", { action: "receive", text: "test-77 2 150" }, CODE);
ok(j.applied && j.inventory.items["pan-hamburguesa"].qty === 20 && j.inventory.items["pan-hamburguesa"].packCost === 150, "receipt applied");
// takeout containers: 82 seeded; every dish of an order that is NOT "dine in" uses one (drinks and packaged items don't)
[s, j] = await call("GET", "/api/kitchen-inventory", null, CODE);
const box0 = j.inventory.items["recipiente-llevar"];
ok(box0 && box0.qty === 82 && box0.min === 10 && box0.unit === "piezas", "takeout containers seeded at 82, alert at 10");
[s, j] = await call("POST", "/api/orders", { orderType: "dinein", items: [{ id: "f-club", name: "Club", qty: 1 }] });
ok(s === 200 && !(j.order.inv && j.order.inv["recipiente-llevar"]), "dine-in order does not use containers");
[s, j] = await call("POST", "/api/orders", { orderType: "apartment", apartment: "1204", items: [
  { id: "f-club", name: "Club", qty: 1 }, { id: "f-burger", name: "Burger", qty: 2 }, { id: "d-latte", name: "Latte", qty: 3 }, { id: "f-bolsa", name: "Bolsa", qty: 1 }] });
ok(s === 200 && j.order.inv && j.order.inv["recipiente-llevar"] === 3, "apartment order: 3 dishes = 3 containers (drink and chips bag excluded)");
const toid = j.order.id;
[s, j] = await call("GET", "/api/kitchen-inventory", null, CODE);
ok(j.inventory.items["recipiente-llevar"].qty === 79, "containers 82 -> 79");
[s, j] = await call("POST", "/api/orders", { orderType: "amenity", amenity: "Terraza", items: [{ id: "d-latte", name: "Latte", qty: 1 }] });
ok(s === 200 && !(j.order.inv && j.order.inv["recipiente-llevar"]), "drinks-only takeout order uses no container");
[s, j] = await call("POST", "/api/orders", { action: "update", orderId: toid, status: "dismissed" }, CODE);
[s, j] = await call("GET", "/api/kitchen-inventory", null, CODE);
ok(j.inventory.items["recipiente-llevar"].qty === 82, "dismissed takeout order gives its containers back");
console.log(fails ? "FAILED " + fails : "ALL PASS");
process.exit(fails ? 1 : 0);
