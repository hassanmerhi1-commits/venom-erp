import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { Product, Sale, Purchase } from "./erp-store";
import { fmt, productTitle } from "./erp-store";

const BRAND: [number, number, number] = [56, 163, 216];
const GOLD: [number, number, number] = [212, 175, 55];
const INK: [number, number, number] = [20, 20, 20];
const MUTED: [number, number, number] = [110, 120, 115];
const LINE: [number, number, number] = [225, 232, 228];

function header(doc: jsPDF, kind: "VENDA" | "COMPRA", number: string, dateISO: string) {
  const w = doc.internal.pageSize.getWidth();
  doc.setFillColor(...BRAND);
  doc.rect(0, 0, w, 28, "F");
  doc.setFillColor(...GOLD);
  doc.rect(0, 28, w, 1.2, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("VENOM ERP", 14, 13);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Gestão de Stock · Vendas · Compras", 14, 20);
  doc.setFontSize(8);
  doc.text("Emitido: " + new Date().toLocaleString("pt-AO"), w - 14, 13, { align: "right" });

  // Title block
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  const title = kind === "VENDA" ? "FATURA DE VENDA" : "FATURA DE COMPRA";
  doc.text(title, 14, 46);

  // Meta box (right)
  const boxX = w - 14 - 70;
  const boxY = 36;
  doc.setDrawColor(...LINE);
  doc.setFillColor(248, 251, 249);
  doc.roundedRect(boxX, boxY, 70, 22, 2, 2, "FD");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text("Nº DOCUMENTO", boxX + 4, boxY + 6);
  doc.text("DATA", boxX + 4, boxY + 14);
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(number, boxX + 66, boxY + 6, { align: "right" });
  doc.text(new Date(dateISO).toLocaleDateString("pt-AO"), boxX + 66, boxY + 14, { align: "right" });

  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.line(14, 62, w - 14, 62);
  return 70;
}

function footer(doc: jsPDF, note: string) {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    const w = doc.internal.pageSize.getWidth();
    const h = doc.internal.pageSize.getHeight();
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.3);
    doc.line(14, h - 18, w - 14, h - 18);
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(note, 14, h - 12);
    doc.text(`pág. ${i}/${pages}`, w - 14, h - 12, { align: "right" });
    doc.setFontSize(7);
    doc.text("Documento gerado eletronicamente · VENOM ERP", w / 2, h - 7, { align: "center" });
  }
}

