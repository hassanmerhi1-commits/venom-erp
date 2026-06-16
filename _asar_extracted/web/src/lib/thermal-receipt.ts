import type { Product } from "./erp-store";
import { fmt, productPickLabel } from "./erp-store";

export type ThermalSaleItem = {
  product: Product | undefined;
  qty: number;
  unitPrice: number;
};

export type ThermalSaleReceipt = {
  companyName: string;
  companyPhone?: string;
  filialName?: string;
  dateISO: string;
  receiptNo: string;
  items: ThermalSaleItem[];
  /** ORIGINAL = cliente, DUPLICATA = gerente */
  copyLabel?: "ORIGINAL" | "DUPLICATA";
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function thermalReceiptNumber(dateISO: string) {
  const d = new Date(dateISO);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `FV-${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

export function renderThermalSaleReceipt(data: ThermalSaleReceipt): string {
  const when = new Date(data.dateISO).toLocaleString("pt-AO");
  const total = data.items.reduce((a, it) => a + it.qty * it.unitPrice, 0);
  const lines = data.items
    .map((it) => {
      const label = it.product ? productPickLabel(it.product) : "—";
      const lineTotal = it.qty * it.unitPrice;
      return `
        <tr>
          <td class="name">${escapeHtml(label)}</td>
        </tr>
        <tr class="detail">
          <td>${it.qty} x ${escapeHtml(fmt(it.unitPrice))} = <strong>${escapeHtml(fmt(lineTotal))}</strong></td>
        </tr>`;
    })
    .join("");

  const headerName = data.companyName.trim() || data.filialName?.trim() || "VENOM ERP";

  return `<!doctype html>
<html lang="pt">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(data.receiptNo)}</title>
  <style>
    @page { size: 80mm auto; margin: 2mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 76mm;
      max-width: 76mm;
      font-family: "Courier New", Consolas, monospace;
      font-size: 12px;
      line-height: 1.35;
      color: #000;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .center { text-align: center; }
    .bold { font-weight: 700; }
    .big { font-size: 15px; }
    .muted { font-size: 11px; }
    .rule {
      border: 0;
      border-top: 1px dashed #000;
      margin: 6px 0;
    }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 1px 0; vertical-align: top; }
    td.name { font-weight: 700; padding-top: 4px; }
    tr.detail td { padding-bottom: 4px; font-size: 11px; }
    .total {
      font-size: 16px;
      font-weight: 700;
      padding: 6px 0 2px;
    }
    .foot { margin-top: 8px; font-size: 11px; text-align: center; }
    .via {
      text-align: center;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.05em;
      border: 2px solid #000;
      padding: 4px 0;
      margin-bottom: 6px;
    }
  </style>
</head>
<body>
  ${data.copyLabel ? `<div class="via">${data.copyLabel === "ORIGINAL" ? "ORIGINAL — CLIENTE" : "DUPLICATA — GERENTE"}</div>` : ""}
  <div class="center bold big">${escapeHtml(headerName)}</div>
  ${data.companyPhone ? `<div class="center muted">${escapeHtml(data.companyPhone)}</div>` : ""}
  ${data.filialName ? `<div class="center">${escapeHtml(data.filialName)}</div>` : ""}
  <hr class="rule" />
  <div class="center bold">FATURA DE VENDA</div>
  <div class="muted">Nº ${escapeHtml(data.receiptNo)}</div>
  <div class="muted">${escapeHtml(when)}</div>
  <hr class="rule" />
  <table>${lines}</table>
  <hr class="rule" />
  <div class="total">TOTAL: ${escapeHtml(fmt(total))}</div>
  <hr class="rule" />
  <div class="foot">Obrigado pela preferência</div>
  <div class="foot muted">VENOM ERP</div>
</body>
</html>`;
}

export type ThermalDayTicket = {
  time: string;
  total: string;
  items: number;
};

export type ThermalDayCloseReceipt = {
  companyName: string;
  filialName?: string;
  date: string;
  closedAt: string;
  closedBy: string;
  tickets: ThermalDayTicket[];
  ticketCount: number;
  totalUnits: number;
  totalRevenue: string;
};

export function renderThermalDayCloseReceipt(data: ThermalDayCloseReceipt): string {
  const headerName = data.companyName.trim() || data.filialName?.trim() || "VENOM ERP";
  const ticketLines = data.tickets
    .map(
      (t) => `
        <tr>
          <td>${escapeHtml(t.time)}</td>
          <td class="num">${t.items} it.</td>
          <td class="num"><strong>${escapeHtml(t.total)}</strong></td>
        </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="pt">
<head>
  <meta charset="UTF-8" />
  <title>FECHO-${escapeHtml(data.date)}</title>
  <style>
    @page { size: 80mm auto; margin: 2mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 76mm;
      max-width: 76mm;
      font-family: "Courier New", Consolas, monospace;
      font-size: 12px;
      line-height: 1.35;
      color: #000;
      background: #fff;
    }
    .center { text-align: center; }
    .bold { font-weight: 700; }
    .big { font-size: 15px; }
    .muted { font-size: 11px; }
    .rule { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 2px 0; }
    .num { text-align: right; white-space: nowrap; }
    .total { font-size: 16px; font-weight: 700; padding: 6px 0; }
    .foot { margin-top: 8px; font-size: 11px; text-align: center; }
  </style>
</head>
<body>
  <div class="center bold big">${escapeHtml(headerName)}</div>
  ${data.filialName ? `<div class="center">${escapeHtml(data.filialName)}</div>` : ""}
  <hr class="rule" />
  <div class="center bold big">FECHO DE DIA</div>
  <div class="center">${escapeHtml(new Date(data.date).toLocaleDateString("pt-AO"))}</div>
  <div class="muted center">Fechado: ${escapeHtml(new Date(data.closedAt).toLocaleString("pt-AO"))}</div>
  <div class="muted center">Operador: ${escapeHtml(data.closedBy)}</div>
  <hr class="rule" />
  <table>
    <tr class="bold"><td>Hora</td><td class="num">Itens</td><td class="num">Total</td></tr>
    ${ticketLines || '<tr><td colspan="3" class="center muted">Sem vendas</td></tr>'}
  </table>
  <hr class="rule" />
  <div>Vendas: <strong>${data.ticketCount}</strong></div>
  <div>Unidades: <strong>${data.totalUnits}</strong></div>
  <div class="total">TOTAL DIA: ${escapeHtml(data.totalRevenue)}</div>
  <hr class="rule" />
  <div class="foot">Dia encerrado</div>
  <div class="foot muted">VENOM ERP</div>
</body>
</html>`;
}
