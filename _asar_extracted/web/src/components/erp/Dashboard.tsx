import { useErp, fmt, todayKey, isSameDay, productTitle, productPickLabel } from "@/lib/erp-store";

export function Dashboard({ onNav }: { onNav: (t: "dashboard" | "products" | "purchases" | "sales" | "reports") => void }) {
  const { products, sales } = useErp();
  const today = todayKey();
  const todaySales = sales.filter((s) => isSameDay(s.date, today));
  const tRev = todaySales.reduce((a, s) => a + s.revenue, 0);
  const tProfit = todaySales.reduce((a, s) => a + s.profit, 0);
  const tUnits = todaySales.reduce((a, s) => a + s.qty, 0);

  const lowStock = products.filter((p) => p.stock <= p.lowStock);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Receita hoje" value={fmt(tRev)} />
        <Stat label="Lucro hoje" value={fmt(tProfit)} positive={tProfit >= 0} />
        <Stat label="Unidades hoje" value={String(tUnits)} />
        <Stat label="Produtos cadastrados" value={String(products.length)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">Stock baixo</h2>
            <button className="btn-ghost text-xs" onClick={() => onNav("products")}>
              Ver produtos
            </button>
          </div>
          {lowStock.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {products.length === 0 ? "Adicione produtos para começar." : "Tudo em ordem."}
            </p>
          ) : (
            <ul className="divide-y">
              {lowStock.map((p) => (
                <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                  <span>{productPickLabel(p)}</span>
                  <span className="pill" style={{ background: "hsl(var(--destructive) / .15)", color: "hsl(var(--destructive))" }}>
                    {p.stock} un · mín {p.lowStock}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">Vendas de hoje</h2>
            <button className="btn-ghost text-xs" onClick={() => onNav("sales")}>
              Registar venda
            </button>
          </div>
          {todaySales.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Sem vendas hoje.</p>
          ) : (
            <ul className="max-h-72 divide-y overflow-auto">
              {todaySales.map((s) => {
                const p = products.find((x) => x.id === s.productId);
                return (
                  <li key={s.id} className="flex items-center justify-between py-2 text-sm">
                    <div>
                      <div className="font-medium">{p ? productTitle(p) : "—"}</div>
                      <div className="text-xs text-muted-foreground">
                        {s.qty}× @ {fmt(s.unitPrice)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="tabular-nums font-semibold">{fmt(s.revenue)}</div>
                      <div className={`text-xs tabular-nums ${s.profit >= 0 ? "text-emerald-600" : "text-destructive"}`}>
                        {s.profit >= 0 ? "+" : ""}
                        {fmt(s.profit)}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${positive === undefined ? "" : positive ? "text-emerald-600" : "text-destructive"}`}>
        {value}
      </div>
    </div>
  );
}