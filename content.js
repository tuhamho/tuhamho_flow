"use strict";

(() => {
  // Khi Flow thay đổi, sửa selector tại đây rồi tải lại extension VÀ tab Flow.
  // Selector tùy chỉnh phải trỏ đúng một phần tử đang hiện; không đoán khi mơ hồ.
  const CONFIG = Object.freeze({
    promptSelector: "",
    generateSelector: "",
    resultSelector: "", // Selector của các thẻ img KẾT QUẢ (không phải thẻ chứa).
    minImageSize: 256,
    pollMs: 500,
    settleMs: 1800,
    maxPixels: 32000000,
    maxDataLength: 24000000,
    maxVideoBytes: 30000000,
    leaseMs: 45000
  });
  const extensionPrefix = chrome.runtime.getURL("");
  let activeJob = null;

  function onFlow() {
    return (location.origin === "https://labs.google" &&
      /^\/fx\/(?:[^/]+\/)?tools\/flow(?:\/|$)/.test(location.pathname)) ||
      (location.origin === "https://flow.google.com" &&
      /^\/project\/[^/]+(?:\/|$)/.test(location.pathname));
  }
  if (!onFlow()) return;
  const fail = code => { throw new Error(code); };
  const trusted = sender => sender?.id === chrome.runtime.id &&
    (sender?.url?.startsWith(extensionPrefix) || sender?.origin === `chrome-extension://${chrome.runtime.id}`);
  function visible(element) {
    if (!element?.isConnected || element.closest('[hidden],[aria-hidden="true"],[inert]')) return false;
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" &&
      style.visibility !== "hidden" && Number(style.opacity) !== 0;
  }
  function query(selector, root = document) {
    try { return [...root.querySelectorAll(selector)]; }
    catch { return fail("SELECTOR"); }
  }
  function unique(elements, error) {
    const list = [...new Set(elements)];
    if (list.length > 1) fail(error);
    return list[0] || null;
  }
  function editable(element) {
    return visible(element) && !element.disabled && !element.readOnly &&
      element.getAttribute("aria-disabled") !== "true" &&
      (element.tagName === "TEXTAREA" || element.isContentEditable);
  }
  function findInput() {
    if (CONFIG.promptSelector) return unique(query(CONFIG.promptSelector).filter(editable), "INPUT_AMBIGUOUS");
    const candidates = query('textarea,[contenteditable="true"],[contenteditable=""],[contenteditable="plaintext-only"]')
      .filter(editable).filter(element => !element.parentElement?.closest('[contenteditable="true"],[contenteditable=""]'));
    const hinted = candidates.filter(element => /prompt|describe|imagine|create|mô tả|tạo|生成|描述/i.test(
      [element.getAttribute("placeholder"), element.getAttribute("aria-label"), element.getAttribute("data-placeholder")].join(" ")));
    if (hinted.length) return unique(hinted, "INPUT_AMBIGUOUS");
    const slate = candidates.filter(element => element.matches('[data-slate-editor="true"]'));
    return unique(slate.length ? slate : candidates, "INPUT_AMBIGUOUS");
  }
  function buttonLabel(button) {
    return [button.getAttribute("aria-label"), button.getAttribute("title"), button.textContent].join(" ").trim();
  }
  function findGenerate(input) {
    const isButton = element => element.matches('button,[role="button"],input[type="submit"]');
    if (CONFIG.generateSelector) {
      return unique(query(CONFIG.generateSelector).filter(element => visible(element) && isButton(element)), "BUTTON_AMBIGUOUS");
    }
    const bad = /delete|remove|close|cancel|upload|download|project|new project|model|setting|xóa|xoá|đóng|hủy|dự án|tải/i;
    const wanted = /(?:^|\s)(?:generate|create|send|submit|tạo|gửi)(?:\s|$)|arrow_forward|生成|送信/i;
    const buttons = query('button,[role="button"]').filter(button => visible(button) &&
      wanted.test(buttonLabel(button)) && !bad.test(buttonLabel(button)));
    // Chỉ xét nút có nhãn gửi/tạo. Tuyệt đối không bấm một nút bất kỳ vì nó ở gần.
    let ancestor = input.parentElement;
    for (let level = 0; ancestor && level < 5 && ancestor !== document.body; level++, ancestor = ancestor.parentElement) {
      const local = buttons.filter(button => ancestor.contains(button));
      if (local.length) return unique(local, "BUTTON_AMBIGUOUS");
    }
    const rect = input.getBoundingClientRect();
    return unique(buttons.filter(button => {
      const box = button.getBoundingClientRect();
      return Math.abs(box.top - rect.top) < 250 && Math.abs(box.left - rect.right) < 650;
    }), "BUTTON_AMBIGUOUS");
  }
  const disabled = button => button.disabled || button.getAttribute("aria-disabled") === "true";
  function inputText(input) {
    if (input.tagName === "TEXTAREA") return input.value;
    if (input.matches('[data-slate-editor="true"]')) {
      return query("[data-slate-string]", input).map(element => element.textContent).join("");
    }
    return input.textContent || "";
  }
  const normalize = text => text.replace(/\r\n/g, "\n").replace(/\u200b/g, "").trim();
  function check(job) {
    if (job.controller.signal.aborted) fail("STOPPED");
    if (!onFlow() || location.href !== job.href) fail("NAVIGATED");
    if (Date.now() - job.client.lastSeen > CONFIG.leaseMs) fail("PANEL_CLOSED");
  }
  function pause(ms, job) {
    check(job);
    return new Promise((resolve, reject) => {
      const signal = job.controller.signal;
      const abort = () => { clearTimeout(timer); reject(new Error("STOPPED")); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
      signal.addEventListener("abort", abort, { once: true });
    }).then(() => check(job));
  }
  // Quan sát DOM để nhận kết quả kịp thời cả khi tab Flow ở nền và timer bị giảm tần suất.
  function waitForDomChange(ms, job) {
    check(job);
    return new Promise((resolve, reject) => {
      let settled = false;
      const root = document.querySelector("main") || document.body;
      const finish = error => {
        if (settled) return;
        settled = true; clearTimeout(timer); observer.disconnect();
        root.removeEventListener("load", onLoad, true); job.controller.signal.removeEventListener("abort", onAbort);
        error ? reject(error) : resolve();
      };
      const observer = new MutationObserver(() => finish());
      const onLoad = event => { if (event.target instanceof HTMLImageElement || event.target instanceof HTMLVideoElement) finish(); };
      const onAbort = () => finish(new Error("STOPPED"));
      observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true,
        attributeFilter: ["src", "srcset", "class", "style", "aria-busy", "data-testid"] });
      root.addEventListener("load", onLoad, true);
      job.controller.signal.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => finish(), ms);
      if (job.controller.signal.aborted) onAbort();
    }).then(() => check(job));
  }
  function selectEditor(input) {
    input.focus();
    const selection = window.getSelection(), range = document.createRange();
    range.selectNodeContents(input);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  async function fillPrompt(input, prompt, job) {
    check(job);
    input.focus();
    if (input.tagName === "TEXTAREA") {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(input, prompt);
      input.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: prompt }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      // Cho Slate cơ hội cập nhật state qua beforeinput, không thay textContent/HTML.
      selectEditor(input);
      input.dispatchEvent(new InputEvent("beforeinput", {
        bubbles: true, composed: true, cancelable: true, inputType: "insertText", data: prompt
      }));
      await pause(250, job);
      input = findInput();
      if (!input) fail("NO_INPUT");
      if (normalize(inputText(input)) !== normalize(prompt)) {
        // Dự phòng DOM editing command của trình duyệt (không thực thi script).
        selectEditor(input);
        document.execCommand("insertText", false, prompt);
      }
    }
    await pause(500, job);
    input = findInput();
    if (!input || normalize(inputText(input)) !== normalize(prompt)) fail("INPUT_REJECTED");
    return input;
  }
  function images() {
    const root = document.querySelector("main") || document;
    return query(CONFIG.resultSelector || "img", root).filter(image => image.tagName === "IMG" &&
      !image.closest('header,nav,aside,[role="navigation"],form,[contenteditable]'));
  }
  const source = image => image.currentSrc || image.src;
  function baseline() {
    // Ghi cả URL ảnh cũ chưa tải xong để không nhầm chúng với kết quả mới.
    const urls = new Set();
    for (const image of images()) {
      if (image.src) urls.add(image.src);
      if (image.currentSrc) urls.add(image.currentSrc);
      for (const entry of (image.getAttribute("srcset") || "").split(",")) {
        const value = entry.trim().split(/\s+/)[0];
        if (value) { try { urls.add(new URL(value, location.href).href); } catch {} }
      }
    }
    return urls;
  }
  function completed(image) {
    return visible(image) && image.complete && image.naturalWidth >= CONFIG.minImageSize &&
      image.naturalHeight >= CONFIG.minImageSize && /^(https:|blob:|data:image\/)/i.test(source(image));
  }
  function videoEntries() {
    const root = document.querySelector("main") || document;
    const entries = [];
    for (const video of query("video", root)) {
      const src = video.currentSrc || video.src || video.querySelector("source[src]")?.src;
      if (visible(video) && src && video.readyState >= 2 && video.videoWidth > 0) entries.push({ src });
    }
    for (const anchor of query("a[download][href]", root)) {
      const name = `${anchor.download} ${anchor.href}`;
      if (visible(anchor) && /\.(?:mp4|webm)(?:\?|#|\s|$)/i.test(name)) entries.push({ src: anchor.href });
    }
    return entries;
  }
  function mediaDownloadUrl(src) {
    let url;
    try { url = new URL(src, location.href); } catch { return null; }
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    const googleMedia = host === "flow.google.com" || host === "labs.google" ||
      ["googleapis.com", "googleusercontent.com", "googlevideo.com", "gstatic.com", "ggpht.com"]
        .some(domain => host === domain || host.endsWith(`.${domain}`));
    return googleMedia ? url.href : null;
  }
  function imageExtension(src) {
    try { return /\.(jpe?g|webp)(?:$)/i.exec(new URL(src).pathname)?.[1].toLowerCase() || "png"; }
    catch { return "png"; }
  }
  function videoExtension(src) {
    try { return /\.webm(?:$)/i.test(new URL(src).pathname) ? "webm" : "mp4"; }
    catch { return "mp4"; }
  }
  function videoPoster(image) {
    const region = image.closest("article,figure,[role='button']") || image.parentElement?.parentElement;
    if (!region) return false;
    return Boolean(region.querySelector("video")) ||
      /play_arrow|play_circle|videocam/i.test((region.textContent || "").slice(0, 150)) ||
      /video/i.test(image.getAttribute("alt") || "");
  }
  function busy() {
    const root = document.querySelector("main") || document;
    return query('[role="progressbar"],[aria-busy="true"]', root).some(visible);
  }
  function videoStillRendering() {
    const root = document.querySelector("main") || document;
    // Flow có thể chỉ hiện "0%" dưới dạng văn bản, không có role=progressbar.
    // Chỉ đọc nhãn phần trăm ngắn, đang hiện; không đọc prompt hay toàn trang.
    return query("span,small,div,p,[role='status']", root).some(element =>
      element.childElementCount === 0 && visible(element) &&
      /^(?:[0-9]|[1-9][0-9])\s*%$/.test((element.textContent || "").trim()));
  }
  function alertSet() {
    // Chỉ đọc thông báo lỗi trực tiếp, không lấy toàn bộ nội dung trang.
    return new Set(query('[role="alert"]').filter(visible).map(element => element.textContent.trim()));
  }
  async function waitForImage(oldUrls, oldAlerts, job, timeout) {
    const deadline = Date.now() + timeout * 1000;
    let candidate = "", since = 0;
    while (Date.now() < deadline) {
      check(job);
      if ([...alertSet()].some(text => !oldAlerts.has(text) &&
          /error|failed|unable|limit|quota|try again|lỗi|không thể|thất bại|hạn mức|thử lại/i.test(text))) fail("FLOW_ERROR");
      const fresh = images().filter(image => completed(image) && !oldUrls.has(source(image)));
      const urls = [...new Set(fresh.map(source))];
      if (urls.length > 1) fail("MULTIPLE_IMAGES");
      if (urls.length === 1 && !busy()) {
        if (candidate !== urls[0]) { candidate = urls[0]; since = Date.now(); }
        if (Date.now() - since >= CONFIG.settleMs) {
          if (videoPoster(fresh[0])) fail("VIDEO_RESULT");
          return fresh[0];
        }
      } else { candidate = ""; since = 0; }
      await waitForDomChange(CONFIG.pollMs, job);
    }
    fail("TIMEOUT");
  }
  async function waitForVideo(oldSources, oldAlerts, job, deadline) {
    let candidate = "", since = 0;
    while (Date.now() < deadline) {
      check(job);
      if ([...alertSet()].some(text => !oldAlerts.has(text) &&
          /error|failed|unable|limit|quota|try again|lỗi|không thể|thất bại|hạn mức|thử lại/i.test(text))) fail("FLOW_ERROR");
      const fresh = [...new Set(videoEntries().map(entry => entry.src))].filter(src => !oldSources.has(src));
      if (fresh.length > 1) fail("MULTIPLE_VIDEOS");
      if (fresh.length === 1 && !busy() && !videoStillRendering()) {
        if (candidate !== fresh[0]) { candidate = fresh[0]; since = Date.now(); }
        if (Date.now() - since >= CONFIG.settleMs) return candidate;
      } else { candidate = ""; since = 0; }
      await waitForDomChange(CONFIG.pollMs, job);
    }
    fail(videoStillRendering() ? "VIDEO_PENDING_TIMEOUT" : "TIMEOUT");
  }
  async function exportVideo(src, job) {
    check(job);
    let url;
    try { url = new URL(src, location.href); } catch { fail("VIDEO_SOURCE_UNAVAILABLE"); }
    // Không truy cập CDN hoặc URL tùy ý. Với HTTPS chỉ nhận đúng origin Flow,
    // không gửi cookie, không theo redirect; blob:/data: là dữ liệu sẵn có của trang.
    const localBlob = url.protocol === "blob:" && url.origin === location.origin;
    const localData = url.protocol === "data:" && /^data:video\//i.test(src);
    const sameOrigin = url.protocol === "https:" && url.origin === location.origin;
    if (!localBlob && !localData && !sameOrigin) {
      const downloadUrl = mediaDownloadUrl(src);
      if (!downloadUrl) fail("VIDEO_SOURCE_EXTERNAL");
      // Người dùng đã chọn tự tải: Chrome Downloads xử lý URL tệp mà Flow
      // vừa hiển thị, thay vì content script đọc cookie hoặc gọi CDN.
      return { downloadUrl, extension: videoExtension(downloadUrl) };
    }
    let response;
    try { response = await fetch(src, { credentials: "omit", redirect: "error", signal: job.controller.signal }); }
    catch { fail("VIDEO_SOURCE_UNAVAILABLE"); }
    check(job);
    if (!response.ok) fail("VIDEO_SOURCE_UNAVAILABLE");
    const length = Number(response.headers.get("content-length"));
    if (length > CONFIG.maxVideoBytes) fail("VIDEO_TOO_LARGE");
    const chunks = [];
    let total = 0;
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        check(job);
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > CONFIG.maxVideoBytes) { await reader.cancel(); fail("VIDEO_TOO_LARGE"); }
        chunks.push(value);
      }
    } else {
      chunks.push(await response.arrayBuffer());
    }
    const blob = new Blob(chunks, { type: response.headers.get("content-type") || "" });
    check(job);
    if (blob.size > CONFIG.maxVideoBytes) fail("VIDEO_TOO_LARGE");
    const mime = blob.type.split(";")[0].toLowerCase();
    const extension = mime === "video/mp4" ? "mp4" :
      mime === "video/webm" ? "webm" : null;
    if (!extension) fail("VIDEO_FORMAT_UNSUPPORTED");
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      const abort = () => reader.abort();
      job.controller.signal.addEventListener("abort", abort, { once: true });
      reader.onload = () => { job.controller.signal.removeEventListener("abort", abort); resolve(reader.result); };
      reader.onerror = () => { job.controller.signal.removeEventListener("abort", abort); reject(new Error("VIDEO_READ_FAILED")); };
      reader.onabort = () => { job.controller.signal.removeEventListener("abort", abort); reject(new Error("STOPPED")); };
      reader.readAsDataURL(blob);
    });
    check(job);
    if (typeof dataUrl !== "string" || !/^data:[^,]+;base64,/i.test(dataUrl)) fail("VIDEO_READ_FAILED");
    return { dataUrl: dataUrl.replace(/^data:[^,]+;base64,/i, `data:${mime};base64,`), extension };
  }
  function exportImage(image, job) {
    check(job);
    if (!completed(image)) fail("IMAGE_GONE");
    const width = image.naturalWidth, height = image.naturalHeight;
    if (width * height > CONFIG.maxPixels) fail("IMAGE_TOO_LARGE");
    // Chỉ đọc pixel ảnh kết quả đang hiển thị; không fetch URL/CDN, cookie hay API.
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    try {
      const context = canvas.getContext("2d");
      if (!context) fail("IMAGE_EXPORT");
      context.drawImage(image, 0, 0);
      const dataUrl = canvas.toDataURL("image/png");
      if (!dataUrl.startsWith("data:image/png;base64,")) fail("IMAGE_EXPORT");
      if (dataUrl.length > CONFIG.maxDataLength) fail("IMAGE_TOO_LARGE");
      return dataUrl;
    } catch (error) {
      if (error.name === "SecurityError") fail("IMAGE_CORS");
      throw error;
    } finally { canvas.width = 0; canvas.height = 0; }
  }
  async function runOne(message, job, report) {
    if (typeof message.prompt !== "string" || !message.prompt.trim() || message.prompt.length > 10000 ||
        !["image", "video"].includes(message.mediaType) ||
        !Number.isFinite(message.timeout) || message.timeout < 30 || message.timeout > 900) fail("INVALID");
    check(job);
    let input = findInput();
    if (!input) fail("NO_INPUT");
    if (busy()) fail("FLOW_BUSY");
    report("typing");
    input = await fillPrompt(input, message.prompt, job);
    // Chờ state UI cập nhật, không gửi Enter/click liên tiếp có thể tiêu tốn thêm lượt.
    let button;
    for (let attempt = 0; attempt < 10; attempt++) {
      input = findInput();
      if (!input) fail("NO_INPUT");
      button = findGenerate(input);
      if (button && !disabled(button)) break;
      await pause(300, job);
    }
    if (!button) fail("NO_BUTTON");
    if (disabled(button)) fail("BUTTON_DISABLED");
    if (normalize(inputText(input)) !== normalize(message.prompt)) fail("INPUT_REJECTED");
    const oldUrls = message.mediaType === "video" ? new Set(videoEntries().map(entry => entry.src)) : baseline();
    const oldAlerts = alertSet();
    check(job);
    if (busy()) fail("FLOW_BUSY");
    button.click(); // Chính xác một lần gửi cho mỗi prompt. Không tự thử lại.
    report("generating");
    if (message.mediaType === "video") {
      const deadline = Date.now() + message.timeout * 1000;
      let lastError = null;
      while (Date.now() < deadline) {
        let src;
        try { src = await waitForVideo(oldUrls, oldAlerts, job, deadline); }
        catch (error) {
          if (error.message === "TIMEOUT" && lastError) throw lastError;
          throw error;
        }
        try { return await exportVideo(src, job); }
        catch (error) {
          if (error.message !== "VIDEO_SOURCE_UNAVAILABLE") throw error;
          // Video có thể mới là URL phát tạm trong lúc Flow xử lý. Chờ nguồn
          // ổn định/thay đổi, không gửi lại prompt và vẫn giữ cùng hạn chờ.
          lastError = error;
          await pause(Math.min(5000, Math.max(1, deadline - Date.now())), job);
        }
      }
      throw lastError || new Error("TIMEOUT");
    }
    const image = await waitForImage(oldUrls, oldAlerts, job, message.timeout);
    check(job);
    try { return { dataUrl: exportImage(image, job), extension: "png" }; }
    catch (error) {
      if (error.message !== "IMAGE_CORS") throw error;
      // Canvas không đọc được pixel ảnh CDN. Chỉ trả URL của đúng thẻ ảnh
      // kết quả mới và đang hiện; panel sẽ kiểm tra lại trước khi tải.
      const downloadUrl = mediaDownloadUrl(source(image));
      if (!downloadUrl) throw error;
      return { downloadUrl, extension: imageExtension(downloadUrl) };
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!trusted(sender) || message?.type !== "FLOW_PING") return;
    try { respond({ ok: onFlow(), hasInput: onFlow() && Boolean(findInput()) }); }
    catch { respond({ ok: onFlow(), hasInput: false }); }
  });
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== "flow-batch-work" || !trusted(port.sender) || !onFlow()) { port.disconnect(); return; }
    const client = { lastSeen: Date.now(), closed: false };
    const send = message => { if (!client.closed) { try { port.postMessage(message); } catch {} } };
    const cancel = () => { if (activeJob?.client === client) activeJob.controller.abort(); };
    port.onDisconnect.addListener(() => { client.closed = true; cancel(); });
    port.onMessage.addListener(message => {
      if (message?.type === "HEARTBEAT") { client.lastSeen = Date.now(); send({ type: "ALIVE" }); return; }
      if (message?.type === "STOP") { cancel(); return; }
      if (message?.type !== "RUN" || typeof message.id !== "string") return;
      if (activeJob) { send({ type: "RESULT", id: message.id, ok: false, code: "BUSY" }); return; }
      const job = { client, href: location.href, controller: new AbortController() };
      activeJob = job;
      runOne(message, job, phase => send({ type: "PHASE", id: message.id, phase }))
        .then(result => { check(job); send({ type: "RESULT", id: message.id, ok: true, ...result }); })
        .catch(error => send({ type: "RESULT", id: message.id, ok: false, code: error.message }))
        .finally(() => { if (activeJob === job) activeJob = null; });
    });
  });
  window.addEventListener("pagehide", () => activeJob?.controller.abort());
})();
