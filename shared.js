"use strict";

// Dùng chung trong panel và kiểm thử, không có thư viện hay mã từ xa.
globalThis.FlowUtils = (() => {
  const defaults = Object.freeze({ prompts: "", folder: "tuhamho_flow", filenameBase: "tuhamho", serial: true, startFrom: "", batchEvery: 10, delayMin: 5, delayMax: 15, timeout: 240, mediaType: "image", provider: "flow" });
  function isFlowUrl(value) {
    try {
      const url = new URL(value);
      return (url.origin === "https://labs.google" &&
        /^\/fx\/(?:[^/]+\/)?tools\/flow(?:\/|$)/.test(url.pathname)) ||
        (url.origin === "https://flow.google.com" && /^\/project\/[^/]+(?:\/|$)/.test(url.pathname));
    } catch { return false; }
  }
  function isFlowMediaUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password) return false;
      const host = url.hostname.toLowerCase();
      // Chỉ URL của hạ tầng Google dùng cho kết quả Flow, không nhận URL tùy ý.
      return host === "flow.google.com" || host === "labs.google" ||
        ["googleapis.com", "googleusercontent.com", "googlevideo.com", "gstatic.com", "ggpht.com"]
          .some(domain => host === domain || host.endsWith(`.${domain}`));
    } catch { return false; }
  }
  function isChatGPTUrl(value) {
    try { const url = new URL(value); return url.origin === "https://chatgpt.com"; }
    catch { return false; }
  }
  function isChatGPTMediaUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol === "blob:") return url.origin === "https://chatgpt.com";
      if (url.protocol !== "https:" || url.username || url.password) return false;
      const host = url.hostname.toLowerCase();
      return ["chatgpt.com", "openai.com", "oaiusercontent.com", "oaistatic.com"]
        .some(domain => host === domain || host.endsWith(`.${domain}`));
    } catch { return false; }
  }
  function safeSegment(value, fallback = "Flow") {
    let result = String(value).normalize("NFC")
      .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069<>:"/\\|?*]/g, "-")
      .replace(/\s+/g, " ").replace(/^[.\s]+|[.\s]+$/g, "");
    result = Array.from(result).slice(0, 70).join("").replace(/[.\s]+$/g, "");
    if (!result) result = fallback;
    if (/^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(result)) result = "_" + result;
    return result;
  }
  function parsePrompts(text) {
    return text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/).map(line => line.trim()).filter(Boolean);
  }
  function validate(settings) {
    if (typeof settings.prompts !== "string" || settings.prompts.length > 500000) {
      throw new Error("Danh sách prompt quá lớn (tối đa 500.000 ký tự).");
    }
    const prompts = parsePrompts(settings.prompts);
    if (!prompts.length) throw new Error("Hãy nhập ít nhất một prompt.");
    if (prompts.length > 500 || prompts.some(prompt => prompt.length > 10000)) {
      throw new Error("Tối đa 500 prompt, mỗi prompt tối đa 10.000 ký tự.");
    }
    const startFromText = String(settings.startFrom ?? "").trim();
    const startFrom = startFromText === "" ? null : Number(startFromText);
    if (startFrom !== null && (!Number.isInteger(startFrom) || startFrom < 1 || startFrom > prompts.length)) {
      throw new Error(`Prompt bắt đầu phải là số nguyên từ 1 đến ${prompts.length}, hoặc để trống để tự tiếp tục.`);
    }
    const batchEvery = Number(settings.batchEvery ?? defaults.batchEvery);
    if (!Number.isInteger(batchEvery) || batchEvery < 1 || batchEvery > 500) {
      throw new Error("Mốc dừng ChatGPT phải là số nguyên từ 1 đến 500.");
    }
    const min = Number(settings.delayMin), max = Number(settings.delayMax), timeout = Number(settings.timeout);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < min || max > 3600) {
      throw new Error("Khoảng nghỉ phải từ 0 đến 3.600 giây; mức tối đa phải lớn hơn hoặc bằng mức tối thiểu.");
    }
    if (!Number.isFinite(timeout) || timeout < 30 || timeout > 900) {
      throw new Error("Thời gian chờ ảnh phải từ 30 đến 900 giây.");
    }
    if (!["image", "video"].includes(settings.mediaType)) throw new Error("Loại kết quả phải là ảnh hoặc video.");
    const provider = settings.provider === "chatgpt" ? "chatgpt" : "flow";
    if (provider === "chatgpt" && settings.mediaType !== "image") throw new Error("ChatGPT hiện chỉ hỗ trợ tạo ảnh.");
    return { prompts, folder: safeSegment(settings.folder), filenameBase: safeSegment(settings.filenameBase || "tuhamho", "tuhamho"), serial: Boolean(settings.serial), startFrom, batchEvery, delayMin: min, delayMax: max, timeout, mediaType: settings.mediaType, provider };
  }
  function imageTitle(prompt, suggested = "") {
    const clean = value => String(value || "").replace(/\s+/g, " ").trim()
      .replace(/\.(?:png|jpe?g|webp)$/i, "");
    const generic = /^(?:ảnh|image|ảnh được tạo|generated image|created image)(?:\s*\d+)?$/i;
    let title = clean(suggested);
    if (title && !generic.test(title)) return safeSegment(title.slice(0, 72), "anh");

    // ChatGPT đôi khi chỉ gắn nhãn chung cho ảnh. Khi đó dùng phần mô tả cảnh
    // đầu tiên trong prompt, bỏ đoạn mở đầu chỉ nói về phong cách vẽ.
    title = clean(prompt).replace(/^\[\d{1,2}:\d{2}(?::\d{2})?\]\s*/, "")
      .replace(/^hand-drawn\s+2d\s+doodle\s+cartoon\s+animation,\s*flat\s+solid\s+colors,\s*bold\s+black\s+hand-drawn\s+outlines,\s*slightly\s+wobbly\s+imperfect\s+marker\s+lines,\s*/i, "")
      .replace(/^(?:a|an|the)\s+/i, "");
    title = clean(title.split(/[.;\n]/, 1)[0]).split(",", 1)[0];
    return safeSegment(title.slice(0, 72), "anh");
  }
  function filename(settings, index, batchId, extension = "png", title = "") {
    const safeExtension = ["png", "jpg", "jpeg", "webp", "mp4", "webm"].includes(extension) ? extension : "png";
    const prefix = settings.serial ? `${String(index + 1).padStart(3, "0")}_` : "";
    const unique = settings.serial ? "" : `-${safeSegment(batchId, "flow")}`;
    const name = title ? `${imageTitle("", title)}_${safeSegment(settings.filenameBase || "tuhamho", "tuhamho")}`
      : safeSegment(settings.filenameBase || "tuhamho", "tuhamho");
    return `${safeSegment(settings.folder)}/${prefix}${name}${unique}.${safeExtension}`;
  }
  return Object.freeze({ defaults, isFlowUrl, isFlowMediaUrl, isChatGPTUrl, isChatGPTMediaUrl, safeSegment, parsePrompts, validate, imageTitle, filename });
})();
