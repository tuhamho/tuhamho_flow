"use strict";

const $ = selector => document.querySelector(selector);
const ui = Object.fromEntries(["baseUrl", "password", "connection", "message", "testConnection", "promptSource", "addScene", "sceneCount", "sceneList", "project", "newProject", "frame", "seconds", "timeout", "delayMin", "delayMax", "filenameBase", "serial", "autoChain", "errorMode", "chooseFolder", "folderPath", "start", "stop", "queueStatus", "queueCount", "progressBar", "queueList", "refreshLibrary", "libraryStatus", "libraryList"].map(id => [id, document.getElementById(id)]));
const labels = { pending: "CHỜ", generating: "ĐANG TẠO", downloading: "ĐANG TẢI", done: "HOÀN THÀNH", error: "LỖI", skipped: "BỎ QUA", stopped: "ĐÃ DỪNG" };
let scenes = [], projects = [], queue = [], running = false, stopRequested = false, requests = new Set(), downloadDirectory = "", sleptDuringRun = 0;
let previousRun = null;

const saved = (() => { try { return JSON.parse(localStorage.getItem("muse-app-settings") || "{}"); } catch { return {}; } })();
ui.baseUrl.value = saved.baseUrl || "https://tuhamho-muse.serveousercontent.com";
ui.frame.value = saved.frame || "16:9"; ui.seconds.value = saved.seconds || 10; ui.timeout.value = saved.timeout || 30;
ui.delayMin.value = saved.delayMin ?? 5; ui.delayMax.value = saved.delayMax ?? 15; ui.filenameBase.value = saved.filenameBase || "tuhamho";
ui.serial.checked = saved.serial !== false; ui.autoChain.checked = saved.autoChain !== false; ui.errorMode.value = saved.errorMode || "stop";
ui.promptSource.value = saved.promptSource || "";

