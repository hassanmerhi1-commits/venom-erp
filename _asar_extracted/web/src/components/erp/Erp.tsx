import { useEffect, useRef, useState } from "react";
import { Dashboard } from "./Dashboard";
import { Products } from "./Products";
import { Purchases } from "./Purchases";
import { Sales } from "./Sales";
import { Reports } from "./Reports";
import { Users } from "./Users";
import { Accounts } from "./Accounts";
import { Login } from "./Login";
import { exportDb, importDb, dbInfo, dbChangePath, dbReveal } from "@/lib/erp-store";
import { useAuth, logout } from "@/lib/auth";
import { useAccounts } from "@/lib/accounts-store";
import venomIcon from "@/assets/venom-icon.png";

type Tab = "dashboard" | "products" | "purchases" | "sales" | "reports" | "contas" | "users";

export function Erp() {
  const { session } = useAuth();
  const { filiais, company, setCurrentFilial } = useAccounts();
  const [tab, setTab] = useState<Tab>("dashboard");
  const fileRef = useRef<HTMLInputElement>(null);
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light",
  );
  const [appVersion, setAppVersion] = useState("");
  const [update, setUpdate] = useState<{ status: string; version?: string; percent?: number } | null>(null);

  useEffect(() => {
    const u = window.venomUpdater;
    if (!u) return;
    u.getVersion().then(setAppVersion).catch(() => {});
    return u.onStatus(setUpdate);
  }, []);

  const onCheckUpdate = async () => {
    const u = window.venomUpdater;
    if (!u) {
      alert("Auto-update só funciona na versão instalada (Setup.exe), não no modo dev.");
      return;
    }
    setUpdate({ status: "checking" });
    const r = await u.check();
    if (!r.ok) {
      setUpdate(null);
      alert(r.error === "not-packaged" ? "Modo desenvolvimento — sem auto-update." : `Erro ao verificar: ${r.error}`);
      return;
    }
    if (!r.updateInfo?.version) setUpdate({ status: "none" });
  };

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    try { localStorage.setItem("venom.theme", next); } catch { /* ignore */ }
    setTheme(next);
  };

  if (!session) return <Login />;

  const TABS: { id: Tab; label: string }[] = [
    { id: "dashboard", label: "Dashboard" },
    { id: "products", label: "Produtos" },
    { id: "purchases", label: "Compras" },
    { id: "sales", label: "Vendas" },
    { id: "reports", label: "Relatórios" },
    { id: "contas", label: "Contas" },
    ...(session.role === "admin" ? [{ id: "users" as Tab, label: "Utilizadores" }] : []),
  ];

  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!confirm("Importar irá substituir os dados atuais. Continuar?")) return;
    const r = await importDb(f);
    alert(r.ok ? "Base importada com sucesso." : `Falha: ${r.error}`);
  };

  const info = dbInfo();
  const onChangePath = () => {
    const p = dbChangePath();
    if (p) alert(`Base de dados agora em:\n${p}`);
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header
        className="sticky top-0 z-30 border-b border-[var(--border)]"
        style={{ background: "color-mix(in oklab, var(--card) 82%, transparent)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)" }}
      >
        <div className="mx-auto flex w-full max-w-[1800px] items-center justify-between gap-4 px-6 py-4 lg:px-10">
          <div className="flex items-center gap-3">
            <img src={venomIcon} alt="VENOM ERP" width={40} height={40} className="h-10 w-10 object-contain drop-shadow-[0_2px_8px_rgba(56,163,216,0.45)]" />
            <div>
              <h1 className="text-lg font-bold tracking-tight text-foreground">VENOM<span className="text-[var(--primary)]"> ERP</span></h1>
              <p className="text-[11px] text-muted-foreground">
                Compras · Vendas · Stock · Relatórios — 100% offline
                {appVersion && <span className="ml-1 opacity-70">· v{appVersion}</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" accept=".db,.json,application/json" className="hidden" onChange={onImport} />
            {filiais.length > 0 && (
              <select
                className="input h-9 max-w-[170px] py-1 text-xs"
                value={company.currentFilialId ?? ""}
                onChange={(e) => setCurrentFilial(e.target.value || undefined)}
                title="Filial ativa — novas vendas e compras são associadas a esta filial"
              >
                <option value="">— sem filial —</option>
                {filiais.map((f) => (
                  <option key={f.id} value={f.id}>🏪 {f.name}</option>
                ))}
              </select>
            )}
            <button className="btn-ghost" onClick={onCheckUpdate} title="Verificar atualizações">↻ Atualizar</button>
            <button className="btn-ghost" onClick={toggleTheme} title={theme === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro"}>
              {theme === "dark" ? "☀" : "🌙"}
            </button>
            <button className="btn-ghost" onClick={() => fileRef.current?.click()} title="Importar uma base venom.db">↥ Importar</button>
            <button className="btn-secondary" onClick={exportDb} title="Guardar a base em ficheiro venom.db">↧ Exportar .db</button>
            {info.native && (
              <button
                className="btn-ghost"
                onClick={onChangePath}
                title={`Base de dados: ${info.path}\n(clique para mudar localização)`}
              >
                🗄 BD
              </button>
            )}
            {info.native && (
              <button className="btn-ghost" onClick={dbReveal} title="Abrir pasta da base de dados">📂</button>
            )}
            <div className="ml-2 hidden items-center gap-2 sm:flex">
              <span className="pill" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
                {session.username} · {session.role}
              </span>
              <button className="btn-ghost" onClick={() => { if (confirm("Terminar sessão?")) logout(); }}>Sair</button>
            </div>
          </div>
        </div>
        <nav className="mx-auto flex w-full max-w-[1800px] gap-1 overflow-x-auto px-4 lg:px-8">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                tab === t.id
                  ? "border-[var(--primary)] text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
        {update && update.status !== "none" && (
          <div className="mx-auto flex w-full max-w-[1800px] items-center justify-between gap-3 border-t border-[var(--border)] px-6 py-2 text-xs lg:px-10"
            style={{ background: "color-mix(in oklab, var(--primary) 12%, var(--card))" }}>
            <span className="text-foreground">
              {update.status === "checking" && "A verificar atualizações…"}
              {update.status === "available" && `Nova versão ${update.version} — a transferir…`}
              {update.status === "downloading" && `A transferir atualização… ${update.percent ?? 0}%`}
              {update.status === "ready" && `Versão ${update.version} pronta — reinicie para instalar.`}
              {update.status === "error" && "Não foi possível verificar atualizações (servidor offline ou URL não configurada)."}
            </span>
            {update.status === "ready" && (
              <button className="btn-primary py-1 text-xs" onClick={() => window.venomUpdater?.install()}>Reiniciar agora</button>
            )}
          </div>
        )}
      </header>
      <div className="mx-auto w-full max-w-[1800px] px-6 py-8 lg:px-10">
        {tab === "dashboard" && <Dashboard onNav={setTab} />}
        {tab === "products" && <Products />}
        {tab === "purchases" && <Purchases />}
        {tab === "sales" && <Sales />}
        {tab === "reports" && <Reports />}
        {tab === "contas" && <Accounts />}
        {tab === "users" && <Users />}
      </div>

      <style>{`
        .input {
          width: 100%;
          border-radius: 0.5rem;
          border: 1px solid var(--border);
          background: var(--input);
          color: var(--foreground);
          padding: 0.55rem 0.75rem;
          font-size: 0.875rem;
          outline: none;
          transition: border-color .15s, box-shadow .15s;
        }
        .input::placeholder { color: var(--muted-foreground); opacity: .7; }
        .input:focus { border-color: var(--ring); box-shadow: 0 0 0 3px color-mix(in oklab, var(--ring) 25%, transparent); }
        select.input { appearance: none; background-image: linear-gradient(45deg, transparent 50%, var(--muted-foreground) 50%), linear-gradient(135deg, var(--muted-foreground) 50%, transparent 50%); background-position: calc(100% - 18px) 50%, calc(100% - 13px) 50%; background-size: 5px 5px; background-repeat: no-repeat; padding-right: 2rem; }
        .btn-primary { display:inline-flex; align-items:center; justify-content:center; gap:.4rem; background: var(--primary); color: var(--primary-foreground); border-radius: .5rem; padding: .55rem 1.1rem; font-size: .875rem; font-weight: 600; box-shadow: 0 4px 14px color-mix(in oklab, var(--primary) 30%, transparent); transition: transform .08s, box-shadow .15s, opacity .15s; }
        .btn-primary:hover:not(:disabled) { box-shadow: 0 6px 20px color-mix(in oklab, var(--primary) 45%, transparent); }
        .btn-primary:active:not(:disabled) { transform: translateY(1px); }
        .btn-primary:disabled { opacity: .45; cursor: not-allowed; box-shadow: none; }
        .btn-secondary { background: var(--secondary); color: var(--secondary-foreground); border: 1px solid var(--border); border-radius: .5rem; padding: .5rem .9rem; font-size: .8125rem; font-weight: 500; }
        .btn-secondary:hover { background: var(--muted); }
        .btn-ghost { background: transparent; color: var(--muted-foreground); border-radius: .5rem; padding: .45rem .75rem; font-size: .8125rem; }
        .btn-ghost:hover { background: var(--muted); color: var(--foreground); }
        .card { background: var(--card); border: 1px solid var(--border); border-radius: .85rem; padding: 1.25rem; box-shadow: 0 1px 0 rgba(255,255,255,.4) inset, 0 4px 20px color-mix(in oklab, var(--primary) 8%, transparent); }
        .label { display:block; font-size: .72rem; font-weight: 600; letter-spacing: .02em; text-transform: uppercase; color: var(--muted-foreground); margin-bottom: .35rem; }
        .pill { display:inline-flex; align-items:center; padding: .2rem .55rem; border-radius: 9999px; font-size: .7rem; font-weight: 600; }
        table { border-color: var(--border); }
        th, td { border-color: var(--border) !important; }
      `}</style>
    </main>
  );
}