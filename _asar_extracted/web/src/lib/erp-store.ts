import { useEffect, useState } from "react";
import { dbRead, dbWrite, dbExportAll, dbImportAll, dbClearKeys } from "./db";
export { dbInfo, dbChangePath, dbReveal } from "./db";

export type Product = {
  id: string;
  name: string;
  sku?: string;
  stock: number;
  avgCost: number; // weighted moving average (landed)
  salePrice?: number; // fixed sale price defined by user
  lowStock: number;
  createdAt: string;
};

export type PurchaseLine = {
  productId: string;
  qty: number;
  unitPrice: number; // pre-transport
  landedUnitCost: number; // unitPrice + transportShare
};

export type Purchase = {
  id: string;
  date: string; // ISO
  transport: number;
  lines: PurchaseLine[];
  total: number; // sum(qty*unitPrice) + transport
  filialId?: string; // branch this purchase belongs to
  supplierId?: string; // supplier (fornecedor)
  paid?: boolean; // true = paid in cash (caixa), false = on credit (owed to supplier)
};

export type Sale = {
  id: string;
  date: string; // ISO
  productId: string;
  qty: number;
  unitPrice: number;
  unitCost: number; // cost at time of sale
  revenue: number;
  profit: number;
  filialId?: string; // branch this sale belongs to
};

const KEYS = {
  products: "erp.products.v1",
  purchases: "erp.purchases.v1",
  sales: "erp.sales.v1",
};

const read = dbRead;
const write = dbWrite;

export type PurchaseMeta = { supplierId?: string; paid?: boolean; filialId?: string };

function currentFilialId(): string | undefined {
  const c = dbRead<{ currentFilialId?: string }>("erp.company.v1", {});
  return c?.currentFilialId;
}

// Recompute every product's stock + weighted-average cost from the full history.
// Purchases (chronological) build up stock & avgCost; sales only reduce stock.
// Used after any edit/delete so totals always stay consistent.
function computeProducts(base: Product[], purchases: Purchase[], sales: Sale[]): Product[] {
  const map = new Map(base.map((p) => [p.id, { ...p, stock: 0, avgCost: 0 }]));
  const sortedPurchases = [...purchases].sort((a, b) => a.date.localeCompare(b.date));
  for (const pu of sortedPurchases) {
    for (const l of pu.lines) {
      const p = map.get(l.productId);
      if (!p) continue;
      const totalCostBefore = p.stock * p.avgCost;
      p.stock += l.qty;
      p.avgCost = p.stock > 0 ? (totalCostBefore + l.qty * l.landedUnitCost) / p.stock : 0;
    }
  }
  for (const s of sales) {
    const p = map.get(s.productId);
    if (!p) continue;
    p.stock = Math.max(0, p.stock - s.qty);
  }
  return base.map((p) => map.get(p.id) ?? p);
}

// average cost of every product based only on purchases (sales don't change avg cost)
function avgCostMap(purchases: Purchase[], base: Product[]): Map<string, number> {
  const computed = computeProducts(base, purchases, []);
  return new Map(computed.map((p) => [p.id, p.avgCost]));
}

