import { useEffect, useState } from "react";
import { dbRead, dbWrite } from "./db";
import type { Purchase, Sale, Product } from "./erp-store";
import {
  normAccountCode,
  defaultInvoiceSeries,
  suggestNextAccountCode,
  readFiliais,
  assignAllOrphanToFilial,
  countOrphanFilialRecords,
  filialAccountLabel,
  type Filial,
} from "./filial-accounts";

export type { Filial } from "./filial-accounts";
export type Supplier = { id: string; name: string; phone?: string; note?: string; createdAt: string };
export type CashEntry = { id: string; date: string; type: "in" | "out"; amount: number; note: string; filialId?: string };
export type SupplierPayment = { id: string; supplierId: string; date: string; amount: number; note?: string; filialId?: string };
export type FreightEntry = { id: string; date: string; transporter: string; amount: number; note?: string; filialId?: string };
export type StockTransferLine = { productId: string; qty: number };
export type StockTransfer = {
  id: string;
  date: string;
  fromFilialId: string;
  toFilialId: string;
  lines: StockTransferLine[];
  note?: string;
};
export type Company = { name: string; phone?: string; address?: string; currentFilialId?: string };

const KEYS = {
  company: "erp.company.v1",
  filiais: "erp.filiais.v1",
  suppliers: "erp.suppliers.v1",
  cash: "erp.cash.v1",
  payments: "erp.payments.v1",
  freight: "erp.freight.v1",
  transfers: "erp.transfers.v1",
  // shared with erp-store
  products: "erp.products.v1",
  purchases: "erp.purchases.v1",
  sales: "erp.sales.v1",
};

/** Per-filial stock from purchases, sales and inter-filial transfers. */
export function computeFilialStockQty(
  filialId: string,
  purchases: Purchase[],
  sales: Sale[],
  transfers: StockTransfer[],
): Map<string, number> {
  const stockQty = new Map<string, number>();
  for (const p of purchases.filter((x) => x.filialId === filialId))
    for (const l of p.lines) stockQty.set(l.productId, (stockQty.get(l.productId) ?? 0) + l.qty);
  for (const s of sales.filter((x) => x.filialId === filialId))
    stockQty.set(s.productId, (stockQty.get(s.productId) ?? 0) - s.qty);
  for (const t of transfers) {
    if (t.fromFilialId === filialId)
      for (const l of t.lines) stockQty.set(l.productId, (stockQty.get(l.productId) ?? 0) - l.qty);
    if (t.toFilialId === filialId)
      for (const l of t.lines) stockQty.set(l.productId, (stockQty.get(l.productId) ?? 0) + l.qty);
  }
  return stockQty;
}

export function getFilialStockQty(filialId: string | undefined, productId: string): number {
  if (!filialId) {
    return dbRead<Product[]>(KEYS.products, []).find((p) => p.id === productId)?.stock ?? 0;
  }
  const purchases = dbRead<Purchase[]>(KEYS.purchases, []);
  const sales = dbRead<Sale[]>(KEYS.sales, []);
  const transfers = dbRead<StockTransfer[]>(KEYS.transfers, []);
  return computeFilialStockQty(filialId, purchases, sales, transfers).get(productId) ?? 0;
}

export type FilialStockMatrix = {
  byFilial: Map<string, Map<string, number>>;
  unlabeled: Map<string, number>;
};

/** Stock qty per product for every filial (+ unlabeled movements). */
export function buildFilialStockMatrix(
  filiais: Filial[],
  purchases: Purchase[],
  sales: Sale[],
  transfers: StockTransfer[],
): FilialStockMatrix {
  const byFilial = new Map<string, Map<string, number>>();
  for (const f of filiais) byFilial.set(f.id, computeFilialStockQty(f.id, purchases, sales, transfers));
  const unlabeled = new Map<string, number>();
  for (const p of purchases.filter((x) => !x.filialId))
    for (const l of p.lines) unlabeled.set(l.productId, (unlabeled.get(l.productId) ?? 0) + l.qty);
  for (const s of sales.filter((x) => !x.filialId))
    unlabeled.set(s.productId, (unlabeled.get(s.productId) ?? 0) - s.qty);
  return { byFilial, unlabeled };
}

