"use strict";

const U = FlowUtils;
const $ = id => document.getElementById(id);
const ids = ["connection", "flowTab", "refresh", "settings", "fields", "provider", "providerHint", "mediaBlock", "tip", "tabLabel", "mediaType", "mediaHint", "prompts", "count", "loadTxt", "txtFile", "startFrom", "clear", "filenameBase", "folder", "folderPreview", "serial", "delayMin", "delayMax", "timeout", "start", "stop", "status", "error", "progress", "bar", "current", "queue"];
const ui = Object.fromEntries(ids.map(id => [id, $(id)]));
const labels = { pending: "Chờ", typing: "Đang nhập", generating: "Đang tạo", downloading: "Đang tải", done: "Hoàn thành", skipped: "Bỏ qua", stopped: "Đã dừng", error: "Lỗi", timeout: "Quá giờ" };
let items = [], queueMeta = null, currentRun = null, hydrated = false, refreshing = false, saveTimer;
let saveTail = Promise.resolve();

function showError(text = "") { ui.error.textContent = text; ui.error.hidden = !text; }
function settings() {
  return { prompts: ui.prompts.value, folder: ui.folder.value, filenameBase: ui.filenameBase.value, serial: ui.serial.checked, provider: ui.provider.value, mediaType: ui.mediaType.value,
    startFrom: ui.startFrom.value, delayMin: ui.delayMin.value, delayMax: ui.delayMax.value, timeout: ui.timeout.value };
}
function queueMatchesCurrent() {
  return Boolean(queueMeta && queueMeta.provider === ui.provider.value && queueMeta.mediaType === ui.mediaType.value &&
    JSON.stringify(queueMeta.prompts) === JSON.stringify(U.parsePrompts(ui.prompts.value)));
}
function updateStartLabel() {
  if (currentRun) { ui.start.textContent = "Đang chạy nền…"; return; }
  const selected = ui.startFrom.value.trim();
  if (selected) { ui.start.textContent = `Bắt đầu từ prompt ${selected}`; return; }
  const firstOpen = queueMatchesCurrent() ? items.findIndex(item => !["done", "skipped"].includes(item.status)) : -1;
  ui.start.textContent = firstOpen >= 0 ? `Tiếp tục từ prompt ${firstOpen + 1}` : "Bắt đầu";
}
function persistQueueState() {
  if (!items.length || !queueMeta) return chrome.storage.local.remove("queueState");
  return chrome.storage.local.set({ queueState: {
    version: 1, provider: queueMeta.provider, mediaType: queueMeta.mediaType,
    prompts: items.map(item => item.prompt), items: items.map(item => ({ status: item.status, detail: item.detail })),
    updatedAt: Date.now()
  } });
}
function preview() {
  const promptCount = U.parsePrompts(ui.prompts.value).length;
  ui.count.textContent = `${promptCount} prompt`;
  ui.startFrom.max = String(Math.max(1, promptCount));
  const video = ui.mediaType.value === "video";
  const chatgpt = ui.provider.value === "chatgpt";
  ui.mediaBlock.hidden = chatgpt;
  ui.mediaType.disabled = chatgpt;
  ui.providerHint.textContent = chatgpt
    ? "ChatGPT tạo ảnh qua giao diện web; mỗi prompt được gửi kèm yêu cầu tạo một ảnh."
    : "Mở dự án Google Flow và chọn đúng tab ở phần tùy chọn.";
  ui.tabLabel.textContent = chatgpt ? "Tab ChatGPT" : "Tab Google Flow";
  ui.flowTab.setAttribute("aria-label", chatgpt ? "Tab ChatGPT cần điều khiển" : "Tab Flow cần điều khiển");
  ui.tip.textContent = chatgpt
    ? "💡 Mở chatgpt.com, đăng nhập và chọn chế độ có thể tạo ảnh. Tiện ích gửi prompt theo thứ tự, chờ ảnh mới rồi tự tải. Muốn bỏ Save As: tắt ‘Hỏi vị trí lưu từng tệp’ trong Cài đặt Chrome > Tệp đã tải xuống."
    : "💡 Chọn đúng tab Google Flow và loại Ảnh/Video; mỗi lượt chỉ tạo 1 kết quả. Có thể đóng panel hoặc chuyển tab sau khi bấm Bắt đầu. Muốn bỏ Save As: tắt ‘Hỏi vị trí lưu từng tệp’ trong Cài đặt Chrome > Tệp đã tải xuống.";
  const sampleExt = video ? ".mp4 hoặc .webm" : ".png, .jpg hoặc .webp";
  ui.folderPreview.textContent = `Downloads / ${U.safeSegment(ui.folder.value)} / ${ui.serial.checked ? "001_" : ""}${U.safeSegment(ui.filenameBase.value, "tuhamho")}${ui.serial.checked ? "" : "-mã-lượt"}${sampleExt}`;
  ui.mediaHint.textContent = video
    ? "Chờ video thật sẵn sàng, không lấy ảnh thumbnail. Nên tăng thời gian chờ trong Tùy chọn bổ sung."
    : "Chọn Ảnh khi Flow đang tạo ảnh. Không dùng ảnh thumbnail của video làm kết quả.";
  updateStartLabel();
}
function saveSettings() {
  const value = settings();
  // Ghi nối tiếp để thao tác xóa không bị một lần ghi cũ ghi đè.
  saveTail = saveTail.catch(() => {}).then(() => chrome.storage.local.set({ settings: value }));
  return saveTail;
}
function scheduleSave() {
  preview(); clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveSettings().catch(() => showError("Không lưu được cài đặt trên máy. Hãy kiểm tra dung lượng lưu trữ của extension.")), 300);
}
function render() {
  const completed = items.filter(item => item.status === "done").length;
  const skipped = items.filter(item => item.status === "skipped").length;
  ui.progress.textContent = skipped ? `${completed} xong · ${skipped} bỏ qua / ${items.length}` : `${completed} / ${items.length} hoàn thành`;
  ui.bar.max = Math.max(1, items.length); ui.bar.value = completed + skipped;
  const nodes = items.map((item, index) => {
    const li = document.createElement("li"); li.className = `qitem ${item.status}`;
    const head = document.createElement("div"); head.className = "item-head";
    const number = document.createElement("span"); number.className = "num"; number.textContent = String(index + 1);
    const text = document.createElement("span"); text.className = "txt";
    text.textContent = item.prompt; text.title = item.prompt;
    const tag = document.createElement("span"); tag.className = `tag ${item.status}`; tag.textContent = labels[item.status];
    head.append(number, text, tag); li.append(head);
    if (item.detail) { const detail = document.createElement("p"); detail.className = "detail"; detail.textContent = item.detail; li.append(detail); }
    return li;
  });
  ui.queue.replaceChildren(...nodes);
}
function applyQueueUpdate(update) {
  if (!update?.state || update.state.version !== 1 || !Array.isArray(update.state.prompts) || !Array.isArray(update.state.items)) return;
  queueMeta = { provider: update.state.provider, mediaType: update.state.mediaType, prompts: update.state.prompts };
  items = update.state.prompts.map((prompt, index) => ({ prompt, status: update.state.items[index]?.status || "pending", detail: update.state.items[index]?.detail || "" }));
  currentRun = update.running ? { background: true } : null;
  toggleRunning(Boolean(currentRun)); render();
  ui.status.textContent = update.status || (currentRun ? "Hàng đợi đang chạy nền." : "");
  showError(update.error || "");
  const active = items.findIndex(item => ["typing", "generating", "downloading"].includes(item.status));
  ui.current.hidden = active < 0;
  ui.current.textContent = active >= 0 ? `Prompt ${active + 1}: ${items[active].prompt}` : "";
}
function toggleRunning(running) {
  ui.fields.disabled = running || !hydrated; ui.start.disabled = running || !hydrated;
  ui.stop.disabled = !running; ui.refresh.disabled = running; ui.flowTab.disabled = running;
  ui.timeout.disabled = running || !hydrated; ui.clear.disabled = running || !hydrated;
  updateStartLabel();
}
async function ping(tabId, provider = "flow") {
  let timer;
  try {
    return await Promise.race([
      chrome.tabs.sendMessage(tabId, { type: provider === "chatgpt" ? "CHATGPT_PING" : "FLOW_PING" }, { frameId: 0 }),
      new Promise(resolve => { timer = setTimeout(() => resolve(null), 2500); })
    ]);
  } catch { return null; } finally { clearTimeout(timer); }
}
async function refreshTabs() {
  if (currentRun || refreshing) return;
  refreshing = true;
  try {
    const previous = ui.flowTab.value;
    const chatgpt = ui.provider.value === "chatgpt";
    const patterns = chatgpt ? ["https://chatgpt.com/*"] : ["https://labs.google/fx/tools/flow*", "https://labs.google/fx/*/tools/flow*", "https://flow.google.com/project/*"];
    const tabs = (await chrome.tabs.query({ url: patterns }))
      .filter(tab => chatgpt ? U.isChatGPTUrl(tab.url) : U.isFlowUrl(tab.url)).sort((a, b) => Number(b.active) - Number(a.active));
    if (currentRun) return;
    ui.flowTab.replaceChildren(...tabs.map((tab, index) => {
      const option = document.createElement("option"); option.value = String(tab.id);
      option.textContent = `${chatgpt ? "ChatGPT" : "Flow"} ${index + 1} · tab ${tab.id}${tab.active ? " (đang chọn)" : ""}`;
      return option;
    }));
    if (tabs.some(tab => String(tab.id) === previous)) ui.flowTab.value = previous;
    if (!tabs.length) { ui.connection.textContent = chatgpt ? "Chưa tìm thấy tab chatgpt.com. Mở ChatGPT rồi bấm Làm mới." : "Chưa tìm thấy tab Flow. Nếu đã mở flow.google.com, hãy tải lại tiện ích rồi bấm Làm mới."; ui.connection.className = ""; return; }
    const selectedId = Number(ui.flowTab.value);
    const response = await ping(selectedId, chatgpt ? "chatgpt" : "flow");
    if (currentRun || Number(ui.flowTab.value) !== selectedId) return;
    ui.connection.className = response?.ok ? "ok" : "";
    ui.connection.textContent = response?.ok
      ? (response.hasInput ? "Đã kết nối · đã nhận diện ô prompt" : "Đã kết nối · hãy bấm vào ô prompt trong dự án")
      : `Hãy tải lại tab ${chatgpt ? "ChatGPT" : "Flow"} sau khi cài hoặc cập nhật tiện ích.`;
  } catch { ui.connection.textContent = "Không kiểm tra được kết nối. Bấm Làm mới để thử lại."; }
  finally { refreshing = false; }
}

