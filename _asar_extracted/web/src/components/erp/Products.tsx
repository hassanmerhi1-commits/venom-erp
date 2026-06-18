import { useState } from "react";
import { useErp, fmt, productCode, productTitle, productPickLabel } from "@/lib/erp-store";
import type { Product } from "@/lib/erp-store";
import { useAccounts, productFilialQty, productTotalFilialQty } from "@/lib/accounts-store";
import { Modal } from "./Modal";

function EditProductModal({
  product,
  filiais,
  filialStockMatrix,
  onClose,
  onSave,
}: {
  product: Product;
  filiais: { id: string; name: string }[];
  filialStockMatrix: ReturnType<typeof useAccounts>["filialStockMatrix"];
  onClose: () => void;
  onSave: (patch: Partial<Product>) => void;
}) {
  const [name, setName] = useState(product.name);
  const [sku, setSku] = useState(product.sku ?? "");
  const [lowStock, setLowStock] = useState(String(product.lowStock));
  const [salePrice, setSalePrice] = useState(product.salePrice ? String(product.salePrice) : "");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const sp = parseFloat(salePrice);
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      sku: sku.trim() || undefined,
      lowStock: parseInt(lowStock) || 0,
      salePrice: isFinite(sp) && sp > 0 ? sp : undefined,
    });
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={`Editar produto · ${productPickLabel(product)}`} size="md">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Código *</label>
            <input className="input font-mono" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: 00123" autoFocus />
          </div>
          <div>
            <label className="label">Nome do produto</label>
            <input className="input" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Ex: Caixa d'água 200L" />
          </div>
          <div>
            <label className="label">Stock mín.</label>
            <input type="number" min={0} className="input" value={lowStock} onChange={(e) => setLowStock(e.target.value)} />
          </div>
          <div>
            <label className="label">Preço venda</label>
            <input
              type="number"
              min={0}
              step="0.01"
              className="input"
              value={salePrice}
              onChange={(e) => setSalePrice(e.target.value)}
              placeholder="0,00"
            />
          </div>
          <div>
            <label className="label">Custo médio (auto)</label>
            <input className="input" value={fmt(product.avgCost)} disabled />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 rounded-lg border p-3 text-xs" style={{ borderColor: "var(--border)" }}>
          <div>
            <div className="text-muted-foreground">{filiais.length > 0 ? "Stock total" : "Stock atual"}</div>
            <div className="text-sm font-semibold tabular-nums">
              {filiais.length > 0 ? productTotalFilialQty(filialStockMatrix, filiais, product.id) : product.stock}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Custo médio</div>
            <div className="text-sm font-semibold tabular-nums">{fmt(product.avgCost)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Criado em</div>
            <div className="text-sm font-semibold tabular-nums">{product.createdAt.slice(0, 10)}</div>
          </div>
        </div>
        {filiais.length > 0 && (
          <div className="rounded-lg border p-3 text-xs" style={{ borderColor: "var(--border)" }}>
            <div className="mb-2 font-medium uppercase tracking-wide text-muted-foreground">Stock por filial</div>
            <div className="flex flex-wrap gap-2">
              {filiais.map((f) => {
                const q = productFilialQty(filialStockMatrix, f.id, product.id);
                return (
                  <span key={f.id} className="pill" style={{ background: "var(--muted)", color: "var(--foreground)" }}>
                    {f.name}: <b>{q}</b>
                  </span>
                );
              })}
              {(filialStockMatrix.unlabeled.get(product.id) ?? 0) !== 0 && (
                <span className="pill" style={{ background: "color-mix(in oklab, var(--destructive) 12%, transparent)", color: "var(--destructive)" }}>
                  Sem filial: <b>{filialStockMatrix.unlabeled.get(product.id)}</b>
                </span>
              )}
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn-primary">Guardar alterações</button>
        </div>
      </form>
    </Modal>
  );
}

export function Products() {
  const { products, purchases, sales, addProduct, updateProduct, removeProduct } = useErp();
  const { filiais, company, filialStockMatrix } = useAccounts("all");
  const hasFiliais = filiais.length > 0;
  const hasUnlabeledStock = products.some((p) => (filialStockMatrix.unlabeled.get(p.id) ?? 0) !== 0);
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [lowStock, setLowStock] = useState("5");
  const [salePrice, setSalePrice] = useState("");
  const [tab, setTab] = useState<"stock" | "statement">("stock");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    addProduct({
      name: name.trim(),
      sku: sku.trim() || undefined,
      lowStock: parseInt(lowStock) || 0,
      salePrice: parseFloat(salePrice) > 0 ? parseFloat(salePrice) : undefined,
    });
    setName("");
    setSku("");
    setLowStock("5");
    setSalePrice("");
  };

  const openStatement = (p: Product) => {
    setSelectedId(p.id);
    setTab("statement");
  };

  const selected = products.find((p) => p.id === selectedId) ?? null;

  type Entry = {
    date: string;
    kind: "purchase" | "sale";
    qty: number;
    unitPrice: number;
    unitCost: number;
    total: number;
    ref: string;
  };

  const entries: Entry[] = selected
    ? [
        ...purchases.flatMap((pu) =>
          pu.lines
            .filter((l) => l.productId === selected.id)
            .map<Entry>((l) => ({
              date: pu.date,
              kind: "purchase",
              qty: l.qty,
              unitPrice: l.unitPrice,
              unitCost: l.landedUnitCost,
              total: l.qty * l.landedUnitCost,
              ref: pu.id,
            }))
        ),
        ...sales
          .filter((s) => s.productId === selected.id)
          .map<Entry>((s) => ({
            date: s.date,
            kind: "sale",
            qty: s.qty,
            unitPrice: s.unitPrice,
            unitCost: s.unitCost,
            total: s.revenue,
            ref: s.id,
          })),
      ].sort((a, b) => (a.date < b.date ? 1 : -1))
    : [];

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--border)]">
        {(["stock", "statement"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`relative px-4 py-2 text-sm font-medium transition-colors ${
              tab === t ? "text-[var(--foreground)]" : "text-muted-foreground hover:text-[var(--foreground)]"
            }`}
          >
            {t === "stock" ? "Stock de produtos" : "Extrato (compras / vendas)"}
            {tab === t && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full" style={{ background: "var(--primary)" }} />
            )}
          </button>
        ))}
      </div>

      {tab === "stock" && (
      <>
      {/* Top: horizontal creation bar */}
      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Novo produto</h2>
          <span className="text-xs text-muted-foreground">Preencha e clique em Adicionar</span>
        </div>
        <form onSubmit={submit} className="grid grid-cols-1 gap-3 md:grid-cols-[1.6fr_1fr_0.8fr_1fr_auto] md:items-end">
          <div>
            <label className="label">Código *</label>
            <input className="input font-mono" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: 00123" />
          </div>
          <div>
            <label className="label">Nome do produto</label>
            <input className="input" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Ex: Caixa d'água 200L" />
          </div>
          <div>
            <label className="label">Stock mín.</label>
            <input type="number" min={0} className="input" value={lowStock} onChange={(e) => setLowStock(e.target.value)} />
          </div>
          <div>
            <label className="label">Preço venda</label>
            <input type="number" min={0} step="0.01" className="input" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} placeholder="0,00" />
          </div>
          <button className="btn-primary md:w-auto" type="submit">+ Adicionar</button>
        </form>
      </div>

      {/* Bottom: products table */}
      <div className="card p-0 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h2 className="text-base font-semibold">Stock de produtos</h2>
            {hasFiliais && (
              <p className="mt-0.5 text-xs text-muted-foreground">Quantidades por filial — coluna Total soma todas as lojas.</p>
            )}
          </div>
          <span className="pill" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
            {products.length} {products.length === 1 ? "item" : "itens"}
          </span>
        </div>
        {products.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">Sem produtos ainda. Adicione o primeiro acima.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground" style={{ background: "var(--muted)" }}>
                  <th className="px-5 py-3 font-semibold">Código</th>
                  <th className="px-3 py-3 font-semibold">Produto</th>
                  {hasFiliais ? (
                    <>
                      {filiais.map((f) => (
                        <th
                          key={f.id}
                          className="px-3 py-3 text-right font-semibold whitespace-nowrap"
                          title={f.location}
                        >
                          {f.name}
                          {company.currentFilialId === f.id && " ★"}
                        </th>
                      ))}
                      {hasUnlabeledStock && <th className="px-3 py-3 text-right font-semibold">Sem filial</th>}
                      <th className="px-3 py-3 text-right font-semibold">Total</th>
                    </>
                  ) : (
                    <th className="px-3 py-3 text-right font-semibold">Qtd. em armazém</th>
                  )}
                  <th className="px-3 py-3 text-right font-semibold">Preço venda</th>
                  <th className="px-3 py-3 text-right font-semibold">Custo médio</th>
                  <th className="px-3 py-3 text-right font-semibold">Lucro / un.</th>
                  <th className="px-3 py-3 text-right font-semibold">Stock mín.</th>
                  <th className="px-3 py-3 text-center font-semibold">Extrato</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {products.map((p, idx) => {
                  const totalQty = hasFiliais ? productTotalFilialQty(filialStockMatrix, filiais, p.id) : p.stock;
                  const low = hasFiliais
                    ? filiais.some((f) => productFilialQty(filialStockMatrix, f.id, p.id) <= p.lowStock) || totalQty <= p.lowStock
                    : p.stock <= p.lowStock;
                  const profit = (p.salePrice ?? 0) > 0 ? (p.salePrice as number) - p.avgCost : null;
                  const profitPct = profit !== null && p.avgCost > 0 ? (profit / p.avgCost) * 100 : null;
                  return (
                    <tr
                      key={p.id}
                      className="border-t border-[var(--border)] transition-colors hover:bg-[color-mix(in_oklab,var(--muted)_60%,transparent)]"
                      style={idx % 2 === 1 ? { background: "color-mix(in oklab, var(--muted) 25%, transparent)" } : undefined}
                    >
                      <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{productCode(p) || "—"}</td>
                      <td className="px-3 py-3 font-medium">{productTitle(p)}</td>
                      {hasFiliais ? (
                        <>
                          {filiais.map((f) => {
                            const q = productFilialQty(filialStockMatrix, f.id, p.id);
                            const filLow = q <= p.lowStock;
                            return (
                              <td key={f.id} className="px-3 py-3 text-right tabular-nums">
                                <span
                                  className="pill"
                                  style={{
                                    background: filLow
                                      ? "color-mix(in oklab, var(--destructive) 18%, transparent)"
                                      : q > 0
                                        ? "color-mix(in oklab, var(--primary) 14%, transparent)"
                                        : "var(--muted)",
                                    color: filLow ? "var(--destructive)" : q > 0 ? "var(--primary)" : "var(--muted-foreground)",
                                  }}
                                >
                                  {q}
                                </span>
                              </td>
                            );
                          })}
                          {hasUnlabeledStock && (
                            <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                              {filialStockMatrix.unlabeled.get(p.id) ?? 0}
                            </td>
                          )}
                          <td className="px-3 py-3 text-right tabular-nums font-semibold">{totalQty}</td>
                        </>
                      ) : (
                        <td className="px-3 py-3 text-right tabular-nums">
                          <span className={`pill ${low ? "" : ""}`} style={{
                            background: low ? "color-mix(in oklab, var(--destructive) 18%, transparent)" : "color-mix(in oklab, var(--primary) 14%, transparent)",
                            color: low ? "var(--destructive)" : "var(--primary)",
                          }}>
                            {p.stock}
                          </span>
                        </td>
                      )}
                      <td className="px-3 py-3 text-right tabular-nums">
                        {p.salePrice ? fmt(p.salePrice) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">{fmt(p.avgCost)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {profit === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <div className="flex flex-col items-end leading-tight">
                            <span className={profit >= 0 ? "font-semibold text-[var(--primary)]" : "font-semibold text-destructive"}>
                              {fmt(profit)}
                            </span>
                            {profitPct !== null && (
                              <span className="text-[10px] text-muted-foreground">{profitPct.toFixed(1)}%</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{p.lowStock}</td>
                      <td className="px-3 py-3 text-center">
                        <button
                          onClick={() => openStatement(p)}
                          className="rounded-md border border-[var(--border)] px-2 py-1 text-xs font-medium hover:bg-muted"
                          title="Ver extrato"
                        >
                          Ver
                        </button>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setEditingId(p.id)}
                          className="rounded-md border border-[var(--border)] px-2 py-1 text-xs font-medium hover:bg-muted"
                          title="Editar"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Remover "${productPickLabel(p)}"?`)) removeProduct(p.id);
                          }}
                          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                          aria-label="Remover"
                          title="Remover"
                        >
                          ×
                        </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </>
      )}

      {tab === "statement" && (
        <div className="space-y-4">
          <div className="card">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[220px]">
                <label className="label">Produto</label>
                <select
                  className="input"
                  value={selectedId ?? ""}
                  onChange={(e) => setSelectedId(e.target.value || null)}
                >
                  <option value="">— Selecione um produto —</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {productPickLabel(p)}
                    </option>
                  ))}
                </select>
              </div>
              {selected && (
                <div className="flex flex-wrap gap-4 text-sm">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{hasFiliais ? "Stock total" : "Stock atual"}</div>
                    <div className="font-semibold tabular-nums">
                      {hasFiliais ? productTotalFilialQty(filialStockMatrix, filiais, selected.id) : selected.stock}
                    </div>
                  </div>
                  {hasFiliais && filiais.map((f) => (
                    <div key={f.id}>
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{f.name}</div>
                      <div className="font-semibold tabular-nums">{productFilialQty(filialStockMatrix, f.id, selected.id)}</div>
                    </div>
                  ))}
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Custo médio</div>
                    <div className="font-semibold tabular-nums">{fmt(selected.avgCost)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Preço venda</div>
                    <div className="font-semibold tabular-nums">{selected.salePrice ? fmt(selected.salePrice) : "—"}</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="card p-0 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
              <h2 className="text-base font-semibold">
                Extrato {selected ? `— ${productPickLabel(selected)}` : ""}
              </h2>
              <span className="pill" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
                {entries.length} {entries.length === 1 ? "movimento" : "movimentos"}
              </span>
            </div>
            {!selected ? (
              <p className="py-16 text-center text-sm text-muted-foreground">Selecione um produto para ver o extrato.</p>
            ) : entries.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">Sem movimentos para este produto.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground" style={{ background: "var(--muted)" }}>
                      <th className="px-5 py-3 font-semibold">Data</th>
                      <th className="px-3 py-3 font-semibold">Tipo</th>
                      <th className="px-3 py-3 text-right font-semibold">Qtd.</th>
                      <th className="px-3 py-3 text-right font-semibold">Preço un.</th>
                      <th className="px-3 py-3 text-right font-semibold">Custo un.</th>
                      <th className="px-3 py-3 text-right font-semibold">Margem un.</th>
                      <th className="px-5 py-3 text-right font-semibold">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e, i) => {
                      const margin = e.kind === "sale" ? e.unitPrice - e.unitCost : null;
                      return (
                        <tr
                          key={`${e.ref}-${i}`}
                          className="border-t border-[var(--border)]"
                          style={i % 2 === 1 ? { background: "color-mix(in oklab, var(--muted) 25%, transparent)" } : undefined}
                        >
                          <td className="px-5 py-3 tabular-nums">{e.date.slice(0, 10)}</td>
                          <td className="px-3 py-3">
                            <span
                              className="pill"
                              style={{
                                background:
                                  e.kind === "sale"
                                    ? "color-mix(in oklab, var(--primary) 14%, transparent)"
                                    : "color-mix(in oklab, var(--accent) 20%, transparent)",
                                color: e.kind === "sale" ? "var(--primary)" : "var(--accent-foreground)",
                              }}
                            >
                              {e.kind === "sale" ? "Venda" : "Compra"}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums">{e.qty}</td>
                          <td className="px-3 py-3 text-right tabular-nums">{fmt(e.unitPrice)}</td>
                          <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">{fmt(e.unitCost)}</td>
                          <td className="px-3 py-3 text-right tabular-nums">
                            {margin === null ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <span className={margin >= 0 ? "text-[var(--primary)] font-medium" : "text-destructive font-medium"}>
                                {fmt(margin)}
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-3 text-right tabular-nums font-medium">{fmt(e.total)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
      {editingId && (() => {
        const p = products.find((x) => x.id === editingId);
        if (!p) return null;
        return (
          <EditProductModal
            product={p}
            filiais={filiais}
            filialStockMatrix={filialStockMatrix}
            onClose={() => setEditingId(null)}
            onSave={(patch) => updateProduct(p.id, patch)}
          />
        );
      })()}
    </div>
  );
}