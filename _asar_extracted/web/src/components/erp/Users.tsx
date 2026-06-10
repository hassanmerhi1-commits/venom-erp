import { useState } from "react";
import { useAuth, type Role } from "@/lib/auth";

export function Users() {
  const { session, users, addUser, changePassword, removeUser } = useAuth();
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [role, setRole] = useState<Role>("user");
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [pwEdits, setPwEdits] = useState<Record<string, string>>({});

  if (session?.role !== "admin") {
    return <div className="card">Apenas o admin pode gerir utilizadores.</div>;
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const r = addUser(u, p, role);
    if (r.ok) {
      setMsg({ type: "ok", text: `Utilizador "${u}" criado.` });
      setU(""); setP(""); setRole("user");
    } else setMsg({ type: "err", text: r.error ?? "Erro" });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.5fr]">
      <div className="card h-fit">
        <h2 className="mb-4 text-base font-semibold">Novo utilizador</h2>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="label">Utilizador</label>
            <input className="input" value={u} onChange={(e) => setU(e.target.value)} />
          </div>
          <div>
            <label className="label">Palavra-passe</label>
            <input type="text" className="input" value={p} onChange={(e) => setP(e.target.value)} />
          </div>
          <div>
            <label className="label">Função</label>
            <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="caixa">Caixa (só vendas)</option>
              <option value="user">Utilizador</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button className="btn-primary w-full" type="submit">Criar</button>
          {msg && (
            <div className={`rounded-md border px-3 py-2 text-xs ${msg.type === "ok" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700" : "border-destructive/40 bg-destructive/10 text-destructive"}`}>
              {msg.text}
            </div>
          )}
        </form>
      </div>

      <div className="card">
        <h2 className="mb-4 text-base font-semibold">Utilizadores ({users.length})</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-2">Utilizador</th>
                <th className="py-2 pr-2">Função</th>
                <th className="py-2 pr-2">Mudar palavra-passe</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((x) => (
                <tr key={x.username} className="border-b last:border-0">
                  <td className="py-2 pr-2 font-medium">{x.username}{x.username === session?.username && <span className="ml-2 pill" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>você</span>}</td>
                  <td className="py-2 pr-2"><span className="pill" style={{ background: x.role === "admin" ? "color-mix(in oklab, var(--primary) 18%, transparent)" : x.role === "caixa" ? "color-mix(in oklab, var(--primary) 10%, transparent)" : "var(--muted)", color: x.role === "admin" || x.role === "caixa" ? "var(--primary)" : "var(--muted-foreground)" }}>{x.role === "caixa" ? "Caixa" : x.role}</span></td>
                  <td className="py-2 pr-2">
                    <div className="flex gap-2">
                      <input
                        className="input"
                        placeholder="nova palavra-passe"
                        value={pwEdits[x.username] ?? ""}
                        onChange={(e) => setPwEdits((s) => ({ ...s, [x.username]: e.target.value }))}
                      />
                      <button
                        className="btn-secondary"
                        onClick={() => {
                          const v = pwEdits[x.username] ?? "";
                          const r = changePassword(x.username, v);
                          if (r.ok) {
                            setPwEdits((s) => ({ ...s, [x.username]: "" }));
                            setMsg({ type: "ok", text: `Palavra-passe de "${x.username}" alterada.` });
                          } else setMsg({ type: "err", text: r.error ?? "Erro" });
                        }}
                      >Guardar</button>
                    </div>
                  </td>
                  <td className="py-2 text-right">
                    <button
                      className="rounded p-1 text-muted-foreground hover:text-destructive disabled:opacity-30"
                      disabled={x.username === session?.username}
                      onClick={() => {
                        if (!confirm(`Remover "${x.username}"?`)) return;
                        const r = removeUser(x.username);
                        if (!r.ok) setMsg({ type: "err", text: r.error ?? "Erro" });
                      }}
                      title="Remover"
                    >×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}