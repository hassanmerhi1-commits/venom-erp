const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

let mainWindow = null;
let autoUpdater = null;

function sendUpdate(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("venom-update", payload);
  }
}

function initAutoUpdater() {
  if (!app.isPackaged) return;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch (e) {
    dlog("UPDATER-LOAD-FAIL", String(e));
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = {
    info: (...a) => dlog("UPDATER", ...a),
    warn: (...a) => dlog("UPDATER-WARN", ...a),
    error: (...a) => dlog("UPDATER-ERR", ...a),
    debug: () => {},
  };

  autoUpdater.on("checking-for-update", () => sendUpdate({ status: "checking" }));
  autoUpdater.on("update-available", (info) => {
    sendUpdate({ status: "available", version: info.version });
    dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "VENOM ERP — Atualização",
      message: `Versão ${info.version} disponível.`,
      detail: "A transferência começa automaticamente. Será avisado quando puder reiniciar.",
      buttons: ["OK"],
    }).catch(() => {});
  });
  autoUpdater.on("update-not-available", () => sendUpdate({ status: "none" }));
  autoUpdater.on("download-progress", (p) => {
    sendUpdate({ status: "downloading", percent: Math.round(p.percent || 0) });
  });
  autoUpdater.on("update-downloaded", (info) => {
    sendUpdate({ status: "ready", version: info.version });
    dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "VENOM ERP — Atualização pronta",
      message: `Versão ${info.version} transferida.`,
      detail: "Reinicie agora para aplicar a atualização?",
      buttons: ["Reiniciar agora", "Mais tarde"],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall(false, true);
    }).catch(() => {});
  });
  autoUpdater.on("error", (err) => {
    dlog("UPDATER-ERROR", String(err));
    sendUpdate({ status: "error", message: String(err.message || err) });
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((e) => dlog("UPDATER-CHECK-FAIL", String(e)));
  }, 8000);
}

ipcMain.handle("venom-updater:get-version", () => app.getVersion());
ipcMain.handle("venom-updater:check", async () => {
  if (!autoUpdater) return { ok: false, error: "not-packaged" };
  try {
    const r = await autoUpdater.checkForUpdates();
    return { ok: true, updateInfo: r?.updateInfo ?? null };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});
ipcMain.on("venom-updater:install", () => {
  if (autoUpdater) autoUpdater.quitAndInstall(false, true);
});

// --- Database file location ---
const CONFIG_FILE = path.join(app.getPath("userData"), "venom-config.json");

function defaultDbPath() {
  if (process.platform === "win32") {
    const dir = "C:\\VenomERP";
    return path.join(dir, "venom.db");
  }
  return path.join(os.homedir(), "VenomERP", "venom.db");
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeConfig(cfg) {
  try {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  } catch (e) {
    console.error("config write fail", e);
  }
}

function getDbPath() {
  const cfg = readConfig();
  return cfg.dbPath || defaultDbPath();
}

function ensureDb(p) {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    if (!fs.existsSync(p)) {
      fs.writeFileSync(p, JSON.stringify({ app: "VENOM-ERP", version: 1, data: {} }, null, 2));
    }
  } catch (e) {
    console.error("ensureDb fail", e);
  }
}

function loadDb() {
  const p = getDbPath();
  ensureDb(p);
  try {
    const raw = fs.readFileSync(p, "utf8");
    const parsed = JSON.parse(raw);
    return parsed.data || {};
  } catch (e) {
    console.error("loadDb fail", e);
    return {};
  }
}

function saveDb(state) {
  const p = getDbPath();
  ensureDb(p);
  try {
    const payload = { app: "VENOM-ERP", version: 1, savedAt: new Date().toISOString(), data: state };
    fs.writeFileSync(p, JSON.stringify(payload, null, 2));
    return { ok: true };
  } catch (e) {
    console.error("saveDb fail", e);
    return { ok: false, error: String(e) };
  }
}

ipcMain.on("venom-db:load", (e) => { e.returnValue = loadDb(); });
ipcMain.on("venom-db:save", (e, state) => { e.returnValue = saveDb(state); });
ipcMain.on("venom-db:get-path", (e) => { e.returnValue = getDbPath(); });
ipcMain.on("venom-db:reveal", (e) => {
  try { shell.showItemInFolder(getDbPath()); } catch {}
  e.returnValue = true;
});
ipcMain.on("venom-db:set-path", (e) => {
  const win = BrowserWindow.getFocusedWindow();
  const res = dialog.showSaveDialogSync(win, {
    title: "Escolher localização da base de dados VENOM",
    defaultPath: getDbPath(),
    filters: [{ name: "VENOM DB", extensions: ["db"] }],
  });
  if (!res) { e.returnValue = null; return; }
  // If file doesn't exist yet, seed with current data
  const current = loadDb();
  const cfg = readConfig();
  cfg.dbPath = res;
  writeConfig(cfg);
  ensureDb(res);
  if (!fs.existsSync(res) || fs.readFileSync(res, "utf8").length < 5) {
    saveDb(current);
  }
  e.returnValue = res;
});

const DEBUG_LOG = path.join(app.getPath("userData"), "venom-debug.log");
function dlog(...args) {
  try { fs.appendFileSync(DEBUG_LOG, new Date().toISOString() + "  " + args.join(" ") + "\n"); } catch {}
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: "VENOM ERP",
    backgroundColor: "#e8f4fc",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      plugins: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  Menu.setApplicationMenu(null);

  const wc = mainWindow.webContents;
  wc.on("console-message", (_e, level, message, line, sourceId) => dlog("CONSOLE", "L" + level, message, "@" + sourceId + ":" + line));
  wc.on("did-fail-load", (_e, code, desc, url) => dlog("FAIL-LOAD", code, desc, url));
  wc.on("did-finish-load", () => dlog("FINISH-LOAD"));
  wc.on("render-process-gone", (_e, details) => dlog("RENDER-GONE", JSON.stringify(details)));
  wc.on("preload-error", (_e, p, err) => dlog("PRELOAD-ERR", p, String(err)));
  wc.on("unresponsive", () => dlog("UNRESPONSIVE"));

  const indexPath = path.join(__dirname, "web", "dist", "index.html");
  dlog("LOADING", indexPath, "exists=" + fs.existsSync(indexPath));
  mainWindow.loadFile(indexPath).catch((e) => dlog("LOADFILE-REJECT", String(e)));
  mainWindow.maximize();
  mainWindow.on("closed", () => { mainWindow = null; });
}

app.whenReady().then(() => {
  // Pre-create default DB so it's visible to the user
  ensureDb(getDbPath());
  createWindow();
  initAutoUpdater();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
