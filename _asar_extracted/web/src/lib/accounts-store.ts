import { useEffect, useState } from "react";
import { dbRead, dbWrite } from "./db";
import type { Purchase, Sale, Product } from "./erp-store";

export type Filial = { id: string; name: string; location?: string; createdAt: string };
export type Supplier = { id: string; name: string; phone?: string; note?: string; createdAt: string };
export type CashEntry = { id: string; date: string; type: "in" | "out"; amount: number; note: string; filialId?: string };
export type SupplierPayment = { id: string; supplierId: string; date: string; amount: number; note?: string; filialId?: string };
export type FreightEntry = { id: string; date: string; transporter: string; amount: number; note?: string; filialId?: string };
export type Company = { name: string; phone?: string; address?: string; currentFilialId?: string };

const KEYS = {
  company: "erp.company.v1",
  filiais: "erp.filiais.v1",
  suppliers: "erp.suppliers.v1",
  cash: "erp.cash.v1",
  payments: "erp.payments.v1",
  freight: "erp.freight.v1",
  // shared with erp-store
  products: "erp.products.v1",
  purchases: "erp.purchases.v1",
  sales: "erp.sales.v1",
};

const EMPTY_COMPANY: Company = { name: "" };

export function getCompany(): Company {
  return dbRead<Company>(KEYS.company, EMPTY_COMPANY);
}

export function getCurrentFilialId(): string | undefined {
  return getCompany().currentFilialId;
}

export function filialName(filiais: Filial[], id?: string): string {
  if (!id) return "Geral";
  return filiais.find((f) => f.id === id)?.name ?? "Geral";
}

function matchFilial(filialId: string | undefined, filter: string): boolean {
  if (filter === "all") return true;
  if (filter === "none") return !filialId;
  return filialId === filter;
}

