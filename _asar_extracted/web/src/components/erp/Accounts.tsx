import { Fragment, useEffect, useState } from "react";
import { useAccounts } from "@/lib/accounts-store";
import { fmt, productCode, productTitle, productPickLabel } from "@/lib/erp-store";

type Section = "caixa" | "fornecedores" | "fretes" | "stock" | "empresa";

const today = () => new Date().toISOString().slice(0, 10);

export function Accounts() {
  const [filialFilter, setFilialFilter] = useState<string>("all");
  const acc = useAccounts(filialFilter);
  const [section, setSection] = useState<Section>(() => (acc.filiais.length === 0 ? "empresa" : "caixa"));

  const SECTIONS: { id: Section; label: string }[] = [
    { id: "empresa", label: "Empresa / Filiais" },
    { id: "caixa", label: "Caixa" },
    { id: "fornecedores", label: "Fornecedores" },
    { id: "stock", label: "Stock" },
    { id: "fretes", label: "Fretes" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Contas</h2>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Filial:</label>
          <select className="input max-w-[200px]" value={filialFilter} onChange={(e) => setFilialFilter(e.target.value)}>
            <option value="all">Todas as filiais</option>
            {acc.filiais.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
            <option value="none">Sem filial</option>
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-[var(--border)]">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              section === s.id ? "border-[var(--primary)] text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {section === "caixa" && <Caixa acc={acc} filialFilter={filialFilter} />}
      {section === "fornecedores" && <Fornecedores acc={acc} />}
      {section === "stock" && <Stock acc={acc} filialFilter={filialFilter} />}
      {section === "fretes" && <Fretes acc={acc} />}
      {section === "empresa" && <Empresa acc={acc} />}
    </div>
  );
}

type Acc = ReturnType<typeof useAccounts>;

function StatCard({ label, value, tone, big }: { label: string; value: string; tone?: "good" | "bad"; big?: boolean }) {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 tabular-nums font-semibold ${big ? "text-3xl" : "text-2xl"} ${tone === "good" ? "text-emerald-500" : tone === "bad" ? "text-destructive" : ""}`}>{value}</div>
    </div>
  );
}

// ---------------- Caixa ----------------
function Caixa({ acc, filialFilter }: { acc: Acc; filialFilter: string }) {
  const [type, setType] = useState<"in" | "out">("in");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(today());
  const [dest, setDest] = useState("");
  const [editId, setEditId] = useState<string | null>(null);

  // which filial new cash movements get stamped to, matching what is currently shown:
  //  - specific filial  -> that filial
  //  - "none"           -> no filial (null)
  //  - "all"            -> the active filial (or null if none)
  const targetFilial: string | null = filialFilter === "all" ? (acc.company.currentFilialId ?? null) : filialFilter === "none" ? null : filialFilter;

  const resetEntry = () => { setAmount(""); setNote(""); setType("in"); setDate(today()); setEditId(null); };

  const add = () => {
    const a = parseFloat(amount) || 0;
    if (a <= 0) return;
    if (editId) {
      acc.updateCashEntry(editId, { type, amount: a, note, date: new Date(date).toISOString() });
    } else {
      acc.addCashEntry(type, a, note, new Date(date).toISOString(), targetFilial);
    }
    resetEntry();
  };

  const editEntry = (cashId: string) => {
    const c = acc.cash.find((x) => x.id === cashId);
    if (!c) return;
    setEditId(cashId);
    setType(c.type);
    setAmount(String(c.amount));
    setNote(c.note ?? "");
    setDate(c.date.slice(0, 10));
  };

  const withdrawAll = () => {
    const bal = acc.caixaBalance;
    if (bal <= 0) return;
    const where = dest.trim() || "destino final";
    if (!confirm(`Retirar ${fmt(bal)} do caixa para "${where}"? O saldo de caixa fica a zero.`)) return;
    acc.addCashEntry("out", bal, `Retirada para ${where}`, new Date().toISOString(), targetFilial);
    setDest("");
  };

  type Mov = { id: string; date: string; label: string; in?: number; out?: number; removable?: boolean };
  const movements: Mov[] = [
    ...acc.fSales.map((s) => ({ id: "s" + s.id, date: s.date, label: "Venda", in: s.revenue })),
    ...acc.fPurchases.filter((p) => p.paid !== false).map((p) => ({ id: "p" + p.id, date: p.date, label: "Compra (paga em dinheiro)", out: p.total })),
    ...acc.fPayments.map((p) => ({ id: "pay" + p.id, date: p.date, label: "Pagamento a fornecedor", out: p.amount })),
    ...acc.fFreight.map((f) => ({ id: "f" + f.id, date: f.date, label: `Frete${f.transporter && f.transporter !== "—" ? " · " + f.transporter : ""}`, out: f.amount })),
    ...acc.fCash.map((c) => ({ id: "c" + c.id, date: c.date, label: (c.note || (c.type === "in" ? "Entrada" : "Saída")) + " (manual)", in: c.type === "in" ? c.amount : undefined, out: c.type === "out" ? c.amount : undefined, removable: true })),
  ];
  // running balance: accumulate oldest -> newest, then show newest first
  let running = 0;
  const ledger = [...movements]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((m) => {
      running += (m.in ?? 0) - (m.out ?? 0);
      return { ...m, balance: running };
    })
    .reverse();

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Saldo de caixa" value={fmt(acc.caixaBalance)} tone={acc.caixaBalance >= 0 ? "good" : "bad"} big />
        <StatCard label="Total entradas" value={fmt(acc.cashIn)} tone="good" />
        <StatCard label="Total saídas" value={fmt(acc.cashOut)} tone="bad" />
      </div>

      <div className="card">
        <h3 className="mb-3 text-base font-semibold">{editId ? "Editar movimento manual" : "Movimento manual"}</h3>
        <div className="grid gap-2 sm:grid-cols-[auto_1fr_2fr_auto_auto_auto]">
          <select className="input" value={type} onChange={(e) => setType(e.target.value as "in" | "out")}>
            <option value="in">Entrada (+)</option>
            <option value="out">Saída (−)</option>
          </select>
          <input type="number" min={0} className="input" placeholder="Valor" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <input className="input" placeholder="Nota (ex: abertura, despesa, retirada)" value={note} onChange={(e) => setNote(e.target.value)} />
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          <button className="btn-primary" onClick={add} disabled={!(parseFloat(amount) > 0)}>{editId ? "Guardar" : "Adicionar"}</button>
          {editId && <button className="btn-secondary" onClick={resetEntry}>Cancelar</button>}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Vendas e compras pagas entram/saem automaticamente. Use isto para aberturas, despesas e retiradas.</p>
      </div>

      <div className="card">
        <h3 className="mb-1 text-base font-semibold">Retirar / enviar para destino final</h3>
        <p className="mb-3 text-xs text-muted-foreground">Tira <b>todo</b> o saldo do caixa (ex.: depósito no banco, entrega ao patrão, cofre). Regista a saída e deixa o caixa a zero.</p>
        <div className="grid gap-2 sm:grid-cols-[2fr_auto]">
          <input className="input" placeholder="Destino (ex: Banco BFA, Patrão, Cofre)" value={dest} onChange={(e) => setDest(e.target.value)} />
          <button className="btn-primary whitespace-nowrap" onClick={withdrawAll} disabled={!(acc.caixaBalance > 0)}>
            Retirar {acc.caixaBalance > 0 ? fmt(acc.caixaBalance) : ""} e zerar
          </button>
        </div>
        {acc.caixaBalance <= 0 && <p className="mt-2 text-xs text-muted-foreground">O caixa já está a zero ou negativo — nada a retirar.</p>}
      </div>

      <div className="card">
        <h3 className="mb-3 text-base font-semibold">Extrato de caixa ({ledger.length} movimento(s))</h3>
        {ledger.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Sem movimentos.</p>
        ) : (
          <div className="max-h-[460px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[var(--card)]">
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-2">Data</th>
                  <th className="py-2 pr-2">Descrição</th>
                  <th className="py-2 pr-2 text-right">Entrada</th>
                  <th className="py-2 pr-2 text-right">Saída</th>
                  <th className="py-2 pr-2 text-right">Saldo</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((m) => (
                  <tr key={m.id} className="border-b last:border-0">
                    <td className="py-2 pr-2 whitespace-nowrap text-muted-foreground">{new Date(m.date).toLocaleDateString("pt-AO")}</td>
                    <td className="py-2 pr-2">{m.label}</td>
                    <td className="py-2 pr-2 text-right tabular-nums text-emerald-500">{m.in ? fmt(m.in) : ""}</td>
                    <td className="py-2 pr-2 text-right tabular-nums text-destructive">{m.out ? fmt(m.out) : ""}</td>
                    <td className={`py-2 pr-2 text-right tabular-nums font-medium ${m.balance < 0 ? "text-destructive" : ""}`}>{fmt(m.balance)}</td>
                    <td className="py-2 text-right">
                      {m.removable && (
                        <span className="flex items-center justify-end gap-2">
                          <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => editEntry(m.id.slice(1))}>editar</button>
                          <button className="text-xs text-muted-foreground hover:text-destructive" onClick={() => acc.removeCashEntry(m.id.slice(1))}>remover</button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- Fornecedores ----------------
function Fornecedores({ acc }: { acc: Acc }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<string | null>(null);
  const [payAmt, setPayAmt] = useState("");
  const [stmtFor, setStmtFor] = useState<string | null>(null);
  const [editFor, setEditFor] = useState<string | null>(null);
  const [eName, setEName] = useState("");
  const [ePhone, setEPhone] = useState("");
  const [eNote, setENote] = useState("");
  const [eMsg, setEMsg] = useState<string | null>(null);

  const add = () => {
    const r = acc.addSupplier(name, phone, note);
    if (r.ok) { setName(""); setPhone(""); setNote(""); setMsg(null); }
    else setMsg(r.error ?? "Erro");
  };

  const pay = (supplierId: string) => {
    const a = parseFloat(payAmt) || 0;
    if (a <= 0) return;
    acc.paySupplier(supplierId, a, new Date().toISOString());
    setPayFor(null); setPayAmt("");
  };

  const startEdit = (s: { id: string; name: string; phone?: string; note?: string }) => {
    setEditFor(s.id); setEName(s.name); setEPhone(s.phone ?? ""); setENote(s.note ?? ""); setEMsg(null);
    setPayFor(null); setStmtFor(null);
  };
  const saveEdit = (id: string) => {
    const r = acc.updateSupplier(id, { name: eName, phone: ePhone, note: eNote });
    if (r.ok) { setEditFor(null); setEMsg(null); }
    else setEMsg(r.error ?? "Erro");
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.6fr]">
      <div className="card h-fit">
        <h3 className="mb-4 text-base font-semibold">Novo fornecedor</h3>
        <div className="space-y-3">
          <div>
            <label className="label">Nome *</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label">Telefone</label>
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <label className="label">Nota</label>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <button className="btn-primary w-full" onClick={add} disabled={!name.trim()}>Criar fornecedor</button>
          {msg && <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{msg}</div>}
        </div>
      </div>

      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <StatCard label="Total em dívida" value={fmt(acc.totalOwed)} tone={acc.totalOwed > 0 ? "bad" : "good"} />
          <StatCard label="Fornecedores" value={String(acc.suppliers.length)} />
        </div>
        <div className="card">
          <h3 className="mb-3 text-base font-semibold">Fornecedores ({acc.suppliers.length})</h3>
          {acc.supplierStats.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Sem fornecedores. Crie um ao lado.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-2">Fornecedor</th>
                    <th className="py-2 pr-2 text-right">Comprado</th>
                    <th className="py-2 pr-2 text-right">Em dívida</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {acc.supplierStats.map(({ supplier, totalBought, owed, count }) => (
                    <Fragment key={supplier.id}>
                    <tr className="border-b last:border-0 align-top">
                      <td className="py-2 pr-2">
                        <div className="font-medium">{supplier.name}</div>
                        <div className="text-xs text-muted-foreground">{supplier.phone ?? ""}{supplier.phone && count ? " · " : ""}{count} compra(s)</div>
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums">{fmt(totalBought)}</td>
                      <td className={`py-2 pr-2 text-right tabular-nums ${owed > 0 ? "text-destructive font-semibold" : "text-muted-foreground"}`}>{fmt(owed)}</td>
                      <td className="py-2 text-right">
                        {payFor === supplier.id ? (
                          <div className="flex items-center justify-end gap-1">
                            <input type="number" min={0} className="input max-w-[110px]" placeholder="Valor" value={payAmt} onChange={(e) => setPayAmt(e.target.value)} autoFocus />
                            <button className="btn-primary text-xs" onClick={() => pay(supplier.id)}>Pagar</button>
                            <button className="btn-ghost text-xs" onClick={() => { setPayFor(null); setPayAmt(""); }}>✕</button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-2">
                            <button className="btn-ghost text-xs" onClick={() => setStmtFor(stmtFor === supplier.id ? null : supplier.id)}>{stmtFor === supplier.id ? "Fechar" : "Extrato"}</button>
                            <button className="btn-secondary text-xs" onClick={() => { setPayFor(supplier.id); setPayAmt(owed > 0 ? String(owed) : ""); }}>Pagar</button>
                            <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => startEdit(supplier)}>editar</button>
                            <button className="text-xs text-muted-foreground hover:text-destructive" onClick={() => confirm(`Remover "${supplier.name}"?`) && acc.removeSupplier(supplier.id)}>remover</button>
                          </div>
                        )}
                      </td>
                    </tr>
                    {editFor === supplier.id && (
                      <tr>
                        <td colSpan={4} className="pb-3">
                          <div className="rounded-md border border-[var(--border)] bg-[var(--muted)]/30 p-3">
                            <div className="grid gap-2 sm:grid-cols-3">
                              <div>
                                <label className="label">Nome *</label>
                                <input className="input" value={eName} onChange={(e) => setEName(e.target.value)} />
                              </div>
                              <div>
                                <label className="label">Telefone</label>
                                <input className="input" value={ePhone} onChange={(e) => setEPhone(e.target.value)} />
                              </div>
                              <div>
                                <label className="label">Nota</label>
                                <input className="input" value={eNote} onChange={(e) => setENote(e.target.value)} />
                              </div>
                            </div>
                            {eMsg && <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{eMsg}</div>}
                            <div className="mt-3 flex justify-end gap-2">
                              <button className="btn-secondary text-xs" onClick={() => setEditFor(null)}>Cancelar</button>
                              <button className="btn-primary text-xs" onClick={() => saveEdit(supplier.id)} disabled={!eName.trim()}>Guardar</button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    {stmtFor === supplier.id && (
                      <tr>
                        <td colSpan={4} className="pb-3">
                          <SupplierStatement acc={acc} supplierId={supplier.id} name={supplier.name} owed={owed} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SupplierStatement({ acc, supplierId, name, owed }: { acc: Acc; supplierId: string; name: string; owed: number }) {
  const [editPay, setEditPay] = useState<string | null>(null);
  const [pv, setPv] = useState("");
  const savePay = (payId: string) => {
    const a = parseFloat(pv) || 0;
    if (a > 0) acc.updatePayment(payId, { amount: a });
    setEditPay(null); setPv("");
  };
  type Ent = { id: string; date: string; label: string; debit: number; credit: number };
  const ents: Ent[] = [
    ...acc.fPurchases
      .filter((p) => p.supplierId === supplierId)
      .map((p) => ({
        id: "p" + p.id,
        date: p.date,
        label: p.paid === false ? "Compra a crédito" : "Compra (paga em dinheiro)",
        debit: p.paid === false ? p.total : 0,
        credit: 0,
      })),
    ...acc.fPayments
      .filter((p) => p.supplierId === supplierId)
      .map((p) => ({ id: "pay" + p.id, date: p.date, label: "Pagamento" + (p.note ? " · " + p.note : ""), debit: 0, credit: p.amount })),
  ];
  let run = 0;
  const rows = [...ents]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => {
      run += e.debit - e.credit;
      return { ...e, balance: run };
    })
    .reverse();

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--muted)]/30 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold">Extrato · {name}</div>
        <div className="text-xs text-muted-foreground">Saldo em dívida: <span className={owed > 0 ? "font-semibold text-destructive" : ""}>{fmt(owed)}</span></div>
      </div>
      {rows.length === 0 ? (
        <p className="py-3 text-center text-xs text-muted-foreground">Sem movimentos para este fornecedor nesta filial.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left uppercase tracking-wide text-muted-foreground">
              <th className="py-1 pr-2">Data</th>
              <th className="py-1 pr-2">Movimento</th>
              <th className="py-1 pr-2 text-right">Dívida (+)</th>
              <th className="py-1 pr-2 text-right">Pago (−)</th>
              <th className="py-1 pr-2 text-right">Saldo dívida</th>
              <th className="py-1"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isPay = r.id.startsWith("pay");
              const payId = r.id.slice(3);
              return (
              <tr key={r.id} className="border-t border-[var(--border)]">
                <td className="py-1 pr-2 whitespace-nowrap text-muted-foreground">{new Date(r.date).toLocaleDateString("pt-AO")}</td>
                <td className="py-1 pr-2">{r.label}</td>
                <td className="py-1 pr-2 text-right tabular-nums text-destructive">{r.debit ? fmt(r.debit) : ""}</td>
                <td className="py-1 pr-2 text-right tabular-nums text-emerald-500">
                  {editPay === payId ? (
                    <input type="number" min={0} className="input h-7 max-w-[100px] py-0 text-right" value={pv} onChange={(e) => setPv(e.target.value)} autoFocus />
                  ) : (
                    r.credit ? fmt(r.credit) : ""
                  )}
                </td>
                <td className={`py-1 pr-2 text-right tabular-nums font-medium ${r.balance > 0 ? "text-destructive" : ""}`}>{fmt(r.balance)}</td>
                <td className="py-1 text-right whitespace-nowrap">
                  {isPay && (
                    editPay === payId ? (
                      <span className="flex items-center justify-end gap-1">
                        <button className="text-emerald-600 hover:underline" onClick={() => savePay(payId)}>guardar</button>
                        <button className="text-muted-foreground hover:underline" onClick={() => { setEditPay(null); setPv(""); }}>✕</button>
                      </span>
                    ) : (
                      <span className="flex items-center justify-end gap-2">
                        <button className="text-muted-foreground hover:text-foreground" onClick={() => { setEditPay(payId); setPv(String(r.credit)); }}>editar</button>
                        <button className="text-muted-foreground hover:text-destructive" onClick={() => confirm("Remover este pagamento?") && acc.removePayment(payId)}>remover</button>
                      </span>
                    )
                  )}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------- Fretes ----------------
function Fretes({ acc }: { acc: Acc }) {
  const [transporter, setTransporter] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(today());
  const [editId, setEditId] = useState<string | null>(null);

  const reset = () => { setTransporter(""); setAmount(""); setNote(""); setDate(today()); setEditId(null); };

  const add = () => {
    const a = parseFloat(amount) || 0;
    if (a <= 0) return;
    if (editId) {
      acc.updateFreight(editId, { transporter, amount: a, note, date: new Date(date).toISOString() });
    } else {
      acc.addFreight(transporter, a, new Date(date).toISOString(), note);
    }
    reset();
  };

  const editFreight = (f: { id: string; transporter: string; amount: number; note?: string; date: string }) => {
    setEditId(f.id);
    setTransporter(f.transporter === "—" ? "" : f.transporter);
    setAmount(String(f.amount));
    setNote(f.note ?? "");
    setDate(f.date.slice(0, 10));
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard label="Total em fretes" value={fmt(acc.freightTotal)} tone="bad" big />
        <StatCard label="Registos de frete" value={String(acc.allFreight.length)} />
      </div>

      <div className="card">
        <h3 className="mb-3 text-base font-semibold">{editId ? "Editar frete" : "Novo frete"}</h3>
        <div className="grid gap-2 sm:grid-cols-[1.5fr_1fr_2fr_auto_auto_auto]">
          <input className="input" placeholder="Transportador" value={transporter} onChange={(e) => setTransporter(e.target.value)} />
          <input type="number" min={0} className="input" placeholder="Valor" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <input className="input" placeholder="Nota" value={note} onChange={(e) => setNote(e.target.value)} />
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          <button className="btn-primary" onClick={add} disabled={!(parseFloat(amount) > 0)}>{editId ? "Guardar" : "Adicionar"}</button>
          {editId && <button className="btn-secondary" onClick={reset}>Cancelar</button>}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Inclui automaticamente o transporte das compras. Adicione aqui fretes avulsos.</p>
      </div>

      <div className="card">
        <h3 className="mb-3 text-base font-semibold">Fretes ({acc.allFreight.length})</h3>
        {acc.allFreight.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Sem fretes.</p>
        ) : (
          <div className="max-h-[460px] overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-2">Data</th>
                  <th className="py-2 pr-2">Transportador</th>
                  <th className="py-2 pr-2">Origem</th>
                  <th className="py-2 pr-2 text-right">Valor</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {acc.allFreight.map((f) => (
                  <tr key={f.source + f.id} className="border-b last:border-0">
                    <td className="py-2 pr-2 whitespace-nowrap text-muted-foreground">{new Date(f.date).toLocaleDateString("pt-AO")}</td>
                    <td className="py-2 pr-2">{f.transporter}</td>
                    <td className="py-2 pr-2">
                      <span className="pill" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>{f.source === "purchase" ? "Compra" : "Avulso"}</span>
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">{fmt(f.amount)}</td>
                    <td className="py-2 text-right">
                      {f.source === "manual" && (
                        <span className="flex items-center justify-end gap-2">
                          <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => editFreight(f)}>editar</button>
                          <button className="text-xs text-muted-foreground hover:text-destructive" onClick={() => acc.removeFreight(f.id)}>remover</button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- Stock ----------------
function Stock({ acc, filialFilter }: { acc: Acc; filialFilter: string }) {
  const scope =
    filialFilter === "all" ? "todas as filiais" : filialFilter === "none" ? "registos sem filial" : acc.filiais.find((f) => f.id === filialFilter)?.name ?? "filial";
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard label="Valor do stock (custo)" value={fmt(acc.stockValue)} big />
        <StatCard label="Unidades em stock" value={String(acc.stockUnits)} />
      </div>

      <div className="card">
        <h3 className="mb-1 text-base font-semibold">Stock por produto</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          Calculado a partir das compras e vendas atribuídas a <b>{scope}</b>. Entradas = compras, saídas = vendas.
        </p>
        {acc.stockStats.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Sem movimento de stock para esta filial.</p>
        ) : (
          <div className="max-h-[460px] overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-2">Produto</th>
                  <th className="py-2 pr-2 text-right">Quantidade</th>
                  <th className="py-2 pr-2 text-right">Custo médio</th>
                  <th className="py-2 pr-2 text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {acc.stockStats.map(({ product, qty, value }) => (
                  <tr key={product.id} className="border-b last:border-0">
                    <td className="py-2 pr-2">
                      <div className="font-medium">{productTitle(product)}</div>
                      {product.sku && product.name && <div className="text-xs font-mono text-muted-foreground">{productCode(product)}</div>}
                    </td>
                    <td className={`py-2 pr-2 text-right tabular-nums ${qty < 0 ? "text-destructive" : ""}`}>{qty}</td>
                    <td className="py-2 pr-2 text-right tabular-nums text-muted-foreground">{fmt(product.avgCost)}</td>
                    <td className="py-2 pr-2 text-right tabular-nums font-medium">{fmt(value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- Empresa / Filiais ----------------
function Empresa({ acc }: { acc: Acc }) {
  const [name, setName] = useState(acc.company.name ?? "");
  const [phone, setPhone] = useState(acc.company.phone ?? "");
  const [address, setAddress] = useState(acc.company.address ?? "");
  const [saved, setSaved] = useState(false);
  const [thermalPrinter, setThermalPrinter] = useState("");
  const [printerSaved, setPrinterSaved] = useState(false);

  useEffect(() => {
    window.venomPrint?.getPrinter?.().then((p) => setThermalPrinter(p || "")).catch(() => {});
  }, []);

  const [fName, setFName] = useState("");
  const [fLoc, setFLoc] = useState("");
  const [fMsg, setFMsg] = useState<string | null>(null);

  const [editFil, setEditFil] = useState<string | null>(null);
  const [efName, setEfName] = useState("");
  const [efLoc, setEfLoc] = useState("");
  const [efMsg, setEfMsg] = useState<string | null>(null);
  const startEditFilial = (f: { id: string; name: string; location?: string }) => {
    setEditFil(f.id); setEfName(f.name); setEfLoc(f.location ?? ""); setEfMsg(null);
  };
  const saveEditFilial = (id: string) => {
    const r = acc.updateFilial(id, { name: efName, location: efLoc });
    if (r.ok) { setEditFil(null); setEfMsg(null); }
    else setEfMsg(r.error ?? "Erro");
  };

  const [assignTo, setAssignTo] = useState("");
  const unlabeled = acc.unlabeledPurchases + acc.unlabeledSales;
  const runAssign = () => {
    if (!assignTo) return;
    const fname = acc.filiais.find((f) => f.id === assignTo)?.name ?? "";
    if (!confirm(`Atribuir ${acc.unlabeledPurchases} compra(s) e ${acc.unlabeledSales} venda(s) sem filial a "${fname}"?`)) return;
    acc.assignUnlabeledToFilial(assignTo);
    setAssignTo("");
  };

  const saveCompany = () => {
    acc.saveCompany({ name: name.trim(), phone: phone.trim() || undefined, address: address.trim() || undefined });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const addFilial = () => {
    const r = acc.addFilial(fName, fLoc);
    if (r.ok) { setFName(""); setFLoc(""); setFMsg(null); }
    else setFMsg(r.error ?? "Erro");
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="card h-fit">
        <h3 className="mb-4 text-base font-semibold">Dados da empresa</h3>
        <p className="mb-4 text-xs text-muted-foreground">Aparece no cabeçalho dos relatórios em PDF.</p>
        <div className="space-y-3">
          <div>
            <label className="label">Nome da empresa</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: VENOM Comercial, Lda" />
          </div>
          <div>
            <label className="label">Telefone</label>
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <label className="label">Endereço</label>
            <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <button className="btn-primary w-full" onClick={saveCompany}>{saved ? "Guardado ✓" : "Guardar"}</button>
        </div>
        {typeof window !== "undefined" && window.venomPrint && (
          <div className="mt-6 border-t pt-4" style={{ borderColor: "var(--border)" }}>
            <h4 className="mb-2 text-sm font-semibold">Impressora térmica (caixa)</h4>
            <p className="mb-3 text-xs text-muted-foreground">
              Nome exacto da impressora no Windows (ex: XP80). Deixe vazio para usar a impressora predefinida.
              A venda imprime automaticamente ao finalizar — sem janela de confirmação.
            </p>
            <input
              className="input"
              value={thermalPrinter}
              onChange={(e) => setThermalPrinter(e.target.value)}
              placeholder="XP80"
            />
            <button
              className="btn-secondary mt-2 w-full"
              onClick={async () => {
                await window.venomPrint?.setPrinter?.(thermalPrinter.trim());
                setPrinterSaved(true);
                setTimeout(() => setPrinterSaved(false), 1500);
              }}
            >
              {printerSaved ? "Impressora guardada ✓" : "Guardar impressora"}
            </button>
          </div>
        )}
      </div>

      <div className="card h-fit">
        <h3 className="mb-4 text-base font-semibold">Filiais ({acc.filiais.length})</h3>
        <div className="grid gap-2 sm:grid-cols-[1.5fr_1.5fr_auto]">
          <input className="input" placeholder="Nome da filial" value={fName} onChange={(e) => setFName(e.target.value)} />
          <input className="input" placeholder="Localização (opcional)" value={fLoc} onChange={(e) => setFLoc(e.target.value)} />
          <button className="btn-primary" onClick={addFilial} disabled={!fName.trim()}>+ Filial</button>
        </div>
        {fMsg && <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{fMsg}</div>}

        <ul className="mt-4 divide-y">
          {acc.filiais.length === 0 && <li className="py-4 text-center text-sm text-muted-foreground">Sem filiais. Adicione a primeira acima.</li>}
          {acc.filiais.map((f) => (
            <li key={f.id} className="py-2">
              {editFil === f.id ? (
                <div>
                  <div className="grid gap-2 sm:grid-cols-[1.5fr_1.5fr_auto_auto]">
                    <input className="input" placeholder="Nome da filial" value={efName} onChange={(e) => setEfName(e.target.value)} autoFocus />
                    <input className="input" placeholder="Localização" value={efLoc} onChange={(e) => setEfLoc(e.target.value)} />
                    <button className="btn-primary text-xs" onClick={() => saveEditFilial(f.id)} disabled={!efName.trim()}>Guardar</button>
                    <button className="btn-secondary text-xs" onClick={() => setEditFil(null)}>Cancelar</button>
                  </div>
                  {efMsg && <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{efMsg}</div>}
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="font-medium">
                      {f.name}
                      {acc.company.currentFilialId === f.id && <span className="ml-2 pill" style={{ background: "color-mix(in oklab, var(--primary) 18%, transparent)", color: "var(--primary)" }}>atual</span>}
                    </div>
                    {f.location && <div className="text-xs text-muted-foreground">{f.location}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    {acc.company.currentFilialId !== f.id && (
                      <button className="btn-secondary text-xs" onClick={() => acc.setCurrentFilial(f.id)}>Definir atual</button>
                    )}
                    <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => startEditFilial(f)}>editar</button>
                    <button className="text-xs text-muted-foreground hover:text-destructive" onClick={() => confirm(`Remover filial "${f.name}"?`) && acc.removeFilial(f.id)}>remover</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      {acc.filiais.length > 0 && (
        <div className="card h-fit lg:col-span-2">
          <h3 className="mb-1 text-base font-semibold">Ligar dados antigos a uma filial</h3>
          <p className="mb-3 text-xs text-muted-foreground">
            Compras e vendas registadas antes de criar filiais ficam <b>sem filial</b>. Atribua-as a uma filial para aparecerem nas contas, stock e relatórios dessa filial.
          </p>
          {unlabeled === 0 ? (
            <p className="rounded-md border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2 text-sm text-muted-foreground">
              ✓ Tudo ligado — não há compras nem vendas sem filial.
            </p>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div className="text-sm">
                <span className="pill" style={{ background: "color-mix(in oklab, var(--destructive) 16%, transparent)", color: "var(--destructive)" }}>
                  {acc.unlabeledPurchases} compra(s) · {acc.unlabeledSales} venda(s) sem filial
                </span>
              </div>
              <div>
                <label className="label">Atribuir a</label>
                <select className="input min-w-[180px]" value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
                  <option value="">— escolher filial —</option>
                  {acc.filiais.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>
              <button className="btn-primary" onClick={runAssign} disabled={!assignTo}>Atribuir dados antigos</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
