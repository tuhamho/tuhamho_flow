"use strict";

// Điều khiển riêng giao diện ChatGPT. Chỉ đọc composer và ảnh mới trong câu trả lời assistant.
(() => {
  const extensionPrefix = chrome.runtime.getURL("");
  let activeJob = null;
  if (location.origin !== "https://chatgpt.com") return;
  const trusted = sender => sender?.id === chrome.runtime.id &&
    (sender?.url?.startsWith(extensionPrefix) || sender?.origin === `chrome-extension://${chrome.runtime.id}`);
  const fail = code => { throw new Error(code); };
  const visible = element => {
    if (!element?.isConnected || element.closest('[hidden],[aria-hidden="true"],[inert]')) return false;
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0;
  };
  function composer() {
    const candidates = [...document.querySelectorAll('#prompt-textarea,[data-testid="composer-text-input"],textarea,[contenteditable="true"]')]
      .filter(el => visible(el) && !el.disabled && el.getAttribute("aria-disabled") !== "true");
    const unique = [...new Set(candidates)];
    if (!unique.length) fail("GPT_NO_INPUT");
    if (unique.length > 1) {
      const primary = unique.filter(el => el.id === "prompt-textarea" || el.matches('[data-testid="composer-text-input"]'));
      if (primary.length === 1) return primary[0];
      fail("GPT_INPUT_AMBIGUOUS");
    }
    return unique[0];
  }
  const readText = el => el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement ? el.value : el.innerText;
  const normalizeText = value => String(value || "").replace(/\u200b/g, "").replace(/\s+/g, " ").trim();
  async function fill(el, text, job) {
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
      if (!setter) fail("GPT_INPUT_REJECTED");
      setter.call(el, text);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: text }));
    } else {
      el.focus(); el.replaceChildren();
      document.execCommand("insertText", false, text);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: text }));
    }
    await pause(300, job);
    // ChatGPT may render newlines as separate paragraphs; compare the text while ignoring layout whitespace.
    if (normalizeText(readText(composer())) !== normalizeText(text)) fail("GPT_INPUT_REJECTED");
  }
  function sendButton() {
    const candidates = [...document.querySelectorAll('button,[role="button"]')].filter(visible).filter(button => {
      if (button.disabled || button.getAttribute("aria-disabled") === "true") return false;
      const label = `${button.getAttribute("aria-label") || ""} ${button.getAttribute("data-testid") || ""} ${button.textContent || ""}`.toLowerCase();
      return /send|submit|gửi|composer-submit/.test(label) && !/stop|cancel|voice/.test(label);
    });
    if (candidates.length !== 1) fail(candidates.length ? "GPT_BUTTON_AMBIGUOUS" : "GPT_NO_BUTTON");
    return candidates[0];
  }
  function check(job) {
    if (job.controller.signal.aborted) fail("STOPPED");
    // ChatGPT tự chuyển / sang /c/<id> sau lần gửi đầu; cho phép route nội bộ này.
    if (location.origin !== "https://chatgpt.com") fail("NAVIGATED");
    if (Date.now() - job.client.lastSeen > 45000) fail("PANEL_CLOSED");
  }
  function pause(ms, job) {
    check(job);
    return new Promise((resolve, reject) => {
      const signal = job.controller.signal;
      const abort = () => { clearTimeout(timer); reject(new Error("STOPPED")); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
      signal.addEventListener("abort", abort, { once: true });
    });
  }
  // Dùng MutationObserver để nhận ảnh ngay cả khi Chrome giảm tần suất timer ở tab nền.
  function waitForPageChange(ms, job) {
    check(job);
    return new Promise((resolve, reject) => {
      let settled = false;
      // Quan sát toàn bộ cây tài liệu: ChatGPT có thể thay vùng <main> khi cập nhật
      // câu trả lời. Quan sát riêng node main cũ khiến tab nền bỏ lỡ ảnh mới.
      const root = document.documentElement;
      const finish = error => {
        if (settled) return;
        settled = true; clearTimeout(timer); observer.disconnect();
        root.removeEventListener("load", onLoad, true); job.controller.signal.removeEventListener("abort", onAbort);
        error ? reject(error) : resolve();
      };
      const observer = new MutationObserver(() => finish());
      const onLoad = event => { if (event.target instanceof HTMLImageElement) finish(); };
      const onAbort = () => finish(new Error("STOPPED"));
      observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["src", "srcset", "class", "style", "aria-busy", "data-testid"] });
      root.addEventListener("load", onLoad, true);
      job.controller.signal.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => finish(), ms);
      if (job.controller.signal.aborted) onAbort();
    }).then(() => check(job));
  }
  function userMessages() {
    return [...document.querySelectorAll('main [data-message-author-role="user"]')];
  }
  function userSnapshot() {
    const nodes = userMessages();
    return { nodes: new Set(nodes), ids: new Set(nodes.map(node => node.getAttribute("data-message-id")).filter(Boolean)) };
  }
  function assistantImagesAfterRequest(request, snapshot) {
    // Ghép ảnh với đúng tin nhắn mới gửi. Chỉ xét các ảnh nằm sau tin nhắn đó
    // trong main; ảnh lịch sử ở phía trên có thể lazy-load muộn nhưng bị loại.
    const expected = normalizeText(request);
    const userMessage = userMessages().reverse().find(node => {
      const id = node.getAttribute("data-message-id");
      const isNew = id ? !snapshot.ids.has(id) : !snapshot.nodes.has(node);
      const actual = normalizeText(node.innerText);
      const promptPrefix = expected.slice(0, Math.min(120, expected.length));
      return isNew && (actual.includes(expected) || actual.includes(promptPrefix));
    });
    if (!userMessage) return [];
    const main = document.querySelector("main");
    if (!main) return [];
    return resultImages(main).filter(img =>
      Boolean(userMessage.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_FOLLOWING));
  }
  function resultImages(root = document.querySelector("main")) {
    // Kết quả ảnh của ChatGPT có thể nằm trong wrapper khác nhau giữa các phiên bản UI.
    // Không dùng boundingClientRect ở đây: Chrome có thể trả kích thước bằng 0
    // cho nội dung chưa được vẽ của tab nền dù ảnh đã tải xong trong DOM.
    // Giới hạn vào assistant message hiện tại, loại node ẩn và avatar/icon.
    return [...(root?.querySelectorAll("img") || [])].filter(img => {
      if (!img.isConnected || img.closest('[hidden],[aria-hidden="true"],[inert]') || !img.complete ||
          img.naturalWidth < 256 || img.naturalHeight < 256) return false;
      const style = getComputedStyle(img);
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0;
    });
  }
  function generating() {
    const stop = document.querySelector('[data-testid="stop-button"],button[aria-label*="Stop generating" i]');
    return visible(stop);
  }
  async function runOne(message, job, report) {
    if (typeof message.prompt !== "string" || !message.prompt.trim() || message.prompt.length > 10000 ||
        !Number.isInteger(message.index) || message.index < 1 || message.index > 500 ||
        !Number.isFinite(message.timeout) || message.timeout < 30 || message.timeout > 900) fail("INVALID");
    const editor = composer();
    const priorUserMessages = userSnapshot();
    report("typing");
    const request = `Số thứ tự: ${message.index}. Chỉ dùng số này để đối chiếu thứ tự; không đưa chữ hoặc số này vào hình ảnh.\n\nTạo một hình ảnh dựa trên prompt sau. Chỉ tạo một ảnh.\n\n${message.prompt}`;
    await fill(editor, request, job);
    check(job);
    sendButton().click(); // Một lần gửi theo thao tác Bắt đầu của người dùng.
    report("generating");
    const deadline = Date.now() + message.timeout * 1000;
    let candidate = "", stableSince = 0;
    while (Date.now() < deadline) {
      check(job);
      const fresh = [...new Set(assistantImagesAfterRequest(request, priorUserMessages).map(img => img.currentSrc || img.src))].filter(Boolean);
      if (fresh.length > 1) fail("GPT_MULTIPLE_IMAGES");
      if (fresh.length === 1 && !generating()) {
        if (candidate !== fresh[0]) { candidate = fresh[0]; stableSince = Date.now(); }
        if (Date.now() - stableSince >= 1800) {
          let url;
          try { url = new URL(candidate, location.href); } catch { fail("GPT_IMAGE_URL"); }
          if (!FlowUtils.isChatGPTMediaUrl(url.href)) fail("GPT_IMAGE_URL");
          const ext = /\.(jpe?g|webp)(?:$|[?#])/i.exec(url.pathname)?.[1]?.toLowerCase() || "png";
          return { downloadUrl: url.href, extension: ext === "jpeg" ? "jpg" : ext };
        }
      } else { candidate = ""; stableSince = 0; }
      await waitForPageChange(1200, job);
    }
    fail("GPT_TIMEOUT");
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!trusted(sender) || message?.type !== "CHATGPT_PING") return;
    try { respond({ ok: true, hasInput: Boolean(composer()) }); }
    catch { respond({ ok: false, hasInput: false }); }
  });
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== "chatgpt-batch-work" || !trusted(port.sender) || location.origin !== "https://chatgpt.com") { port.disconnect(); return; }
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