function setMessage(message = "", type = "") { ui.message.textContent = message; ui.message.className = `message ${type}`; }
function credentials() { return { baseUrl: ui.baseUrl.value.trim(), password: ui.password.value }; }
function saveSettings() {
  localStorage.setItem("muse-app-settings", JSON.stringify({ baseUrl: ui.baseUrl.value.trim(), frame: ui.frame.value,
    seconds: ui.seconds.value, timeout: ui.timeout.value, delayMin: ui.delayMin.value, delayMax: ui.delayMax.value,
    filenameBase: ui.filenameBase.value, serial: ui.serial.checked, autoChain: ui.autoChain.checked,
    errorMode: ui.errorMode.value, promptSource: ui.promptSource.value, project: ui.project.value }));
  return window.museDesktop.saveSettings({ password: ui.password.value, downloadDirectory });
}
function apiPathForVideo(id) { return `/api/video/result/${encodeURIComponent(id)}`; }
async function sleep(ms) {
  const until = Date.now() + ms;
  while (!stopRequested && Date.now() < until) await new Promise(resolve => setTimeout(resolve, Math.min(250, until - Date.now())));
}
async function api(apiPath, method = "GET", body, retry = true) {
  const { baseUrl, password } = credentials();
  const id = crypto.randomUUID(); requests.add(id);
  let lastError;
  try {
    for (let attempt = 0; attempt < (retry ? 4 : 1); attempt++) {
      try {
        const response = await window.museDesktop.api({ requestId: id, baseUrl, password, apiPath, method, body });
        if (response.status === 401) throw new Error("Sai mật khẩu API, kiểm tra lại trong cài đặt.");
        if (response.status >= 500 && attempt < (retry ? 3 : 0)) { await sleep([2000, 5000, 10000][attempt]); continue; }
        return response;
      } catch (error) {
        lastError = error;
        if (stopRequested || attempt >= (retry ? 3 : 0)) throw error;
        setStatus(`Lỗi mạng, thử lại sau ${[2, 5, 10][attempt]} giây…`);
        await sleep([2000, 5000, 10000][attempt]);
      }
    }
    throw lastError || new Error("Không gọi được Muse API.");
  } finally { requests.delete(id); }
}
function checkApi(response) {
  if (response.ok) return response.data;
  const error = String(response.data?.error || `Muse API trả HTTP ${response.status}.`);
  throw new Error(response.status === 401 ? "Sai mật khẩu API, kiểm tra lại trong cài đặt." : error);
}
function setStatus(text) { ui.queueStatus.textContent = text; }
function renderScenes() {
  ui.sceneCount.textContent = `${scenes.length} cảnh`;
  ui.sceneList.replaceChildren();
  scenes.forEach((scene, index) => {
    const card = document.createElement("article"); card.className = "scene";
    const top = document.createElement("div"); top.className = "scene-top";
    const title = document.createElement("span"); title.textContent = `Cảnh ${index + 1}`;
    const tools = document.createElement("div"); tools.className = "scene-tools";
    for (const [label, delta] of [["↑", -1], ["↓", 1]]) {
      const button = document.createElement("button"); button.className = "icon-btn"; button.type = "button"; button.textContent = label; button.title = "Di chuyển cảnh";
      button.disabled = index + delta < 0 || index + delta >= scenes.length;
      button.addEventListener("click", () => { const [moving] = scenes.splice(index, 1); scenes.splice(index + delta, 0, moving); syncSource(); renderScenes(); }); tools.append(button);
    }
    const remove = document.createElement("button"); remove.className = "icon-btn"; remove.type = "button"; remove.textContent = "×"; remove.title = "Xóa cảnh";
    remove.addEventListener("click", () => { scenes.splice(index, 1); syncSource(); renderScenes(); }); tools.append(remove);
    top.append(title, tools);
    const area = document.createElement("textarea"); area.value = scene.prompt; area.setAttribute("aria-label", `Prompt cảnh ${index + 1}`);
    area.addEventListener("input", () => { scenes[index].prompt = area.value; syncSource(false); });
    const projectRow = document.createElement("label"); projectRow.className = "scene-project"; projectRow.append(document.createTextNode("Dự án"));
    const select = document.createElement("select"); select.setAttribute("aria-label", `Dự án riêng cảnh ${index + 1}`);
    const shared = document.createElement("option"); shared.value = ""; shared.textContent = "Dùng chung dự án"; select.append(shared);
    for (const name of projects) { const option = document.createElement("option"); option.value = name; option.textContent = name; select.append(option); }
    select.value = scene.project || ""; select.addEventListener("change", () => { scenes[index].project = select.value; persistDraft(); }); projectRow.append(select);
    card.append(top, area, projectRow); ui.sceneList.append(card);
  });
  persistDraft();
}
function syncSource(reparse = false) {
  if (reparse) scenes = FlowUtils.parseMusePrompts(ui.promptSource.value).map(prompt => ({ prompt, project: "" }));
  else ui.promptSource.value = scenes.map((scene, index) => `CẢNH ${index + 1}:\n${scene.prompt}`).join("\n\n");
  localStorage.setItem("muse-app-settings", JSON.stringify({ ...saved, promptSource: ui.promptSource.value, baseUrl: ui.baseUrl.value,
    frame: ui.frame.value, seconds: ui.seconds.value, timeout: ui.timeout.value, delayMin: ui.delayMin.value, delayMax: ui.delayMax.value,
    filenameBase: ui.filenameBase.value, serial: ui.serial.checked, autoChain: ui.autoChain.checked, errorMode: ui.errorMode.value }));
}
function persistDraft() {
  localStorage.setItem("muse-app-queue", JSON.stringify({ prompts: scenes.map(scene => scene.prompt), items: queue.map(item => ({ prompt: item.prompt,
    status: item.status, detail: item.detail || "", taskId: item.taskId || "", videoPath: item.videoPath || "", duration: item.duration || 0,
    project: item.project || "" })), savedAt: Date.now() }));
}
function renderQueue() {
  const complete = queue.filter(item => item.status === "done").length;
  ui.queueCount.textContent = `${complete} / ${queue.length}`;
  ui.progressBar.style.width = `${queue.length ? complete / queue.length * 100 : 0}%`;
  ui.queueList.replaceChildren();
  queue.forEach((item, index) => {
    const card = document.createElement("article"); card.className = `qitem ${item.status}`;
    const head = document.createElement("div"); head.className = "q-head";
    const number = document.createElement("span"); number.className = "q-num"; number.textContent = String(index + 1);
    const prompt = document.createElement("span"); prompt.className = "q-prompt"; prompt.textContent = item.prompt; prompt.title = item.prompt;
    const tag = document.createElement("span"); tag.className = `tag ${item.status}`; tag.textContent = labels[item.status] || "CHỜ";
    head.append(number, prompt, tag); card.append(head);
    if (item.detail) { const detail = document.createElement("p"); detail.className = "q-detail"; detail.textContent = item.detail; card.append(detail); }
    if (item.status === "error" && !running) {
      const retry = document.createElement("button"); retry.type = "button"; retry.className = "button ghost"; retry.textContent = "Thử lại cảnh này";
      retry.addEventListener("click", () => { item.status = "pending"; item.detail = ""; startQueue(index); }); card.append(retry);
    }
    ui.queueList.append(card);
  });
  persistDraft();
}
function setRunning(value) { running = value; ui.start.disabled = value; ui.stop.disabled = !value; ui.testConnection.disabled = value; }
async function refreshProjects(select = ui.project.value) {
  const data = checkApi(await api("/api/projects"));
  projects = Array.isArray(data.projects) ? data.projects.filter(name => typeof name === "string") : [];
  const placeholder = document.createElement("option"); placeholder.value = ""; placeholder.textContent = "Không chọn dự án";
  ui.project.replaceChildren(placeholder);
  for (const name of projects) { const option = document.createElement("option"); option.value = name; option.textContent = name; ui.project.append(option); }
  ui.project.value = projects.includes(select) ? select : ""; renderScenes();
}
async function testConnection() {
  setMessage("Đang kiểm tra kết nối…");
  try {
    const { status, data } = await api("/api/video", "POST", { mo_ta: "", khung_hinh: "16:9", so_giay: 10 }, false);
    if (status === 400 && data?.error === "empty") { setMessage("Kết nối thành công, mật khẩu hợp lệ.", "success"); ui.connection.textContent = "Đã kết nối Muse"; ui.connection.className = "connection ok"; await saveSettings(); return; }
    if (status === 401) throw new Error("Sai mật khẩu API, kiểm tra lại trong cài đặt.");
    throw new Error(String(data?.error || `Muse API trả HTTP ${status}.`));
  } catch (error) { setMessage(error.message, "error"); ui.connection.textContent = "Chưa kết nối"; ui.connection.className = "connection"; }
}
function newProject() {
  const name = window.prompt("Tên dự án Muse:"); if (name === null || !name.trim()) return;
  api("/api/projects", "POST", { name: name.trim() }, false).then(response => {
    const data = checkApi(response); return refreshProjects(data.name);
  }).catch(error => setMessage(error.message, "error"));
}
async function loadLibrary() {
  ui.libraryStatus.textContent = "Đang tải thư viện Muse…"; ui.refreshLibrary.disabled = true;
  try {
    const response = checkApi(await api("/api/videos"));
    const videos = Array.isArray(response.videos) ? response.videos : [];
    ui.libraryList.replaceChildren();
    if (!videos.length) { ui.libraryStatus.textContent = "Chưa có video trong thư viện."; return; }
    ui.libraryStatus.textContent = `${videos.length} video`;
    for (const video of videos) {
      const card = document.createElement("article"); card.className = "lib-item";
      const thumb = document.createElement("img"); thumb.className = "lib-thumb"; thumb.alt = "Thumbnail video";
      if (video.thumb_url) thumb.src = await window.museDesktop.thumbnail({ ...credentials(), imagePath: video.thumb_url });
      const info = document.createElement("div"), title = document.createElement("div"); title.className = "lib-title"; title.textContent = video.title || video.id || "Video Muse";
      const meta = document.createElement("div"); meta.className = "lib-meta"; meta.textContent = video.du_an || "Gốc";
      const controls = document.createElement("div"); controls.className = "lib-controls";
      const move = document.createElement("select");
      const rootOption = document.createElement("option"); rootOption.value = ""; rootOption.textContent = "Gốc / không dự án"; move.append(rootOption);
      for (const name of projects) { const option = document.createElement("option"); option.value = name; option.textContent = name; move.append(option); }
      move.value = video.du_an || "";
      const moveButton = document.createElement("button"); moveButton.className = "button ghost"; moveButton.textContent = "Chuyển dự án";
      moveButton.addEventListener("click", async () => { try { checkApi(await api(`/api/videos/${encodeURIComponent(video.id)}/move`, "POST", { du_an: move.value || null }, false)); setMessage("Đã chuyển video sang dự án.", "success"); await loadLibrary(); } catch (error) { setMessage(error.message, "error"); } });
      const download = document.createElement("button"); download.className = "button ghost"; download.textContent = "Tải MP4"; download.disabled = !video.video_url;
      download.addEventListener("click", async () => { try { const result = await window.museDesktop.download({ ...credentials(), videoPath: video.video_url, filename: `${video.id || "muse_video"}.mp4`, project: video.du_an || "" }); setMessage(`Đã lưu: ${result.path}`, "success"); } catch (error) { setMessage(error.message, "error"); } });
      controls.append(move, moveButton, download); info.append(title, meta, controls); card.append(thumb, info); ui.libraryList.append(card);
    }
  } catch (error) { ui.libraryStatus.textContent = error.message; }
  finally { ui.refreshLibrary.disabled = false; }
}
function filename(index) { const prefix = ui.serial.checked ? `${String(index + 1).padStart(3, "0")}_` : "";
  const base = String(ui.filenameBase.value || "tuhamho").normalize("NFC").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/[. ]+$/g, "").slice(0, 80) || "tuhamho";
  return `${prefix}${base}.mp4`; }