function totalsBlock(doc: jsPDF, y: number, rows: Array<[string, string, boolean?]>) {
  const w = doc.internal.pageSize.getWidth();
  const boxW = 90;
  const x = w - 14 - boxW;
  const rowH = 7;
  const h = rows.length * rowH + 4;
  doc.setDrawColor(...LINE);
  doc.setFillColor(252, 253, 252);
  doc.roundedRect(x, y, boxW, h, 2, 2, "FD");
  rows.forEach(([label, value, strong], i) => {
    const ry = y + 5 + i * rowH;
    doc.setFont("helvetica", strong ? "bold" : "normal");
    doc.setFontSize(strong ? 11 : 9);
    doc.setTextColor(...(strong ? BRAND : INK));
    doc.text(label, x + 4, ry);
    doc.text(value, x + boxW - 4, ry, { align: "right" });
    if (i < rows.length - 1) {
      doc.setDrawColor(...LINE);
      doc.setLineWidth(0.1);
      doc.line(x + 3, ry + 2, x + boxW - 3, ry + 2);
    }
  });
  return y + h + 4;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderInvoiceHtml({
  title,
  number,
  dateISO,
  rows,
  totals,
  signatures,
  note,
}: {
  title: string;
  number: string;
  dateISO: string;
  rows: Array<{ index: number; product: string; qty: string; unitPrice: string; total: string; extra?: string }>;
  totals: Array<{ label: string; value: string; strong?: boolean }>;
  signatures: [string, string];
  note: string;
}) {
  const rowsHtml = rows
    .map(
      (row) => `
        <tr>
          <td>${row.index}</td>
          <td>${escapeHtml(row.product)}</td>
          <td class="num">${escapeHtml(row.qty)}</td>
          <td class="num">${escapeHtml(row.unitPrice)}</td>
          <td class="num">${escapeHtml(row.total)}</td>
          <td class="num">${escapeHtml(row.extra ?? "—")}</td>
        </tr>`,
    )
    .join("");

  const totalsHtml = totals
    .map(
      (row) => `
        <div class="total-row ${row.strong ? "strong" : ""}">
          <span>${escapeHtml(row.label)}</span>
          <strong>${escapeHtml(row.value)}</strong>
        </div>`,
    )
    .join("");

  return `<!doctype html>
<html lang="pt">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(number)}</title>
    <style>
      :root {
        color-scheme: light;
        --brand: rgb(${BRAND.join(",")});
        --gold: rgb(${GOLD.join(",")});
        --ink: rgb(${INK.join(",")});
        --muted: rgb(${MUTED.join(",")});
        --line: rgb(${LINE.join(",")});
        --surface: #ffffff;
        --surface-muted: #f6faf7;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: #edf2ef;
        color: var(--ink);
        font-family: Arial, Helvetica, sans-serif;
      }
      .page {
        width: min(920px, 100%);
        margin: 0 auto;
        background: var(--surface);
        min-height: 100vh;
        box-shadow: 0 18px 40px rgba(0, 0, 0, 0.08);
      }
      .hero {
        background: var(--brand);
        color: white;
        padding: 28px 36px 18px;
        border-bottom: 4px solid var(--gold);
      }
      .hero h1 {
        margin: 0;
        font-size: 30px;
      }
      .hero p {
        margin: 6px 0 0;
        font-size: 13px;
        opacity: 0.9;
      }
      .content {
        padding: 28px 36px 40px;
      }
      .topbar {
        display: flex;
        justify-content: space-between;
        gap: 24px;
        align-items: flex-start;
        margin-bottom: 26px;
      }
      .title {
        font-size: 28px;
        font-weight: 700;
        margin: 0 0 8px;
      }
      .meta {
        min-width: 260px;
        border: 1px solid var(--line);
        background: var(--surface-muted);
        border-radius: 10px;
        padding: 14px 16px;
      }
      .meta-row {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        font-size: 13px;
        margin: 0 0 8px;
      }
      .meta-row:last-child { margin-bottom: 0; }
      .meta-row span { color: var(--muted); }
      .meta-row strong { text-align: right; }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 10px;
      }
      th, td {
        border: 1px solid var(--line);
        padding: 10px 12px;
        text-align: left;
        font-size: 13px;
      }
      thead th {
        background: var(--brand);
        color: white;
      }
      tbody tr:nth-child(even) { background: var(--surface-muted); }
      .num { text-align: right; white-space: nowrap; }
      .summary {
        margin-top: 20px;
        margin-left: auto;
        width: min(360px, 100%);
        border: 1px solid var(--line);
        border-radius: 10px;
        background: #fcfdfc;
        padding: 12px 16px;
      }
      .total-row {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        padding: 8px 0;
        border-bottom: 1px solid var(--line);
        font-size: 14px;
      }
      .total-row:last-child { border-bottom: 0; }
      .total-row.strong {
        color: var(--brand);
        font-size: 17px;
      }
      .signatures {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 28px;
        margin-top: 48px;
      }
      .signature-line {
        padding-top: 10px;
        border-top: 1px solid var(--ink);
        text-align: center;
        color: var(--muted);
        font-size: 12px;
      }
      .footer {
        margin-top: 28px;
        padding-top: 18px;
        border-top: 1px solid var(--line);
        color: var(--muted);
        font-size: 12px;
        display: flex;
        justify-content: space-between;
        gap: 16px;
      }
      @media print {
        body { background: white; }
        .page {
          width: auto;
          margin: 0;
          min-height: auto;
          box-shadow: none;
        }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="hero">
        <h1>VENOM ERP</h1>
        <p>Gestão de Stock · Vendas · Compras</p>
      </section>
      <section class="content">
        <div class="topbar">
          <div>
            <h2 class="title">${escapeHtml(title)}</h2>
            <div style="font-size:13px;color:var(--muted)">Emitido: ${escapeHtml(new Date().toLocaleString("pt-AO"))}</div>
          </div>
          <div class="meta">
            <div class="meta-row"><span>Nº DOCUMENTO</span><strong>${escapeHtml(number)}</strong></div>
            <div class="meta-row"><span>DATA</span><strong>${escapeHtml(new Date(dateISO).toLocaleDateString("pt-AO"))}</strong></div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Produto</th>
              <th class="num">Qtd</th>
              <th class="num">Preço Un.</th>
              <th class="num">Total</th>
              <th class="num">Obs.</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>

        <section class="summary">${totalsHtml}</section>

        <section class="signatures">
          <div class="signature-line">${escapeHtml(signatures[0])}</div>
          <div class="signature-line">${escapeHtml(signatures[1])}</div>
        </section>

        <footer class="footer">
          <span>${escapeHtml(note)}</span>
          <span>Documento gerado eletronicamente</span>
        </footer>
      </section>
    </main>
  </body>
</html>`;
}

function buildPdf(doc: jsPDF, filename: string, html: string): { url: string; filename: string; html: string } {
  const blob = doc.output("blob");
  const url = URL.createObjectURL(blob);
  return { url, filename, html };
}

export type PdfResult = { url: string; filename: string; html: string };

function invoiceNumber(prefix: "FV" | "FC", dateISO: string, id: string) {
  const d = new Date(dateISO);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const short = id.replace(/-/g, "").slice(0, 6).toUpperCase();
  return `${prefix}-${yyyy}${mm}${dd}-${short}`;
}

/* ============ FATURA DE VENDA ============ */
export function printSaleInvoice(group: Sale[], products: Product[]): PdfResult | null {
  if (group.length === 0) return null;
  const first = group[0];
  const doc = new jsPDF();
  const number = invoiceNumber("FV", first.date, first.id);
  const startY = header(doc, "VENDA", number, first.date);

  const totalQty = group.reduce((a, s) => a + s.qty, 0);
  const totalRev = group.reduce((a, s) => a + s.revenue, 0);
  const totalCost = group.reduce((a, s) => a + s.unitCost * s.qty, 0);
  const totalProfit = group.reduce((a, s) => a + s.profit, 0);

  autoTable(doc, {
    startY,
    head: [["#", "Produto", "Qtd", "Preço Un.", "Total"]],
    body: group.map((s, i) => {
      const p = products.find((x) => x.id === s.productId);
      return [
        String(i + 1),
        p ? productTitle(p) : "—",
        String(s.qty),
        fmt(s.unitPrice),
        fmt(s.revenue),
      ];
    }),
    theme: "grid",
    styles: { fontSize: 10, cellPadding: 4, lineColor: LINE, lineWidth: 0.1 },
    headStyles: { fillColor: BRAND, textColor: 255, fontStyle: "bold", halign: "left" },
    alternateRowStyles: { fillColor: [246, 250, 247] },
    columnStyles: {
      0: { halign: "center", cellWidth: 12 },
      2: { halign: "right", cellWidth: 20 },
      3: { halign: "right", cellWidth: 35 },
      4: { halign: "right", cellWidth: 40, fontStyle: "bold" },
    },
  });
  // @ts-expect-error autotable
  let y = doc.lastAutoTable.finalY + 6;

  y = totalsBlock(doc, y, [
    ["Itens", String(group.length)],
    ["Unidades", String(totalQty)],
    ["Custo total", fmt(totalCost)],
    ["Lucro", fmt(totalProfit)],
    ["TOTAL A PAGAR", fmt(totalRev), true],
  ]);

  // Signature lines
  const h = doc.internal.pageSize.getHeight();
  const sigY = Math.max(y + 20, h - 50);
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.3);
  doc.line(20, sigY, 90, sigY);
  doc.line(120, sigY, 190, sigY);
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text("Assinatura do Vendedor", 55, sigY + 5, { align: "center" });
  doc.text("Assinatura do Cliente", 155, sigY + 5, { align: "center" });

  footer(doc, "VENOM ERP · Fatura de Venda");
  const html = renderInvoiceHtml({
    title: "FATURA DE VENDA",
    number,
    dateISO: first.date,
    rows: group.map((s, i) => {
      const p = products.find((x) => x.id === s.productId);
      return {
        index: i + 1,
        product: p ? productTitle(p) : "—",
        qty: String(s.qty),
        unitPrice: fmt(s.unitPrice),
        total: fmt(s.revenue),
        extra: `lucro ${fmt(s.profit)}`,
      };
    }),
    totals: [
      { label: "Itens", value: String(group.length) },
      { label: "Unidades", value: String(totalQty) },
      { label: "Custo total", value: fmt(totalCost) },
      { label: "Lucro", value: fmt(totalProfit) },
      { label: "TOTAL A PAGAR", value: fmt(totalRev), strong: true },
    ],
    signatures: ["Assinatura do Vendedor", "Assinatura do Cliente"],
    note: "VENOM ERP · Fatura de Venda",
  });
  return buildPdf(doc, `${number}.pdf`, html);
}