export function useErp() {
  const [products, setProducts] = useState<Product[]>(() => read(KEYS.products, []));
  const [purchases, setPurchases] = useState<Purchase[]>(() => read(KEYS.purchases, []));
  const [sales, setSales] = useState<Sale[]>(() => read(KEYS.sales, []));

  useEffect(() => {
    const sync = () => {
      setProducts(read(KEYS.products, []));
      setPurchases(read(KEYS.purchases, []));
      setSales(read(KEYS.sales, []));
    };
    window.addEventListener("erp:change", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("erp:change", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return {
    products,
    purchases,
    sales,
    addProduct: (p: Omit<Product, "id" | "createdAt" | "stock" | "avgCost">) => {
      const list = read<Product[]>(KEYS.products, []);
      const next: Product = {
        ...p,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        stock: 0,
        avgCost: 0,
      };
      write(KEYS.products, [next, ...list]);
    },
    updateProduct: (id: string, patch: Partial<Product>) => {
      const list = read<Product[]>(KEYS.products, []);
      write(KEYS.products, list.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    },
    removeProduct: (id: string) => {
      const list = read<Product[]>(KEYS.products, []);
      write(KEYS.products, list.filter((p) => p.id !== id));
    },
    addPurchase: (date: string, transport: number, lines: Array<{ productId: string; qty: number; unitPrice: number }>, meta?: PurchaseMeta) => {
      const totalUnits = lines.reduce((a, l) => a + l.qty, 0);
      const perUnitTransport = totalUnits > 0 ? transport / totalUnits : 0;
      const full: Purchase = {
        id: crypto.randomUUID(),
        date,
        transport,
        total: lines.reduce((a, l) => a + l.qty * l.unitPrice, 0) + transport,
        lines: lines.map((l) => ({
          ...l,
          landedUnitCost: l.unitPrice + perUnitTransport,
        })),
        filialId: meta?.filialId ?? currentFilialId(),
        supplierId: meta?.supplierId,
        paid: meta?.paid !== false,
      };
      // update products: stock + moving avg cost
      const products = read<Product[]>(KEYS.products, []);
      const nextProducts = products.map((p) => {
        const matching = full.lines.filter((l) => l.productId === p.id);
        if (matching.length === 0) return p;
        let stock = p.stock;
        let avg = p.avgCost;
        for (const l of matching) {
          const totalCostBefore = stock * avg;
          const totalCostAdd = l.qty * l.landedUnitCost;
          stock = stock + l.qty;
          avg = stock > 0 ? (totalCostBefore + totalCostAdd) / stock : 0;
        }
        return { ...p, stock, avgCost: avg };
      });
      write(KEYS.products, nextProducts);
      write(KEYS.purchases, [full, ...read<Purchase[]>(KEYS.purchases, [])]);
    },
    recordSale: (date: string, items: Array<{ productId: string; qty: number; unitPrice: number }>, filialId?: string) => {
      const products = read<Product[]>(KEYS.products, []);
      const sales = read<Sale[]>(KEYS.sales, []);
      const saleFilial = filialId ?? currentFilialId();
      const productsCopy = [...products];
      const newSales: Sale[] = [];
      for (const it of items) {
        const idx = productsCopy.findIndex((p) => p.id === it.productId);
        if (idx === -1) continue;
        const p = productsCopy[idx];
        const unitCost = p.avgCost;
        const sale: Sale = {
          id: crypto.randomUUID(),
          date,
          productId: it.productId,
          qty: it.qty,
          unitPrice: it.unitPrice,
          unitCost,
          revenue: it.qty * it.unitPrice,
          profit: (it.unitPrice - unitCost) * it.qty,
          filialId: saleFilial,
        };
        newSales.push(sale);
        productsCopy[idx] = { ...p, stock: Math.max(0, p.stock - it.qty) };
      }
      write(KEYS.products, productsCopy);
      write(KEYS.sales, [...newSales, ...sales]);
    },
    // ---- editing ----
    updatePurchase: (
      id: string,
      date: string,
      transport: number,
      lines: Array<{ productId: string; qty: number; unitPrice: number }>,
      meta?: PurchaseMeta,
    ) => {
      const list = read<Purchase[]>(KEYS.purchases, []);
      const existing = list.find((p) => p.id === id);
      if (!existing) return;
      const totalUnits = lines.reduce((a, l) => a + l.qty, 0);
      const perUnitTransport = totalUnits > 0 ? transport / totalUnits : 0;
      const updated: Purchase = {
        ...existing,
        date,
        transport,
        total: lines.reduce((a, l) => a + l.qty * l.unitPrice, 0) + transport,
        lines: lines.map((l) => ({ ...l, landedUnitCost: l.unitPrice + perUnitTransport })),
        filialId: meta?.filialId,
        supplierId: meta?.supplierId,
        paid: meta?.paid !== false,
      };
      const nextPurchases = list.map((p) => (p.id === id ? updated : p));
      const base = read<Product[]>(KEYS.products, []);
      const sales = read<Sale[]>(KEYS.sales, []);
      write(KEYS.products, computeProducts(base, nextPurchases, sales));
      write(KEYS.purchases, nextPurchases);
    },
    // replace every sale line sharing groupDate (one invoice) with new lines
    updateSaleGroup: (
      groupDate: string,
      date: string,
      items: Array<{ productId: string; qty: number; unitPrice: number }>,
      filialId?: string,
    ) => {
      const salesList = read<Sale[]>(KEYS.sales, []);
      const remaining = salesList.filter((s) => s.date !== groupDate);
      const base = read<Product[]>(KEYS.products, []);
      const purchasesList = read<Purchase[]>(KEYS.purchases, []);
      const costs = avgCostMap(purchasesList, base);
      const newSales: Sale[] = items.map((it) => {
        const unitCost = costs.get(it.productId) ?? 0;
        return {
          id: crypto.randomUUID(),
          date,
          productId: it.productId,
          qty: it.qty,
          unitPrice: it.unitPrice,
          unitCost,
          revenue: it.qty * it.unitPrice,
          profit: (it.unitPrice - unitCost) * it.qty,
          filialId,
        };
      });
      const nextSales = [...newSales, ...remaining];
      write(KEYS.products, computeProducts(base, purchasesList, nextSales));
      write(KEYS.sales, nextSales);
    },
    removeSale: (id: string) => {
      const nextSales = read<Sale[]>(KEYS.sales, []).filter((s) => s.id !== id);
      const base = read<Product[]>(KEYS.products, []);
      const purchasesList = read<Purchase[]>(KEYS.purchases, []);
      write(KEYS.products, computeProducts(base, purchasesList, nextSales));
      write(KEYS.sales, nextSales);
    },
    removePurchase: (id: string) => {
      const nextPurchases = read<Purchase[]>(KEYS.purchases, []).filter((p) => p.id !== id);
      const base = read<Product[]>(KEYS.products, []);
      const sales = read<Sale[]>(KEYS.sales, []);
      write(KEYS.products, computeProducts(base, nextPurchases, sales));
      write(KEYS.purchases, nextPurchases);
    },
  };
}

// Product fields: `name` = código (ref.), `sku` = nome/descrição do produto.
export function productCode(p: Pick<Product, "name">) {
  return p.name;
}

export function productTitle(p: Pick<Product, "name" | "sku">) {
  return p.sku?.trim() || p.name;
}

export function productPickLabel(p: Pick<Product, "name" | "sku">) {
  const code = p.name.trim();
  const title = p.sku?.trim();
  if (code && title) return `${code} — ${title}`;
  return title || code || "—";
}

export const fmt = (n: number) =>
  new Intl.NumberFormat("pt-AO", {
    style: "currency",
    currency: "AOA",
    maximumFractionDigits: 2,
  }).format(isFinite(n) ? n : 0);

export const fmtInt = (n: number) => new Intl.NumberFormat("pt-AO").format(n);

export function monthRange(ym: string) {
  // ym = "YYYY-MM"
  const [y, m] = ym.split("-").map(Number);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 1);
  return { start, end };
}

export function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export function isSameDay(iso: string, dayKey: string) {
  return iso.slice(0, 10) === dayKey;
}

export function inMonth(iso: string, ym: string) {
  return iso.slice(0, 7) === ym;
}

const DB_KEYS = [
  "erp.products.v1",
  "erp.purchases.v1",
  "erp.sales.v1",
  "erp.company.v1",
  "erp.filiais.v1",
  "erp.suppliers.v1",
  "erp.cash.v1",
  "erp.payments.v1",
  "erp.freight.v1",
] as const;

export function exportDb() {
  const all = dbExportAll();
  const dump: Record<string, unknown> = { app: "VENOM-ERP", version: 1, exportedAt: new Date().toISOString() };
  for (const k of DB_KEYS) dump[k] = (all as Record<string, unknown>)[k] ?? null;
  const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  a.href = url;
  a.download = `venom-${stamp}.db`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function importDb(file: File): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (data?.app !== "VENOM-ERP") return { ok: false, error: "Ficheiro não é uma base VENOM ERP." };
    const incoming: Record<string, unknown> = {};
    for (const k of DB_KEYS) if (data[k] !== undefined) incoming[k] = data[k] ?? [];
    dbImportAll(incoming);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export function clearDb() {
  dbClearKeys([...DB_KEYS]);
}