async function pollTask(item, index) {
  const timeoutMs = Number(ui.timeout.value) * 60_000;
  const deadline = Date.now() + timeoutMs, sleepAdjustment = sleptDuringRun;
  while (Date.now() < deadline + (sleptDuringRun - sleepAdjustment)) {
    if (stopRequested) throw new Error("Đã dừng theo yêu cầu.");
    const response = await api(apiPathForVideo(item.taskId)); const result = checkApi(response);
    if (result.status === "error") throw new Error(result.error || "Muse báo lỗi khi tạo video.");
    if (result.status === "ok") { item.videoPath = result.video_url; item.duration = Number(result.duration) || 0; return; }
    item.status = "generating"; item.detail = `Đang tạo cảnh ${index + 1}/${queue.length}…`;
    setStatus(item.detail); renderQueue(); await sleep(5000);
  }
  throw new Error("Hết thời gian chờ Muse API.");
}
async function processItem(item, index, batchId) {
  if (!item.taskId) {
    const previous = ui.autoChain.checked && index > 0 && queue[index - 1].status === "done" ? queue[index - 1].taskId : "";
    const promptBody = FlowUtils.buildMuseVideoBody(item.prompt, ui.frame.value, Number(ui.seconds.value), previous, item.project || ui.project.value);
    item.status = "generating"; item.detail = "Đang gửi cảnh tới Muse API…"; renderQueue();
    const created = checkApi(await api("/api/video", "POST", promptBody));
    if (typeof created.id !== "string" || !created.id) throw new Error("Muse API không trả task ID hợp lệ.");
    item.taskId = created.id;
  }
  item.status = "generating"; item.detail = `Đang tạo cảnh ${index + 1}/${queue.length}…`; setStatus(item.detail); renderQueue();
  await pollTask(item, index);
  if (stopRequested) throw new Error("Đã dừng theo yêu cầu.");
  item.status = "downloading"; item.detail = `Đang tải video · ${item.duration} giây`; setStatus(`Đang tải cảnh ${index + 1}/${queue.length}…`); renderQueue();
  const requestId = crypto.randomUUID(); requests.add(requestId); let result, lastError;
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      if (stopRequested) throw new Error("Đã dừng theo yêu cầu.");
      try { result = await window.museDesktop.download({ requestId, ...credentials(), videoPath: item.videoPath,
        filename: filename(index), project: item.project || ui.project.value }); break; }
      catch (error) {
        lastError = error;
        if (stopRequested || attempt === 3 || /HTTP 401|HTTP 4\d\d|Sai mật khẩu/.test(error.message)) throw error;
        setStatus(`Lỗi tải mạng, thử lại sau ${[2, 5, 10][attempt]} giây…`); await sleep([2000, 5000, 10000][attempt]);
      }
    }
  } catch (error) { throw error || lastError; }
  finally { requests.delete(requestId); }
  item.status = "done"; item.detail = `Đã lưu video · ${item.duration} giây · ${result.path}`; renderQueue();
}
async function startQueue(fromIndex = 0) {
  if (running) return;
  if (!scenes.length) { setMessage("Hãy nhập ít nhất một cảnh.", "error"); return; }
  if (!ui.password.value.trim()) { setMessage("Hãy nhập mật khẩu Muse API.", "error"); return; }
  if (!Number.isInteger(Number(ui.seconds.value)) || Number(ui.seconds.value) < 5 || Number(ui.seconds.value) > 15) { setMessage("Thời lượng phải từ 5 đến 15 giây.", "error"); return; }
  if (!Number.isInteger(Number(ui.timeout.value)) || Number(ui.timeout.value) < 1 || Number(ui.timeout.value) > 60) { setMessage("Timeout phải từ 1 đến 60 phút.", "error"); return; }
  if (queue.length !== scenes.length || queue.some((item, index) => item.prompt !== scenes[index]?.prompt)) {
    queue = scenes.map(scene => ({ ...scene, status: "pending", detail: "", taskId: "", videoPath: "", duration: 0 }));
  } else queue = queue.map((item, index) => ({ ...item, project: scenes[index].project }));
  stopRequested = false; setRunning(true); renderQueue();
  const batchId = crypto.randomUUID(); let failed = false;
  try {
    await saveSettings();
    for (let i = fromIndex; i < queue.length; i++) {
      const item = queue[i]; if (item.status === "done" || item.status === "skipped") continue;
      if (stopRequested) { item.status = "stopped"; item.detail = "Chưa chạy."; renderQueue(); break; }
      item.status = "generating"; item.detail = "Đang chờ Muse API…"; renderQueue();
      try { await processItem(item, i, batchId); }
      catch (error) {
        if (stopRequested) { item.status = item.taskId ? "pending" : "stopped"; item.detail = item.taskId ? "Đã lưu task; có thể tiếp tục poll." : "Chưa gửi xong."; renderQueue(); break; }
        item.status = "error"; item.detail = error.message || "Muse tạo video thất bại."; renderQueue();
        if (ui.errorMode.value === "stop") { failed = true; throw error; }
      }
      if (stopRequested) break;
      const remaining = queue.slice(i + 1).some(entry => !["done", "skipped"].includes(entry.status));
      if (remaining) { const min = Math.max(0, Number(ui.delayMin.value) || 0), max = Math.max(min, Number(ui.delayMax.value) || min); await sleep((min + Math.random() * (max - min)) * 1000); }
    }
    setStatus(stopRequested ? "Đã dừng; tiến độ được lưu trên máy." : failed ? "Hàng đợi dừng vì lỗi." : "Hoàn tất hàng đợi.");
  } catch (error) { setStatus(`Hàng đợi dừng: ${error.message}`); }
  finally { setRunning(false); requests.clear(); renderQueue(); await saveSettings(); }
}

