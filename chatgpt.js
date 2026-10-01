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
  function generatedImageButtons(root = document.querySelector("main")) {
    return [...(root?.querySelectorAll('button,[role="button"]') || [])].filter(button => {
      const label = normalizeText([
        button.getAttribute("aria-label"), button.getAttribute("title"), button.textContent,
        ...[...button.querySelectorAll("img")].map(img => img.getAttribute("alt"))
      ].filter(Boolean).join(" "));
      return /(?:ảnh\s+(?:được|đã)\s+tạo|image\s+(?:generated|created)|(?:generated|created)\s+image)/i.test(label);
    });
  }
  function promptTurn(prompt, snapshot) {
    const currentMessages = userMessages();
    const isNewMessage = node => {
      const id = node.getAttribute("data-message-id");
      return id ? !snapshot.ids.has(id) : !snapshot.nodes.has(node);
    };
    const newMessages = currentMessages.filter(isNewMessage);
    const expected = normalizeText(prompt);
    const userMessage = [...newMessages].reverse().find(node => {
      const actual = normalizeText(node.innerText);
      const promptPrefix = expected.slice(0, Math.min(120, expected.length));
      return actual.includes(expected) || actual.includes(promptPrefix);
    }) || (newMessages.length === 1 ? newMessages[0] : null);
    const userIndex = userMessage ? currentMessages.indexOf(userMessage) : -1;
    return { userMessage, nextUserMessage: userIndex >= 0 ? currentMessages[userIndex + 1] || null : null };
  }
  function generatedVariantCount(prompt, snapshot) {
    const { userMessage, nextUserMessage } = promptTurn(prompt, snapshot);
    if (!userMessage) return 0;
    const controls = [...document.querySelectorAll('main button[aria-label],main [role="button"][aria-label]')]
      .filter(button => {
        const label = normalizeText(button.getAttribute("aria-label"));
        return /^(?:hiển thị ảnh đã tạo|show generated image)\s*\d+$/i.test(label) &&
          Boolean(userMessage.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING) &&
          (!nextUserMessage || Boolean(button.compareDocumentPosition(nextUserMessage) & Node.DOCUMENT_POSITION_FOLLOWING));
      });
    const indexes = new Set(controls.map(button => Number(/\d+$/.exec(button.getAttribute("aria-label"))?.[0])).filter(Number.isInteger));
    return indexes.size;
  }
  function userSnapshot() {
    const nodes = userMessages();
    const main = document.querySelector("main");
    return { nodes: new Set(nodes), ids: new Set(nodes.map(node => node.getAttribute("data-message-id")).filter(Boolean)),
      imageNodes: new Set(main?.querySelectorAll("img") || []),
      generatedButtons: new Set(generatedImageButtons(main)) };
  }
  function assistantImagesAfterPrompt(prompt, snapshot) {
    // Ghép ảnh với đúng tin nhắn mới gửi. Chỉ xét các ảnh nằm sau tin nhắn đó
    // trong main; ảnh lịch sử ở phía trên có thể lazy-load muộn nhưng bị loại.
    const { userMessage } = promptTurn(prompt, snapshot);
    const main = document.querySelector("main");
    if (!main) return [];
    const imgs = resultImages(main);
    // The accessibility tree exposes generated results as a button labelled
    // "Ảnh được tạo 1" even on ChatGPT layouts without message-role attributes.
    const freshResultButtons = generatedImageButtons(main).filter(button =>
      !snapshot.generatedButtons.has(button) && userMessage &&
      Boolean(userMessage.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING));
    const buttonImages = freshResultButtons.flatMap(button => resultImages(button));
    if (buttonImages.length) return buttonImages;
    if (userMessage) {
      const scoped = imgs.filter(img =>
        !snapshot.imageNodes.has(img) &&
        Boolean(userMessage.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_FOLLOWING));
      if (scoped.length) return scoped;
    }

    // Only new img elements qualify as fallback. A pre-existing image can finish
    // lazy-loading after submission and must never be attributed to this prompt.
    return imgs.filter(img => !snapshot.imageNodes.has(img));
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
      const isGenerating = generating();
      const freshImages = assistantImagesAfterPrompt(message.prompt, priorUserMessages)
        .filter(img => (img.currentSrc || img.src) && FlowUtils.isChatGPTMediaUrl(img.currentSrc || img.src));
      // ChatGPT may expose several URL variants/results in one response. Prefer the
      // largest newly-added image; on equal dimensions use the last item in DOM order.
      const selected = freshImages.reduce((best, img) => {
        const area = img.naturalWidth * img.naturalHeight;
        return !best || area >= best.naturalWidth * best.naturalHeight ? img : best;
      }, null);
      const fresh = selected ? selected.currentSrc || selected.src : "";
      // Ảnh phải là node/nút kết quả mới, sau prompt hiện tại. Dùng chính kết quả
      // mới làm tín hiệu hoàn tất vì trạng thái stop của ChatGPT có thể bị ẩn ở tab nền.
      if (fresh && !isGenerating) {
        if (candidate !== fresh) { candidate = fresh; stableSince = Date.now(); }
        if (Date.now() - stableSince >= 1800) {
          if (generatedVariantCount(message.prompt, priorUserMessages) > 1) fail("GPT_MULTIPLE_IMAGES");
          let url;
          try { url = new URL(candidate, location.href); } catch { fail("GPT_IMAGE_URL"); }
          if (!FlowUtils.isChatGPTMediaUrl(url.href)) fail("GPT_IMAGE_URL");
          const ext = /\.(jpe?g|webp)(?:$|[?#])/i.exec(url.pathname)?.[1]?.toLowerCase() || "png";
          const imageName = [selected.getAttribute("download"), selected.getAttribute("data-filename"),
            selected.getAttribute("alt"), selected.getAttribute("title")]
            .map(value => normalizeText(value)).find(value => value &&
              !/^(?:ảnh|image|ảnh được tạo|generated image|created image)(?:\s*\d+)?$/i.test(value)) || "";
          return { downloadUrl: url.href, extension: ext === "jpeg" ? "jpg" : ext, imageName };
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
