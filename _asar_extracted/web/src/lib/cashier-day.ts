import { dbRead, dbWrite } from "@/lib/db";
import type { Sale } from "@/lib/erp-store";
import { groupSales } from "@/lib/invoices";
import { localDateKey } from "@/lib/erp-store";

const KEY = "erp.cashier-days.v1";

export type CashierDayClose = {
  date: string;
  filialId: string;
  closedAt: string;
  closedBy: string;
};

function readCloses(): CashierDayClose[] {
  return dbRead<CashierDayClose[]>(KEY, []);
}

export function todayISO() {
  return localDateKey();
}

export function isDayClosed(date: string, filialId?: string): boolean {
  const fid = filialId ?? "";
  return readCloses().some((c) => c.date === date && c.filialId === fid);
}

export function getDayClose(date: string, filialId?: string): CashierDayClose | null {
  const fid = filialId ?? "";
  return readCloses().find((c) => c.date === date && c.filialId === fid) ?? null;
}

export function closeCashierDay(date: string, filialId: string | undefined, closedBy: string) {
  const fid = filialId ?? "";
  if (isDayClosed(date, fid)) return { ok: false as const, error: "Dia já fechado." };
  const list = readCloses();
  list.push({ date, filialId: fid, closedAt: new Date().toISOString(), closedBy });
  dbWrite(KEY, list);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("erp:change", { detail: KEY }));
  }
  return { ok: true as const };
}

export function salesForDay(sales: Sale[], date: string, filialId?: string) {
  const fid = filialId ?? "";
  return sales.filter((s) => localDateKey(new Date(s.date)) === date && (s.filialId ?? "") === fid);
}

export function daySalesSummary(sales: Sale[], date: string, filialId?: string) {
  const daySales = salesForDay(sales, date, filialId);
  const groups = groupSales(daySales);
  const totalRevenue = daySales.reduce((a, s) => a + s.revenue, 0);
  const totalUnits = daySales.reduce((a, s) => a + s.qty, 0);
  return {
    groups,
    ticketCount: groups.length,
    lineCount: daySales.length,
    totalRevenue,
    totalUnits,
  };
}
