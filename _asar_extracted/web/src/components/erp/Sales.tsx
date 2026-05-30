import { useState } from "react";
import { useErp, fmt, type Sale, productPickLabel, productTitle } from "@/lib/erp-store";
import { useAccounts, filialName } from "@/lib/accounts-store";
import { printSaleInvoice, groupSales, type PdfResult } from "@/lib/invoices";
import { Modal, PdfPreviewModal } from "./Modal";

type Mode = "single" | "daily";
type Item = { productId: string; qty: string; unitPrice: string };

export function Sales() {
  const { products, sales, recordSale, updateSaleGroup, removeSale } = useErp();
  const { filiais, company } = useAccounts();
  const [mode, setMode] = useState<Mode>("single");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [filialId, setFilialId] = useState<string>(company.currentFilialId ?? "");
  const [items, setItems] = useState<Item[]>([{ productId: "", qty: "", unitPrice: "" }]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [pdf, setPdf] = useState<PdfResult | null>(null);

  const setItem = (i: number, patch: Partial<Item>) =>
    setItems((it) => it.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));

  const onPickProduct = (i: number, productId: string) => {
    const p = products.find((x) => x.id === productId);
    setItems((it) =>
      it.map((x, idx) =>
        idx === i
          ? {
              ...x,
              productId,
              unitPrice:
                x.unitPrice && x.unitPrice !== "0"
                  ? x.unitPrice
                  : p?.salePrice
                  ? String(p.salePrice)
                  : x.unitPrice,
            }
          : x,
      ),
    );
  };
  const addItem = () => setItems((it) => [...it, { productId: "", qty: "", unitPrice: "" }]);
  const removeItem = (i: number) => setItems((it) => it.filter((_, idx) => idx !== i));

  const valid = items
    .map((it) => ({
      productId: it.productId,
      qty: parseFloat(it.qty) || 0,
      unitPrice: parseFloat(it.unitPrice) || 0,
    }))
    .filter((it) => it.productId && it.qty > 0 && it.unitPrice >= 0);

  const preview = valid.map((it) => {
    const p = products.find((x) => x.id === it.productId);
    const revenue = it.qty * it.unitPrice;
    const profit = (it.unitPrice - (p?.avgCost ?? 0)) * it.qty;
    return { name: p ? productTitle(p) : "—", stock: p?.stock ?? 0, qty: it.qty, revenue, profit, over: it.qty > (p?.stock ?? 0) };
  });
  const totalRev = preview.reduce((a, p) => a + p.revenue, 0);
  const totalProfit = preview.reduce((a, p) => a + p.profit, 0);
  const anyOver = preview.some((p) => p.over);

  const resetForm = () => {
    setItems([{ productId: "", qty: "", unitPrice: "" }]);
    setFilialId(company.currentFilialId ?? "");
    setDate(new Date().toISOString().slice(0, 10));
    setMode("single");
    setEditingDate(null);
  };

  const save = () => {
    if (valid.length === 0) return;
    if (anyOver && !confirm("Algumas linhas excedem o stock. Continuar mesmo assim?")) return;
    const stamp = new Date(`${date}T${new Date().toISOString().slice(11, 19)}`).toISOString();
    if (editingDate) {
      updateSaleGroup(editingDate, stamp, valid, filialId || undefined);
    } else {
      recordSale(stamp, valid, filialId || undefined);
    }
    resetForm();
    setFormOpen(false);
  };

  const openEdit = (group: Sale[]) => {
    setEditingDate(group[0].date);
    setMode(group.length > 1 ? "daily" : "single");
    setDate(group[0].date.slice(0, 10));
    setFilialId(group[0].filialId ?? "");
    setItems(group.map((s) => ({ productId: s.productId, qty: String(s.qty), unitPrice: String(s.unitPrice) })));
    setFormOpen(true);
  };

  const openPrint = (group: Sale[]) => {
    const r = printSaleInvoice(group, products);
    if (r) setPdf(r);
  };

  const closePdf = () => {
    if (pdf) setTimeout(() => URL.revokeObjectURL(pdf.url), 1000);
    setPdf(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Vendas</h2>
        <button
          className="btn-primary"
          onClick={() => {
            resetForm();
            setFormOpen(true);
          }}
          disabled={products.length === 0}
          title={products.length === 0 ? "Adicione produtos primeiro" : "Nova venda"}
        >
          + Nova venda
        </button>
      </div>

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editingDate ? "Editar venda" : "Registar venda"} size="xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex rounded-lg border p-0.5" style={{ borderColor: "var(--border)" }}>
            <button onClick={() => { setMode("single"); setItems([{ productId: "", qty: "", unitPrice: "" }]); }} className={`px-3 py-1 text-xs rounded-md ${mode === "single" ? "bg-primary text-primary-foreground" : ""}`}>Venda individual</button>
            <button onClick={() => setMode("daily")} className={`px-3 py-1 text-xs rounded-md ${mode === "daily" ? "bg-primary text-primary-foreground" : ""}`}>Resumo diário</button>
          </div>
        </div>
            <div className="mb-3 flex flex-wrap gap-3">
              <div>
                <label className="label">Data</label>
                <input type="date" className="input max-w-xs" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              {filiais.length > 0 && (
                <div>
                  <label className="label">Filial</label>
                  <select className="input" value={filialId} onChange={(e) => setFilialId(e.target.value)}>
                    <option value="">— sem filial —</option>
                    {filiais.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
                  <select className="input" value={it.productId} onChange={(e) => onPickProduct(i, e.target.value)}>
                    <option value="">— produto —</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {productPickLabel(p)} (stock: {p.stock}{p.salePrice ? ` · ${fmt(p.salePrice)}` : ""})
                      </option>
                    ))}
                  </select>
                  <input type="number" min={0} className="input" placeholder="Qtd" value={it.qty} onChange={(e) => setItem(i, { qty: e.target.value })} />
                  <input type="number" min={0} className="input" placeholder="Preço venda" value={it.unitPrice} onChange={(e) => setItem(i, { unitPrice: e.target.value })} />
                  {mode === "daily" ? (
                    <button className="btn-ghost" onClick={() => removeItem(i)} disabled={items.length === 1}>×</button>
                  ) : <span />}
                </div>
              ))}
            </div>
            {mode === "daily" && (
              <button className="btn-secondary mt-2" onClick={addItem}>+ Adicionar produto</button>
            )}

            {preview.length > 0 && (
              <div className="mt-4 rounded-lg border p-3 text-sm">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pré-visualização</div>
                <ul className="space-y-1">
                  {preview.map((p, i) => (
                    <li key={i} className="flex justify-between">
                      <span className={p.over ? "text-destructive" : ""}>
                        {p.name} ({p.qty} un){p.over && " — excede stock!"}
                      </span>
                      <span className="tabular-nums">
                        {fmt(p.revenue)} · <span className={p.profit >= 0 ? "text-emerald-600" : "text-destructive"}>lucro {fmt(p.profit)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex justify-between border-t pt-2 font-semibold">
                  <span>Total</span>
                  <span className="tabular-nums">
                    {fmt(totalRev)} · <span className={totalProfit >= 0 ? "text-emerald-600" : "text-destructive"}>{fmt(totalProfit)}</span>
                  </span>
                </div>
              </div>
            )}

        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-secondary" onClick={() => { setFormOpen(false); resetForm(); }}>Cancelar</button>
          <button className="btn-primary" onClick={save} disabled={valid.length === 0}>
            {editingDate ? "Guardar alterações" : "Guardar venda"}
          </button>
        </div>
      </Modal>

      <div className="card">
        <h2 className="mb-4 text-base font-semibold">Histórico ({sales.length})</h2>
        {sales.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Sem vendas.</p>
        ) : (
          <ul className="max-h-[520px] divide-y overflow-auto">
            {groupSales(sales).map((group) => {
              const first = group[0];
              const total = group.reduce((a, s) => a + s.revenue, 0);
              const profit = group.reduce((a, s) => a + s.profit, 0);
              const units = group.reduce((a, s) => a + s.qty, 0);
              return (
                <li key={first.date + first.id} className="py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm">
                      <div className="flex flex-wrap items-center gap-2 font-medium">
                        Fatura · {new Date(first.date).toLocaleString("pt-AO")}
                        {filiais.length > 0 && (
                          <span className="pill" style={{ background: "color-mix(in oklab, var(--primary) 16%, transparent)", color: "var(--primary)" }}>🏪 {filialName(filiais, first.filialId)}</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {group.length} produto(s) · {units} unidade(s)
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <div className="tabular-nums font-semibold">{fmt(total)}</div>
                        <div className={`text-xs tabular-nums ${profit >= 0 ? "text-emerald-600" : "text-destructive"}`}>
                          lucro {profit >= 0 ? "+" : ""}{fmt(profit)}
                        </div>
                      </div>
                      <button
                        onClick={() => openPrint(group)}
                        className="btn-secondary text-xs"
                        title="Imprimir fatura"
                      >
                        🖨 Fatura
                      </button>
                      <button
                        onClick={() => openEdit(group)}
                        className="btn-secondary text-xs"
                        title="Editar venda"
                      >
                        ✎ Editar
                      </button>
                    </div>
                  </div>
                  <ul className="mt-2 grid gap-1 pl-2 text-xs text-muted-foreground">
                    {group.map((s) => {
                      const p = products.find((x) => x.id === s.productId);
                      return (
                        <li key={s.id} className="flex items-center justify-between">
                          <span>• {p ? productPickLabel(p) : "—"}: {s.qty} × {fmt(s.unitPrice)}</span>
                          <button
                            onClick={() => confirm("Remover linha?") && removeSale(s.id)}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            remover
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <PdfPreviewModal
        open={!!pdf}
        onClose={closePdf}
        url={pdf?.url ?? null}
        html={pdf?.html ?? null}
        filename={pdf?.filename ?? "fatura.pdf"}
      />
    </div>
  );
}