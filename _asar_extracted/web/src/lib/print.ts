import type { ThermalSaleReceipt } from "@/lib/thermal-receipt";
import { renderThermalSaleReceipt } from "@/lib/thermal-receipt";

export async function printThermalReceipt(html: string): Promise<{ ok: boolean; error?: string }> {
  if (typeof window === "undefined" || !window.venomPrint?.thermal) {
    return { ok: false, error: "no-printer" };
  }
  const printer = await window.venomPrint.getPrinter?.().catch(() => "");
  return window.venomPrint.thermal(html, printer || undefined);
}

/** Imprime 2 vias: original (cliente) + duplicata (gerente). */
export async function printThermalSaleCopies(data: ThermalSaleReceipt): Promise<{ ok: boolean; error?: string }> {
  const original = renderThermalSaleReceipt({ ...data, copyLabel: "ORIGINAL" });
  const r1 = await printThermalReceipt(original);
  if (!r1.ok) return r1;

  const duplicata = renderThermalSaleReceipt({ ...data, copyLabel: "DUPLICATA" });
  const r2 = await printThermalReceipt(duplicata);
  return r2;
}
