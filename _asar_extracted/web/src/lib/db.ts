// Persistence adapter: prefers Electron file-backed DB (window.venomDb), falls back to localStorage.
// Same key/value API so the rest of the app does not change.

type SaveResult = { ok: boolean; error?: string };

declare global {
  interface Window {
    venomDb?: {
      load: () => Record<string, unknown>;
      save: (state: Record<string, unknown>) => SaveResult;
      getPath: () => string;
      setPath: () => string | null;
      reveal: () => boolean;
    };
    venomUpdater?: {
      getVersion: () => Promise<string>;
      check: () => Promise<{ ok: boolean; error?: string; updateInfo?: { version?: string } | null }>;
      install: () => void;
      onStatus: (cb: (payload: { status: string; version?: string; percent?: number; message?: string }) => void) => () => void;
    };
    venomPrint?: {
      thermal: (html: string, printerName?: string) => Promise<{ ok: boolean; error?: string }>;
      getPrinter: () => Promise<string>;
      setPrinter: (name: string) => Promise<string>;
    };
  }
}

const hasNative = () => typeof window !== "undefined" && !!window.venomDb;

let cache: Record<string, unknown> | null = null;
function loadCache() {
  if (cache) return cache;
  cache = hasNative() ? (window.venomDb!.load() ?? {}) : {};
  return cache;
}

export function dbRead<T>(key: string, fallback: T): T {
  if (hasNative()) {
    const c = loadCache();
    const v = c[key];
    return (v === undefined || v === null) ? fallback : (v as T);
  }
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function dbWrite<T>(key: string, value: T) {
  if (hasNative()) {
    const c = loadCache();
    c[key] = value as unknown;
    window.venomDb!.save(c);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("erp:change", { detail: key }));
    }
    return;
  }
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent("erp:change", { detail: key }));
}

export function dbInfo() {
  if (hasNative()) {
    return { native: true as const, path: window.venomDb!.getPath() };
  }
  return { native: false as const, path: "Navegador (localStorage)" };
}

export function dbChangePath(): string | null {
  if (!hasNative()) return null;
  const p = window.venomDb!.setPath();
  if (p) {
    cache = window.venomDb!.load() ?? {};
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("erp:change", { detail: "path" }));
    }
  }
  return p;
}

export function dbReveal() {
  if (hasNative()) window.venomDb!.reveal();
}

export function dbExportAll(): Record<string, unknown> {
  if (hasNative()) return { ...loadCache() };
  if (typeof window === "undefined") return {};
  const out: Record<string, unknown> = {};
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i)!;
    try { out[k] = JSON.parse(window.localStorage.getItem(k) ?? "null"); } catch { out[k] = null; }
  }
  return out;
}

export function dbImportAll(state: Record<string, unknown>) {
  if (hasNative()) {
    cache = { ...state };
    window.venomDb!.save(cache);
  } else if (typeof window !== "undefined") {
    for (const [k, v] of Object.entries(state)) {
      window.localStorage.setItem(k, JSON.stringify(v));
    }
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("erp:change", { detail: "import" }));
  }
}

export function dbClearKeys(keys: string[]) {
  if (hasNative()) {
    const c = loadCache();
    for (const k of keys) delete c[k];
    window.venomDb!.save(c);
  } else if (typeof window !== "undefined") {
    for (const k of keys) window.localStorage.removeItem(k);
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("erp:change", { detail: "clear" }));
  }
}
