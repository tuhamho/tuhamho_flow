// Kiểm thử bằng Chrome riêng với DOM/API mô phỏng, không truy cập tài khoản Flow.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
let browser;
const passed = [];
async function check(name, fn) { await fn(); passed.push(name); console.log('PASS', name); }
async function contentPage(mode = 'success') {
  const page = await browser.newPage();
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><main><form><textarea aria-label="Prompt"></textarea><button type="button" aria-label="Generate" disabled>Generate</button></form><section id="results"></section></main>' }));
  await page.goto('https://flow.google.com/project/test');
  await page.evaluate(({ mode }) => {
    // Hàm event nhỏ được tái tạo bởi Playwright trong fixture, không thuộc extension.
    const makeEvent = () => {
      const listeners = new Set();
      return { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn), emit: (...args) => [...listeners].forEach(fn => fn(...args)) };
    };
    globalThis.chrome = { runtime: { id: 'test', getURL: file => `chrome-extension://test/${file}`, onMessage: makeEvent(), onConnect: makeEvent() } };
    globalThis.results = []; globalThis.clicks = 0;
    globalThis.port = { name: 'flow-batch-work', sender: { id: 'test', url: 'chrome-extension://test/sidepanel.html' }, onMessage: makeEvent(), onDisconnect: makeEvent(), postMessage: msg => results.push(msg), disconnect() { this.onDisconnect.emit(); } };
    const input = document.querySelector('textarea'), button = document.querySelector('button');
    if (mode === 'editable') {
      const editor = document.createElement('div'); editor.contentEditable = 'true'; editor.setAttribute('role', 'textbox'); editor.setAttribute('aria-label', 'Prompt'); editor.style.cssText = 'width:300px;height:100px;border:1px solid'; input.replaceWith(editor);
    }
    document.querySelector('form').addEventListener('input', () => { button.disabled = false; });
    if (mode === 'missing-button') button.remove();
    if (mode === 'ambiguous-input') { const second = input.cloneNode(); document.querySelector('form').append(second); }
    button.addEventListener('click', () => {
      clicks++;
      if (['video-ready', 'video-external', 'video-google', 'video-blob', 'video-pending', 'video-transient'].includes(mode)) {
        const anchor = document.createElement('a');
        anchor.download = 'clip.mp4';
        anchor.href = mode === 'video-ready' ? 'data:video/mp4;base64,AAAA' :
          mode === 'video-blob' ? URL.createObjectURL(new Blob(['local video'], { type: 'video/mp4' })) :
          mode === 'video-pending' ? 'data:video/mp4;base64,AAAA' :
          mode === 'video-transient' ? 'blob:https://flow.google.com/nonexistent' :
          mode === 'video-google' ? 'https://storage.googleapis.com/flow-result.mp4' :
          'https://cdn.example.test/clip.mp4';
        anchor.textContent = 'Tải video'; document.querySelector('#results').append(anchor);
        if (mode === 'video-pending') {
          const progress = document.createElement('span'); progress.textContent = '0%';
          document.querySelector('#results').append(progress);
          setTimeout(() => { progress.textContent = '100%'; }, 3500);
        }
        if (mode === 'video-transient') {
          setTimeout(() => { anchor.href = 'data:video/mp4;base64,AAAA'; }, 4200);
        }
        return;
      }
      if (['waiting', 'stop-waiting'].includes(mode)) return;
      for (let i = 0; i < (mode === 'multiple' ? 2 : 1); i++) {
        const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = i ? 'blue' : 'green'; ctx.fillRect(0, 0, 512, 512);
        const img = document.createElement('img'); img.src = canvas.toDataURL(); img.style.width = '300px';
        if (mode === 'cors-google' || mode === 'cors-googleapis' || mode === 'cors-evil') {
          Object.defineProperty(img, 'currentSrc', { get: () => mode === 'cors-google'
            ? 'https://lh3.googleusercontent.com/flow-result.png'
            : mode === 'cors-googleapis' ? 'https://aisandbox-pa.googleapis.com/v1/media/flow-result.png'
            : 'https://example.test/flow-result.png' });
        }
        if (mode === 'poster') {
          const article = document.createElement('article'); article.append(img, document.createElement('video'));
          document.querySelector('#results').append(article);
        } else document.querySelector('#results').append(img);
      }
    });
  }, { mode });
  await page.addScriptTag({ path: path.join(root, 'content.js') });
  await page.evaluate(() => chrome.runtime.onConnect.emit(port));
  return page;
}
async function chatgptPage(mode = 'success') {
  const page = await browser.newPage();
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><main><form><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button" aria-label="Send prompt" disabled>Send</button></form><div data-message-author-role="assistant"></div></main>' }));
  await page.goto('https://chatgpt.com/c/fixture');
  await page.evaluate(({ mode }) => {
    const makeEvent = () => { const listeners = new Set(); return { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn), emit: (...args) => [...listeners].forEach(fn => fn(...args)) }; };
    globalThis.chrome = { runtime: { id: 'test', getURL: file => `chrome-extension://test/${file}`, onConnect: makeEvent(), onMessage: makeEvent() } };
    globalThis.FlowUtils = { isChatGPTMediaUrl: value => { try { const u = new URL(value); return u.protocol === 'https:' && ['chatgpt.com','openai.com','oaiusercontent.com','oaistatic.com'].some(d => u.hostname === d || u.hostname.endsWith(`.${d}`)); } catch { return false; } } };
    window.results = []; globalThis.port = { name: 'chatgpt-batch-work', sender: { id: 'test', url: 'chrome-extension://test/sidepanel.html' }, onMessage: makeEvent(), onDisconnect: makeEvent(), postMessage: msg => window.results.push(msg), disconnect() { this.onDisconnect.emit(); } };
    let input = document.querySelector('textarea');
    if (mode === 'formatted') {
      const editor = document.createElement('div'); editor.id = 'prompt-textarea'; editor.contentEditable = 'true'; editor.style.cssText = 'width:400px;height:100px'; input.replaceWith(editor); input = editor;
    }
    const button = document.querySelector('button');
    input.addEventListener('input', () => { button.disabled = false; });
    button.addEventListener('click', () => {
      if (mode === 'navigate') history.pushState({}, '', '/c/local-chatgpt%3Agenerated');
      if (mode === 'mismatch') {
        const userMessage = document.createElement('div'); userMessage.setAttribute('data-message-author-role', 'user');
        userMessage.textContent = 'Nội dung đã được giao diện chuyển đổi'; document.querySelector('main').append(userMessage);
      }
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
      canvas.getContext('2d').fillRect(0, 0, 512, 512);
      const img = document.createElement('img'); img.src = canvas.toDataURL(); img.style.width = '300px';
      Object.defineProperty(img, 'currentSrc', { get: () => mode === 'evil' ? 'https://example.test/image.png' : 'https://chatgpt.com/backend-api/estuary/content?id=fresh.png' });
      const message = document.createElement('div');
      if (mode !== 'missing-roles') message.setAttribute('data-message-author-role', 'assistant');
      message.append(img); document.querySelector('main').append(message);
    });
  }, { mode });
  await page.addScriptTag({ path: path.join(root, 'shared.js') });
  await page.addScriptTag({ path: path.join(root, 'chatgpt.js') });
  await page.evaluate(() => chrome.runtime.onConnect.emit(port));
  return page;
}
async function runContent(page, timeout = 30, mediaType = 'image') {
  await page.evaluate(({ timeout, mediaType }) => port.onMessage.emit({ type: 'RUN', id: 'one', prompt: 'Một khu vườn <b>an toàn</b>', timeout, mediaType }), { timeout, mediaType });
}
async function result(page) {
  await page.waitForFunction(() => results.some(item => item.type === 'RESULT'), null, { timeout: 15000 });
  return page.evaluate(() => results.find(item => item.type === 'RESULT'));
}
async function panelPage() {
  const page = await browser.newPage({ viewport: { width: 390, height: 1080 } });
  await page.route('**/*', route => {
    const filename = new URL(route.request().url()).pathname.slice(1) || 'sidepanel.html';
    if (!['sidepanel.html', 'sidepanel.css', 'sidepanel.js', 'shared.js'].includes(filename)) return route.abort();
    route.fulfill({ contentType: filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(path.join(root, filename)) });
  });
  await page.addInitScript(({ png }) => {
    const event = () => {
      const listeners = new Set();
      return { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn), emit: (...args) => [...listeners].forEach(fn => fn(...args)) };
    };
    globalThis.mock = { runs: [], downloads: [], cancels: [], values: {}, mode: 'success', ports: [], chatgpt: false };
    const port = name => {
      const instance = { onMessage: event(), onDisconnect: event(),
        postMessage(msg) {
          if (msg.type === 'ACQUIRE') setTimeout(() => this.onMessage.emit({ type: 'LOCK', ok: true }), 0);
          if (msg.type === 'RUN') {
            mock.runs.push(msg);
            setTimeout(() => this.onMessage.emit({ type: 'PHASE', id: msg.id, phase: 'generating' }), 5);
            if (mock.mode !== 'waiting') setTimeout(() => this.onMessage.emit({ type: 'RESULT', id: msg.id, ok: true,
              ...(mock.mode === 'direct-image' || mock.mode === 'direct-html' ? { downloadUrl: 'https://lh3.googleusercontent.com/flow-result.png' } :
                mock.mode === 'direct-video' ? { downloadUrl: 'https://storage.googleapis.com/flow-result.mp4' } :
                mock.mode === 'direct-evil' ? { downloadUrl: 'https://example.test/flow-result.png' } :
                mock.mode === 'direct-chatgpt' ? { downloadUrl: 'https://chatgpt.com/backend-api/estuary/content?id=generated.png' } :
                { dataUrl: msg.mediaType === 'video' ? 'data:video/mp4;base64,AAAA' : png }),
              extension: msg.mediaType === 'video' ? 'mp4' : 'png' }), 40);
          }
        }, disconnect() { this.onDisconnect.emit(); }
      }; mock.ports.push(instance); return instance;
    };
    globalThis.chrome = {
      runtime: { connect: () => port('lock') },
      storage: { local: { get: async () => mock.values, set: async value => { Object.assign(mock.values, value); }, remove: async key => { delete mock.values[key]; } } },
      tabs: { query: async () => mock.chatgpt ? [{ id: 8, url: 'https://chatgpt.com/c/test', active: true }] : [{ id: 7, url: 'https://flow.google.com/project/test', active: true }], get: async id => ({ id, url: mock.chatgpt ? 'https://chatgpt.com/c/test' : 'https://flow.google.com/project/test' }), sendMessage: async () => ({ ok: true, hasInput: true }), connect: () => port('content'), onRemoved: event(), onUpdated: event() },
      downloads: { onChanged: event(), download: async options => { mock.downloads.push(options); return mock.downloads.length; },
        search: async ({ id }) => [{ id, state: mock.mode === 'download-wait' ? 'in_progress' : mock.mode === 'download-error' ? 'interrupted' : 'complete',
          mime: mock.mode === 'direct-html' ? 'text/html' : mock.mode === 'direct-video' ? 'video/mp4' : 'image/png',
          finalUrl: mock.mode === 'direct-chatgpt' ? 'https://chatgpt.com/backend-api/estuary/content?id=generated.png' : mock.mode === 'direct-html' ? 'https://lh3.googleusercontent.com/flow-result.png' : undefined }],
        cancel: async id => { mock.cancels.push(id); }
      }
    };
  }, { png });
  await page.goto('https://panel.test/sidepanel.html');
  await page.waitForFunction(() => !document.querySelector('#start').disabled && document.querySelector('#flowTab').value === '7');
  await page.locator('#delayMin').fill('0'); await page.locator('#delayMax').fill('0');
  return page;
}
(async () => {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
  await check('ChatGPT: gửi prompt một lần, nhận URL ảnh mới từ câu trả lời', async () => {
    const page = await chatgptPage();
    await page.evaluate(() => port.onMessage.emit({ type: 'RUN', id: 'gpt', prompt: 'Một chú mèo màu xanh', timeout: 30, mediaType: 'image' }));
    await page.waitForFunction(() => window.results?.some(item => item.type === 'RESULT'));
    const response = await page.evaluate(() => window.results?.find(item => item.type === 'RESULT'));
    assert.equal(response.ok, true); assert.equal(response.extension, 'png'); assert.match(response.downloadUrl, /^https:\/\/chatgpt\.com\/backend-api\//);
    assert.match(await page.locator('#prompt-textarea').inputValue(), /Tạo một hình ảnh dựa trên prompt sau/); await page.close();
  });
  await check('ChatGPT: chấp nhận xuống dòng được hiển thị thành khoảng trắng trong composer', async () => {
    const page = await chatgptPage('formatted');
    await page.evaluate(() => port.onMessage.emit({ type: 'RUN', id: 'gpt-formatted', prompt: 'Một chú mèo màu xanh', timeout: 30, mediaType: 'image' }));
    await page.waitForFunction(() => window.results?.some(item => item.type === 'RESULT'));
    const response = await page.evaluate(() => window.results?.find(item => item.type === 'RESULT'));
    assert.equal(response.ok, true); await page.close();
  });
  await check('ChatGPT: tiếp tục chờ ảnh sau khi tạo chat mới đổi URL nội bộ', async () => {
    const page = await chatgptPage('navigate');
    await page.evaluate(() => port.onMessage.emit({ type: 'RUN', id: 'gpt-nav', prompt: 'Một chú mèo màu xanh', timeout: 30, mediaType: 'image' }));
    await page.waitForFunction(() => window.results?.some(item => item.type === 'RESULT'));
    const response = await page.evaluate(() => window.results?.find(item => item.type === 'RESULT'));
    assert.equal(response.ok, true); assert.match(await page.evaluate(() => location.pathname), /^\/c\/local-chatgpt/); await page.close();
  });
  await check('ChatGPT: vẫn nhận ảnh mới khi giao diện biến đổi nội dung tin nhắn user', async () => {
    const page = await chatgptPage('mismatch');
    await page.evaluate(() => port.onMessage.emit({ type: 'RUN', id: 'gpt-mismatch', prompt: 'Một chú mèo màu xanh', timeout: 30, mediaType: 'image' }));
    await page.waitForFunction(() => window.results?.some(item => item.type === 'RESULT'));
    const response = await page.evaluate(() => window.results?.find(item => item.type === 'RESULT'));
    assert.equal(response.ok, true); assert.match(response.downloadUrl, /^https:\/\/chatgpt\.com\/backend-api\//); await page.close();
  });
  await check('ChatGPT: nhận ảnh mới khi giao diện bỏ thuộc tính role của tin nhắn', async () => {
    const page = await chatgptPage('missing-roles');
    await page.evaluate(() => port.onMessage.emit({ type: 'RUN', id: 'gpt-no-roles', prompt: 'Một chú mèo màu xanh', timeout: 30, mediaType: 'image' }));
    await page.waitForFunction(() => window.results?.some(item => item.type === 'RESULT'));
    const response = await page.evaluate(() => window.results?.find(item => item.type === 'RESULT'));
    assert.equal(response.ok, true); assert.match(response.downloadUrl, /^https:\/\/chatgpt\.com\/backend-api\//); await page.close();
  });
  await check('DOM textarea → một click → PNG', async () => {
    const page = await contentPage(); await runContent(page); const response = await result(page);
    assert.equal(response.ok, true); assert.match(response.dataUrl, /^data:image\/png;base64,/); assert.equal(await page.evaluate(() => clicks), 1); await page.close();
  });
  await check('DOM contenteditable dự phòng insertText', async () => {
    const page = await contentPage('editable'); await runContent(page); assert.equal((await result(page)).ok, true); await page.close();
  });
  await check('Dừng trong lúc nhập: không bấm tạo', async () => {
    const page = await contentPage(); await runContent(page); await page.evaluate(() => port.onMessage.emit({ type: 'STOP' }));
    assert.equal((await result(page)).code, 'STOPPED'); assert.equal(await page.evaluate(() => clicks), 0); await page.close();
  });
  for (const [mode, code] of [['ambiguous-input', 'INPUT_AMBIGUOUS'], ['missing-button', 'NO_BUTTON'], ['multiple', 'MULTIPLE_IMAGES']]) {
    await check(`Dừng rõ ràng: ${code}`, async () => {
      const page = await contentPage(mode); await runContent(page); assert.equal((await result(page)).code, code); await page.close();
    });
  }
  await check('Đóng cổng trong lúc chờ: không trả ảnh', async () => {
    const page = await contentPage('stop-waiting'); await runContent(page);
    await page.waitForFunction(() => clicks === 1); await page.evaluate(() => port.disconnect());
    await page.waitForTimeout(150); assert.equal(await page.evaluate(() => results.some(item => item.type === 'RESULT')), false); await page.close();
  });
  await check('PNG bị CORS: lỗi an toàn, không gọi mạng để né', async () => {
    const page = await contentPage(); await runContent(page);
    await page.waitForFunction(() => clicks === 1);
    await page.evaluate(() => { HTMLCanvasElement.prototype.toDataURL = () => { throw new DOMException('Blocked', 'SecurityError'); }; });
    assert.equal((await result(page)).code, 'IMAGE_CORS'); await page.close();
  });
  await check('Ảnh Google CDN bị CORS: trả URL đúng ảnh mới để Chrome tự tải', async () => {
    const page = await contentPage('cors-google'); await runContent(page);
    await page.waitForFunction(() => clicks === 1);
    await page.evaluate(() => { HTMLCanvasElement.prototype.toDataURL = () => { throw new DOMException('Blocked', 'SecurityError'); }; });
    const response = await result(page);
    assert.equal(response.ok, true); assert.equal(response.downloadUrl, 'https://lh3.googleusercontent.com/flow-result.png');
    assert.equal(response.extension, 'png'); assert.equal(await page.evaluate(() => clicks), 1); await page.close();
  });
  await check('Ảnh Flow trên Google APIs bị CORS: cho phép Chrome tự tải đúng URL mới', async () => {
    const page = await contentPage('cors-googleapis'); await runContent(page);
    await page.waitForFunction(() => clicks === 1);
    await page.evaluate(() => { HTMLCanvasElement.prototype.toDataURL = () => { throw new DOMException('Blocked', 'SecurityError'); }; });
    const response = await result(page);
    assert.equal(response.ok, true); assert.match(response.downloadUrl, /^https:\/\/aisandbox-pa\.googleapis\.com\//);
    assert.equal(response.extension, 'png'); await page.close();
  });
  await check('Ảnh ngoài Google bị CORS: không tải URL lạ', async () => {
    const page = await contentPage('cors-evil'); await runContent(page);
    await page.waitForFunction(() => clicks === 1);
    await page.evaluate(() => { HTMLCanvasElement.prototype.toDataURL = () => { throw new DOMException('Blocked', 'SecurityError'); }; });
    assert.equal((await result(page)).code, 'IMAGE_CORS'); await page.close();
  });
  await check('Chọn Ảnh nhưng Flow trả thumbnail video: báo sai chế độ trước khi xuất PNG', async () => {
    const page = await contentPage('poster'); await runContent(page);
    assert.equal((await result(page)).code, 'VIDEO_RESULT'); await page.close();
  });
  await check('Video đang xếp hàng: thumbnail không bị tính là hoàn thành', async () => {
    const page = await contentPage(); await runContent(page, 30, 'video');
    await page.waitForFunction(() => clicks === 1 && document.querySelectorAll('#results img').length === 1);
    await page.waitForTimeout(2300);
    assert.equal(await page.evaluate(() => results.some(item => item.type === 'RESULT')), false);
    await page.evaluate(() => port.onMessage.emit({ type: 'STOP' }));
    assert.equal((await result(page)).code, 'STOPPED'); await page.close();
  });
  await check('Video MP4 cùng trang: trả về đúng tệp video', async () => {
    const page = await contentPage('video-ready'); await runContent(page, 30, 'video');
    const response = await result(page);
    assert.equal(response.ok, true); assert.equal(response.extension, 'mp4');
    assert.match(response.dataUrl, /^data:video\/mp4;base64,/); await page.close();
  });
  await check('Video blob cục bộ của Flow: xuất đúng MP4', async () => {
    const page = await contentPage('video-blob'); await runContent(page, 30, 'video');
    const response = await result(page);
    assert.equal(response.ok, true); assert.equal(response.extension, 'mp4');
    assert.match(response.dataUrl, /^data:video\/mp4;base64,/); await page.close();
  });
  await check('Video 0% chưa tải: chờ hoàn tất, không gửi lại prompt', async () => {
    const page = await contentPage('video-pending'); await runContent(page, 30, 'video');
    await page.waitForFunction(() => clicks === 1);
    await page.waitForTimeout(2400);
    assert.equal(await page.evaluate(() => results.some(item => item.type === 'RESULT')), false);
    const response = await result(page);
    assert.equal(response.ok, true); assert.equal(await page.evaluate(() => clicks), 1); await page.close();
  });
  await check('Nguồn video tạm lỗi: chờ nguồn mới, không gửi lại prompt', async () => {
    const page = await contentPage('video-transient'); await runContent(page, 30, 'video');
    const response = await result(page);
    assert.equal(response.ok, true); assert.equal(response.extension, 'mp4');
    assert.equal(await page.evaluate(() => clicks), 1); await page.close();
  });
  await check('Video ở link ngoài: báo lỗi riêng, không tải link tùy ý', async () => {
    const page = await contentPage('video-external'); await runContent(page, 30, 'video');
    assert.equal((await result(page)).code, 'VIDEO_SOURCE_EXTERNAL'); await page.close();
  });
  await check('Video từ Google CDN: trả URL để Chrome tự tải', async () => {
    const page = await contentPage('video-google'); await runContent(page, 30, 'video');
    const response = await result(page);
    assert.equal(response.ok, true); assert.equal(response.downloadUrl, 'https://storage.googleapis.com/flow-result.mp4');
    assert.equal(response.extension, 'mp4'); await page.close();
  });
  await check('Panel tự tải URL ảnh Google CDN vào đúng thư mục', async () => {
    const page = await panelPage(); await page.evaluate(() => { mock.mode = 'direct-image'; });
    await page.locator('#folder').fill('anh-flow'); await page.locator('#prompts').fill('Ảnh tĩnh');
    await page.locator('#start').click();
    await page.waitForFunction(() => document.querySelector('#progress').textContent === '1 / 1 hoàn thành');
    const saved = await page.evaluate(() => mock.downloads[0]);
    assert.equal(saved.url, 'https://lh3.googleusercontent.com/flow-result.png');
    assert.match(saved.filename, /^anh-flow\/001_anh-.*\.png$/); await page.close();
  });
  await check('Panel chọn ChatGPT, tự tải ảnh vào thư mục đã chọn', async () => {
    const page = await panelPage();
    await page.evaluate(() => { mock.chatgpt = true; mock.mode = 'direct-chatgpt'; });
    await page.locator('#provider').selectOption('chatgpt');
    await page.waitForFunction(() => document.querySelector('#flowTab').value === '8');
    await page.locator('#folder').fill('anh-chatgpt'); await page.locator('#prompts').fill('Một chú mèo màu xanh');
    await page.locator('#start').click();
    await page.waitForFunction(() => mock.runs.length === 1);
    await page.evaluate(() => chrome.tabs.onUpdated.emit(8, { url: 'https://chatgpt.com/c/local-chatgpt%3Agenerated' }));
    await page.waitForFunction(() => document.querySelector('#progress').textContent === '1 / 1 hoàn thành');
    const data = await page.evaluate(() => ({ run: mock.runs[0], download: mock.downloads[0], saved: mock.values.settings.provider }));
    assert.equal(data.run.prompt, 'Một chú mèo màu xanh'); assert.equal(data.saved, 'chatgpt');
    assert.match(data.download.url, /^https:\/\/chatgpt\.com\/backend-api\//);
    assert.match(data.download.filename, /^anh-chatgpt\/001_anh-/); await page.close();
  });
  await check('Panel tự tải URL video Google CDN vào đúng thư mục', async () => {
    const page = await panelPage(); await page.evaluate(() => { mock.mode = 'direct-video'; });
    await page.locator('#mediaType').selectOption('video'); await page.locator('#prompts').fill('Video ngắn');
    await page.locator('#start').click();
    await page.waitForFunction(() => document.querySelector('#progress').textContent === '1 / 1 hoàn thành');
    const saved = await page.evaluate(() => mock.downloads[0]);
    assert.equal(saved.url, 'https://storage.googleapis.com/flow-result.mp4');
    assert.match(saved.filename, /\.mp4$/); await page.close();
  });
  await check('Panel từ chối URL tệp ngoài Google', async () => {
    const page = await panelPage(); await page.evaluate(() => { mock.mode = 'direct-evil'; });
    await page.locator('#prompts').fill('Ảnh tĩnh'); await page.locator('#start').click();
    await page.waitForFunction(() => !document.querySelector('#error').hidden);
    assert.equal(await page.evaluate(() => mock.downloads.length), 0); await page.close();
  });
  await check('Panel không đánh dấu xong nếu CDN trả trang HTML', async () => {
    const page = await panelPage(); await page.evaluate(() => { mock.mode = 'direct-html'; });
    await page.locator('#prompts').fill('Ảnh tĩnh'); await page.locator('#start').click();
    await page.waitForFunction(() => !document.querySelector('#error').hidden);
    assert.match(await page.locator('#error').textContent(), /sai định dạng/);
    assert.equal(await page.locator('#progress').textContent(), '0 / 1 hoàn thành'); await page.close();
  });
  await check('Panel hai prompt tuần tự, tên sạch, nội dung HTML không thực thi', async () => {
    const page = await panelPage(); await page.locator('#prompts').fill('<img src=x onerror=alert(1)>\nMột bức tranh');
    await page.locator('#folder').fill('../CON'); await page.locator('#start').click();
    await page.waitForFunction(() => document.querySelector('#progress').textContent === '2 / 2 hoàn thành');
    const data = await page.evaluate(() => ({ runs: mock.runs.length, files: mock.downloads.map(item => item.filename), injected: document.querySelector('#queue img'), settings: mock.values.settings }));
    assert.equal(data.runs, 2); assert.equal(data.injected, null); assert.equal(data.files[0].split('/').length, 2);
    assert.match(data.files[0], /001_anh-/); assert.match(data.files[1], /002_anh-/); assert.equal(data.settings.prompts.includes('<img'), true);
    fs.mkdirSync(path.join(__dirname, 'artifacts'), { recursive: true });
    await page.screenshot({ path: path.join(__dirname, 'artifacts', 'sidepanel.png'), fullPage: true }); await page.close();
  });
  await check('Panel chọn video: tải MP4 vào thư mục người dùng nhập', async () => {
    const page = await panelPage(); await page.locator('#mediaType').selectOption('video');
    await page.locator('#folder').fill('clip-cua-toi'); await page.locator('#prompts').fill('Một video ngắn');
    await page.locator('#start').click();
    await page.waitForFunction(() => document.querySelector('#progress').textContent === '1 / 1 hoàn thành');
    const saved = await page.evaluate(() => ({ filename: mock.downloads[0].filename, url: mock.downloads[0].url, mediaType: mock.runs[0].mediaType }));
    assert.equal(saved.mediaType, 'video'); assert.match(saved.filename, /^clip-cua-toi\/001_video-.*\.mp4$/);
    assert.match(saved.url, /^data:video\/mp4;base64,/); await page.close();
  });
  await check('Panel dừng khi chờ: không gửi prompt kế, không tải', async () => {
    const page = await panelPage(); await page.evaluate(() => { mock.mode = 'waiting'; });
    await page.locator('#prompts').fill('một\nhai'); await page.locator('#start').click();
    await page.waitForFunction(() => mock.runs.length === 1); await page.locator('#stop').click();
    await page.waitForFunction(() => !document.querySelector('#start').disabled);
    assert.deepEqual(await page.evaluate(() => [mock.runs.length, mock.downloads.length]), [1, 0]); await page.close();
  });
  await check('Panel chỉ hoàn thành khi download complete; Dừng hủy đúng ID', async () => {
    const page = await panelPage(); await page.evaluate(() => { mock.mode = 'download-wait'; });
    await page.locator('#prompts').fill('một\nhai'); await page.locator('#start').click();
    await page.waitForFunction(() => mock.downloads.length === 1);
    assert.equal(await page.locator('#progress').textContent(), '0 / 2 hoàn thành'); await page.locator('#stop').click();
    await page.waitForFunction(() => !document.querySelector('#start').disabled);
    assert.deepEqual(await page.evaluate(() => mock.cancels), [1]); assert.equal(await page.evaluate(() => mock.runs.length), 1); await page.close();
  });
  await check('Download interrupted dừng cả hàng đợi', async () => {
    const page = await panelPage(); await page.evaluate(() => { mock.mode = 'download-error'; });
    await page.locator('#prompts').fill('một\nhai'); await page.locator('#start').click();
    await page.waitForFunction(() => !document.querySelector('#error').hidden);
    assert.equal(await page.evaluate(() => mock.runs.length), 1); assert.equal(await page.locator('#progress').textContent(), '0 / 2 hoàn thành'); await page.close();
  });
  await check('Tab đóng: dừng hàng đợi', async () => {
    const page = await panelPage(); await page.evaluate(() => { mock.mode = 'waiting'; });
    await page.locator('#prompts').fill('một\nhai'); await page.locator('#start').click();
    await page.waitForFunction(() => mock.runs.length === 1); await page.evaluate(() => chrome.tabs.onRemoved.emit(7));
    await page.waitForFunction(() => !document.querySelector('#start').disabled);
    assert.match(await page.locator('#error').textContent(), /đã bị đóng/); assert.equal(await page.evaluate(() => mock.runs.length), 1); await page.close();
  });
  await check('Dừng trong khoảng nghỉ: không gửi prompt kế tiếp', async () => {
    const page = await panelPage(); await page.locator('#delayMin').fill('5'); await page.locator('#delayMax').fill('5');
    await page.locator('#prompts').fill('một\nhai'); await page.locator('#start').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Nghỉ'));
    await page.locator('#stop').click(); await page.waitForFunction(() => !document.querySelector('#start').disabled);
    assert.equal(await page.evaluate(() => mock.runs.length), 1); await page.close();
  });
  await check('Hết thời gian chờ: không thử gửi lại', async () => {
    const page = await contentPage('waiting'); await runContent(page);
    await page.waitForFunction(() => clicks === 1);
    await page.waitForFunction(() => results.some(item => item.type === 'RESULT'), null, { timeout: 35000 });
    assert.equal((await result(page)).code, 'TIMEOUT'); assert.equal(await page.evaluate(() => clicks), 1); await page.close();
  });
  console.log(`${passed.length} browser scenarios passed. Mô phỏng, chưa kiểm thử Flow thực tế.`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); });
