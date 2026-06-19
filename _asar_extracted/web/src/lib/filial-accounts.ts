import { dbRead, dbWrite } from "./db";
import type { Purchase, Sale } from "./erp-store";

const FILIAIS_KEY = "erp.filiais.v1";
const COMPANY_KEY = "erp.company.v1";

export type Filial = {
  id: string;
  name: string;
  location?: string;
  accountCode: string;
  invoiceSeries?: string;
  nextInvoiceNumber?: number;
  createdAt: string;
};

export function normAccountCode(code: string): string {
  return code.trim().toUpperCase();
}

export function defaultInvoiceSeries(accountCode: string): string {
  return `FV/${normAccountCode(accountCode)}`;
}

export function formatInvoiceNumber(series: string, year: number, seq: number): string {
  return `${series}/${year}/${String(seq).padStart(6, "0")}`;
}

export function suggestNextAccountCode(filiais: Filial[]): string {
  let max = 0;
  for (const f of filiais) {
    const code = f.accountCode?.trim();
    if (!code) continue;
    const n = parseInt(code.replace(/\D/g, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return String(max + 1).padStart(3, "0");
}

/** Assign account code + invoice series to legacy filiais missing them. */
export function ensureFilialAccounts(list: Filial[]): Filial[] {
  if (list.length === 0) return list;
  let max = 0;
  for (const f of list) {
    const code = f.accountCode?.trim();
    if (!code) continue;
    const n = parseInt(code.replace(/\D/g, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  let changed = false;
  const next = list.map((f) => {
    if (f.accountCode?.trim() && f.nextInvoiceNumber != null && f.invoiceSeries?.trim()) return f;
    changed = true;
    max += 1;
    const accountCode = f.accountCode?.trim() ? normAccountCode(f.accountCode) : String(max).padStart(3, "0");
    return {
      ...f,
      accountCode,
      invoiceSeries: f.invoiceSeries?.trim() || defaultInvoiceSeries(accountCode),
      nextInvoiceNumber: f.nextInvoiceNumber ?? 1,
    };
  });
  if (changed) dbWrite(FILIAIS_KEY, next);
  return changed ? next : list;
}

export function readFiliais(): Filial[] {
  ensureFilialAccounts(dbRead<Filial[]>(FILIAIS_KEY, []));
  migrateLegacyFilialLinks();
  return dbRead<Filial[]>(FILIAIS_KEY, []);
}

type FilialStamp = { filialId?: string; filialAccountCode?: string };

/** Resolve filial link for legacy/orphan records. */
function resolveFilialLink(filiais: Filial[], item: FilialStamp, defaultFilialId?: string): FilialStamp | null {
  const ids = new Set(filiais.map((f) => f.id));

  if (item.filialAccountCode) {
    const byCode = findFilialByAccountCode(filiais, item.filialAccountCode);
    if (byCode) return { filialId: byCode.id, filialAccountCode: normAccountCode(byCode.accountCode) };
  }

  if (item.filialId && ids.has(item.filialId)) {
    const f = filiais.find((x) => x.id === item.filialId)!;
    const code = normAccountCode(f.accountCode);
    if ((item.filialAccountCode ?? "") === code) return null;
    return { filialId: f.id, filialAccountCode: code };
  }

  let target: Filial | undefined;
  if (filiais.length === 1) target = filiais[0];
  else if (defaultFilialId && ids.has(defaultFilialId)) target = filiais.find((f) => f.id === defaultFilialId);

  if (target) return { filialId: target.id, filialAccountCode: normAccountCode(target.accountCode) };
  return null;
}

function needsFilialLink(filiais: Filial[], item: FilialStamp): boolean {
  const ids = new Set(filiais.map((f) => f.id));
  if (!item.filialId || !ids.has(item.filialId)) return true;
  const f = filiais.find((x) => x.id === item.filialId);
  if (!f) return true;
  return normAccountCode(f.accountCode) !== (item.filialAccountCode ?? "");
}

/** Auto-link old sem filial / orphan UUID records to the correct filial + account code. */
export function migrateLegacyFilialLinks(): {
  sales: number;
  purchases: number;
  cash: number;
  payments: number;
  freight: number;
} {
  const filiais = dbRead<Filial[]>(FILIAIS_KEY, []);
  if (filiais.length === 0) return { sales: 0, purchases: 0, cash: 0, payments: 0, freight: 0 };

  const defaultFilialId = dbRead<{ currentFilialId?: string }>(COMPANY_KEY, {}).currentFilialId;
  const stats = { sales: 0, purchases: 0, cash: 0, payments: 0, freight: 0 };

  const migrate = <T extends FilialStamp>(key: string, stat: keyof typeof stats) => {
    const list = dbRead<T[]>(key, []);
    let n = 0;
    const next = list.map((item) => {
      if (!needsFilialLink(filiais, item)) return item;
      const resolved = resolveFilialLink(filiais, item, defaultFilialId);
      if (!resolved) return item;
      n++;
      return { ...item, ...resolved };
    });
    if (n > 0) dbWrite(key, next);
    stats[stat] = n;
  };

  migrate<Sale>("erp.sales.v1", "sales");
  migrate<Purchase>("erp.purchases.v1", "purchases");
  migrate<FilialStamp>("erp.cash.v1", "cash");
  migrate<FilialStamp>("erp.payments.v1", "payments");
  migrate<FilialStamp>("erp.freight.v1", "freight");
  return stats;
}

/** Force all unlabeled + orphan records onto one filial (manual repair). */
export function assignAllOrphanToFilial(filialId: string): number {
  const filiais = dbRead<Filial[]>(FILIAIS_KEY, []);
  const f = filiais.find((x) => x.id === filialId);
  if (!f) return 0;
  const code = normAccountCode(f.accountCode);
  const ids = new Set(filiais.map((x) => x.id));
  let total = 0;

  const stamp = <T extends FilialStamp>(key: string) => {
    const list = dbRead<T[]>(key, []);
    let n = 0;
    const next = list.map((item) => {
      const itemCode = item.filialAccountCode ? normAccountCode(item.filialAccountCode) : "";
      if (item.filialId && ids.has(item.filialId) && itemCode === code) return item;
      n++;
      return { ...item, filialId, filialAccountCode: code };
    });
    if (n > 0) dbWrite(key, next);
    total += n;
  };

  stamp<Sale>("erp.sales.v1");
  stamp<Purchase>("erp.purchases.v1");
  stamp<FilialStamp>("erp.cash.v1");
  stamp<FilialStamp>("erp.payments.v1");
  stamp<FilialStamp>("erp.freight.v1");
  return total;
}

export function countOrphanFilialRecords(filiais: Filial[]): {
  purchases: number;
  sales: number;
  total: number;
} {
  const ids = new Set(filiais.map((f) => f.id));
  const orphan = <T extends FilialStamp>(list: T[]) =>
    list.filter((x) => !x.filialId || !ids.has(x.filialId)).length;
  const purchases = orphan(dbRead<Purchase[]>("erp.purchases.v1", []));
  const sales = orphan(dbRead<Sale[]>("erp.sales.v1", []));
  return { purchases, sales, total: purchases + sales };
}

export function findFilialByAccountCode(filiais: Filial[], code?: string): Filial | undefined {
  if (!code?.trim()) return undefined;
  const n = normAccountCode(code);
  return filiais.find((f) => normAccountCode(f.accountCode) === n);
}

export function findFilialById(filiais: Filial[], id?: string): Filial | undefined {
  if (!id) return undefined;
  return filiais.find((f) => f.id === id);
}

export function filialAccountLabel(f: Filial): string {
  return f.accountCode ? `${f.name} · Conta ${f.accountCode}` : f.name;
}

export type InvoiceAllocation = { number: string; seq: number; accountCode: string };

/** Reserve the next invoice number for a filial and persist the counter. */
export function allocateInvoiceNumber(filialId: string, dateISO?: string): InvoiceAllocation | null {
  const filiais = readFiliais();
  const f = filiais.find((x) => x.id === filialId);
  if (!f?.accountCode) return null;
  const year = dateISO ? new Date(dateISO).getFullYear() : new Date().getFullYear();
  const seq = f.nextInvoiceNumber ?? 1;
  const series = f.invoiceSeries?.trim() || defaultInvoiceSeries(f.accountCode);
  const number = formatInvoiceNumber(series, year, seq);
  dbWrite(
    FILIAIS_KEY,
    filiais.map((x) => (x.id === filialId ? { ...x, nextInvoiceNumber: seq + 1 } : x)),
  );
  return { number, seq, accountCode: normAccountCode(f.accountCode) };
}

/** Bump filial counter if imported sale has a higher sequence than local. */
export function bumpInvoiceCounterIfNeeded(filialId: string, invoiceSeq?: number) {
  if (!invoiceSeq || invoiceSeq < 1) return;
  const filiais = readFiliais();
  dbWrite(
    FILIAIS_KEY,
    filiais.map((f) =>
      f.id === filialId ? { ...f, nextInvoiceNumber: Math.max(f.nextInvoiceNumber ?? 1, invoiceSeq + 1) } : f,
    ),
  );
}

export function saleInvoiceNumber(group: Sale[]): string | undefined {
  return group.find((s) => s.invoiceNumber)?.invoiceNumber;
}

export function buildFilialIdMap(local: Filial[], incoming: Filial[]): Map<string, string> {
  const localByCode = new Map(local.map((f) => [normAccountCode(f.accountCode), f.id]));
  const map = new Map<string, string>();
  for (const inf of incoming) {
    if (local.some((f) => f.id === inf.id)) {
      map.set(inf.id, inf.id);
      continue;
    }
    const code = inf.accountCode ? normAccountCode(inf.accountCode) : "";
    if (code && localByCode.has(code)) map.set(inf.id, localByCode.get(code)!);
    else map.set(inf.id, inf.id);
  }
  return map;
}

export function remapSaleFilial(
  sale: Sale,
  idMap: Map<string, string>,
  incomingFiliais: Filial[],
  localFiliais: Filial[],
  defaultIncomingFilialId?: string,
): Sale {
  const incomingById = new Map(incomingFiliais.map((f) => [f.id, f]));
  let fid = sale.filialId;
  if (!fid && defaultIncomingFilialId) fid = defaultIncomingFilialId;

  let accountCode = sale.filialAccountCode ? normAccountCode(sale.filialAccountCode) : undefined;
  if (!accountCode && fid) accountCode = incomingById.get(fid)?.accountCode ? normAccountCode(incomingById.get(fid)!.accountCode) : undefined;

  let localId: string | undefined;
  if (fid) localId = idMap.get(fid) ?? fid;
  if (accountCode) {
    const byCode = findFilialByAccountCode(localFiliais, accountCode);
    if (byCode) localId = byCode.id;
  }
  if (localId && !localFiliais.some((f) => f.id === localId)) {
    const byCode = accountCode ? findFilialByAccountCode(localFiliais, accountCode) : undefined;
    localId = byCode?.id;
  }

  const localFilial = localId ? localFiliais.find((f) => f.id === localId) : undefined;

  return {
    ...sale,
    filialId: localId,
    filialAccountCode: localFilial?.accountCode ? normAccountCode(localFilial.accountCode) : accountCode,
  };
}