/* ============ FATURA DE COMPRA ============ */
export function printPurchaseInvoice(purchase: Purchase, products: Product[]): PdfResult {
  const doc = new jsPDF();
  const number = invoiceNumber("FC", purchase.date, purchase.id);
  const startY = header(doc, "COMPRA", number, purchase.date);

  const subtotal = purchase.lines.reduce((a, l) => a + l.qty * l.unitPrice, 0);
  const totalUnits = purchase.lines.reduce((a, l) => a + l.qty, 0);

  autoTable(doc, {
    startY,
    head: [["#", "Produto", "Qtd", "Preço Un.", "Subtotal", "Custo c/ Transp."]],
    body: purchase.lines.map((l, i) => {
      const p = products.find((x) => x.id === l.productId);
      return [
        String(i + 1),
        p ? productTitle(p) : "—",
        String(l.qty),
        fmt(l.unitPrice),
        fmt(l.qty * l.unitPrice),
        fmt(l.landedUnitCost),
      ];
    }),
    theme: "grid",
    styles: { fontSize: 10, cellPadding: 4, lineColor: LINE, lineWidth: 0.1 },
    headStyles: { fillColor: BRAND, textColor: 255, fontStyle: "bold", halign: "left" },
    alternateRowStyles: { fillColor: [246, 250, 247] },
    columnStyles: {
      0: { halign: "center", cellWidth: 12 },
      2: { halign: "right", cellWidth: 18 },
      3: { halign: "right", cellWidth: 30 },
      4: { halign: "right", cellWidth: 35, fontStyle: "bold" },
      5: { halign: "right", cellWidth: 38 },
    },
  });
  // @ts-expect-error autotable
  let y = doc.lastAutoTable.finalY + 6;

  y = totalsBlock(doc, y, [
    ["Linhas", String(purchase.lines.length)],
    ["Unidades", String(totalUnits)],
    ["Subtotal", fmt(subtotal)],
    ["Transporte", fmt(purchase.transport)],
    ["TOTAL", fmt(purchase.total), true],
  ]);

  const h = doc.internal.pageSize.getHeight();
  const sigY = Math.max(y + 20, h - 50);
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.3);
  doc.line(20, sigY, 90, sigY);
  doc.line(120, sigY, 190, sigY);
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text("Assinatura do Comprador", 55, sigY + 5, { align: "center" });
  doc.text("Assinatura do Fornecedor", 155, sigY + 5, { align: "center" });

  footer(doc, "VENOM ERP · Fatura de Compra (Arquivo)");
  const html = renderInvoiceHtml({
    title: "FATURA DE COMPRA",
    number,
    dateISO: purchase.date,
    rows: purchase.lines.map((l, i) => {
      const p = products.find((x) => x.id === l.productId);
      return {
        index: i + 1,
        product: p ? productTitle(p) : "—",
        qty: String(l.qty),
        unitPrice: fmt(l.unitPrice),
        total: fmt(l.qty * l.unitPrice),
        extra: fmt(l.landedUnitCost),
      };
    }),
    totals: [
      { label: "Linhas", value: String(purchase.lines.length) },
      { label: "Unidades", value: String(totalUnits) },
      { label: "Subtotal", value: fmt(subtotal) },
      { label: "Transporte", value: fmt(purchase.transport) },
      { label: "TOTAL", value: fmt(purchase.total), strong: true },
    ],
    signatures: ["Assinatura do Comprador", "Assinatura do Fornecedor"],
    note: "VENOM ERP · Fatura de Compra (Arquivo)",
  });
  return buildPdf(doc, `${number}.pdf`, html);
}

/* Group sales by exact ISO date (one recordSale call = one invoice) */
export function groupSales(sales: Sale[]): Sale[][] {
  const map = new Map<string, Sale[]>();
  for (const s of sales) {
    const arr = map.get(s.date) ?? [];
    arr.push(s);
    map.set(s.date, arr);
  }
  return Array.from(map.values()).sort(
    (a, b) => new Date(b[0].date).getTime() - new Date(a[0].date).getTime(),
  );
}