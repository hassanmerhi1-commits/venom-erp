import { useEffect, type ReactNode } from "react";

export function Modal({
  open,
  onClose,
  title,
  children,
  size = "lg",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: "md" | "lg" | "xl";
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  const maxW = size === "md" ? "max-w-lg" : size === "xl" ? "max-w-5xl" : "max-w-2xl";

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in"
      onClick={onClose}
    >
      <div
        className={`w-full ${maxW} max-h-[90vh] overflow-hidden rounded-xl border bg-card shadow-2xl flex flex-col`}
        style={{ borderColor: "var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b px-5 py-3" style={{ borderColor: "var(--border)" }}>
          <h3 className="text-base font-semibold">{title}</h3>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>
        <div className="overflow-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export function PdfPreviewModal({
  open,
  onClose,
  url,
  html,
  filename,
}: {
  open: boolean;
  onClose: () => void;
  url: string | null;
  html: string | null;
  filename: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open || !url || !html) return null;

  const print = () => {
    const iframe = document.getElementById("venom-print-frame") as HTMLIFrameElement | null;
    try {
      iframe?.contentWindow?.focus();
      iframe?.contentWindow?.print();
    } catch {
      window.print();
    }
  };

  const download = () => {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border bg-card shadow-2xl"
        style={{ borderColor: "var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b px-5 py-3" style={{ borderColor: "var(--border)" }}>
          <h3 className="text-base font-semibold">Pré-visualização · {filename}</h3>
          <div className="flex items-center gap-2">
            <button onClick={print} className="btn-primary">🖨 Imprimir</button>
            <button onClick={download} className="btn-secondary">↧ Descarregar</button>
            <button
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Fechar"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto bg-muted/30 p-4">
          <iframe
            id="venom-print-frame"
            srcDoc={html}
            title="Pré-visualização da fatura"
            className="h-full w-full rounded-lg bg-white shadow-sm"
            style={{ border: 0 }}
          />
        </div>
      </div>
    </div>
  );
}