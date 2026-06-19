import { dbRead, dbSaveBatch } from "./db";
import { computeProducts, type Product, type Purchase, type Sale } from "./erp-store";
import type { CashEntry, Company, Filial, FreightEntry, Supplier, SupplierPayment } from "./accounts-store";
import {
  normAccountCode,
  ensureFilialAccounts,
  buildFilialIdMap,
  remapSaleFilial,
  bumpInvoiceCounterIfNeeded,
  findFilialByAccountCode,
} from "./filial-accounts";

export type SyncPayload = Record<string, unknown>;

export type SyncResult = {
  ok: true;
  summary: string;
  stats: Record<string, number>;
};

export type SyncError = { ok: false; error: string };

const KEYS = {
  products: "erp.products.v1",
  purchases: "erp.purchases.v1",
  sales: "erp.sales.v1",
  company: "erp.company.v1",
  filiais: "erp.filiais.v1",
  suppliers: "erp.suppliers.v1",
  cash: "erp.cash.v1",
  payments: "erp.payments.v1",
  freight: "erp.freight.v1",
} as const;

function normCode(s: string) {
  return s.trim().toLowerCase();
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function mergeFiliais(local: Filial[], incoming: Filial[]): Filial[] {
  const localNorm = ensureFilialAccounts(local);
  const incomingNorm = ensureFilialAccounts(incoming);
  const byCode = new Map(localNorm.map((f) => [normAccountCode(f.accountCode), { ...f }]));
  const byId = new Map(localNorm.map((f) => [f.id, { ...f }]));

  for (const inf of incomingNorm) {
    const code = normAccountCode(inf.accountCode);
    const existing = byCode.get(code) ?? byId.get(inf.id);
    if (existing) {
      const merged: Filial = {
        ...existing,
        name: inf.name || existing.name,
        location: inf.location ?? existing.location,
        accountCode: existing.accountCode || code,
        invoiceSeries: existing.invoiceSeries || inf.invoiceSeries,
        nextInvoiceNumber: Math.max(existing.nextInvoiceNumber ?? 1, inf.nextInvoiceNumber ?? 1),
      };
      byCode.set(normAccountCode(merged.accountCode), merged);
      byId.set(merged.id, merged);
    } else {
      const added = { ...inf, accountCode: code, nextInvoiceNumber: inf.nextInvoiceNumber ?? 1 };
      byCode.set(code, added);
      byId.set(added.id, added);
    }
  }

  const out = new Map<string, Filial>();
  for (const f of byId.values()) out.set(f.id, f);
  return [...out.values()];
}

function mergeSuppliers(local: Supplier[], incoming: Supplier[]): { merged: Supplier[]; added: number } {
  const map = new Map(local.map((s) => [s.id, s]));
  let added = 0;
  for (const s of incoming) {
    if (!map.has(s.id)) {
      map.set(s.id, s);
      added++;
    }
  }
  return { merged: [...map.values()], added };
}

/** Map incoming product ids to local ids (same id, or same product code). */
function buildIncomingProductIdMap(local: Product[], incoming: Product[]): Map<string, string> {
  const map = new Map<string, string>();
  const localByCode = new Map(local.map((p) => [normCode(p.name), p.id]));
  for (const ip of incoming) {
    if (local.some((p) => p.id === ip.id)) {
      map.set(ip.id, ip.id);
    } else {
      const byCode = localByCode.get(normCode(ip.name));
      map.set(ip.id, byCode ?? ip.id);
    }
  }
  return map;
}

/** Apply matriz catalog onto local products; add new items from matriz. Keeps local ids when codes match. */
function mergeProductsFromMain(local: Product[], incoming: Product[]): { merged: Product[]; updated: number; added: number } {
  const byId = new Map(local.map((p) => [p.id, { ...p }]));
  const byCode = new Map(local.map((p) => [normCode(p.name), p.id]));
  let updated = 0;
  let added = 0;

  for (const ip of incoming) {
    const existingId = byId.has(ip.id) ? ip.id : byCode.get(normCode(ip.name));
    if (existingId) {
      const cur = byId.get(existingId)!;
      byId.set(existingId, {
        ...cur,
        name: ip.name,
        sku: ip.sku ?? cur.sku,
        salePrice: ip.salePrice ?? cur.salePrice,
        lowStock: ip.lowStock ?? cur.lowStock,
        avgCost: ip.avgCost ?? cur.avgCost,
      });
      updated++;
    } else {
      byId.set(ip.id, { ...ip });
      byCode.set(normCode(ip.name), ip.id);
      added++;
    }
  }

  return { merged: [...byId.values()], updated, added };
}

/** Add filial-only products missing on matriz (matched by id or code). */
function mergeProductsFromFilial(local: Product[], incoming: Product[]): { merged: Product[]; added: number } {
  const byId = new Map(local.map((p) => [p.id, { ...p }]));
  const byCode = new Map(local.map((p) => [normCode(p.name), p.id]));
  let added = 0;
  for (const ip of incoming) {
    if (byId.has(ip.id) || byCode.has(normCode(ip.name))) continue;
    byId.set(ip.id, { ...ip });
    byCode.set(normCode(ip.name), ip.id);
    added++;
  }
  return { merged: [...byId.values()], added };
}

function remapPurchaseProductIds(purchases: Purchase[], idMap: Map<string, string>): Purchase[] {
  return purchases.map((pu) => ({
    ...pu,
    lines: pu.lines.map((l) => {
      const mapped = idMap.get(l.productId);
      return mapped && mapped !== l.productId ? { ...l, productId: mapped } : l;
    }),
  }));
}

/** Map incoming (matriz) product ids to local filial ids after catalog merge. */
function buildMainProductIdMap(merged: Product[], incoming: Product[]): Map<string, string> {
  const byCode = new Map(merged.map((p) => [normCode(p.name), p.id]));
  const map = new Map<string, string>();
  for (const ip of incoming) {
    if (merged.some((p) => p.id === ip.id)) map.set(ip.id, ip.id);
    else {
      const localId = byCode.get(normCode(ip.name));
      map.set(ip.id, localId ?? ip.id);
    }
  }
  return map;
}

function remapSalesProductIds(sales: Sale[], idMap: Map<string, string>): Sale[] {
  return sales.map((s) => {
    const mapped = idMap.get(s.productId);
    return mapped && mapped !== s.productId ? { ...s, productId: mapped } : s;
  });
}

function dominantFilialId(sales: Sale[]): string | undefined {
  const counts = new Map<string, number>();
  for (const s of sales) {
    const fid = s.filialId ?? "";
    if (!fid) continue;
    counts.set(fid, (counts.get(fid) ?? 0) + 1);
  }
  let best = "";
  let max = 0;
  for (const [id, n] of counts) {
    if (n > max) {
      max = n;
      best = id;
    }
  }
  return best || undefined;
}

function readLocalFilialId(): string | undefined {
  return dbRead<Company>(KEYS.company, {}).currentFilialId;
}

export function parseSyncPayload(data: unknown): SyncPayload | SyncError {
  if (!data || typeof data !== "object") return { ok: false, error: "Ficheiro inválido." };
  const d = data as Record<string, unknown>;
  if (d.app !== "VENOM-ERP") return { ok: false, error: "Ficheiro não é uma base VENOM ERP." };
  return d;
}

/**
 * Filial receives matriz export: update products/prices, merge stock purchases for this filial.
 * Local sales and other filial activity are never removed.
 */
export function mergeFromMain(payload: SyncPayload): SyncResult | SyncError {
  const localFilialId = readLocalFilialId();

  const localProducts = dbRead<Product[]>(KEYS.products, []);
  const localPurchases = dbRead<Purchase[]>(KEYS.purchases, []);
  const localSales = dbRead<Sale[]>(KEYS.sales, []);
  const localFiliais = dbRead<Filial[]>(KEYS.filiais, []);
  const localSuppliers = dbRead<Supplier[]>(KEYS.suppliers, []);
  const localCash = dbRead<CashEntry[]>(KEYS.cash, []);
  const localPayments = dbRead<SupplierPayment[]>(KEYS.payments, []);
  const localFreight = dbRead<FreightEntry[]>(KEYS.freight, []);
  const localCompany = dbRead<Company>(KEYS.company, { name: "" });

  const incomingProducts = asArray<Product>(payload[KEYS.products]);
  const incomingPurchases = asArray<Purchase>(payload[KEYS.purchases]);
  const incomingFiliais = asArray<Filial>(payload[KEYS.filiais]);
  const incomingSuppliers = asArray<Supplier>(payload[KEYS.suppliers]);
  const incomingCompany = (payload[KEYS.company] as Company | undefined) ?? { name: "" };

  const filiais = mergeFiliais(localFiliais, incomingFiliais);
  const { merged: products, updated: productsUpdated, added: productsAdded } = mergeProductsFromMain(
    localProducts,
    incomingProducts,
  );
  const mainProductIdMap = buildMainProductIdMap(products, incomingProducts);

  const purchaseIds = new Set(localPurchases.map((p) => p.id));
  const purchasesToAdd = remapPurchaseProductIds(
    localFilialId
      ? incomingPurchases.filter((p) => !purchaseIds.has(p.id) && (p.filialId ?? "") === localFilialId)
      : [],
    mainProductIdMap,
  );
  const purchases = [...localPurchases, ...purchasesToAdd];

  const { merged: suppliers, added: suppliersAdded } = mergeSuppliers(localSuppliers, incomingSuppliers);

  // Matriz is source of truth for filial account codes / invoice series on filial PC.
  const localFilial = localFilialId ? filiais.find((f) => f.id === localFilialId) : undefined;
  const incomingFilialMatch =
    localFilial && localFilial.accountCode
      ? incomingFiliais.find((f) => normAccountCode(f.accountCode) === normAccountCode(localFilial.accountCode))
      : undefined;
  const syncedFiliais = filiais.map((f) => {
    if (!localFilial || f.id !== localFilial.id || !incomingFilialMatch) return f;
    return {
      ...f,
      accountCode: normAccountCode(incomingFilialMatch.accountCode || f.accountCode),
      invoiceSeries: incomingFilialMatch.invoiceSeries || f.invoiceSeries,
      nextInvoiceNumber: Math.max(f.nextInvoiceNumber ?? 1, incomingFilialMatch.nextInvoiceNumber ?? 1),
    };
  });

  const company: Company = {
    ...localCompany,
    name: incomingCompany.name || localCompany.name,
    phone: incomingCompany.phone ?? localCompany.phone,
    address: incomingCompany.address ?? localCompany.address,
    currentFilialId: localCompany.currentFilialId,
  };

  const recomputed = computeProducts(products, purchases, localSales);

  dbSaveBatch({
    [KEYS.products]: recomputed,
    [KEYS.purchases]: purchases,
    [KEYS.sales]: localSales,
    [KEYS.filiais]: syncedFiliais,
    [KEYS.suppliers]: suppliers,
    [KEYS.company]: company,
    [KEYS.cash]: localCash,
    [KEYS.payments]: localPayments,
    [KEYS.freight]: localFreight,
  });

  return {
    ok: true,
    summary: `Matriz importada: ${productsUpdated} produto(s) atualizado(s), ${productsAdded} novo(s), ${purchasesToAdd.length} compra(s) de stock.${!localFilialId ? " (Seleccione a filial activa para receber stock.)" : ""}`,
    stats: {
      productsUpdated,
      productsAdded,
      purchasesAdded: purchasesToAdd.length,
      suppliersAdded,
    },
  };
}

/**
 * Matriz receives filial export: append filial sales (and related records) without erasing matriz data.
 */
export function mergeFromFilial(payload: SyncPayload): SyncResult | SyncError {
  const localProducts = dbRead<Product[]>(KEYS.products, []);
  const localPurchases = dbRead<Purchase[]>(KEYS.purchases, []);
  const localSales = dbRead<Sale[]>(KEYS.sales, []);
  const localFiliais = dbRead<Filial[]>(KEYS.filiais, []);
  const localSuppliers = dbRead<Supplier[]>(KEYS.suppliers, []);
  const localCash = dbRead<CashEntry[]>(KEYS.cash, []);
  const localPayments = dbRead<SupplierPayment[]>(KEYS.payments, []);
  const localFreight = dbRead<FreightEntry[]>(KEYS.freight, []);
  const localCompany = dbRead<Company>(KEYS.company, { name: "" });

  const incomingProducts = asArray<Product>(payload[KEYS.products]);
  const incomingSales = asArray<Sale>(payload[KEYS.sales]);
  const incomingPurchases = asArray<Purchase>(payload[KEYS.purchases]);
  const incomingFiliais = asArray<Filial>(payload[KEYS.filiais]);
  const incomingSuppliers = asArray<Supplier>(payload[KEYS.suppliers]);
  const incomingCash = asArray<CashEntry>(payload[KEYS.cash]);
  const incomingPayments = asArray<SupplierPayment>(payload[KEYS.payments]);
  const incomingFreight = asArray<FreightEntry>(payload[KEYS.freight]);

  const incomingCompany = (payload[KEYS.company] as Company | undefined) ?? { name: "" };

  const filiais = mergeFiliais(localFiliais, incomingFiliais);
  const filialIdMap = buildFilialIdMap(localFiliais, incomingFiliais);
  const sourceFilialId =
    dominantFilialId(incomingSales) || incomingCompany.currentFilialId || incomingFiliais[0]?.id;

  const { merged: products, added: productsAdded } = mergeProductsFromFilial(localProducts, incomingProducts);
  const idMap = buildIncomingProductIdMap(products, incomingProducts);

  const saleIds = new Set(localSales.map((s) => s.id));
  const salesToAdd = incomingSales
    .filter((s) => !saleIds.has(s.id))
    .map((s) => remapSalesProductIds([s], idMap)[0])
    .map((s) => remapSaleFilial(s, filialIdMap, incomingFiliais, filiais, sourceFilialId));
  for (const s of salesToAdd) {
    if (s.filialId && s.invoiceSeq) bumpInvoiceCounterIfNeeded(s.filialId, s.invoiceSeq);
  }
  const sales = [...localSales, ...salesToAdd];

  const purchaseIds = new Set(localPurchases.map((p) => p.id));
  const purchasesToAdd = incomingPurchases.filter((p) => !purchaseIds.has(p.id));
  const purchases = [...localPurchases, ...purchasesToAdd];

  const { merged: suppliers, added: suppliersAdded } = mergeSuppliers(localSuppliers, incomingSuppliers);

  const resolvedSourceId = sourceFilialId ? filialIdMap.get(sourceFilialId) ?? sourceFilialId : undefined;
  const belongsToFilial = <T extends { filialId?: string }>(item: T) =>
    !resolvedSourceId || (item.filialId ?? "") === sourceFilialId || (item.filialId ?? "") === resolvedSourceId;

  const cashIds = new Set(localCash.map((c) => c.id));
  const cashToAdd = incomingCash.filter((c) => !cashIds.has(c.id) && belongsToFilial(c));
  const cash = [...localCash, ...cashToAdd];

  const paymentIds = new Set(localPayments.map((p) => p.id));
  const paymentsToAdd = incomingPayments.filter((p) => !paymentIds.has(p.id) && belongsToFilial(p));
  const payments = [...localPayments, ...paymentsToAdd];

  const freightIds = new Set(localFreight.map((f) => f.id));
  const freightToAdd = incomingFreight.filter((f) => !freightIds.has(f.id) && belongsToFilial(f));
  const freight = [...localFreight, ...freightToAdd];

  const recomputed = computeProducts(products, purchases, sales);

  dbSaveBatch({
    [KEYS.products]: recomputed,
    [KEYS.purchases]: purchases,
    [KEYS.sales]: sales,
    [KEYS.filiais]: filiais,
    [KEYS.suppliers]: suppliers,
    [KEYS.company]: localCompany,
    [KEYS.cash]: cash,
    [KEYS.payments]: payments,
    [KEYS.freight]: freight,
  });

  const filialLabel = resolvedSourceId
    ? filiais.find((f) => f.id === resolvedSourceId)?.name ?? findFilialByAccountCode(filiais, salesToAdd[0]?.filialAccountCode)?.name ?? "filial"
    : "filial";

  return {
    ok: true,
    summary: `${filialLabel}: ${salesToAdd.length} venda(s) recebida(s), ${productsAdded} produto(s) novo(s). Dados da matriz mantidos.`,
    stats: {
      salesAdded: salesToAdd.length,
      productsAdded,
      purchasesAdded: purchasesToAdd.length,
      cashAdded: cashToAdd.length,
      suppliersAdded,
    },
  };
}