async function start(event) {
  event.preventDefault();
  if (currentRun || !hydrated) return;
  showError();
  let config;
  try {
    if ([ui.delayMin, ui.delayMax, ui.timeout].some(input => input.value.trim() === "")) throw new Error("Hãy nhập đủ thời gian nghỉ và thời gian chờ.");
    config = U.validate(settings());
  } catch (error) { showError(error.message); return; }
  if (!Number.isInteger(Number(ui.flowTab.value))) { showError("Chưa chọn tab dịch vụ. Bấm Làm mới rồi chọn tab đang mở."); return; }
  currentRun = { background: true }; toggleRunning(true);
  ui.status.textContent = "Đang chuyển hàng đợi sang chạy nền…";
  try {
    clearTimeout(saveTimer); await saveSettings();
    const response = await chrome.runtime.sendMessage({ type: "START_QUEUE", config: settings(), tabId: Number(ui.flowTab.value) });
    if (!response?.ok) throw new Error(response?.error || "Không khởi chạy được hàng đợi nền.");
  } catch (error) {
    currentRun = null; toggleRunning(false); showError(error.message || "Không kết nối được với tiến trình nền.");
  }
}

ui.settings.addEventListener("submit", start);
chrome.runtime.onMessage.addListener(message => {
  if (message?.type === "QUEUE_UPDATE") applyQueueUpdate(message);
});
ui.stop.addEventListener("click", () => { if (currentRun) void chrome.runtime.sendMessage({ type: "STOP_QUEUE" }); });
ui.fields.addEventListener("input", scheduleSave);
ui.fields.addEventListener("change", scheduleSave);
ui.timeout.addEventListener("input", scheduleSave);
ui.timeout.addEventListener("change", scheduleSave);
ui.mediaType.addEventListener("change", () => {
  if (ui.mediaType.value === "video" && Number(ui.timeout.value) === 240) ui.timeout.value = "600";
  scheduleSave();
});
ui.provider.addEventListener("change", () => {
  if (ui.provider.value === "chatgpt") ui.mediaType.value = "image";
  scheduleSave(); void refreshTabs();
});
ui.refresh.addEventListener("click", refreshTabs);
ui.flowTab.addEventListener("change", refreshTabs);
ui.loadTxt.addEventListener("click", () => ui.txtFile.click());
ui.txtFile.addEventListener("change", async () => {
  const file = ui.txtFile.files[0]; ui.txtFile.value = "";
  if (!file || currentRun) return;
  if (!/\.txt$/i.test(file.name) || file.size > 1000000) { showError("Chọn tệp .txt UTF-8 không quá 1 MB."); return; }
  try {
    const text = await file.text();
    if (currentRun) return;
    if (text.length > 500000) throw new Error();
    ui.prompts.value = text.replace(/^\uFEFF/, ""); scheduleSave(); showError();
  } catch { showError("Không đọc được tệp, hoặc nội dung vượt 500.000 ký tự. Hãy lưu tệp dưới dạng UTF-8."); }
});
ui.clear.addEventListener("click", async () => {
  if (currentRun) return;
  clearTimeout(saveTimer); ui.prompts.value = ""; items = []; queueMeta = null; render(); preview();
  ui.current.textContent = ""; ui.current.hidden = true;
  try { await saveSettings(); await persistQueueState(); ui.status.textContent = "Đã xóa prompt và tiến độ đã lưu trên máy."; showError(); }
  catch { showError("Không xóa được prompt đã lưu. Hãy thử lại."); }
});
// Đóng panel chỉ đóng giao diện; service worker tiếp tục điều phối hàng đợi.

