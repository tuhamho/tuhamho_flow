"use strict";

importScripts("shared.js");
const U = FlowUtils;
const extensionPrefix = chrome.runtime.getURL("");
let activeRun = null;
let starting = false;

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {});
});

function publish(run, extra = {}) {
  const state = {
    version: 1,
    provider: run.provider,
    mediaType: run.mediaType,
    prompts: run.items.map(item => item.prompt),
    items: run.items.map(item => ({ status: item.status, detail: item.detail })),
    updatedAt: Date.now()
  };
  run.state = state;
  void chrome.storage.local.set({ queueState: state });
  chrome.runtime.sendMessage({ type: "QUEUE_UPDATE", running: !run.finished, state,
    status: run.status || "Đang chạy…", error: run.error || "", ...extra }).catch(() => {});
}
function halt(run, reason, user = false) {
  if (!run || run.controller.signal.aborted) return;
  run.reason = reason;
  run.userStopped = user;
  run.controller.abort();
  const item = run.items[run.index];
  if (item && item.status !== "done") {
    item.status = "stopped";
    item.detail = `${reason} Kiểm tra kết quả trên tab trước khi tiếp tục.`;
  }
  try { run.port?.postMessage({ type: "STOP" }); } catch {}
  run.status = "Đang dừng… Không gửi thêm prompt.";
  publish(run);
}
function check(run) { if (run.controller.signal.aborted) throw new Error(run.reason || "Đã dừng."); }
function sleep(ms, run) {
  check(run);
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new Error(run.reason || "Đã dừng.")); };
    const timer = setTimeout(() => { run.controller.signal.removeEventListener("abort", abort); resolve(); }, ms);
    run.controller.signal.addEventListener("abort", abort, { once: true });
  });
}
function request(port, message, match, timeoutMs, run, phase) {
  check(run);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); port.onMessage.removeListener(receive);
      port.onDisconnect.removeListener(disconnect); run.controller.signal.removeEventListener("abort", abort);
      error ? reject(error) : resolve(value);
    };
    const receive = value => {
      if (value?.type === "PHASE" && value.id === message.id) phase?.(value.phase);
      if (match(value)) finish(null, value);
    };
    const disconnect = () => { void chrome.runtime.lastError; finish(new Error("Mất kết nối với tab dịch vụ.")); };
    const abort = () => finish(new Error(run.reason || "Đã dừng."));
    const timer = setTimeout(() => finish(new Error("Hết thời gian chờ phản hồi của tab.")), timeoutMs);
    port.onMessage.addListener(receive); port.onDisconnect.addListener(disconnect);
    run.controller.signal.addEventListener("abort", abort, { once: true });
    try { port.postMessage(message); } catch { disconnect(); }
  });
}
function queueError(code) {
  const messages = {
    NO_INPUT: "Không tìm thấy ô prompt trên tab. Kiểm tra giao diện rồi thử lại.", INPUT_AMBIGUOUS: "Có nhiều ô nhập phù hợp; không thể chọn an toàn.",
    INPUT_REJECTED: "Trang chưa nhận đúng prompt; chưa gửi yêu cầu.", NO_BUTTON: "Không tìm thấy nút tạo/gửi.", BUTTON_AMBIGUOUS: "Không xác định được nút tạo/gửi.",
    BUTTON_DISABLED: "Nút tạo đang bị vô hiệu hóa.", FLOW_BUSY: "Tab dịch vụ đang xử lý tác vụ khác.", FLOW_ERROR: "Dịch vụ báo lỗi; kiểm tra tab.",
    TIMEOUT: "Hết thời gian chờ kết quả. Không tự gửi lại để tránh tạo trùng.", GPT_TIMEOUT: "Hết thời gian chờ ảnh ChatGPT. Kiểm tra tab trước khi chạy lại.",
    GPT_NO_IMAGE: "ChatGPT đã dừng trước khi trả ảnh. Mục này chưa hoàn thành; bấm Tiếp tục để thử lại đúng prompt này.",
    GPT_BATCH_CANCEL_FAILED: "Không bấm được nút Dừng ChatGPT ở mốc 10 prompt. Hàng đợi đã dừng để tránh lệch thứ tự.",
    IMAGE_CORS: "Không tự tải được ảnh do CORS/miền URL. Tải bằng nút dịch vụ; không chạy lại prompt này.",
    GPT_IMAGE_URL: "Không tự tải được URL ảnh ChatGPT. Tải bằng nút ChatGPT; không gửi lại prompt.",
    VIDEO_SOURCE_EXTERNAL: "Video nằm ngoài miền được phép tải. Hãy dùng nút tải Flow.", VIDEO_SOURCE_UNAVAILABLE: "Flow chưa cung cấp tệp video có thể đọc; tải bằng Flow.",
    VIDEO_PENDING_TIMEOUT: "Video vẫn đang xếp hàng khi hết thời gian chờ. Kiểm tra Flow; không gửi lại.",
    STOPPED: "Đã dừng theo yêu cầu.", BUSY: "Tab dịch vụ đang chạy một lượt khác.", NAVIGATED: "Tab dịch vụ đã chuyển trang; hàng đợi dừng.",
    GPT_MULTIPLE_IMAGES: "Phản hồi ChatGPT hiện nhiều ảnh trong cùng một câu trả lời; đã dừng để tránh tải nhầm.",
    GPT_DUPLICATE_RESULT: "ChatGPT trả lại cùng một URL ảnh như prompt trước; đã dừng để không tải trùng.", MULTIPLE_IMAGES: "Có nhiều ảnh mới; dừng để tránh tải nhầm.",
    MULTIPLE_VIDEOS: "Có nhiều video mới; dừng để tránh tải nhầm."
  };
  return messages[code] || `Không hoàn thành được tác vụ (${String(code).slice(0, 80)}). Kiểm tra tab dịch vụ.`;
}
async function downloadResult(result, filename, extension, run) {
  check(run);
  const mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", mp4: "video/mp4", webm: "video/webm" }[extension];
  if (!mime || Boolean(result.dataUrl) === Boolean(result.downloadUrl)) throw new Error("Dữ liệu tệp kết quả không hợp lệ.");
  let url;
  if (result.dataUrl) {
    const max = extension === "png" ? 24000000 : 41000000;
    if (typeof result.dataUrl !== "string" || result.dataUrl.length > max ||
        !new RegExp(`^data:${mime.replace("/", "\\/")};base64,[A-Za-z0-9+/]+={0,2}$`).test(result.dataUrl)) throw new Error("Dữ liệu tệp kết quả không hợp lệ.");
    url = result.dataUrl;
  } else {
    const allowed = run.provider === "chatgpt" ? U.isChatGPTMediaUrl(result.downloadUrl) : U.isFlowMediaUrl(result.downloadUrl);
    if (!allowed) throw new Error("URL kết quả không thuộc miền dịch vụ đã chọn.");
    url = result.downloadUrl;
  }
  const id = await chrome.downloads.download({ url, filename, saveAs: false, conflictAction: "uniquify" });
  await new Promise((resolve, reject) => {
    let done = false;
    const finish = error => { if (done) return; done = true; clearTimeout(timer); chrome.downloads.onChanged.removeListener(onChanged);
      run.controller.signal.removeEventListener("abort", onAbort); error ? reject(error) : resolve(); };
    const onChanged = delta => { if (delta.id !== id) return; if (delta.state?.current === "complete") finish();
      else if (delta.state?.current === "interrupted" || delta.error?.current) finish(new Error("Tải tệp thất bại hoặc bị hủy.")); };
    const onAbort = () => { chrome.downloads.cancel(id).catch(() => {}); finish(new Error(run.reason || "Đã dừng.")); };
    const timer = setTimeout(() => finish(new Error("Tải tệp quá 120 giây. Kiểm tra Cài đặt tải xuống của Chrome.")), 120000);
    chrome.downloads.onChanged.addListener(onChanged); run.controller.signal.addEventListener("abort", onAbort, { once: true });
    chrome.downloads.search({ id }).then(files => {
      const file = files[0];
      if (!file) return finish(new Error("Không tìm thấy lượt tải vừa tạo."));
      if (file.state === "complete") finish(); else if (file.state === "interrupted") finish(new Error("Tải tệp thất bại hoặc bị hủy."));
    }).catch(() => finish(new Error("Không kiểm tra được trạng thái tải tệp.")));
  });
  check(run);
}
async function runQueue(run, config, startIndex) {
  const service = run.provider === "chatgpt" ? "ChatGPT" : "Flow";
  let heartbeat;
  try {
    const tab = await chrome.tabs.get(run.tabId);
    if (run.provider === "chatgpt" ? !U.isChatGPTUrl(tab.url) : !U.isFlowUrl(tab.url)) throw new Error(`Tab đã chọn không còn ở ${service}.`);
    const pingType = run.provider === "chatgpt" ? "CHATGPT_PING" : "FLOW_PING";
    const ping = await chrome.tabs.sendMessage(run.tabId, { type: pingType }, { frameId: 0 }).catch(() => null);
    if (!ping?.ok) throw new Error(`Không kết nối được ${service}. Tải lại tab rồi thử lại.`);
    run.port = chrome.tabs.connect(run.tabId, { name: run.provider === "chatgpt" ? "chatgpt-batch-work" : "flow-batch-work", frameId: 0 });
    // Content script trả lời heartbeat định kỳ để service worker được đánh thức
    // trong khi đang chờ thời gian dài; không phụ thuộc vào panel còn mở.
    run.port.onMessage.addListener(message => { if (message?.type === "ALIVE") run.lastHeartbeat = Date.now(); });
    run.port.onDisconnect.addListener(() => { void chrome.runtime.lastError; if (!run.finishing) halt(run, `Mất kết nối với tab ${service}.`); });
    heartbeat = setInterval(() => {
      if (run.controller.signal.aborted) return;
      try { run.port.postMessage({ type: "HEARTBEAT" }); } catch { halt(run, `Mất kết nối với tab ${service}.`); }
    }, 10000);
    const batchId = new Date().toISOString().replace(/[:.]/g, "-");
    for (let i = startIndex; i < run.items.length; i++) {
      check(run); const item = run.items[i]; run.index = i;
      item.status = "typing"; item.detail = ""; run.status = `Đang nhập prompt ${i + 1} / ${run.items.length}…`; publish(run);
      const makeRequest = cancelAfterSend => {
        const id = crypto.randomUUID();
        return request(run.port, { type: "RUN", id, index: i + 1, prompt: item.prompt, timeout: config.timeout, mediaType: config.mediaType, cancelAfterSend,
        ...(config.provider === "chatgpt" ? { seenImageUrls: [...run.seenImageUrls] } : {}) },
        value => value?.type === "RESULT" && value.id === id,
        (config.timeout + (config.mediaType === "video" ? 120 : 20)) * 1000, run,
        phase => { item.status = phase; run.status = phase === "typing" ? `Đang nhập prompt ${i + 1}…` : `Đang chờ kết quả prompt ${i + 1}…`; publish(run); });
      };
      let result = await makeRequest(config.provider === "chatgpt" && (i + 1) % config.batchEvery === 0);
      check(run);
      if (!result.ok && result.code === "GPT_BATCH_CANCELLED") {
        const cooldown = 5 + Math.floor(Math.random() * 6);
        item.status = "stopped";
        item.detail = `Đã bấm Dừng theo chu kỳ; nghỉ ${cooldown} giây rồi gửi lại prompt này.`;
        run.status = `Đã dừng ChatGPT ở prompt ${i + 1}; nghỉ ${cooldown} giây rồi chạy lại prompt này…`;
        publish(run);
        await sleep(cooldown * 1000, run);
        check(run);
        item.status = "typing"; item.detail = "Đang gửi lại prompt sau thời gian nghỉ.";
        run.status = `Đang chạy lại prompt ${i + 1}…`; publish(run);
        result = await makeRequest(false);
        check(run);
      }
      if (!result.ok) { const error = new Error(queueError(result.code)); error.code = result.code; throw error; }
      const imageIdentity = config.provider === "chatgpt" && config.mediaType === "image" && result.downloadUrl
        ? result.downloadUrl : "";
      if (imageIdentity && run.seenImageUrls.has(imageIdentity)) {
        const error = new Error(queueError("GPT_DUPLICATE_RESULT")); error.code = "GPT_DUPLICATE_RESULT"; throw error;
      }
      item.status = "downloading"; run.status = `Đang tải kết quả ${i + 1}…`; publish(run);
      const imageName = config.mediaType === "image" ? U.imageTitle(item.prompt, result.imageName) : "";
      await downloadResult(result, U.filename(config, i, batchId, result.extension, imageName), result.extension, run);
      if (imageIdentity) run.seenImageUrls.add(imageIdentity);
      item.status = "done"; item.detail = "Tệp đã tải xong."; run.status = `${i + 1} / ${run.items.length} hoàn thành.`; publish(run);
      if (i < run.items.length - 1) await sleep((config.delayMin + Math.random() * (config.delayMax - config.delayMin)) * 1000, run);
    }
    run.status = `Hoàn thành ${run.items.length} prompt. Tệp ở Downloads/${config.folder}.`;
  } catch (error) {
    const item = run.items[run.index];
    if (item && item.status !== "done") { item.status = run.userStopped ? "stopped" : error.code === "TIMEOUT" ? "timeout" : "error"; item.detail = run.reason || error.message; }
    for (const pending of run.items) if (pending.status === "pending") { pending.status = "stopped"; pending.detail = "Chưa gửi."; }
    run.status = run.userStopped ? "Đã dừng. Mục đang dở cần kiểm tra trước khi tiếp tục." : "Hàng đợi đã dừng vì lỗi.";
    run.error = run.userStopped ? "" : error.message;
  } finally {
    run.finishing = true; clearInterval(heartbeat);
    try { run.port?.postMessage({ type: "STOP" }); } catch {}
    run.port?.disconnect(); run.finished = true;
    await chrome.storage.local.set({ queueState: { version: 1, provider: run.provider, mediaType: run.mediaType,
      prompts: run.items.map(item => item.prompt), items: run.items.map(item => ({ status: item.status, detail: item.detail })), updatedAt: Date.now() } }).catch(() => {});
    chrome.runtime.sendMessage({ type: "QUEUE_UPDATE", running: false, state: run.state, status: run.status, error: run.error || "" }).catch(() => {});
    if (activeRun === run) activeRun = null;
  }
}
function handlePanelMessage(message, respond) {
  if (message.type === "GET_QUEUE_STATUS") {
    chrome.storage.local.get("queueState").then(data => respond({ ok: true, running: Boolean(activeRun), state: activeRun ? activeRun.state : data.queueState || null,
      status: activeRun?.status || "", error: activeRun?.error || "" }));
    return true;
  }
  if (message.type === "STOP_QUEUE") {
    if (activeRun) halt(activeRun, "Đã dừng theo yêu cầu.", true);
    respond({ ok: true }); return false;
  }
  if (message.type !== "START_QUEUE") return false;
  if (activeRun || starting) { respond({ ok: false, error: "Một hàng đợi đang chạy. Mở panel để theo dõi hoặc bấm Dừng." }); return false; }
  let config;
  try { config = U.validate(message.config); }
  catch (error) { respond({ ok: false, error: error.message }); return false; }
  if (!Number.isInteger(message.tabId)) { respond({ ok: false, error: "Chưa chọn tab dịch vụ." }); return false; }
  starting = true;
  chrome.storage.local.get("queueState").then(data => {
    const saved = data.queueState;
    const sameQueue = saved?.version === 1 && saved.provider === config.provider && saved.mediaType === config.mediaType &&
      JSON.stringify(saved.prompts) === JSON.stringify(config.prompts) && Array.isArray(saved.items) && saved.items.length === config.prompts.length;
    const items = sameQueue ? config.prompts.map((prompt, index) => ({ prompt, status: saved.items[index]?.status || "pending", detail: saved.items[index]?.detail || "" }))
      : config.prompts.map(prompt => ({ prompt, status: "pending", detail: "" }));
    // A value explicitly entered in the panel is one-based. It intentionally
    // restarts from that item, while blank keeps the normal resume behavior.
    let normalizedStart;
    if (config.startFrom !== null) {
      normalizedStart = config.startFrom - 1;
      for (let i = 0; i < normalizedStart; i++) {
        if (items[i].status !== "done") { items[i].status = "skipped"; items[i].detail = `Bỏ qua theo lựa chọn bắt đầu từ prompt ${config.startFrom}.`; }
      }
      for (let i = normalizedStart; i < items.length; i++) { items[i].status = "pending"; items[i].detail = ""; }
    } else {
      const startIndex = items.findIndex(item => !["done", "skipped"].includes(item.status));
      normalizedStart = startIndex < 0 ? 0 : startIndex;
      if (startIndex < 0) for (const item of items) { item.status = "pending"; item.detail = ""; }
      for (let i = normalizedStart; i < items.length; i++) if (!["done", "skipped"].includes(items[i].status)) { items[i].status = "pending"; items[i].detail = ""; }
    }
    const run = { provider: config.provider, mediaType: config.mediaType, tabId: message.tabId, items, index: normalizedStart,
      controller: new AbortController(), status: "Đang chuẩn bị…", error: "", finished: false, userStopped: false, seenImageUrls: new Set() };
    activeRun = run; starting = false; publish(run);
    respond({ ok: true, running: true });
    void runQueue(run, config, normalizedStart);
  }).catch(error => { starting = false; respond({ ok: false, error: `Không khởi chạy được hàng đợi: ${error?.message || "lỗi lưu trữ"}` }); });
  return true;
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(extensionPrefix)) return;
  if (handlePanelMessage(message, respond)) return true;
});