export function useAccounts(filialFilter: string = "all") {
  const [company, setCompany] = useState<Company>(() => getCompany());
  const [filiais, setFiliais] = useState<Filial[]>(() => dbRead<Filial[]>(KEYS.filiais, []));
  const [suppliers, setSuppliers] = useState<Supplier[]>(() => dbRead<Supplier[]>(KEYS.suppliers, []));
  const [cash, setCash] = useState<CashEntry[]>(() => dbRead<CashEntry[]>(KEYS.cash, []));
  const [payments, setPayments] = useState<SupplierPayment[]>(() => dbRead<SupplierPayment[]>(KEYS.payments, []));
  const [freight, setFreight] = useState<FreightEntry[]>(() => dbRead<FreightEntry[]>(KEYS.freight, []));
  const [products, setProducts] = useState<Product[]>(() => dbRead<Product[]>(KEYS.products, []));
  const [purchases, setPurchases] = useState<Purchase[]>(() => dbRead<Purchase[]>(KEYS.purchases, []));
  const [sales, setSales] = useState<Sale[]>(() => dbRead<Sale[]>(KEYS.sales, []));

  useEffect(() => {
    const sync = () => {
      setCompany(getCompany());
      setFiliais(dbRead<Filial[]>(KEYS.filiais, []));
      setSuppliers(dbRead<Supplier[]>(KEYS.suppliers, []));
      setCash(dbRead<CashEntry[]>(KEYS.cash, []));
      setPayments(dbRead<SupplierPayment[]>(KEYS.payments, []));
      setFreight(dbRead<FreightEntry[]>(KEYS.freight, []));
      setProducts(dbRead<Product[]>(KEYS.products, []));
      setPurchases(dbRead<Purchase[]>(KEYS.purchases, []));
      setSales(dbRead<Sale[]>(KEYS.sales, []));
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

  // ---- stock per filial (derived from labeled purchases/sales) ----
  const stockQty = new Map<string, number>();
  for (const p of fPurchases) for (const l of p.lines) stockQty.set(l.productId, (stockQty.get(l.productId) ?? 0) + l.qty);
  for (const s of fSales) stockQty.set(s.productId, (stockQty.get(s.productId) ?? 0) - s.qty);
  const stockStats = products
    .map((pr) => {
      const qty = stockQty.get(pr.id) ?? 0;
      return { product: pr, qty, value: qty * pr.avgCost };
    })
    .filter((x) => x.qty !== 0)
    .sort((a, b) => b.value - a.value);
  const stockUnits = stockStats.reduce((a, x) => a + x.qty, 0);
  const stockValue = stockStats.reduce((a, x) => a + x.value, 0);

  // ---- how many old records are not yet assigned to a filial ----
  const unlabeledPurchases = purchases.filter((p) => !p.filialId).length;
  const unlabeledSales = sales.filter((s) => !s.filialId).length;

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
    stockStats,
    stockUnits,
    stockValue,
    unlabeledPurchases,
    unlabeledSales,
    fSales,
    fPurchases,
    fCash,
    fPayments,
    fFreight,

    // ---- company / filial actions ----
    saveCompany: (patch: Partial<Company>) => {
      dbWrite(KEYS.company, { ...getCompany(), ...patch });
    },
    setCurrentFilial: (id: string | undefined) => {
      dbWrite(KEYS.company, { ...getCompany(), currentFilialId: id });
    },
    addFilial: (name: string, location?: string): { ok: boolean; error?: string } => {
      const n = name.trim();
      if (!n) return { ok: false, error: "Indique o nome da filial." };
      const list = dbRead<Filial[]>(KEYS.filiais, []);
      if (list.some((f) => f.name.toLowerCase() === n.toLowerCase())) return { ok: false, error: "Filial já existe." };
      const next: Filial = { id: crypto.randomUUID(), name: n, location: location?.trim() || undefined, createdAt: new Date().toISOString() };
      const updated = [...list, next];
      dbWrite(KEYS.filiais, updated);
      // first filial becomes current automatically
      if (!getCurrentFilialId()) dbWrite(KEYS.company, { ...getCompany(), currentFilialId: next.id });
      return { ok: true };
    },
    removeFilial: (id: string) => {
      dbWrite(KEYS.filiais, dbRead<Filial[]>(KEYS.filiais, []).filter((f) => f.id !== id));
      if (getCurrentFilialId() === id) dbWrite(KEYS.company, { ...getCompany(), currentFilialId: undefined });
    },
    // assign every purchase/sale/cash/payment/freight that has no filial yet to the chosen branch
    assignUnlabeledToFilial: (filialId: string) => {
      if (!filialId) return;
      const stamp = <T extends { filialId?: string }>(list: T[]) => list.map((x) => (x.filialId ? x : { ...x, filialId }));
      dbWrite(KEYS.purchases, stamp(dbRead<Purchase[]>(KEYS.purchases, [])));
      dbWrite(KEYS.sales, stamp(dbRead<Sale[]>(KEYS.sales, [])));
      dbWrite(KEYS.cash, stamp(dbRead<CashEntry[]>(KEYS.cash, [])));
      dbWrite(KEYS.payments, stamp(dbRead<SupplierPayment[]>(KEYS.payments, [])));
      dbWrite(KEYS.freight, stamp(dbRead<FreightEntry[]>(KEYS.freight, [])));
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
    updateFilial: (id: string, patch: { name?: string; location?: string }): { ok: boolean; error?: string } => {
      const list = dbRead<Filial[]>(KEYS.filiais, []);
      if (patch.name !== undefined) {
        const n = patch.name.trim();
        if (!n) return { ok: false, error: "Indique o nome da filial." };
        if (list.some((f) => f.id !== id && f.name.toLowerCase() === n.toLowerCase())) return { ok: false, error: "Filial já existe." };
      }
      dbWrite(
        KEYS.filiais,
        list.map((f) => (f.id === id ? { ...f, name: patch.name !== undefined ? patch.name.trim() : f.name, location: patch.location !== undefined ? patch.location.trim() || undefined : f.location } : f)),
      );
      return { ok: true };
    },
  };
}
