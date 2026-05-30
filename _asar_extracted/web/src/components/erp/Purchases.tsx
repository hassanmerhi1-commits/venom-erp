import { useState } from "react";
import { useErp, fmt, type Purchase, productPickLabel } from "@/lib/erp-store";
import { useAccounts, filialName } from "@/lib/accounts-store";
import { printPurchaseInvoice, type PdfResult } from "@/lib/invoices";
import { Modal, PdfPreviewModal } from "./Modal";

type Line = { productId: string; qty: string; unitPrice: string };

export function Purchases() {
  const { products, purchases, addPurchase, updatePurchase, removePurchase } = useErp();
  const { suppliers, filiais, company } = useAccounts();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [transport, setTransport] = useState("0");
  const [supplierId, setSupplierId] = useState("");
  const [filialId, setFilialId] = useState<string>(company.currentFilialId ?? "");
  const [paid, setPaid] = useState(true);
  const [lines, setLines] = useState<Line[]>([{ productId: "", qty: "", unitPrice: "" }]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pdf, setPdf] = useState<PdfResult | null>(null);

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, { productId: "", qty: "", unitPrice: "" }]);
  const removeLine = (i: number) => setLines((ls) => ls.filter((_, idx) => idx !== i));

  const validLines = lines
    .map((l) => ({
      productId: l.productId,
      qty: parseFloat(l.qty) || 0,
      unitPrice: parseFloat(l.unitPrice) || 0,
    }))
    .filter((l) => l.productId && l.qty > 0);

  const transportN = parseFloat(transport) || 0;
  const subtotal = validLines.reduce((a, l) => a + l.qty * l.unitPrice, 0);
  const totalUnits = validLines.reduce((a, l) => a + l.qty, 0);
  const perUnitT = totalUnits > 0 ? transportN / totalUnits : 0;
  const total = subtotal + transportN;

  const resetForm = () => {
    setLines([{ productId: "", qty: "", unitPrice: "" }]);
    setTransport("0");
    setSupplierId("");
    setFilialId(company.currentFilialId ?? "");
    setPaid(true);
    setEditingId(null);
    setDate(new Date().toISOString().slice(0, 10));
  };

  const save = () => {
    if (validLines.length === 0) return;
    const meta = { supplierId: supplierId || undefined, paid, filialId: filialId || undefined };
    if (editingId) {
      updatePurchase(editingId, new Date(date).toISOString(), transportN, validLines, meta);
    } else {
      addPurchase(new Date(date).toISOString(), transportN, validLines, meta);
    }
    resetForm();
    setFormOpen(false);
  };

  const openEdit = (p: Purchase) => {
    setEditingId(p.id);
    setDate(p.date.slice(0, 10));
    setTransport(String(p.transport));
    setSupplierId(p.supplierId ?? "");
    setFilialId(p.filialId ?? "");
    setPaid(p.paid !== false);
    setLines(
      p.lines.length
        ? p.lines.map((l) => ({ productId: l.productId, qty: String(l.qty), unitPrice: String(l.unitPrice) }))
        : [{ productId: "", qty: "", unitPrice: "" }],
    );
    setFormOpen(true);
  };

  const closePdf = () => {
    if (pdf) setTimeout(() => URL.revokeObjectURL(pdf.url), 1000);
    setPdf(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Compras</h2>
        <button
          className="btn-primary"
          onClick={() => {
            resetForm();
            setFormOpen(true);
          }}
          disabled={products.length === 0}
          title={products.length === 0 ? "Adicione produtos primeiro" : "Nova compra"}
        >
          + Nova compra
        </button>
      </div>

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editingId ? "Editar compra" : "Nova compra (lote)"} size="xl">
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Data</label>
                <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div>
                <label className="label">Transporte total do lote (AOA)</label>
                <input type="number" min={0} className="input" value={transport} onChange={(e) => setTransport(e.target.value)} />
              </div>
              <div>
                <label className="label">Fornecedor</label>
                <select className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                  <option value="">— sem fornecedor —</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Pagamento</label>
                <select className="input" value={paid ? "cash" : "credit"} onChange={(e) => setPaid(e.target.value === "cash")}>
                  <option value="cash">Pago em dinheiro (sai do caixa)</option>
                  <option value="credit">A crédito (fica em dívida)</option>
                </select>
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
            {!paid && !supplierId && (
              <div className="-mt-2 mb-3 rounded-md border border-[var(--warning)]/40 bg-[var(--warning)]/10 px-3 py-2 text-xs" style={{ color: "var(--warning)" }}>
                Compra a crédito sem fornecedor não entra na conta de dívidas. Escolha um fornecedor para acompanhar o que deve.
              </div>
            )}

            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
                  <select className="input" value={l.productId} onChange={(e) => setLine(i, { productId: e.target.value })}>
                    <option value="">— produto —</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{productPickLabel(p)}</option>
                    ))}
                  </select>
                  <input type="number" min={0} className="input" placeholder="Qtd" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
                  <input type="number" min={0} className="input" placeholder="Preço un." value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} />
                  <button className="btn-ghost" onClick={() => removeLine(i)} disabled={lines.length === 1}>×</button>
                </div>
              ))}
            </div>
            <button className="btn-secondary mt-2" onClick={addLine}>+ Adicionar linha</button>

            <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg bg-muted/50 p-3 text-sm sm:grid-cols-4">
              <Mini label="Subtotal" v={fmt(subtotal)} />
              <Mini label="Transporte" v={fmt(transportN)} />
              <Mini label="Transp./unidade" v={fmt(perUnitT)} />
              <Mini label="Total" v={fmt(total)} strong />
            </div>

        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-secondary" onClick={() => { setFormOpen(false); resetForm(); }}>Cancelar</button>
          <button className="btn-primary" onClick={save} disabled={validLines.length === 0}>
            {editingId ? "Guardar alterações" : "Guardar compra"}
          </button>
        </div>
      </Modal>

      <div className="card">
        <h2 className="mb-4 text-base font-semibold">Histórico ({purchases.length})</h2>
        {purchases.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Sem compras.</p>
        ) : (
          <ul className="divide-y">
            {purchases.map((p) => (
              <li key={p.id} className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm">
                    <div className="flex flex-wrap items-center gap-2 font-medium">
                      {new Date(p.date).toLocaleDateString("pt-AO")}
                      {filiais.length > 0 && (
                        <span className="pill" style={{ background: "color-mix(in oklab, var(--primary) 16%, transparent)", color: "var(--primary)" }}>🏪 {filialName(filiais, p.filialId)}</span>
                      )}
                      {p.supplierId && (
                        <span className="pill" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>{suppliers.find((s) => s.id === p.supplierId)?.name ?? "fornecedor"}</span>
                      )}
                      {p.paid === false && (
                        <span className="pill" style={{ background: "color-mix(in oklab, var(--destructive) 16%, transparent)", color: "var(--destructive)" }}>a crédito</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {p.lines.length} produto(s) · transporte {fmt(p.transport)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold tabular-nums">{fmt(p.total)}</div>
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={() => setPdf(printPurchaseInvoice(p, products))}
                        className="btn-secondary text-xs"
                        title="Imprimir fatura de compra"
                      >
                        🖨 Fatura
                      </button>
                      <button onClick={() => openEdit(p)} className="text-xs text-muted-foreground hover:text-foreground" title="Editar compra">editar</button>
                      <button onClick={() => confirm("Remover compra?") && removePurchase(p.id)} className="text-xs text-muted-foreground hover:text-destructive">remover</button>
                    </div>
                  </div>
                </div>
                <ul className="mt-2 grid gap-1 pl-2 text-xs text-muted-foreground">
                  {p.lines.map((l, i) => {
                    const prod = products.find((x) => x.id === l.productId);
                    return (
                      <li key={i}>
                        • {prod ? productPickLabel(prod) : "—"}: {l.qty} × {fmt(l.unitPrice)} → custo c/transp. {fmt(l.landedUnitCost)}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
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

function Mini({ label, v, strong }: { label: string; v: string; strong?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`tabular-nums ${strong ? "text-base font-semibold" : "text-sm font-medium"}`}>{v}</div>
    </div>
  );
}