export function productFilialQty(matrix: FilialStockMatrix, filialId: string, productId: string): number {
  return matrix.byFilial.get(filialId)?.get(productId) ?? 0;
}

export function productTotalFilialQty(matrix: FilialStockMatrix, filiais: Filial[], productId: string): number {
  let n = matrix.unlabeled.get(productId) ?? 0;
  for (const f of filiais) n += productFilialQty(matrix, f.id, productId);
  return n;
}

const EMPTY_COMPANY: Company = { name: "" };

export function getCompany(): Company {
  return dbRead<Company>(KEYS.company, EMPTY_COMPANY);
}

export function getCurrentFilialId(): string | undefined {
  return getCompany().currentFilialId;
}

export function filialName(filiais: Filial[], id?: string): string {
  if (!id) return "Geral";
  const f = filiais.find((x) => x.id === id);
  if (!f) return "Geral";
  return f.accountCode ? filialAccountLabel(f) : f.name;
}

function matchFilial(filialId: string | undefined, filter: string): boolean {
  if (filter === "all") return true;
  if (filter === "none") return !filialId;
  return filialId === filter;
}

export function useAccounts(filialFilter: string = "all") {
  const [company, setCompany] = useState<Company>(() => getCompany());
  const [filiais, setFiliais] = useState<Filial[]>(() => readFiliais());
  const [suppliers, setSuppliers] = useState<Supplier[]>(() => dbRead<Supplier[]>(KEYS.suppliers, []));
  const [cash, setCash] = useState<CashEntry[]>(() => dbRead<CashEntry[]>(KEYS.cash, []));
  const [payments, setPayments] = useState<SupplierPayment[]>(() => dbRead<SupplierPayment[]>(KEYS.payments, []));
  const [freight, setFreight] = useState<FreightEntry[]>(() => dbRead<FreightEntry[]>(KEYS.freight, []));
  const [products, setProducts] = useState<Product[]>(() => dbRead<Product[]>(KEYS.products, []));
  const [purchases, setPurchases] = useState<Purchase[]>(() => dbRead<Purchase[]>(KEYS.purchases, []));
  const [sales, setSales] = useState<Sale[]>(() => dbRead<Sale[]>(KEYS.sales, []));
  const [transfers, setTransfers] = useState<StockTransfer[]>(() => dbRead<StockTransfer[]>(KEYS.transfers, []));

  useEffect(() => {
    const sync = () => {
      setCompany(getCompany());
      setFiliais(readFiliais());
      setSuppliers(dbRead<Supplier[]>(KEYS.suppliers, []));
      setCash(dbRead<CashEntry[]>(KEYS.cash, []));
      setPayments(dbRead<SupplierPayment[]>(KEYS.payments, []));
      setFreight(dbRead<FreightEntry[]>(KEYS.freight, []));
      setProducts(dbRead<Product[]>(KEYS.products, []));
      setPurchases(dbRead<Purchase[]>(KEYS.purchases, []));
      setSales(dbRead<Sale[]>(KEYS.sales, []));
      setTransfers(dbRead<StockTransfer[]>(KEYS.transfers, []));
    };
    window.addEventListener("erp:change", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("erp:change", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  // ---- filtered datasets ----
  const fSales = sales.filter((s) => matchFilial(s.filialId, filialFilter));
  const fPurchases = purchases.filter((p) => matchFilial(p.filialId, filialFilter));
  const fCash = cash.filter((c) => matchFilial(c.filialId, filialFilter));
  const fPayments = payments.filter((p) => matchFilial(p.filialId, filialFilter));
  const fFreight = freight.filter((f) => matchFilial(f.filialId, filialFilter));

  // ---- caixa (cash) computation ----
  const cashIn =
    fSales.reduce((a, s) => a + s.revenue, 0) +
    fCash.filter((c) => c.type === "in").reduce((a, c) => a + c.amount, 0);

  // paid purchases (cash) reduce caixa directly; credit purchases do not (until paid via supplier payment)
  const paidPurchasesOut = fPurchases.filter((p) => p.paid !== false).reduce((a, p) => a + p.total, 0);
  const cashOut =
    paidPurchasesOut +
    fPayments.reduce((a, p) => a + p.amount, 0) +
    fFreight.reduce((a, f) => a + f.amount, 0) +
    fCash.filter((c) => c.type === "out").reduce((a, c) => a + c.amount, 0);

  const caixaBalance = cashIn - cashOut;

  // ---- supplier balances (accounts payable) — respects the selected filial ----
  const supplierBalances = new Map<string, number>();
  for (const p of fPurchases) {
    if (p.paid === false && p.supplierId) {
      supplierBalances.set(p.supplierId, (supplierBalances.get(p.supplierId) ?? 0) + p.total);
    }
  }
  for (const pay of fPayments) {
    supplierBalances.set(pay.supplierId, (supplierBalances.get(pay.supplierId) ?? 0) - pay.amount);
  }
  const supplierStats = suppliers.map((s) => {
    const purchasesOfSupplier = fPurchases.filter((p) => p.supplierId === s.id);
    const totalBought = purchasesOfSupplier.reduce((a, p) => a + p.total, 0);
    const owed = Math.max(0, supplierBalances.get(s.id) ?? 0);
    return { supplier: s, totalBought, owed, count: purchasesOfSupplier.length };
  });
  const totalOwed = supplierStats.reduce((a, s) => a + s.owed, 0);

  // ---- stock per filial (purchases + transfers in − sales − transfers out) ----
  const stockQty = new Map<string, number>();
  for (const p of fPurchases) for (const l of p.lines) stockQty.set(l.productId, (stockQty.get(l.productId) ?? 0) + l.qty);
  for (const s of fSales) stockQty.set(s.productId, (stockQty.get(s.productId) ?? 0) - s.qty);
  const fTransfers = transfers.filter((t) => {
    if (filialFilter === "all") return true;
    if (filialFilter === "none") return false;
    return t.fromFilialId === filialFilter || t.toFilialId === filialFilter;
  });
  for (const t of fTransfers) {
    for (const l of t.lines) {
      if (filialFilter === "all" || t.fromFilialId === filialFilter)
        stockQty.set(l.productId, (stockQty.get(l.productId) ?? 0) - l.qty);
      if (filialFilter === "all" || t.toFilialId === filialFilter)
        stockQty.set(l.productId, (stockQty.get(l.productId) ?? 0) + l.qty);
    }
  }
  const stockStats = products
    .map((pr) => {
      const qty = stockQty.get(pr.id) ?? 0;
      return { product: pr, qty, value: qty * pr.avgCost };
    })
    .filter((x) => x.qty !== 0)
    .sort((a, b) => b.value - a.value);
  const stockUnits = stockStats.reduce((a, x) => a + x.qty, 0);
  const stockValue = stockStats.reduce((a, x) => a + x.value, 0);
  const filialStockMatrix = buildFilialStockMatrix(filiais, purchases, sales, transfers);

  // ---- how many old records are not yet assigned to a filial ----
  const unlabeledPurchases = purchases.filter((p) => !p.filialId).length;
  const unlabeledSales = sales.filter((s) => !s.filialId).length;
  const orphanStats = countOrphanFilialRecords(filiais);

  // ---- freight (purchase transport + standalone entries) ----
  const purchaseFreight = fPurchases
    .filter((p) => p.transport > 0)
    .map((p) => ({ id: p.id, date: p.date, transporter: "—", amount: p.transport, note: "Compra", source: "purchase" as const, filialId: p.filialId }));
  const standaloneFreight = fFreight.map((f) => ({ ...f, source: "manual" as const }));
  const allFreight = [...purchaseFreight, ...standaloneFreight].sort((a, b) => b.date.localeCompare(a.date));
  const freightTotal = allFreight.reduce((a, f) => a + f.amount, 0);

  return {
    company,
    filiais,
    suppliers,
    cash,
    payments,
    freight,
    // computed
    caixaBalance,
    cashIn,
    cashOut,
    supplierStats,
    totalOwed,
    allFreight,
    freightTotal,
    products,
    purchases,
    sales,
    stockStats,
    stockUnits,
    stockValue,
    filialStockMatrix,
    unlabeledPurchases,
    unlabeledSales,
    orphanPurchases: orphanStats.purchases,
    orphanSales: orphanStats.sales,
    fSales,
    fPurchases,
    fCash,
    fPayments,
    fFreight,
    transfers,

    // ---- company / filial actions ----
    saveCompany: (patch: Partial<Company>) => {
      dbWrite(KEYS.company, { ...getCompany(), ...patch });
    },
    setCurrentFilial: (id: string | undefined) => {
      dbWrite(KEYS.company, { ...getCompany(), currentFilialId: id });
    },
    addFilial: (name: string, location?: string, accountCode?: string): { ok: boolean; error?: string } => {
      const n = name.trim();
      if (!n) return { ok: false, error: "Indique o nome da filial." };
      const list = readFiliais();
      if (list.some((f) => f.name.toLowerCase() === n.toLowerCase())) return { ok: false, error: "Filial já existe." };
      const code = accountCode?.trim() ? normAccountCode(accountCode) : suggestNextAccountCode(list);
      if (list.some((f) => normAccountCode(f.accountCode) === code)) return { ok: false, error: `Conta ${code} já existe.` };
      const next: Filial = {
        id: crypto.randomUUID(),
        name: n,
        location: location?.trim() || undefined,
        accountCode: code,
        invoiceSeries: defaultInvoiceSeries(code),
        nextInvoiceNumber: 1,
        createdAt: new Date().toISOString(),
      };
      const updated = [...list, next];
      dbWrite(KEYS.filiais, updated);
      if (!getCurrentFilialId()) dbWrite(KEYS.company, { ...getCompany(), currentFilialId: next.id });
      return { ok: true };
    },
    removeFilial: (id: string) => {
      dbWrite(KEYS.filiais, dbRead<Filial[]>(KEYS.filiais, []).filter((f) => f.id !== id));
      if (getCurrentFilialId() === id) dbWrite(KEYS.company, { ...getCompany(), currentFilialId: undefined });
    },
    // assign every purchase/sale/cash/payment/freight that has no filial yet to the chosen branch
    assignUnlabeledToFilial: (filialId: string) => {
      if (!filialId) return 0;
      return assignAllOrphanToFilial(filialId);
    },

    // ---- supplier actions ----
    addSupplier: (name: string, phone?: string, note?: string): { ok: boolean; error?: string } => {
      const n = name.trim();
      if (!n) return { ok: false, error: "Indique o nome do fornecedor." };
      const list = dbRead<Supplier[]>(KEYS.suppliers, []);
      if (list.some((s) => s.name.toLowerCase() === n.toLowerCase())) return { ok: false, error: "Fornecedor já existe." };
      const next: Supplier = { id: crypto.randomUUID(), name: n, phone: phone?.trim() || undefined, note: note?.trim() || undefined, createdAt: new Date().toISOString() };
      dbWrite(KEYS.suppliers, [...list, next]);
      return { ok: true };
    },
    removeSupplier: (id: string) => {
      dbWrite(KEYS.suppliers, dbRead<Supplier[]>(KEYS.suppliers, []).filter((s) => s.id !== id));
    },
    updateSupplier: (id: string, patch: { name?: string; phone?: string; note?: string }): { ok: boolean; error?: string } => {
      const list = dbRead<Supplier[]>(KEYS.suppliers, []);
      if (patch.name !== undefined) {
        const n = patch.name.trim();
        if (!n) return { ok: false, error: "Indique o nome do fornecedor." };
        if (list.some((s) => s.id !== id && s.name.toLowerCase() === n.toLowerCase())) return { ok: false, error: "Fornecedor já existe." };
      }
      dbWrite(
        KEYS.suppliers,
        list.map((s) =>
          s.id === id
            ? { ...s, name: patch.name !== undefined ? patch.name.trim() : s.name, phone: patch.phone !== undefined ? patch.phone.trim() || undefined : s.phone, note: patch.note !== undefined ? patch.note.trim() || undefined : s.note }
            : s,
        ),
      );
      return { ok: true };
    },
    paySupplier: (supplierId: string, amount: number, date: string, note?: string) => {
      if (!(amount > 0)) return;
      const entry: SupplierPayment = { id: crypto.randomUUID(), supplierId, amount, date, note, filialId: getCurrentFilialId() };
      dbWrite(KEYS.payments, [entry, ...dbRead<SupplierPayment[]>(KEYS.payments, [])]);
    },
    updatePayment: (id: string, patch: { amount?: number; date?: string; note?: string }) => {
      dbWrite(
        KEYS.payments,
        dbRead<SupplierPayment[]>(KEYS.payments, []).map((p) =>
          p.id === id ? { ...p, amount: patch.amount !== undefined && patch.amount > 0 ? patch.amount : p.amount, date: patch.date ?? p.date, note: patch.note !== undefined ? patch.note.trim() || undefined : p.note } : p,
        ),
      );
    },
    removePayment: (id: string) => {
      dbWrite(KEYS.payments, dbRead<SupplierPayment[]>(KEYS.payments, []).filter((p) => p.id !== id));
    },

    // ---- cash (caixa) actions ----
    // filialId: pass `null` to force "no filial"; omit/undefined to use the active filial
    addCashEntry: (type: "in" | "out", amount: number, note: string, date: string, filialId?: string | null) => {
      if (!(amount > 0)) return;
      const fid = filialId === null ? undefined : filialId === undefined ? getCurrentFilialId() : filialId;
      const entry: CashEntry = { id: crypto.randomUUID(), type, amount, note: note.trim(), date, filialId: fid };
      dbWrite(KEYS.cash, [entry, ...dbRead<CashEntry[]>(KEYS.cash, [])]);
    },
    updateCashEntry: (id: string, patch: { type?: "in" | "out"; amount?: number; note?: string; date?: string }) => {
      dbWrite(
        KEYS.cash,
        dbRead<CashEntry[]>(KEYS.cash, []).map((c) =>
          c.id === id ? { ...c, type: patch.type ?? c.type, amount: patch.amount !== undefined && patch.amount > 0 ? patch.amount : c.amount, note: patch.note !== undefined ? patch.note.trim() : c.note, date: patch.date ?? c.date } : c,
        ),
      );
    },
    removeCashEntry: (id: string) => {
      dbWrite(KEYS.cash, dbRead<CashEntry[]>(KEYS.cash, []).filter((c) => c.id !== id));
    },

    // ---- freight actions ----
    addFreight: (transporter: string, amount: number, date: string, note?: string) => {
      if (!(amount > 0)) return;
      const entry: FreightEntry = { id: crypto.randomUUID(), transporter: transporter.trim() || "—", amount, date, note: note?.trim() || undefined, filialId: getCurrentFilialId() };
      dbWrite(KEYS.freight, [entry, ...dbRead<FreightEntry[]>(KEYS.freight, [])]);
    },
    updateFreight: (id: string, patch: { transporter?: string; amount?: number; note?: string; date?: string }) => {
      dbWrite(
        KEYS.freight,
        dbRead<FreightEntry[]>(KEYS.freight, []).map((f) =>
          f.id === id ? { ...f, transporter: patch.transporter !== undefined ? patch.transporter.trim() || "—" : f.transporter, amount: patch.amount !== undefined && patch.amount > 0 ? patch.amount : f.amount, note: patch.note !== undefined ? patch.note.trim() || undefined : f.note, date: patch.date ?? f.date } : f,
        ),
      );
    },
    removeFreight: (id: string) => {
      dbWrite(KEYS.freight, dbRead<FreightEntry[]>(KEYS.freight, []).filter((f) => f.id !== id));
    },

    addTransfer: (
      fromFilialId: string,
      toFilialId: string,
      lines: StockTransferLine[],
      date: string,
      note?: string,
    ): { ok: boolean; error?: string } => {
      if (!fromFilialId || !toFilialId) return { ok: false, error: "Seleccione origem e destino." };
      if (fromFilialId === toFilialId) return { ok: false, error: "Origem e destino têm de ser filiais diferentes." };
      const validLines = lines.filter((l) => l.productId && l.qty > 0);
      if (validLines.length === 0) return { ok: false, error: "Adicione pelo menos um produto com quantidade." };
      const list = dbRead<StockTransfer[]>(KEYS.transfers, []);
      const allPurchases = dbRead<Purchase[]>(KEYS.purchases, []);
      const allSales = dbRead<Sale[]>(KEYS.sales, []);
      const stock = computeFilialStockQty(fromFilialId, allPurchases, allSales, list);
      const allProducts = dbRead<Product[]>(KEYS.products, []);
      for (const l of validLines) {
        const avail = stock.get(l.productId) ?? 0;
        if (l.qty > avail) {
          const pr = allProducts.find((p) => p.id === l.productId);
          const label = pr?.sku?.trim() || pr?.name || "produto";
          return { ok: false, error: `Stock insuficiente em ${filialName(filiais, fromFilialId)} para «${label}»: tem ${avail}, pediu ${l.qty}.` };
        }
      }
      const entry: StockTransfer = {
        id: crypto.randomUUID(),
        date,
        fromFilialId,
        toFilialId,
        lines: validLines,
        note: note?.trim() || undefined,
      };
      dbWrite(KEYS.transfers, [entry, ...list]);
      return { ok: true };
    },
    removeTransfer: (id: string) => {
      dbWrite(KEYS.transfers, dbRead<StockTransfer[]>(KEYS.transfers, []).filter((t) => t.id !== id));
    },

    updateFilial: (
      id: string,
      patch: { name?: string; location?: string; accountCode?: string; invoiceSeries?: string; nextInvoiceNumber?: number },
    ): { ok: boolean; error?: string } => {
      const list = readFiliais();
      if (patch.name !== undefined) {
        const n = patch.name.trim();
        if (!n) return { ok: false, error: "Indique o nome da filial." };
        if (list.some((f) => f.id !== id && f.name.toLowerCase() === n.toLowerCase())) return { ok: false, error: "Filial já existe." };
      }
      if (patch.accountCode !== undefined) {
        const code = normAccountCode(patch.accountCode);
        if (!code) return { ok: false, error: "Indique o código de conta." };
        if (list.some((f) => f.id !== id && normAccountCode(f.accountCode) === code)) return { ok: false, error: `Conta ${code} já existe.` };
      }
      if (patch.nextInvoiceNumber !== undefined && patch.nextInvoiceNumber < 1) {
        return { ok: false, error: "Próximo nº de fatura deve ser ≥ 1." };
      }
      dbWrite(
        KEYS.filiais,
        list.map((f) => {
          if (f.id !== id) return f;
          const accountCode = patch.accountCode !== undefined ? normAccountCode(patch.accountCode) : f.accountCode;
          return {
            ...f,
            name: patch.name !== undefined ? patch.name.trim() : f.name,
            location: patch.location !== undefined ? patch.location.trim() || undefined : f.location,
            accountCode,
            invoiceSeries:
              patch.invoiceSeries !== undefined
                ? patch.invoiceSeries.trim() || defaultInvoiceSeries(accountCode)
                : f.invoiceSeries || defaultInvoiceSeries(accountCode),
            nextInvoiceNumber: patch.nextInvoiceNumber !== undefined ? patch.nextInvoiceNumber : f.nextInvoiceNumber ?? 1,
          };
        }),
      );
      return { ok: true };
    },
  };
}