ui.promptSource.addEventListener("input", () => { scenes = FlowUtils.parseMusePrompts(ui.promptSource.value).map(prompt => ({ prompt, project: "" })); renderScenes(); });
ui.addScene.addEventListener("click", () => { scenes.push({ prompt: "", project: "" }); syncSource(); renderScenes(); ui.sceneList.lastElementChild?.querySelector("textarea")?.focus(); });
ui.testConnection.addEventListener("click", testConnection);
ui.newProject.addEventListener("click", newProject);
ui.project.addEventListener("change", () => { saveSettings(); renderScenes(); });
ui.chooseFolder.addEventListener("click", async () => { const folder = await window.museDesktop.chooseFolder(); if (folder) { downloadDirectory = folder; ui.folderPath.textContent = folder; await saveSettings(); } });
ui.start.addEventListener("click", () => startQueue(0));
ui.stop.addEventListener("click", async () => { stopRequested = true; setStatus("Đang dừng sau request hiện tại…"); await window.museDesktop.abort([...requests]); });
ui.refreshLibrary.addEventListener("click", loadLibrary);
for (const input of [ui.baseUrl, ui.password, ui.frame, ui.seconds, ui.timeout, ui.delayMin, ui.delayMax, ui.filenameBase, ui.serial, ui.autoChain, ui.errorMode]) {
  input.addEventListener("change", () => { saveSettings(); });
}

