"use strict";

const { app, BrowserWindow, ipcMain, dialog, powerMonitor } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const keytar = require("keytar");
const CREDENTIAL_SERVICE = "tuhamho-muse-ai-studio";
const CREDENTIAL_ACCOUNT = "muse-api-password";

const DEFAULT_BASE = "https://tuhamho-muse.serveousercontent.com";
let mainWindow;
let downloadDirectory = path.join(app.getPath("downloads"), "MuseAI");
const requests = new Map();

function makeWindow() {
  mainWindow = new BrowserWindow({
    width: 1180, height: 850, minWidth: 860, minHeight: 640,
    backgroundColor: "#080c12", title: "Muse AI Studio",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  mainWindow.loadFile(path.join(__dirname, "index.html"));
}

function apiUrl(baseUrl, apiPath) {
  let base;
  try { base = new URL(String(baseUrl || DEFAULT_BASE)); } catch { throw new Error("Địa chỉ Muse API không hợp lệ."); }
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) throw new Error("Muse API phải dùng HTTPS.");
  if (typeof apiPath !== "string" || !apiPath.startsWith("/api/") || apiPath.includes("..")) throw new Error("Đường dẫn API không hợp lệ.");
  return new URL(apiPath, base.origin);
}

ipcMain.handle("muse:api", async (_event, { requestId, baseUrl, password, apiPath, method = "GET", body }) => {
  if (typeof password !== "string" || !password.trim()) throw new Error("Hãy nhập mật khẩu Muse API.");
  if (! ["GET", "POST"].includes(method)) throw new Error("Phương thức API không hợp lệ.");
  const headers = { "X-API-Password": password };
  const controller = new AbortController();
  if (requestId) requests.set(requestId, controller);
  const timer = setTimeout(() => controller.abort(), 20000);
  const options = { method, headers, redirect: "error", signal: controller.signal };
  if (body !== undefined) { headers["Content-Type"] = "application/json"; options.body = JSON.stringify(body); }
  let response;
  try { response = await fetch(apiUrl(baseUrl, apiPath), options); }
  catch (error) { throw new Error(`Không kết nối được Muse API: ${error.message}`); }
  finally { clearTimeout(timer); if (requestId) requests.delete(requestId); }
  let data = {};
  try { data = await response.json(); } catch { /* keep empty object for non-JSON responses */ }
  return { status: response.status, ok: response.ok, data };
});
ipcMain.handle("muse:abort", (_event, requestIds) => {
  for (const id of requestIds || []) requests.get(id)?.abort();
  return true;
});

ipcMain.handle("muse:thumbnail", async (_event, { baseUrl, password, imagePath }) => {
  const url = apiUrl(baseUrl, "/api/videos");
  if (typeof imagePath !== "string" || !/^\/results\/[A-Za-z0-9._~!$&'()+,;=@%/-]+\.(?:png|jpe?g|webp)$/i.test(imagePath) || imagePath.split("/").includes("..")) return "";
  const response = await fetch(new URL(imagePath, url.origin), { headers: { "X-API-Password": password }, redirect: "error", signal: AbortSignal.timeout(30000) });
  if (!response.ok) return "";
  const contentType = response.headers.get("content-type") || "image/jpeg";
  return `data:${contentType};base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`;
});

ipcMain.handle("muse:download", async (_event, { requestId, baseUrl, password, videoPath, filename, project }) => {
  const url = apiUrl(baseUrl, "/api/video");
  if (typeof videoPath !== "string" || !/^\/results\/[A-Za-z0-9._~!$&'()+,;=@%/-]+\.mp4$/i.test(videoPath) || videoPath.split("/").includes("..")) {
    throw new Error("Đường dẫn video Muse không hợp lệ.");
  }
  const controller = new AbortController();
  if (requestId) requests.set(requestId, controller);
  const timer = setTimeout(() => controller.abort(), 30 * 60 * 1000);
  let response;
  try {
    response = await fetch(new URL(videoPath, url.origin), {
      headers: { "X-API-Password": password }, redirect: "error", signal: controller.signal
    });
  } finally { clearTimeout(timer); if (requestId) requests.delete(requestId); }
  if (response.status === 401) throw new Error("Sai mật khẩu API, kiểm tra lại trong cài đặt.");
  if (!response.ok) throw new Error(`Không tải được video Muse. HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error("Muse API trả về video rỗng.");
  const safeName = String(filename || "muse_video.mp4").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").slice(0, 160);
  const safeProject = String(project || "").normalize("NFC").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").replace(/^[. ]+|[. ]+$/g, "").slice(0, 80);
  const folder = safeProject ? path.join(downloadDirectory, safeProject) : downloadDirectory;
  await fs.mkdir(folder, { recursive: true });
  let destination = path.join(folder, safeName);
  const ext = path.extname(safeName), stem = path.basename(safeName, ext);
  for (let suffix = 1; await fs.access(destination).then(() => true, () => false); suffix++) {
    destination = path.join(folder, `${stem} (${suffix})${ext}`);
  }
  await fs.writeFile(destination, bytes, { flag: "wx" });
  return { path: destination, bytes: bytes.length };
});

ipcMain.handle("muse:choose-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: "Chọn thư mục lưu video", properties: ["openDirectory", "createDirectory"] });
  if (result.canceled || !result.filePaths[0]) return null;
  downloadDirectory = result.filePaths[0];
  return downloadDirectory;
});

ipcMain.handle("muse:get-settings", async () => {
  const filename = path.join(app.getPath("userData"), "muse-settings.json");
  try { const stored = JSON.parse(await fs.readFile(filename, "utf8")); downloadDirectory = stored.downloadDirectory || downloadDirectory; } catch {}
  return { password: await keytar.getPassword(CREDENTIAL_SERVICE, CREDENTIAL_ACCOUNT) || "", downloadDirectory };
});

ipcMain.handle("muse:save-settings", async (_event, { password, downloadDirectory: folder }) => {
  if (folder) downloadDirectory = path.resolve(String(folder));
  const stored = { downloadDirectory };
  if (typeof password === "string" && password) await keytar.setPassword(CREDENTIAL_SERVICE, CREDENTIAL_ACCOUNT, password);
  else if (password === "") await keytar.deletePassword(CREDENTIAL_SERVICE, CREDENTIAL_ACCOUNT);
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  await fs.writeFile(path.join(app.getPath("userData"), "muse-settings.json"), JSON.stringify(stored), { mode: 0o600 });
  return { saved: true, passwordProtected: Boolean(stored.password) };
});

app.whenReady().then(() => {
  makeWindow();
  let suspendedAt = 0;
  powerMonitor.on("suspend", () => { suspendedAt = Date.now(); });
  powerMonitor.on("resume", () => {
    const sleptFor = suspendedAt ? Math.max(0, Date.now() - suspendedAt) : 0; suspendedAt = 0;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("muse:awake", sleptFor);
  });
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) makeWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
