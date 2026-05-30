import { useState } from "react";
import { login } from "@/lib/auth";

export function Login() {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    const r = login(u, p);
    if (!r.ok) setErr(r.error);
  };

  return (
    <main className="grid min-h-screen place-items-center bg-background px-4 text-foreground">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] font-black">V</div>
          <div>
            <h1 className="text-base font-bold">VENOM<span className="text-[var(--primary)]"> ERP</span></h1>
            <p className="text-[11px] text-muted-foreground">Entrar na sua conta</p>
          </div>
        </div>
        <div>
          <label className="label">Utilizador</label>
          <input className="input" value={u} onChange={(e) => setU(e.target.value)} autoFocus />
        </div>
        <div>
          <label className="label">Palavra-passe</label>
          <input type="password" className="input" value={p} onChange={(e) => setP(e.target.value)} />
        </div>
        {err && <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{err}</div>}
        <button type="submit" className="btn-primary w-full">Entrar</button>
        <p className="text-center text-[11px] text-muted-foreground">
          Primeira instalação: <code className="rounded bg-muted px-1">admin</code> / <code className="rounded bg-muted px-1">admin</code> — altere a palavra-passe em Utilizadores.
        </p>
      </form>
    </main>
  );
}