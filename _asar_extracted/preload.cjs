const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("venomDb", {
  load: () => ipcRenderer.sendSync("venom-db:load"),
  save: (state) => ipcRenderer.sendSync("venom-db:save", state),
  getPath: () => ipcRenderer.sendSync("venom-db:get-path"),
  setPath: () => ipcRenderer.sendSync("venom-db:set-path"),
  reveal: () => ipcRenderer.sendSync("venom-db:reveal"),
});

contextBridge.exposeInMainWorld("venomUpdater", {
  getVersion: () => ipcRenderer.invoke("venom-updater:get-version"),
  check: () => ipcRenderer.invoke("venom-updater:check"),
  install: () => ipcRenderer.send("venom-updater:install"),
  onStatus: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on("venom-update", handler);
    return () => ipcRenderer.removeListener("venom-update", handler);
  },
});