(async () => {
  try {
    const data = await chrome.storage.local.get(["settings", "queueState"]);
    const stored = data.settings || {};
    const restored = { ...U.defaults, ...stored };
    for (const key of ["prompts", "folder", "filenameBase", "startFrom", "delayMin", "delayMax", "timeout"]) {
      ui[key].value = typeof restored[key] === "string" || typeof restored[key] === "number" ? restored[key] : U.defaults[key];
    }
    ui.serial.checked = typeof restored.serial === "boolean" ? restored.serial : U.defaults.serial;
    ui.mediaType.value = ["image", "video"].includes(restored.mediaType) ? restored.mediaType : "image";
    ui.provider.value = restored.provider === "chatgpt" ? "chatgpt" : "flow";
    if (ui.provider.value === "chatgpt") ui.mediaType.value = "image";
    const state = data.queueState;
    const restoredPrompts = U.parsePrompts(ui.prompts.value);
    if (state?.version === 1 && ["flow", "chatgpt"].includes(state.provider) && ["image", "video"].includes(state.mediaType) &&
        state.provider === ui.provider.value && state.mediaType === ui.mediaType.value &&
        JSON.stringify(state.prompts) === JSON.stringify(restoredPrompts) && Array.isArray(state.items) && state.items.length === restoredPrompts.length) {
      queueMeta = { provider: state.provider, mediaType: state.mediaType, prompts: restoredPrompts };
      items = restoredPrompts.map((prompt, index) => {
        const saved = state.items[index] || {};
        const status = ["pending", "typing", "generating", "downloading", "done", "skipped", "stopped", "error", "timeout"].includes(saved.status) ? saved.status : "pending";
        const interrupted = ["typing", "generating", "downloading"].includes(status);
        return { prompt, status: interrupted ? "stopped" : status,
          detail: interrupted ? "Panel đã đóng khi mục này đang chạy. Kiểm tra tab dịch vụ trước khi tiếp tục." : String(saved.detail || "") };
      });
    }
  } catch { showError("Không khôi phục được cài đặt hoặc tiến độ. Đang dùng cài đặt mặc định."); }
  hydrated = true; toggleRunning(false); preview(); render();
  if (items.length) ui.status.textContent = `Đã khôi phục ${items.filter(item => item.status === "done").length} / ${items.length} mục. Bấm “${ui.start.textContent}” để tiếp tục; kiểm tra mục đang dở trước khi gửi lại.`;
  try {
    const running = await chrome.runtime.sendMessage({ type: "GET_QUEUE_STATUS" });
    if (running?.state) applyQueueUpdate(running);
  } catch { /* Panel vẫn dùng được với trạng thái đã lưu nếu worker đang khởi động lại. */ }
  await refreshTabs();
})();
setInterval(() => { if (!currentRun) void refreshTabs(); }, 8000);

// Giữ chấm kết nối xanh/đỏ đồng bộ với trạng thái do bộ điều phối cập nhật.
const syncConnection = () => { $("conn").className = `conn conn--${ui.connection.classList.contains("ok") ? "on" : "off"}`; };
new MutationObserver(syncConnection).observe(ui.connection, { attributes: true, attributeFilter: ["class"] });
syncConnection();
