"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("museDesktop", Object.freeze({
  api: options => ipcRenderer.invoke("muse:api", options),
  abort: ids => ipcRenderer.invoke("muse:abort", ids),
  thumbnail: options => ipcRenderer.invoke("muse:thumbnail", options),
  download: options => ipcRenderer.invoke("muse:download", options),
  chooseFolder: () => ipcRenderer.invoke("muse:choose-folder"),
  getSettings: () => ipcRenderer.invoke("muse:get-settings"),
  saveSettings: options => ipcRenderer.invoke("muse:save-settings", options),
  onWake: callback => { const listener = (_event, sleptFor) => callback(sleptFor); ipcRenderer.on("muse:awake", listener); return () => ipcRenderer.removeListener("muse:awake", listener); }
}));
