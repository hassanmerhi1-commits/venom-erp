import { useMemo, useRef, useState, useEffect } from "react";
import { useErp, fmt, inMonth, productTitle, productCode } from "@/lib/erp-store";
import { getCompany } from "@/lib/accounts-store";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import ExcelJS from "exceljs";

type Preview = { doc: jsPDF; url: string; filename: string };

type RangeKind = "day" | "month" | "custom";

function fmtDate(d: Date) {
  return d.toLocaleDateString("pt-AO");
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-AO");
}
function num(n: number) {
  return new Intl.NumberFormat("pt-AO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(isFinite(n) ? n : 0);
}

function pdfHeader(doc: jsPDF, title: string, subtitle: string) {
  const w = doc.internal.pageSize.getWidth();
  // Brand bar
  doc.setFillColor(56, 163, 216);
  doc.rect(0, 0, w, 26, "F");
  // accent stripe
  doc.setFillColor(212, 175, 55);
  doc.rect(0, 26, w, 1.2, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  const company = getCompany();
  doc.text(company.name ? company.name : "VENOM ERP", 14, 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const sub = [company.name ? "VENOM ERP" : "", company.phone, company.address].filter(Boolean).join("  ·  ");
  if (sub) doc.text(sub, 14, 20);
  doc.setFontSize(9);
  doc.text(new Date().toLocaleString("pt-AO"), w - 14, 16, { align: "right" });

  doc.setTextColor(20, 20, 20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(title, 14, 40);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90, 90, 90);
  doc.text(subtitle, 14, 46);
  // separator line
  doc.setDrawColor(220, 226, 222);
  doc.setLineWidth(0.3);
  doc.line(14, 50, w - 14, 50);
  doc.setTextColor(20, 20, 20);
  return 56;
}

function pdfFooter(doc: jsPDF) {
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const w = doc.internal.pageSize.getWidth();
    const h = doc.internal.pageSize.getHeight();
    doc.setDrawColor(220, 226, 222);
    doc.setLineWidth(0.3);
    doc.line(14, h - 14, w - 14, h - 14);
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text("VENOM ERP · Relatório gerado automaticamente", 14, h - 8);
    doc.text(`pág. ${i}/${pageCount}`, w - 14, h - 8, { align: "right" });
  }
}

function sectionTitle(doc: jsPDF, y: number, text: string) {
  const w = doc.internal.pageSize.getWidth();
  doc.setFillColor(56, 163, 216);
  doc.rect(14, y, 3, 5.5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(20, 20, 20);
  doc.text(text.toUpperCase(), 20, y + 4.2);
  doc.setDrawColor(230, 235, 232);
  doc.setLineWidth(0.2);
  doc.line(20 + doc.getTextWidth(text.toUpperCase()) + 4, y + 3, w - 14, y + 3);
  return y + 9;
}

function kpiCards(doc: jsPDF, y: number, items: Array<{ label: string; value: string; tone?: "good" | "bad" | "neutral" }>) {
  const w = doc.internal.pageSize.getWidth();
  const gap = 4;
  const cols = items.length;
  const cw = (w - 28 - gap * (cols - 1)) / cols;
  const ch = 18;
  items.forEach((it, i) => {
    const x = 14 + i * (cw + gap);
    doc.setFillColor(248, 251, 249);
    doc.setDrawColor(225, 232, 228);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, cw, ch, 1.5, 1.5, "FD");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(110, 120, 115);
    doc.text(it.label.toUpperCase(), x + 3, y + 5);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    const tone = it.tone === "good" ? [56, 163, 216] : it.tone === "bad" ? [200, 40, 40] : [20, 20, 20];
    doc.setTextColor(tone[0], tone[1], tone[2]);
    doc.text(it.value, x + 3, y + 13);
  });
  return y + ch + 4;
}

const HEAD = { fillColor: [56, 163, 216] as [number, number, number], textColor: 255, fontStyle: "bold" as const };
const STRIPE = { fillColor: [246, 250, 247] as [number, number, number] };
const TABLE_BASE = { fontSize: 9, cellPadding: 3.5, lineColor: [225, 232, 228] as [number, number, number], lineWidth: 0.1 };

function summaryRows(doc: jsPDF, startY: number, items: Array<[string, string]>) {
  autoTable(doc, {
    startY,
    body: items,
    theme: "plain",
    styles: { fontSize: 10, cellPadding: { top: 2, bottom: 2, left: 0, right: 4 } },
    columnStyles: {
      0: { fontStyle: "bold", textColor: [60, 60, 60] },
      1: { halign: "right", fontStyle: "bold" },
    },
  });
  // @ts-expect-error lastAutoTable injected by autotable
  return doc.lastAutoTable.finalY + 4;
}

export function Reports() {
  const { products, purchases, sales } = useErp();
  const [ym, setYm] = useState(new Date().toISOString().slice(0, 7));
  const today = new Date().toISOString().slice(0, 10);
  const [day, setDay] = useState(today);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [invDate, setInvDate] = useState(today);

  const [preview, setPreview] = useState<Preview | null>(null);

  const openPreview = (doc: jsPDF, filename: string) => {
    const url = String(doc.output("bloburl"));
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return { doc, url, filename };
    });
  };

  const closePreview = () => {
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
  };

  const data = useMemo(() => {
    const monthSales = sales.filter((s) => inMonth(s.date, ym));
    const monthPurchases = purchases.filter((p) => inMonth(p.date, ym));

    const revenue = monthSales.reduce((a, s) => a + s.revenue, 0);
    const cogs = monthSales.reduce((a, s) => a + s.unitCost * s.qty, 0);
    const netProfit = revenue - cogs;

    const purchasesValue = monthPurchases.reduce((a, p) => a + (p.total - p.transport), 0);
    const transportValue = monthPurchases.reduce((a, p) => a + p.transport, 0);

    const unitsSold = monthSales.reduce((a, s) => a + s.qty, 0);

    // breakdown per product
    const byProduct = new Map<string, { units: number; revenue: number; cogs: number; profit: number }>();
    for (const s of monthSales) {
      const cur = byProduct.get(s.productId) ?? { units: 0, revenue: 0, cogs: 0, profit: 0 };
      cur.units += s.qty;
      cur.revenue += s.revenue;
      cur.cogs += s.unitCost * s.qty;
      cur.profit += s.profit;
      byProduct.set(s.productId, cur);
    }

    return { monthSales, monthPurchases, revenue, cogs, netProfit, purchasesValue, transportValue, unitsSold, byProduct };
  }, [sales, purchases, ym]);

  const exportXlsx = async () => {
    const wb = new ExcelJS.Workbook();
    wb.creator = "VENOM ERP";
    wb.created = new Date();

    const BRAND = "FF38A3D8";
    const BRAND_SOFT = "FFE8F3EE";
    const MONEY = '_-* #,##0.00\\ "AOA"_-;[Red]-* #,##0.00\\ "AOA"_-;_-* "-"??\\ _-;_-@_-';
    const NAME = (id: string) => {
      const p = products.find((x) => x.id === id);
      return p ? productTitle(p) : "—";
    };

    const styleTitle = (cell: ExcelJS.Cell) => {
      cell.font = { name: "Calibri", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND } };
      cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    };
    const styleSubtitle = (cell: ExcelJS.Cell) => {
      cell.font = { name: "Calibri", size: 10, italic: true, color: { argb: "FF666666" } };
      cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    };

    type Col = { header: string; key: string; width: number; money?: boolean; int?: boolean };
    const addTable = (
      ws: ExcelJS.Worksheet,
      name: string,
      tableName: string,
      cols: Col[],
      rows: (string | number)[][],
      totals?: (string | number | null)[],
    ) => {
      // section heading row
      ws.addRow([]);
      const head = ws.addRow([name]);
      ws.mergeCells(head.number, 1, head.number, cols.length);
      head.getCell(1).font = { name: "Calibri", size: 12, bold: true, color: { argb: "FFFFFFFF" } };
      head.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND } };
      head.getCell(1).alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      head.height = 22;

      const startRef = `A${ws.rowCount + 1}`;
      const endRow = ws.rowCount + 1 + rows.length;
      const endCol = String.fromCharCode(64 + cols.length);
      const totalsRow = !!totals;

      ws.addTable({
        name: tableName,
        ref: startRef,
        headerRow: true,
        totalsRow,
        style: { theme: "TableStyleMedium11", showRowStripes: true },
        columns: cols.map((c, i) => ({
          name: c.header,
          filterButton: true,
          totalsRowLabel: i === 0 && totalsRow ? "TOTAL" : undefined,
          totalsRowFunction: totals && typeof totals[i] === "number" ? "sum" : undefined,
        })),
        rows,
      });

      // apply widths + number formats
      cols.forEach((c, i) => {
        const col = ws.getColumn(i + 1);
        col.width = c.width;
        if (c.money) col.numFmt = MONEY;
        if (c.int) col.numFmt = "#,##0";
      });

      // freeze widths can shrink; ensure each data cell gets format too
      for (let r = ws.rowCount - rows.length - (totalsRow ? 0 : 0); r <= endRow; r++) {
        cols.forEach((c, i) => {
          const cell = ws.getCell(r, i + 1);
          if (c.money) cell.numFmt = MONEY;
          if (c.int) cell.numFmt = "#,##0";
        });
      }
      void endCol;
    };

    const addCover = (ws: ExcelJS.Worksheet, title: string, subtitle: string) => {
      ws.columns = [{ width: 30 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 22 }];
      const t = ws.addRow([title]);
      ws.mergeCells(t.number, 1, t.number, 7);
      styleTitle(t.getCell(1));
      t.height = 32;
      const s = ws.addRow([subtitle]);
      ws.mergeCells(s.number, 1, s.number, 7);
      styleSubtitle(s.getCell(1));
      s.height = 18;
      ws.views = [{ state: "frozen", ySplit: 2 }];
    };

    // ============ Sheet: Resumo ============
    const wsR = wb.addWorksheet("Resumo", { properties: { tabColor: { argb: BRAND } } });
    addCover(wsR, `VENOM ERP — Resumo`, `Mês ${ym} · gerado em ${new Date().toLocaleString("pt-AO")}`);
    addTable(
      wsR,
      "Indicadores",
      "tblKpi",
      [
        { header: "Indicador", key: "k", width: 36 },
        { header: "Valor", key: "v", width: 24, money: true },
      ],
      [
        ["Receita", data.revenue],
        ["Custo das vendas (COGS)", data.cogs],
        ["Lucro líquido", data.netProfit],
        ["Compras (mercadoria)", data.purchasesValue],
        ["Frete / transporte", data.transportValue],
      ],
    );
    addTable(
      wsR,
      "Operacional",
      "tblOps",
      [
        { header: "Indicador", key: "k", width: 36 },
        { header: "Quantidade", key: "v", width: 18, int: true },
      ],
      [
        ["Unidades vendidas", data.unitsSold],
        ["Nº de vendas", data.monthSales.length],
        ["Nº de compras", data.monthPurchases.length],
        ["Produtos cadastrados", products.length],
      ],
    );

    // ============ Sheet: Vendas ============
    const wsS = wb.addWorksheet("Vendas", { properties: { tabColor: { argb: BRAND } } });
    addCover(wsS, "Vendas", `Mês ${ym}`);
    addTable(
      wsS,
      "Lista de vendas",
      "tblSales",
      [
        { header: "Data", key: "d", width: 22 },
        { header: "Produto", key: "p", width: 30 },
        { header: "Qtd", key: "q", width: 10, int: true },
        { header: "Preço un.", key: "pu", width: 16, money: true },
        { header: "Custo un.", key: "cu", width: 16, money: true },
        { header: "Receita", key: "r", width: 18, money: true },
        { header: "Lucro", key: "l", width: 18, money: true },
      ],
      data.monthSales.map((s) => [
        new Date(s.date).toLocaleString("pt-AO"),
        NAME(s.productId),
        s.qty,
        s.unitPrice,
        s.unitCost,
        s.revenue,
        s.profit,
      ]),
      ["TOTAL", "", data.unitsSold, null, null, data.revenue, data.netProfit],
    );

    // ============ Sheet: Compras ============
    const wsP = wb.addWorksheet("Compras", { properties: { tabColor: { argb: BRAND } } });
    addCover(wsP, "Compras", `Mês ${ym} · frete incluído por unidade (landed cost)`);
    const purchaseRows: (string | number)[][] = [];
    for (const pu of data.monthPurchases) {
      for (const l of pu.lines) {
        purchaseRows.push([
          new Date(pu.date).toLocaleDateString("pt-AO"),
          NAME(l.productId),
          l.qty,
          l.unitPrice,
          l.landedUnitCost,
          l.qty * l.landedUnitCost,
        ]);
      }
    }
    addTable(
      wsP,
      "Linhas de compra",
      "tblPurch",
      [
        { header: "Data", key: "d", width: 16 },
        { header: "Produto", key: "p", width: 30 },
        { header: "Qtd", key: "q", width: 10, int: true },
        { header: "Preço un.", key: "pu", width: 16, money: true },
        { header: "Custo c/ frete", key: "cu", width: 18, money: true },
        { header: "Total linha", key: "t", width: 18, money: true },
      ],
      purchaseRows,
      ["TOTAL", "", purchaseRows.reduce((a, r) => a + (r[2] as number), 0), null, null, purchaseRows.reduce((a, r) => a + (r[5] as number), 0)],
    );

    // ============ Sheet: Lucro por produto ============
    const wsL = wb.addWorksheet("Lucro", { properties: { tabColor: { argb: BRAND } } });
    addCover(wsL, "Lucro por produto", `Mês ${ym}`);
    const profitRows = [...data.byProduct.entries()]
      .sort((a, b) => b[1].profit - a[1].profit)
      .map(([pid, v]) => {
        const margin = v.revenue > 0 ? v.profit / v.revenue : 0;
        return [NAME(pid), v.units, v.revenue, v.cogs, v.profit, margin] as (string | number)[];
      });
    addTable(
      wsL,
      "Margem por produto",
      "tblProfit",
      [
        { header: "Produto", key: "p", width: 30 },
        { header: "Unidades", key: "u", width: 12, int: true },
        { header: "Receita", key: "r", width: 18, money: true },
        { header: "Custo", key: "c", width: 18, money: true },
        { header: "Lucro", key: "l", width: 18, money: true },
        { header: "Margem", key: "m", width: 12 },
      ],
      profitRows,
      ["TOTAL", data.unitsSold, data.revenue, data.cogs, data.netProfit, data.revenue > 0 ? data.netProfit / data.revenue : 0],
    );
    // percent format for margin col
    wsL.getColumn(6).numFmt = "0.0%";

    // ============ Sheet: Inventário ============
    const wsI = wb.addWorksheet("Inventário", { properties: { tabColor: { argb: BRAND_SOFT } } });
    const [yy, mm] = ym.split("-").map(Number);
    const lastDay = new Date(yy, mm, 0).toISOString().slice(0, 10);
    addCover(wsI, "Inventário", `Stock em ${new Date(lastDay).toLocaleDateString("pt-AO")} · valor a custo (c/ frete)`);
    const cutoffEnd = lastDay + "T23:59:59";
    const purchasedAfter = new Map<string, number>();
    const costMap = new Map<string, { qty: number; cost: number }>();
    for (const pu of purchases) {
      if (pu.date > cutoffEnd) {
        for (const l of pu.lines) purchasedAfter.set(l.productId, (purchasedAfter.get(l.productId) ?? 0) + l.qty);
      } else {
        for (const l of pu.lines) {
          const cur = costMap.get(l.productId) ?? { qty: 0, cost: 0 };
          cur.qty += l.qty; cur.cost += l.qty * l.landedUnitCost;
          costMap.set(l.productId, cur);
        }
      }
    }
    const soldAfter = new Map<string, number>();
    for (const s of sales) if (s.date > cutoffEnd) soldAfter.set(s.productId, (soldAfter.get(s.productId) ?? 0) + s.qty);
    let invUnits = 0, invValue = 0;
    const invRows = products.map((p) => {
      const stockAt = p.stock - (purchasedAfter.get(p.id) ?? 0) + (soldAfter.get(p.id) ?? 0);
      const c = costMap.get(p.id);
      const avgAt = c && c.qty > 0 ? c.cost / c.qty : p.avgCost;
      const value = stockAt * avgAt;
      invUnits += stockAt; invValue += value;
      return [productCode(p), p.sku?.trim() || "—", stockAt, avgAt, value, p.salePrice ?? 0] as (string | number)[];
    });
    addTable(
      wsI,
      "Stock por produto",
      "tblInv",
      [
        { header: "Código", key: "p", width: 14 },
        { header: "Nome do produto", key: "s", width: 30 },
        { header: "Stock", key: "q", width: 10, int: true },
        { header: "Custo médio", key: "c", width: 18, money: true },
        { header: "Valor", key: "v", width: 18, money: true },
        { header: "Preço venda", key: "sp", width: 16, money: true },
      ],
      invRows,
      ["TOTAL", "", invUnits, null, invValue, null],
    );

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `venom-relatorio-${ym}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---- PDF helpers ----
  const filterByRange = <T extends { date: string }>(rows: T[], kind: RangeKind) => {
    if (kind === "day") return rows.filter((r) => r.date.slice(0, 10) === day);
    if (kind === "month") return rows.filter((r) => inMonth(r.date, ym));
    const f = from + "T00:00:00";
    const t = to + "T23:59:59";
    return rows.filter((r) => r.date >= f && r.date <= t);
  };

  const rangeLabel = (kind: RangeKind) => {
    if (kind === "day") return `Dia ${fmtDate(new Date(day))}`;
    if (kind === "month") return `Mês ${ym}`;
    return `${fmtDate(new Date(from))} → ${fmtDate(new Date(to))}`;
  };

  const productName = (id: string) => {
    const p = products.find((x) => x.id === id);
    return p ? productTitle(p) : "—";
  };

  const salesPdf = (kind: RangeKind) => {
    const rows = filterByRange(sales, kind).slice().sort((a, b) => a.date.localeCompare(b.date));
    const revenue = rows.reduce((a, s) => a + s.revenue, 0);
    const cogs = rows.reduce((a, s) => a + s.unitCost * s.qty, 0);
    const profit = revenue - cogs;
    const units = rows.reduce((a, s) => a + s.qty, 0);

    const doc = new jsPDF();
    let y = pdfHeader(doc, "Relatório de Vendas", rangeLabel(kind));
    y = kpiCards(doc, y, [
      { label: "Receita", value: num(revenue) },
      { label: "Custo", value: num(cogs) },
      { label: "Lucro", value: num(profit), tone: profit >= 0 ? "good" : "bad" },
      { label: "Unidades", value: String(units) },
    ]);
    y = sectionTitle(doc, y, "Vendas detalhadas");
    autoTable(doc, {
      startY: y + 2,
      head: [["Data", "Produto", "Qtd", "Preço un.", "Custo un.", "Receita", "Lucro"]],
      body: rows.map((s) => [
        fmtDateTime(s.date),
        productName(s.productId),
        String(s.qty),
        num(s.unitPrice),
        num(s.unitCost),
        num(s.revenue),
        num(s.profit),
      ]),
      headStyles: HEAD,
      styles: TABLE_BASE,
      alternateRowStyles: STRIPE,
      columnStyles: {
        2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" },
        5: { halign: "right" }, 6: { halign: "right" },
      },
    });
    pdfFooter(doc);
    openPreview(doc, `vendas-${kind}-${kind === "month" ? ym : kind === "day" ? day : `${from}_${to}`}.pdf`);
  };

  const purchasesPdf = (kind: RangeKind) => {
    const rows = filterByRange(purchases, kind).slice().sort((a, b) => a.date.localeCompare(b.date));
    const total = rows.reduce((a, p) => a + p.total, 0);
    const transport = rows.reduce((a, p) => a + p.transport, 0);
    const linesCount = rows.reduce((a, p) => a + p.lines.length, 0);

    const doc = new jsPDF();
    let y = pdfHeader(doc, "Relatório de Compras", rangeLabel(kind));
    y = kpiCards(doc, y, [
      { label: "Mercadoria", value: num(total - transport) },
      { label: "Frete (transporte)", value: num(transport) },
      { label: "Total compras", value: num(total) },
      { label: "Nº compras", value: `${rows.length} / ${linesCount}L` },
    ]);
    y = sectionTitle(doc, y, "Compras detalhadas");
    const body: (string | number)[][] = [];
    for (const p of rows) {
      for (const l of p.lines) {
        body.push([
          fmtDate(new Date(p.date)),
          productName(l.productId),
          String(l.qty),
          num(l.unitPrice),
          num(l.landedUnitCost),
          num(l.qty * l.landedUnitCost),
        ]);
      }
    }
    autoTable(doc, {
      startY: y + 2,
      head: [["Data", "Produto", "Qtd", "Preço un.", "Custo c/transp.", "Total"]],
      body,
      headStyles: HEAD,
      styles: TABLE_BASE,
      alternateRowStyles: STRIPE,
      columnStyles: { 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } },
    });
    pdfFooter(doc);
    openPreview(doc, `compras-${kind}-${kind === "month" ? ym : kind === "day" ? day : `${from}_${to}`}.pdf`);
  };

  const profitPdf = (kind: RangeKind) => {
    const rows = filterByRange(sales, kind);
    const byProduct = new Map<string, { units: number; revenue: number; cogs: number; profit: number }>();
    for (const s of rows) {
      const cur = byProduct.get(s.productId) ?? { units: 0, revenue: 0, cogs: 0, profit: 0 };
      cur.units += s.qty;
      cur.revenue += s.revenue;
      cur.cogs += s.unitCost * s.qty;
      cur.profit += s.profit;
      byProduct.set(s.productId, cur);
    }
    const totals = { revenue: 0, cogs: 0, profit: 0, units: 0 };
    const body = [...byProduct.entries()]
      .sort((a, b) => b[1].profit - a[1].profit)
      .map(([pid, v]) => {
        totals.revenue += v.revenue; totals.cogs += v.cogs; totals.profit += v.profit; totals.units += v.units;
        const margin = v.revenue > 0 ? (v.profit / v.revenue) * 100 : 0;
        return [
          productName(pid),
          String(v.units),
          num(v.revenue),
          num(v.cogs),
          num(v.profit),
          margin.toFixed(1) + " %",
        ];
      });
    const totalMargin = totals.revenue > 0 ? (totals.profit / totals.revenue) * 100 : 0;

    const doc = new jsPDF();
    let y = pdfHeader(doc, "Mapa de Lucro por Produto", rangeLabel(kind));
    y = kpiCards(doc, y, [
      { label: "Receita", value: num(totals.revenue) },
      { label: "Custo", value: num(totals.cogs) },
      { label: "Lucro", value: num(totals.profit), tone: totals.profit >= 0 ? "good" : "bad" },
      { label: "Margem média", value: totalMargin.toFixed(1) + "%" },
    ]);
    y = sectionTitle(doc, y, "Lucro por produto");
    autoTable(doc, {
      startY: y + 2,
      head: [["Produto", "Unidades", "Receita", "Custo", "Lucro", "Margem"]],
      body,
      foot: [[
        "TOTAL",
        String(totals.units),
        num(totals.revenue),
        num(totals.cogs),
        num(totals.profit),
        totalMargin.toFixed(1) + " %",
      ]],
      headStyles: HEAD,
      footStyles: { fillColor: [225, 240, 252], textColor: 20, fontStyle: "bold" },
      styles: { ...TABLE_BASE, fontSize: 10, cellPadding: 4 },
      alternateRowStyles: STRIPE,
      columnStyles: {
        1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" },
        4: { halign: "right" }, 5: { halign: "right" },
      },
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 4) {
          const raw = body[data.row.index][4] as string;
          const v = parseFloat(raw.replace(/\./g, "").replace(",", "."));
          if (!isNaN(v)) data.cell.styles.textColor = v >= 0 ? [56, 163, 216] : [200, 40, 40];
        }
      },
    });
    pdfFooter(doc);
    openPreview(doc, `lucro-${kind}-${kind === "month" ? ym : kind === "day" ? day : `${from}_${to}`}.pdf`);
  };

  // Inventory at a given date: stock_at = currentStock - purchasesAfter + salesAfter
  const inventoryPdf = (atDate: string) => {
    const cutoffEnd = atDate + "T23:59:59";
    const purchasedAfter = new Map<string, number>();
    const costAfter = new Map<string, { qty: number; cost: number }>();
    for (const pu of purchases) {
      if (pu.date > cutoffEnd) {
        for (const l of pu.lines) {
          purchasedAfter.set(l.productId, (purchasedAfter.get(l.productId) ?? 0) + l.qty);
        }
      } else {
        for (const l of pu.lines) {
          const cur = costAfter.get(l.productId) ?? { qty: 0, cost: 0 };
          cur.qty += l.qty;
          cur.cost += l.qty * l.landedUnitCost;
          costAfter.set(l.productId, cur);
        }
      }
    }
    const soldAfter = new Map<string, number>();
    for (const s of sales) {
      if (s.date > cutoffEnd) {
        soldAfter.set(s.productId, (soldAfter.get(s.productId) ?? 0) + s.qty);
      }
    }

    const body: (string | number)[][] = [];
    let totalUnits = 0;
    let totalValue = 0;
    for (const p of products) {
      const stockAt = p.stock - (purchasedAfter.get(p.id) ?? 0) + (soldAfter.get(p.id) ?? 0);
      const c = costAfter.get(p.id);
      const avgAt = c && c.qty > 0 ? c.cost / c.qty : p.avgCost;
      const value = stockAt * avgAt;
      totalUnits += stockAt;
      totalValue += value;
      body.push([
        productCode(p),
        p.sku?.trim() || "—",
        String(stockAt),
        num(avgAt),
        num(value),
        p.salePrice ? num(p.salePrice) : "—",
      ]);
    }

    const doc = new jsPDF();
    let y = pdfHeader(doc, "Inventário", `Stock em ${fmtDate(new Date(atDate))}`);
    y = kpiCards(doc, y, [
      { label: "Produtos", value: String(products.length) },
      { label: "Unidades em stock", value: String(totalUnits) },
      { label: "Valor a custo (AOA)", value: num(totalValue) },
    ]);
    y = sectionTitle(doc, y, "Stock por produto");
    autoTable(doc, {
      startY: y + 2,
      head: [["Código", "Nome do produto", "Stock", "Custo médio", "Valor", "Preço venda"]],
      body,
      foot: [["TOTAL", "", String(totalUnits), "", num(totalValue), ""]],
      headStyles: HEAD,
      footStyles: { fillColor: [225, 240, 252], textColor: 20, fontStyle: "bold" },
      styles: TABLE_BASE,
      alternateRowStyles: STRIPE,
      columnStyles: {
        2: { halign: "right" }, 3: { halign: "right" },
        4: { halign: "right" }, 5: { halign: "right" },
      },
    });
    pdfFooter(doc);
    openPreview(doc, `inventario-${atDate}.pdf`);
  };

  // -------- RESUMO GERAL (compras + frete + vendas + lucro + stock) --------
  const summaryPdf = (kind: RangeKind) => {
    const sRows = filterByRange(sales, kind);
    const pRows = filterByRange(purchases, kind);

    const revenue = sRows.reduce((a, s) => a + s.revenue, 0);
    const cogs = sRows.reduce((a, s) => a + s.unitCost * s.qty, 0);
    const profit = revenue - cogs;
    const units = sRows.reduce((a, s) => a + s.qty, 0);

    const totalPurchases = pRows.reduce((a, p) => a + p.total, 0);
    const transport = pRows.reduce((a, p) => a + p.transport, 0);
    const merch = totalPurchases - transport;

    // stock value at end of range
    let cutoff: string;
    if (kind === "day") cutoff = day;
    else if (kind === "month") {
      const [y, m] = ym.split("-").map(Number);
      cutoff = new Date(y, m, 0).toISOString().slice(0, 10);
    } else cutoff = to;
    const cutoffEnd = cutoff + "T23:59:59";
    const purchasedAfter = new Map<string, number>();
    const costMap = new Map<string, { qty: number; cost: number }>();
    for (const pu of purchases) {
      if (pu.date > cutoffEnd) {
        for (const l of pu.lines) purchasedAfter.set(l.productId, (purchasedAfter.get(l.productId) ?? 0) + l.qty);
      } else {
        for (const l of pu.lines) {
          const cur = costMap.get(l.productId) ?? { qty: 0, cost: 0 };
          cur.qty += l.qty; cur.cost += l.qty * l.landedUnitCost;
          costMap.set(l.productId, cur);
        }
      }
    }
    const soldAfter = new Map<string, number>();
    for (const s of sales) if (s.date > cutoffEnd) soldAfter.set(s.productId, (soldAfter.get(s.productId) ?? 0) + s.qty);
    let stockUnits = 0, stockValue = 0;
    for (const p of products) {
      const stockAt = p.stock - (purchasedAfter.get(p.id) ?? 0) + (soldAfter.get(p.id) ?? 0);
      const c = costMap.get(p.id);
      const avgAt = c && c.qty > 0 ? c.cost / c.qty : p.avgCost;
      stockUnits += stockAt;
      stockValue += stockAt * avgAt;
    }

    const doc = new jsPDF();
    let y = pdfHeader(doc, "Resumo Geral", rangeLabel(kind));

    // KPI row 1 - operational
    y = kpiCards(doc, y, [
      { label: "Receita (vendas)", value: num(revenue) },
      { label: "Custo das vendas", value: num(cogs) },
      { label: "Lucro líquido", value: num(profit), tone: profit >= 0 ? "good" : "bad" },
      { label: "Unidades vendidas", value: String(units) },
    ]);
    // KPI row 2 - purchases + stock
    y = kpiCards(doc, y, [
      { label: "Compras (mercadoria)", value: num(merch) },
      { label: "Frete (transporte)", value: num(transport) },
      { label: "Total compras", value: num(totalPurchases) },
      { label: `Stock em ${fmtDate(new Date(cutoff))}`, value: num(stockValue) },
    ]);

    // breakdown per product (sales)
    const byProduct = new Map<string, { units: number; revenue: number; cogs: number; profit: number }>();
    for (const s of sRows) {
      const cur = byProduct.get(s.productId) ?? { units: 0, revenue: 0, cogs: 0, profit: 0 };
      cur.units += s.qty; cur.revenue += s.revenue; cur.cogs += s.unitCost * s.qty; cur.profit += s.profit;
      byProduct.set(s.productId, cur);
    }
    y = sectionTitle(doc, y, "Vendas por produto");
    autoTable(doc, {
      startY: y + 2,
      head: [["Produto", "Un.", "Receita", "Custo", "Lucro", "Margem"]],
      body: [...byProduct.entries()].sort((a, b) => b[1].profit - a[1].profit).map(([pid, v]) => {
        const m = v.revenue > 0 ? (v.profit / v.revenue) * 100 : 0;
        return [productName(pid), String(v.units), num(v.revenue), num(v.cogs), num(v.profit), m.toFixed(1) + "%"];
      }),
      foot: [["TOTAL", String(units), num(revenue), num(cogs), num(profit), revenue > 0 ? ((profit / revenue) * 100).toFixed(1) + "%" : "—"]],
      headStyles: HEAD,
      footStyles: { fillColor: [225, 240, 252], textColor: 20, fontStyle: "bold" },
      styles: TABLE_BASE,
      alternateRowStyles: STRIPE,
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } },
    });
    // @ts-expect-error lastAutoTable
    y = doc.lastAutoTable.finalY + 6;

    // purchases per product
    const byPurchase = new Map<string, { units: number; cost: number }>();
    for (const pu of pRows) {
      for (const l of pu.lines) {
        const cur = byPurchase.get(l.productId) ?? { units: 0, cost: 0 };
        cur.units += l.qty; cur.cost += l.qty * l.landedUnitCost;
        byPurchase.set(l.productId, cur);
      }
    }
    if (byPurchase.size > 0) {
      y = sectionTitle(doc, y, "Compras por produto (custo c/ frete)");
      autoTable(doc, {
        startY: y + 2,
        head: [["Produto", "Un.", "Custo total"]],
        body: [...byPurchase.entries()].sort((a, b) => b[1].cost - a[1].cost).map(([pid, v]) => [productName(pid), String(v.units), num(v.cost)]),
        foot: [["TOTAL", "", num(totalPurchases)]],
        headStyles: HEAD,
        footStyles: { fillColor: [225, 240, 252], textColor: 20, fontStyle: "bold" },
        styles: TABLE_BASE,
        alternateRowStyles: STRIPE,
        columnStyles: { 1: { halign: "right" }, 2: { halign: "right" } },
      });
    }

    pdfFooter(doc);
    openPreview(doc, `resumo-${kind}-${kind === "month" ? ym : kind === "day" ? day : `${from}_${to}`}.pdf`);
  };

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Relatório mensal</h2>
            <p className="text-xs text-muted-foreground">Vendas, compras, transporte e lucro líquido do mês.</p>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <label className="label">Mês</label>
              <input type="month" className="input" value={ym} onChange={(e) => setYm(e.target.value)} />
            </div>
            <button className="btn-secondary" onClick={exportXlsx}>↧ Excel (.xlsx)</button>
          </div>
        </div>
      </div>

      <div className="card space-y-4">
        <div>
          <h2 className="text-base font-semibold">Relatórios em PDF</h2>
          <p className="text-xs text-muted-foreground">Escolha um dia, mês ou intervalo personalizado e gere um PDF limpo e pronto para imprimir.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label">Dia</label>
            <input type="date" className="input" value={day} onChange={(e) => setDay(e.target.value)} />
          </div>
          <div>
            <label className="label">Mês</label>
            <input type="month" className="input" value={ym} onChange={(e) => setYm(e.target.value)} />
          </div>
          <div>
            <label className="label">De</label>
            <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">Até</label>
            <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <PdfBlock title="★ Resumo geral" desc="Tudo num só PDF: compras, frete, vendas, lucro e valor de stock."
            onDay={() => summaryPdf("day")} onMonth={() => summaryPdf("month")} onRange={() => summaryPdf("custom")} />
          <PdfBlock title="Vendas" desc="Lista detalhada de vendas com receita, custo e lucro."
            onDay={() => salesPdf("day")} onMonth={() => salesPdf("month")} onRange={() => salesPdf("custom")} />
          <PdfBlock title="Compras" desc="Compras com transporte rateado por unidade."
            onDay={() => purchasesPdf("day")} onMonth={() => purchasesPdf("month")} onRange={() => purchasesPdf("custom")} />
          <PdfBlock title="Lucro por produto" desc="Tabela com receita, custo, lucro e margem por produto."
            onDay={() => profitPdf("day")} onMonth={() => profitPdf("month")} onRange={() => profitPdf("custom")} />
        </div>

        <div className="rounded-lg border p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Inventário</h3>
              <p className="text-xs text-muted-foreground">Stock restante numa data qualquer (ex: fim do mês) com valor a custo.</p>
            </div>
            <div className="flex items-end gap-2">
              <div>
                <label className="label">Data</label>
                <input type="date" className="input" value={invDate} onChange={(e) => setInvDate(e.target.value)} />
              </div>
              <button className="btn-secondary" onClick={() => {
                const [y, m] = ym.split("-").map(Number);
                const last = new Date(y, m, 0).toISOString().slice(0, 10);
                setInvDate(last);
              }}>Fim do mês ({ym})</button>
              <button className="btn-primary" onClick={() => inventoryPdf(invDate)}>Gerar PDF</button>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Box label="Receita" value={fmt(data.revenue)} />
        <Box label="Custo das vendas (COGS)" value={fmt(data.cogs)} />
        <Box label="Lucro líquido" value={fmt(data.netProfit)} positive={data.netProfit >= 0} big />
        <Box label="Compras (sem transporte)" value={fmt(data.purchasesValue)} />
        <Box label="Transporte" value={fmt(data.transportValue)} />
        <Box label="Unidades vendidas" value={String(data.unitsSold)} />
      </div>

      <div className="card">
        <h3 className="mb-3 text-sm font-semibold">Por produto</h3>
        {data.byProduct.size === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Sem vendas neste mês.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-2">Produto</th>
                  <th className="py-2 pr-2 text-right">Unidades</th>
                  <th className="py-2 pr-2 text-right">Receita</th>
                  <th className="py-2 pr-2 text-right">Custo</th>
                  <th className="py-2 pr-2 text-right">Lucro</th>
                </tr>
              </thead>
              <tbody>
                {[...data.byProduct.entries()].map(([pid, v]) => {
                  const p = products.find((x) => x.id === pid);
                  return (
                    <tr key={pid} className="border-b last:border-0">
                      <td className="py-2 pr-2 font-medium">{p ? productTitle(p) : "—"}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{v.units}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{fmt(v.revenue)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{fmt(v.cogs)}</td>
                      <td className={`py-2 pr-2 text-right tabular-nums ${v.profit >= 0 ? "text-emerald-600" : "text-destructive"}`}>{fmt(v.profit)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {preview && (
        <PreviewModal
          preview={preview}
          onClose={closePreview}
          onExcel={exportXlsx}
        />
      )}
    </div>
  );
}

function PreviewModal({ preview, onClose, onExcel }: { preview: Preview; onClose: () => void; onExcel: () => void }) {
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const print = () => {
    const w = frameRef.current?.contentWindow;
    if (w) { w.focus(); w.print(); }
  };

  const savePdf = () => {
    preview.doc.save(preview.filename);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="mx-auto flex h-full w-full max-w-[1100px] flex-col p-3 sm:p-6">
        <div className="flex items-center justify-between gap-3 rounded-t-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">Pré-visualização do relatório</h3>
            <p className="truncate text-xs text-muted-foreground">{preview.filename}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button className="btn-secondary" onClick={print} title="Imprimir">🖨 Imprimir</button>
            <button className="btn-secondary" onClick={onExcel} title="Exportar para Excel (mês selecionado)">↧ Excel</button>
            <button className="btn-primary" onClick={savePdf} title="Guardar como PDF">↧ Guardar PDF</button>
            <button className="btn-ghost" onClick={onClose} title="Fechar (Esc)">✕</button>
          </div>
        </div>
        <iframe
          ref={frameRef}
          title="preview"
          src={preview.url}
          className="min-h-0 w-full flex-1 rounded-b-xl border border-t-0 border-[var(--border)] bg-white"
        />
      </div>
    </div>
  );
}

function Box({ label, value, positive, big }: { label: string; value: string; positive?: boolean; big?: boolean }) {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 tabular-nums font-semibold ${big ? "text-3xl" : "text-2xl"} ${positive === undefined ? "" : positive ? "text-emerald-600" : "text-destructive"}`}>
        {value}
      </div>
    </div>
  );
}

function PdfBlock({ title, desc, onDay, onMonth, onRange }: { title: string; desc: string; onDay: () => void; onMonth: () => void; onRange: () => void }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="mb-1 text-sm font-semibold">{title}</div>
      <p className="mb-3 text-xs text-muted-foreground">{desc}</p>
      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary" onClick={onDay}>Diário</button>
        <button className="btn-secondary" onClick={onMonth}>Mensal</button>
        <button className="btn-primary" onClick={onRange}>Intervalo</button>
      </div>
    </div>
  );
}