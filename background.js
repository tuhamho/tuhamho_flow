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
    items: run.items.map(item => ({ status: item.status, detail: item.detail, ...(item.taskId ? { taskId: item.taskId } : {}), ...(item.project ? { project: item.project } : {}) })),
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
    const timer = setTimeout(() => {
      const error = new Error("Hết thời gian chờ phản hồi của tab.");
      error.code = message.type === "RUN" && message.provider === "chatgpt" ? "GPT_TIMEOUT" : "TIMEOUT";
      finish(error);
    }, timeoutMs);
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
    GPT_BATCH_CANCEL_FAILED: "Không nhận diện/bấm được nút Dừng ChatGPT ở mốc chia đợt. Hàng đợi đã dừng để không chạy vượt prompt này; hãy kiểm tra tab rồi tiếp tục.",
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
function museError(message, code = "MUSE_ERROR") {
  const error = new Error(message); error.code = code; return error;
}
function museHttpError(status, payload) {
  if (status === 401) return museError("Sai mật khẩu API, kiểm tra lại trong cài đặt.", "MUSE_AUTH");
  if (status === 400) return museError(String(payload?.error || "Muse API từ chối yêu cầu (HTTP 400)."), "MUSE_BAD_REQUEST");
  return museError(`Muse API trả lỗi HTTP ${status}.`, "MUSE_HTTP");
}
async function museFetch(url, options, run, deadline) {
  check(run);
  const remaining = Math.max(1, deadline - Date.now());
  const controller = new AbortController();
  const abort = () => controller.abort();
  run.controller.signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), remaining);
  try {
    return await fetch(url, { credentials: "omit", redirect: "error", ...options, signal: controller.signal });
  } catch (error) {
    check(run);
    if (Date.now() >= deadline) throw museError("Hết thời gian chờ Muse API.", "MUSE_TIMEOUT");
    throw museError(`Không kết nối được Muse API: ${error?.message || "lỗi mạng"}`, "MUSE_NETWORK");
  } finally {
    clearTimeout(timer); run.controller.signal.removeEventListener("abort", abort);
  }
}
async function museJson(response) {
  try { return await response.json(); }
  catch { throw museError("Muse API trả về JSON không hợp lệ.", "MUSE_RESPONSE"); }
}
async function ensureMuseOffscreen() {
  const documentUrl = chrome.runtime.getURL("muse-offscreen.html");
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [documentUrl] });
  if (contexts.length) return;
  await chrome.offscreen.createDocument({ url: "muse-offscreen.html", reasons: ["BLOBS"],
    justification: "Tải video Muse cần xác thực rồi tạo Blob URL để Chrome Downloads lưu được tệp." });
}
async function downloadMuseVideo(baseUrl, password, videoPath, filename, run) {
  check(run);
  await ensureMuseOffscreen(); check(run);
  const requestId = crypto.randomUUID();
  const message = { type: "MUSE_DOWNLOAD_VIDEO", requestId, baseUrl, password, videoPath, filename };
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return; settled = true; run.controller.signal.removeEventListener("abort", onAbort);
      error ? reject(error) : resolve(value);
    };
    const onAbort = () => {
      chrome.runtime.sendMessage({ type: "MUSE_CANCEL_DOWNLOAD", requestId }).catch(() => {});
      finish(new Error(run.reason || "Đã dừng."));
    };
    run.controller.signal.addEventListener("abort", onAbort, { once: true });
    chrome.runtime.sendMessage(message).then(response => {
      if (!response?.ok) return finish(museError(response?.error || "Không tải được video Muse.", response?.code || "MUSE_DOWNLOAD"));
      finish(null, response);
    }).catch(error => finish(museError(`Không tải được video Muse: ${error?.message || "lỗi kết nối"}`, "MUSE_DOWNLOAD")));
    if (run.controller.signal.aborted) onAbort();
  });
}
async function runMuseItem(run, config, item, index, batchId) {
  const deadline = Date.now() + config.timeout * 1000;
  const previous = index > 0 && run.items[index - 1]?.status === "done" ? run.items[index - 1].taskId : "";
  const previousTaskId = U.museContinuationId(config.museAutoChain, previous, index);
  const body = U.buildMuseVideoBody(item.prompt, config.museFrame, config.museSeconds, previousTaskId, item.project || config.museProject);
  const headers = { "Content-Type": "application/json", "X-API-Password": config.musePassword };
  const createResponse = await museFetch(`${config.museBaseUrl}/api/video`, { method: "POST", headers, body: JSON.stringify(body) }, run, deadline);
  const createData = await museJson(createResponse);
  if (!createResponse.ok) throw museHttpError(createResponse.status, createData);
  if (typeof createData.id !== "string" || !createData.id.trim() || createData.id.length > 200) {
    throw museError("Muse API không trả task ID hợp lệ.", "MUSE_RESPONSE");
  }
  item.taskId = createData.id.trim(); publish(run);
  run.status = `Đang tạo cảnh ${index + 1}/${run.items.length}…`; item.status = "generating"; publish(run);
  while (Date.now() < deadline) {
    check(run);
    const resultResponse = await museFetch(`${config.museBaseUrl}/api/video/result/${encodeURIComponent(item.taskId)}`,
      { headers: { "X-API-Password": config.musePassword } }, run, deadline);
    const pollData = await museJson(resultResponse);
    if (!resultResponse.ok) throw museHttpError(resultResponse.status, pollData);
    const parsed = U.parseMusePollResult(pollData);
    if (parsed.status === "error") throw museError(parsed.error, "MUSE_TASK_ERROR");
    if (parsed.status === "ok") {
      const videoFilename = U.filename(config, index, batchId, "mp4");
      item.status = "downloading"; run.status = `Đang tải video ${index + 1}/${run.items.length}…`; publish(run);
      await downloadMuseVideo(config.museBaseUrl, config.musePassword, parsed.videoUrl, videoFilename, run);
      return { taskId: item.taskId, duration: parsed.duration };
    }
    run.status = `Đang tạo cảnh ${index + 1}/${run.items.length}…`; publish(run);
    await sleep(Math.min(5000, Math.max(1, deadline - Date.now())), run);
  }
  throw museError("Hết thời gian chờ Muse API.", "MUSE_TIMEOUT");
}
async function testMuseConnection(config) {
  let baseUrl;
  try { baseUrl = U.normalizeMuseBaseUrl(config?.museBaseUrl); }
  catch (error) { return { ok: false, error: error.message }; }
  const password = String(config?.musePassword || "");
  if (!password.trim()) return { ok: false, error: "Hãy nhập mật khẩu Muse API." };
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${baseUrl}/api/video`, { method: "POST", headers: {
      "Content-Type": "application/json", "X-API-Password": password
    }, body: JSON.stringify({ mo_ta: "", khung_hinh: "16:9", so_giay: 10 }), signal: controller.signal });
    let data = {}; try { data = await response.json(); } catch {}
    if (response.status === 401) return { ok: false, error: "Sai mật khẩu API, kiểm tra lại trong cài đặt." };
    if (response.status === 400 && data.error === "empty") return { ok: true, status: "Kết nối Muse API thành công · mật khẩu đúng." };
    if (response.status === 400) return { ok: false, error: String(data.error || "Muse API từ chối yêu cầu.") };
    return { ok: false, error: `Muse API trả phản hồi HTTP ${response.status}, không khớp kiểm tra kết nối.` };
  } catch (error) {
    return { ok: false, error: error?.name === "AbortError" ? "Hết thời gian kiểm tra kết nối Muse API." : `Không kết nối được Muse API: ${error?.message || "lỗi mạng"}` };
  } finally { clearTimeout(timer); }
}
async function museApiJson(config, path, method = "GET", body) {
  const baseUrl = U.normalizeMuseBaseUrl(config?.museBaseUrl);
  const password = String(config?.musePassword || "");
  if (!password.trim()) throw new Error("Hãy nhập mật khẩu Muse API.");
  if (!/^\/api\/(?:projects|videos)(?:\/[^/]+\/move)?$/.test(path)) throw new Error("Đường dẫn Muse API không hợp lệ.");
  const headers = { "X-API-Password": password };
  const options = { method, headers, credentials: "omit", redirect: "error" };
  if (body !== undefined) { headers["Content-Type"] = "application/json"; options.body = JSON.stringify(body); }
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${baseUrl}${path}`, { ...options, signal: controller.signal });
    let data = {}; try { data = await response.json(); } catch {}
    if (!response.ok) throw museHttpError(response.status, data);
    return { baseUrl, data };
  } catch (error) { if (error?.name === "AbortError") throw new Error("Muse API phản hồi quá chậm, hãy thử lại."); throw error; }
  finally { clearTimeout(timer); }
}
function museRelativePath(baseUrl, value, extension = "") {
  if (typeof value !== "string" || !value) return "";
  try {
    const url = new URL(value, baseUrl), base = new URL(baseUrl);
    if (url.origin !== base.origin || url.username || url.password || url.search || url.hash || !url.pathname.startsWith("/")) return "";
    if (extension === "mp4" && !/^\/results\/[A-Za-z0-9._~!$&'()+,;=@%/-]+\.mp4$/i.test(url.pathname)) return "";
    if (url.pathname.split("/").includes("..")) return "";
    return url.pathname;
  } catch { return ""; }
}
async function museThumbnailDataUrl(config, value) {
  const baseUrl = U.normalizeMuseBaseUrl(config?.museBaseUrl), path = museRelativePath(baseUrl, value);
  if (!path) throw new Error("Đường dẫn ảnh xem trước Muse không hợp lệ.");
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000);
  let response;
  try { response = await fetch(`${baseUrl}${path}`, { headers: { "X-API-Password": String(config.musePassword || "") }, credentials: "omit", redirect: "error", signal: controller.signal }); }
  catch (error) { if (error?.name === "AbortError") throw new Error("Tải ảnh xem trước Muse quá thời gian chờ."); throw error; }
  finally { clearTimeout(timer); }
  if (response.status === 401) throw museHttpError(401, {});
  if (!response.ok) throw new Error(`Không tải được ảnh xem trước Muse (HTTP ${response.status}).`);
  const blob = await response.blob();
  if (!blob.size || blob.size > 2_000_000 || !/^image\/(?:png|jpeg|webp|gif)$/i.test(blob.type)) throw new Error("Ảnh xem trước Muse không hợp lệ hoặc quá lớn.");
  const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type};base64,${btoa(binary)}`;
}
async function handleMuseLibraryMessage(message, respond) {
  const config = message.config || {};
  try {
    if (message.type === "MUSE_LIST_PROJECTS") {
      const { data } = await museApiJson(config, "/api/projects");
      if (!Array.isArray(data.projects)) throw new Error("Muse API không trả danh sách dự án hợp lệ.");
      respond({ ok: true, projects: data.projects.filter(value => typeof value === "string").slice(0, 500) }); return;
    }
    if (message.type === "MUSE_CREATE_PROJECT") {
      const name = String(message.name || "").trim().slice(0, 100);
      if (!name) throw new Error("Nhập tên dự án trước.");
      const { data } = await museApiJson(config, "/api/projects", "POST", { name });
      if (typeof data.name !== "string" || !data.name.trim()) throw new Error("Muse API không trả tên dự án hợp lệ.");
      respond({ ok: true, name: data.name }); return;
    }
    if (message.type === "MUSE_LIST_VIDEOS") {
      const { baseUrl, data } = await museApiJson(config, "/api/videos");
      const rawVideos = Array.isArray(data) ? data : data.videos;
      if (!Array.isArray(rawVideos)) throw new Error("Muse API không trả danh sách video hợp lệ.");
      const videos = rawVideos.slice(0, 1000).map(video => {
        if (!video || (typeof video.id !== "string" && typeof video.id !== "number")) return null;
        return { id: String(video.id).slice(0, 200), du_an: typeof video.du_an === "string" ? video.du_an : "",
          title: String(video.name || video.filename || video.mo_ta || video.prompt || `Video ${video.id}`).slice(0, 200),
          thumbPath: museRelativePath(baseUrl, video.thumb_url), videoPath: museRelativePath(baseUrl, video.video_url || video.video_path || video.file_url || video.url || video.path, "mp4"),
          duration: Number.isFinite(Number(video.duration)) ? Number(video.duration) : null };
      }).filter(Boolean);
      respond({ ok: true, videos }); return;
    }
    if (message.type === "MUSE_MOVE_VIDEO") {
      const id = String(message.videoId || "");
      if (!id || id.length > 200) throw new Error("ID video không hợp lệ.");
      const project = message.project == null || message.project === "" ? null : U.cleanMuseProject(message.project);
      const { data } = await museApiJson(config, `/api/videos/${encodeURIComponent(id)}/move`, "POST", { du_an: project });
      respond({ ok: true, data }); return;
    }
    if (message.type === "MUSE_GET_THUMBNAIL") {
      respond({ ok: true, dataUrl: await museThumbnailDataUrl(config, message.thumbPath) }); return;
    }
    if (message.type === "MUSE_DOWNLOAD_LIBRARY_VIDEO") {
      const baseUrl = U.normalizeMuseBaseUrl(config.museBaseUrl), videoPath = museRelativePath(baseUrl, message.videoPath, "mp4");
      if (!videoPath) throw new Error("Đường dẫn video Muse không hợp lệ.");
      await downloadMuseVideo(baseUrl, String(config.musePassword || ""), videoPath, String(message.filename || "video.mp4"), { controller: new AbortController(), reason: "" });
      respond({ ok: true }); return;
    }
  } catch (error) { respond({ ok: false, error: error?.message || "Không thực hiện được thao tác Muse API." }); }
}
async function runQueue(run, config, startIndex) {
  const muse = run.provider === "muse";
  const service = run.provider === "chatgpt" ? "ChatGPT" : muse ? "Muse API" : "Flow";
  let heartbeat;
  try {
    if (!muse) {
      const tab = await chrome.tabs.get(run.tabId);
      if (run.provider === "chatgpt" ? !U.isChatGPTUrl(tab.url) : !U.isFlowUrl(tab.url)) throw new Error(`Tab đã chọn không còn ở ${service}.`);
      const pingType = run.provider === "chatgpt" ? "CHATGPT_PING" : "FLOW_PING";
      const ping = await chrome.tabs.sendMessage(run.tabId, { type: pingType }, { frameId: 0 }).catch(() => null);
      if (!ping?.ok) throw new Error(`Không kết nối được ${service}. Tải lại tab rồi thử lại.`);
      run.port = chrome.tabs.connect(run.tabId, { name: run.provider === "chatgpt" ? "chatgpt-batch-work" : "flow-batch-work", frameId: 0 });
      run.port.onMessage.addListener(message => { if (message?.type === "ALIVE") run.lastHeartbeat = Date.now(); });
      run.port.onDisconnect.addListener(() => { void chrome.runtime.lastError; if (!run.finishing) halt(run, `Mất kết nối với tab ${service}.`); });
      heartbeat = setInterval(() => {
        if (run.controller.signal.aborted) return;
        try { run.port.postMessage({ type: "HEARTBEAT" }); } catch { halt(run, `Mất kết nối với tab ${service}.`); }
      }, 10000);
    }
    const batchId = new Date().toISOString().replace(/[:.]/g, "-");
    for (let i = startIndex; i < run.items.length; i++) {
      check(run); const item = run.items[i]; run.index = i;
      item.status = "typing"; item.detail = ""; run.status = `Đang nhập prompt ${i + 1} / ${run.items.length}…`; publish(run);
      if (muse) {
        item.status = "generating"; run.status = `Đang tạo cảnh ${i + 1}/${run.items.length}…`; publish(run);
        const result = await runMuseItem(run, config, item, i, batchId);
        check(run);
        item.status = "done"; item.taskId = result.taskId; item.detail = `Tệp đã tải xong · ${result.duration} giây.`;
        run.status = `${i + 1} / ${run.items.length} hoàn thành · video dài ${result.duration} giây.`; publish(run);
        if (i < run.items.length - 1) await sleep((config.delayMin + Math.random() * (config.delayMax - config.delayMin)) * 1000, run);
        continue;
      }
      const makeRequest = cancelAfterSend => {
        const id = crypto.randomUUID();
        return request(run.port, { type: "RUN", id, index: i + 1, prompt: item.prompt, timeout: config.timeout, mediaType: config.mediaType, provider: config.provider, cancelAfterSend,
        ...(config.provider === "chatgpt" ? { seenImageUrls: [...run.seenImageUrls] } : {}) },
        value => value?.type === "RESULT" && value.id === id,
        (config.timeout + (config.mediaType === "video" ? 120 : 20)) * 1000, run,
        phase => { item.status = phase; run.status = phase === "typing" ? `Đang nhập prompt ${i + 1}…` : `Đang chờ kết quả prompt ${i + 1}…`; publish(run); });
      };
      const cancelAtBoundary = config.provider === "chatgpt" && (i + 1) % config.batchEvery === 0;
      let result;
      try { result = await makeRequest(cancelAtBoundary); }
      catch (error) {
        if (!(["GPT_TIMEOUT", "TIMEOUT"].includes(error.code))) throw error;
        result = { ok: false, code: error.code };
      }
      check(run);
      while (!result.ok && ["GPT_NO_BUTTON", "GPT_NO_IMAGE", "GPT_TIMEOUT", "TIMEOUT"].includes(result.code)) {
        const waitingForImage = result.code === "GPT_NO_IMAGE";
        const timedOut = ["GPT_TIMEOUT", "TIMEOUT"].includes(result.code);
        item.status = "typing";
        item.detail = waitingForImage
          ? "ChatGPT chưa trả ảnh; sẽ gửi lại prompt này sau 5 giây."
          : timedOut ? "Đã hết thời gian chờ; sẽ thử lại cùng prompt sau 5 giây."
            : "Chưa tìm thấy nút Gửi; sẽ thử lại sau 5 giây.";
        run.status = waitingForImage
          ? `ChatGPT chưa trả ảnh ở prompt ${i + 1}; thử lại sau 5 giây…`
          : timedOut ? `Hết thời gian chờ prompt ${i + 1}; thử lại sau 5 giây…`
            : `Chưa tìm thấy nút Gửi ở prompt ${i + 1}; thử lại sau 5 giây…`;
        publish(run);
        await sleep(5000, run);
        check(run);
        item.detail = waitingForImage ? "Đang gửi lại prompt chưa có ảnh."
          : timedOut ? "Đang chạy lại prompt hết thời gian chờ."
            : "Đang thử lại cùng prompt.";
        run.status = `Đang thử lại prompt ${i + 1}…`;
        publish(run);
        try { result = await makeRequest(cancelAtBoundary); }
        catch (error) {
          if (!(["GPT_TIMEOUT", "TIMEOUT"].includes(error.code))) throw error;
          result = { ok: false, code: error.code };
        }
        check(run);
      }
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
    if (item && item.status !== "done") { item.status = run.userStopped ? "stopped" : ["TIMEOUT", "MUSE_TIMEOUT"].includes(error.code) ? "timeout" : "error"; item.detail = run.reason || error.message; }
    for (const pending of run.items) if (pending.status === "pending") { pending.status = "stopped"; pending.detail = "Chưa gửi."; }
    run.status = run.userStopped ? "Đã dừng. Mục đang dở cần kiểm tra trước khi tiếp tục." : "Hàng đợi đã dừng vì lỗi.";
    run.error = run.userStopped ? "" : error.message;
  } finally {
    run.finishing = true; clearInterval(heartbeat);
    try { run.port?.postMessage({ type: "STOP" }); } catch {}
    run.port?.disconnect(); run.finished = true;
    if (muse) await chrome.offscreen.closeDocument().catch(() => {});
    await chrome.storage.local.set({ queueState: { version: 1, provider: run.provider, mediaType: run.mediaType,
      prompts: run.items.map(item => item.prompt), items: run.items.map(item => ({ status: item.status, detail: item.detail, ...(item.taskId ? { taskId: item.taskId } : {}), ...(item.project ? { project: item.project } : {}) })), updatedAt: Date.now() } }).catch(() => {});
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
  if (config.provider !== "muse" && !Number.isInteger(message.tabId)) { respond({ ok: false, error: "Chưa chọn tab dịch vụ." }); return false; }
  starting = true;
  chrome.storage.local.get("queueState").then(data => {
    const saved = data.queueState;
    const sameQueue = saved?.version === 1 && saved.provider === config.provider && saved.mediaType === config.mediaType &&
      JSON.stringify(saved.prompts) === JSON.stringify(config.prompts) && Array.isArray(saved.items) && saved.items.length === config.prompts.length;
    const items = config.prompts.map((prompt, index) => {
      const savedItem = sameQueue ? saved.items[index] : {};
      const project = config.provider === "muse" ? U.cleanMuseProject(message.itemProjects?.[index] ?? savedItem?.project) : "";
      return { prompt, status: sameQueue ? (savedItem?.status || "pending") : "pending", detail: sameQueue ? (savedItem?.detail || "") : "",
        ...(savedItem?.taskId ? { taskId: savedItem.taskId } : {}), ...(project ? { project } : {}) };
    });
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
  if (message?.type === "MUSE_TEST_CONNECTION") {
    testMuseConnection(message.config).then(respond).catch(error => respond({ ok: false, error: error?.message || "Không kiểm tra được Muse API." }));
    return true;
  }
  if (["MUSE_LIST_PROJECTS", "MUSE_CREATE_PROJECT", "MUSE_LIST_VIDEOS", "MUSE_MOVE_VIDEO", "MUSE_GET_THUMBNAIL", "MUSE_DOWNLOAD_LIBRARY_VIDEO"].includes(message?.type)) {
    void handleMuseLibraryMessage(message, respond);
    return true;
  }
  if (handlePanelMessage(message, respond)) return true;
});