async function init() {
  const secure = await window.museDesktop.getSettings();
  ui.password.value = secure.password || ""; downloadDirectory = secure.downloadDirectory || "";
  ui.folderPath.textContent = downloadDirectory || "Downloads / MuseAI";
  const draft = (() => { try { return JSON.parse(localStorage.getItem("muse-app-queue") || "null"); } catch { return null; } })();
  if (draft?.items?.length) {
    queue = draft.items.map(item => ({ ...item, status: ["generating", "downloading", "stopped"].includes(item.status) ? (item.taskId ? "pending" : "stopped") : item.status }));
    scenes = queue.map(item => ({ prompt: item.prompt, project: item.project || "" }));
    ui.promptSource.value = scenes.map((scene, index) => `CẢNH ${index + 1}:\n${scene.prompt}`).join("\n\n"); renderQueue(); setStatus("Đã khôi phục hàng đợi. Task đang tạo sẽ tiếp tục poll khi bấm Bắt đầu.");
  } else scenes = FlowUtils.parseMusePrompts(ui.promptSource.value).map(prompt => ({ prompt, project: "" }));
  renderScenes();
  if (ui.password.value) { try { await refreshProjects(saved.project || ""); } catch (error) { ui.connection.textContent = "Chưa kết nối"; setMessage(error.message, "error"); } }
}
window.museDesktop.onWake(sleptFor => {
  sleptDuringRun += sleptFor;
  if (running) setStatus("Windows vừa thức dậy; Muse tiếp tục kiểm tra tiến trình video.");
});
void init();
