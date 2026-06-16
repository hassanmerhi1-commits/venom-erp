/** Pure Node sync test — no downloads, runs in seconds */
const store = {};
const KEYS = {
  products: "erp.products.v1",
  purchases: "erp.purchases.v1",
  sales: "erp.sales.v1",
  company: "erp.company.v1",
  filiais: "erp.filiais.v1",
};

function read(k, fb) {
  try { return store[k] !== undefined ? JSON.parse(JSON.stringify(store[k])) : fb; } catch { return fb; }
}
function write(k, v) { store[k] = JSON.parse(JSON.stringify(v)); }
function reset() { for (const k of Object.keys(store)) delete store[k]; }
function assert(c, m) { if (!c) throw new Error("FAIL: " + m); }
function ok(m) { console.log("  OK " + m); }

function computeProducts(base, purchases, sales) {
  const map = new Map(base.map((p) => [p.id, { ...p, stock: 0, avgCost: 0 }]));
  for (const pu of [...purchases].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const l of pu.lines) {
      const p = map.get(l.productId);
      if (!p) continue;
      const before = p.stock * p.avgCost;
      p.stock += l.qty;
      p.avgCost = p.stock > 0 ? (before + l.qty * l.landedUnitCost) / p.stock : 0;
    }
  }
  for (const s of sales) {
    const p = map.get(s.productId);
    if (p) p.stock = Math.max(0, p.stock - s.qty);
  }
  return base.map((p) => map.get(p.id) ?? p);
}

function mergeFromMain(local, incoming) {
  const localFilialId = local.company.currentFilialId;
  const byId = new Map(local.products.map((p) => [p.id, { ...p }]));
  const byCode = new Map(local.products.map((p) => [p.name.trim().toLowerCase(), p.id]));
  for (const ip of incoming.products) {
    const eid = byId.has(ip.id) ? ip.id : byCode.get(ip.name.trim().toLowerCase());
    if (eid) {
      const cur = byId.get(eid);
      byId.set(eid, { ...cur, salePrice: ip.salePrice ?? cur.salePrice, name: ip.name, sku: ip.sku ?? cur.sku });
    } else {
      byId.set(ip.id, { ...ip });
      byCode.set(ip.name.trim().toLowerCase(), ip.id);
    }
  }
  const products = [...byId.values()];
  const byCodeMerged = new Map(products.map((p) => [p.name.trim().toLowerCase(), p.id]));
  const idMap = new Map();
  for (const ip of incoming.products) {
    if (products.some((p) => p.id === ip.id)) idMap.set(ip.id, ip.id);
    else idMap.set(ip.id, byCodeMerged.get(ip.name.trim().toLowerCase()) ?? ip.id);
  }
  const pids = new Set(local.purchases.map((p) => p.id));
  const purchasesToAdd = (localFilialId
    ? incoming.purchases.filter((p) => !pids.has(p.id) && (p.filialId ?? "") === localFilialId)
    : []
  ).map((pu) => ({
    ...pu,
    lines: pu.lines.map((l) => ({ ...l, productId: idMap.get(l.productId) ?? l.productId })),
  }));
  const purchases = [...local.purchases, ...purchasesToAdd];
  const sales = local.sales;
  return { products: computeProducts(products, purchases, sales), purchases, sales };
}

function mergeFromFilial(local, incoming) {
  const byId = new Map(local.products.map((p) => [p.id, { ...p }]));
  const byCode = new Map(local.products.map((p) => [p.name.trim().toLowerCase(), p.id]));
  for (const ip of incoming.products) {
    if (byId.has(ip.id) || byCode.has(ip.name.trim().toLowerCase())) continue;
    byId.set(ip.id, { ...ip });
  }
  const products = [...byId.values()];
  const idMap = new Map();
  for (const ip of incoming.products) {
    if (byId.has(ip.id)) idMap.set(ip.id, ip.id);
    else {
      const lc = byCode.get(ip.name.trim().toLowerCase());
      idMap.set(ip.id, lc ?? ip.id);
    }
  }
  const sids = new Set(local.sales.map((s) => s.id));
  const salesToAdd = incoming.sales.filter((s) => !sids.has(s.id)).map((s) => {
    const pid = idMap.get(s.productId) ?? s.productId;
    return pid === s.productId ? s : { ...s, productId: pid };
  });
  const sales = [...local.sales, ...salesToAdd];
  return { products: computeProducts(products, local.purchases, sales), sales, added: salesToAdd.length };
}

