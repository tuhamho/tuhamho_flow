const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const event = () => {
  const listeners = new Set();
  return { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn), emit: (...args) => [...listeners].forEach(fn => fn(...args)) };
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 1080 } });
    await page.route('**/*', route => {
      const filename = new URL(route.request().url()).pathname.slice(1) || 'sidepanel.html';
      if (!['sidepanel.html', 'sidepanel.css', 'sidepanel.js', 'shared.js'].includes(filename)) return route.abort();
      route.fulfill({ contentType: filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(path.join(root, filename)) });
    });
    await page.addInitScript(() => {
      const event = () => {
        const listeners = new Set();
        return { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn), emit: (...args) => [...listeners].forEach(fn => fn(...args)) };
      };
      const runtimeMessages = event();
      globalThis.chrome = {
        runtime: { onMessage: runtimeMessages, connect: () => ({ onMessage: event(), onDisconnect: event(), postMessage() {}, disconnect() {} }),
          sendMessage: async message => message.type === 'MUSE_TEST_CONNECTION'
            ? { ok: true, status: 'Kết nối Muse API thành công · mật khẩu đúng.' }
            : message.type === 'MUSE_LIST_PROJECTS' ? { ok: true, projects: ['du_an_cao'] }
            : message.type === 'MUSE_CREATE_PROJECT' ? { ok: true, name: 'du_an_moi' }
            : message.type === 'MUSE_LIST_VIDEOS' ? { ok: true, videos: [{ id: 'vid-1', du_an: 'du_an_cao', title: 'Video demo', thumbPath: '/results/thumb.png', videoPath: '/results/clip.mp4' }] }
            : message.type === 'MUSE_GET_THUMBNAIL' ? { ok: true, dataUrl: 'data:image/png;base64,AA==' }
            : message.type === 'MUSE_MOVE_VIDEO' || message.type === 'MUSE_DOWNLOAD_LIBRARY_VIDEO' ? { ok: true }
            : { ok: true, running: false, state: null } },
        storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
        tabs: { query: async () => [{ id: 7, url: 'https://flow.google.com/project/test', active: true }], sendMessage: async () => ({ ok: true }),
          get: async id => ({ id, url: 'https://flow.google.com/project/test' }) },
        downloads: { onChanged: event(), download: async () => 1, search: async () => [{ state: 'complete' }], cancel: async () => {} }
      };
    });
    await page.goto('https://panel.test/sidepanel.html');
    await page.waitForFunction(() => !document.querySelector('#start').disabled);
    await page.locator('#provider').selectOption('muse');
    await page.locator('#prompts').fill('CẢNH 1:\nMở đầu có nhiều dòng\nchi tiết thêm\n\nCẢNH 2: Kết thúc');
    assert.equal(await page.locator('#count').textContent(), '2 prompt');
    assert.equal(await page.locator('#museSceneList textarea').count(), 2);
    assert.equal(await page.locator('#queue select').count(), 2);
    await page.locator('#queue select').nth(0).selectOption('du_an_cao');
    assert.equal(await page.locator('#queue select').nth(0).inputValue(), 'du_an_cao');
    await page.evaluate(() => { window.prompt = () => 'du_an_moi'; });
    await page.locator('#museCreateProject').click();
    assert.equal(await page.locator('#museProject').inputValue(), 'du_an_moi');
    assert.equal(await page.locator('#queue select').nth(0).inputValue(), 'du_an_cao');
    assert.equal(await page.locator('#museSceneList textarea').nth(0).inputValue(), 'Mở đầu có nhiều dòng\nchi tiết thêm');
    await page.locator('#museSceneList textarea').nth(1).fill('Kết thúc đã sửa');
    assert.match(await page.locator('#prompts').inputValue(), /CẢNH 2:\nKết thúc đã sửa/);
    await page.locator('#museAddScene').click();
    await page.locator('#museSceneList textarea').nth(2).fill('Cảnh mới thêm');
    assert.equal(await page.locator('#count').textContent(), '3 prompt');
    console.log('PASS Muse: tách cảnh, chỉnh từng prompt, thêm cảnh và cập nhật số lượng.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
