"use strict";

// MV3 service workers cannot create object URLs. This hidden extension document
// fetches the password-protected result and owns its Blob URL until Downloads finishes.
const activeDownloads = new Map();
const trusted = sender => sender?.id === chrome.runtime.id && sender?.url === chrome.runtime.getURL("muse-offscreen.html");

function waitForDownload(id, operation) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = error => {
      if (settled) return; settled = true; clearTimeout(timer); chrome.downloads.onChanged.removeListener(onChanged);
      operation.downloadId = null; error ? reject(error) : resolve();
    };
    const onChanged = delta => {
      if (delta.id !== id) return;
      if (delta.state?.current === "complete") finish();
      else if (delta.state?.current === "interrupted" || delta.error?.current) finish(new Error("Tải video Muse thất bại hoặc bị hủy."));
    };
    const timer = setTimeout(() => finish(new Error("Tải video Muse quá 30 phút.")), 1800000);
    operation.downloadId = id;
    chrome.downloads.onChanged.addListener(onChanged);
    chrome.downloads.search({ id }).then(files => {
      const file = files[0];
      if (!file) return finish(new Error("Không tìm thấy lượt tải video Muse."));
      if (file.state === "complete") finish();
      else if (file.state === "interrupted") finish(new Error("Tải video Muse thất bại hoặc bị hủy."));
    }).catch(() => finish(new Error("Không kiểm tra được trạng thái tải video Muse.")));
  });
}

async function downloadVideo(message, operation) {
  let base;
  try { base = new URL(message.baseUrl); } catch { throw new Error("Địa chỉ Muse API không hợp lệ."); }
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash ||
      typeof message.videoPath !== "string" || !/^\/results\/[A-Za-z0-9._~!$&'()+,;=@%/-]+\.mp4$/i.test(message.videoPath) ||
      message.videoPath.split("/").includes("..") || typeof message.password !== "string" || !message.password) {
    throw new Error("Thông tin tải video Muse không hợp lệ.");
  }
  const resultUrl = new URL(message.videoPath, base.origin);
  if (resultUrl.origin !== base.origin) throw new Error("URL video Muse không hợp lệ.");
  const response = await fetch(resultUrl.href, { headers: { "X-API-Password": message.password },
    credentials: "omit", redirect: "error", signal: operation.controller.signal });
  if (response.status === 401) throw new Error("Sai mật khẩu API, kiểm tra lại trong cài đặt.");
  if (!response.ok) throw new Error(`Muse API không tải được video (HTTP ${response.status}).`);
  const blob = await response.blob();
  if (!blob.size) throw new Error("Muse API trả về tệp video rỗng.");
  if (operation.controller.signal.aborted) throw new Error("Đã dừng theo yêu cầu.");
  const blobUrl = URL.createObjectURL(blob);
  try {
    const id = await chrome.downloads.download({ url: blobUrl, filename: message.filename, saveAs: false, conflictAction: "uniquify" });
    await waitForDownload(id, operation);
  } finally { URL.revokeObjectURL(blobUrl); }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!trusted(sender)) return false;
  if (message?.type === "MUSE_CANCEL_DOWNLOAD" && typeof message.requestId === "string") {
    const operation = activeDownloads.get(message.requestId);
    if (operation) {
      operation.controller.abort();
      if (operation.downloadId !== null) chrome.downloads.cancel(operation.downloadId).catch(() => {});
    }
    sendResponse({ ok: true }); return false;
  }
  if (message?.type !== "MUSE_DOWNLOAD_VIDEO" || typeof message.requestId !== "string" || message.requestId.length > 100) return false;
  const operation = { controller: new AbortController(), downloadId: null };
  activeDownloads.set(message.requestId, operation);
  downloadVideo(message, operation).then(() => sendResponse({ ok: true }))
    .catch(error => sendResponse({ ok: false, error: error?.message || "Không tải được video Muse." }))
    .finally(() => activeDownloads.delete(message.requestId));
  return true;
});
