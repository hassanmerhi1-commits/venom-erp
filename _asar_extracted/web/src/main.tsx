import React from "react";
import ReactDOM from "react-dom/client";
import { Erp } from "@/components/erp/Erp";
import "./styles.css";

(function initTheme() {
  try {
    const saved = localStorage.getItem("venom.theme");
    const theme = saved === "light" || saved === "dark" ? saved : "light";
    document.documentElement.classList.toggle("dark", theme === "dark");
  } catch {
    document.documentElement.classList.remove("dark");
  }
})();

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("VENOM render error:", error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0b1220", color: "#e5e7eb", fontFamily: "system-ui, sans-serif", padding: 24 }}>
          <div style={{ maxWidth: 560, textAlign: "center" }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Ocorreu um erro na aplicação</h1>
            <p style={{ fontSize: 14, opacity: 0.75, marginBottom: 16 }}>
              Os seus dados estão guardados. Tente recarregar. Se persistir, partilhe a mensagem abaixo.
            </p>
            <pre style={{ textAlign: "left", whiteSpace: "pre-wrap", background: "#111827", border: "1px solid #1f2937", borderRadius: 8, padding: 12, fontSize: 12, color: "#fca5a5", overflow: "auto", maxHeight: 200 }}>
              {String(this.state.error?.message ?? this.state.error)}
            </pre>
            <button
              onClick={() => window.location.reload()}
              style={{ marginTop: 16, background: "#16a34a", color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontWeight: 600, cursor: "pointer" }}
            >
              Recarregar
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

window.addEventListener("error", (e) => console.error("VENOM window error:", e.message, e.filename, e.lineno));
window.addEventListener("unhandledrejection", (e) => console.error("VENOM unhandled rejection:", String(e.reason)));

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Erp />
    </ErrorBoundary>
  </React.StrictMode>
);