const FILIAL = "filial-aaa";

console.log("\nSYNC TESTS\n");

// TEST 1: filial gets price + stock, keeps sales
reset();
write(KEYS.company, { name: "Filial", currentFilialId: FILIAL });
write(KEYS.products, [{ id: "p1-local", name: "REF001", sku: "A", stock: 5, avgCost: 50, salePrice: 70, lowStock: 5, createdAt: "x" }]);
write(KEYS.purchases, []);
write(KEYS.sales, [{ id: "sf1", date: "2026-05-15", productId: "p1-local", qty: 3, unitPrice: 70, filialId: FILIAL }]);
const filialLocal = { company: read(KEYS.company, {}), products: read(KEYS.products, []), purchases: read(KEYS.purchases, []), sales: read(KEYS.sales, []) };

const mainIncoming = {
  products: [
    { id: "p1", name: "REF001", sku: "A", stock: 100, avgCost: 50, salePrice: 99, lowStock: 5, createdAt: "x" },
    { id: "p3", name: "REF003", sku: "C", stock: 10, avgCost: 20, salePrice: 35, lowStock: 2, createdAt: "x" },
  ],
  purchases: [{ id: "pu1", date: "2026-05-01", transport: 0, total: 1000, filialId: FILIAL, lines: [{ productId: "p1", qty: 20, unitPrice: 50, landedUnitCost: 50 }] }],
};
const r1 = mergeFromMain(filialLocal, mainIncoming);
const p1 = r1.products.find((p) => p.name === "REF001");
assert(p1.salePrice === 99, "price not updated");
assert(p1.stock === 17, "stock should be 20-3=17, got " + p1.stock);
assert(r1.sales.length === 1, "filial sales erased");
assert(r1.products.some((p) => p.name === "REF003"), "new product missing");
ok("Filial receives price+stock, keeps sales");

// TEST 2: main gets filial sales, keeps own
reset();
write(KEYS.sales, [{ id: "sm1", date: "2026-05-10", productId: "p1", qty: 2, unitPrice: 80 }]);
write(KEYS.products, [{ id: "p1", name: "REF001", sku: "A", stock: 10, avgCost: 50, salePrice: 80, lowStock: 5, createdAt: "x" }]);
write(KEYS.purchases, []);
const mainLocal = { products: read(KEYS.products, []), purchases: [], sales: read(KEYS.sales, []) };
const filialIncoming = {
  products: [{ id: "p1-local", name: "REF001", sku: "A", stock: 5, avgCost: 50, salePrice: 70, lowStock: 5, createdAt: "x" }],
  sales: [
    { id: "sf1", date: "2026-05-15", productId: "p1-local", qty: 3, unitPrice: 70, filialId: FILIAL },
    { id: "sf2", date: "2026-05-16", productId: "p1-local", qty: 1, unitPrice: 70, filialId: FILIAL },
  ],
};
const r2 = mergeFromFilial(mainLocal, filialIncoming);
assert(r2.sales.length === 3, "main should have 3 sales, got " + r2.sales.length);
assert(r2.sales.some((s) => s.id === "sm1"), "main sale lost");
assert(r2.sales.some((s) => s.id === "sf1"), "filial sale missing");
ok("Main receives filial sales, keeps own");

// TEST 3: duplicate safe
const mainAfterFirst = { products: r2.products, purchases: mainLocal.purchases, sales: r2.sales };
const r3 = mergeFromFilial(mainAfterFirst, filialIncoming);
assert(r3.added === 0, "duplicate import should add 0");
ok("Duplicate import safe");

console.log("\nALL TESTS PASSED\n");
