// Nạp MV3 thật vào Chromium riêng; trang Flow được route thành fixture cục bộ.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '..');
let context;
(async () => {
  context = await chromium.launchPersistentContext('', {
    executablePath: process.env.CHROMIUM_PATH || path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe'),
    headless: true,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
  });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.protocol === 'chrome-extension:') return route.continue();
    if (url.origin !== 'https://flow.google.com') return route.abort();
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><main><form><textarea aria-label="Prompt"></textarea><button type="button" aria-label="Generate" disabled>Generate</button></form><section id="results"></section></main>' });
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const flow = await context.newPage(); await flow.goto('https://flow.google.com/project/fixture');
  await flow.evaluate(() => {
    globalThis.clicks = 0; globalThis.generateVideo = false;
    const button = document.querySelector('button');
    document.querySelector('textarea').addEventListener('input', () => { button.disabled = false; });
    button.addEventListener('click', () => {
      clicks++;
      if (generateVideo) {
        const anchor = document.createElement('a'); anchor.download = 'clip.mp4';
        anchor.href = 'data:video/mp4;base64,AAAA'; anchor.textContent = 'Tải MP4';
        document.querySelector('#results').append(anchor);
        return;
      }
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = 'teal'; ctx.fillRect(0, 0, 512, 512);
      const image = document.createElement('img'); image.src = canvas.toDataURL(); image.width = 300;
      document.querySelector('#results').append(image);
    });
  });
  const panel = await context.newPage(); await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await panel.waitForFunction(() => document.querySelector('#connection').textContent.includes('đã nhận diện'), null, { timeout: 10000 });
  const second = await context.newPage(); await second.goto(`chrome-extension://${id}/sidepanel.html`);
  await second.waitForFunction(() => !document.querySelector('#start').disabled && document.querySelector('#flowTab').value);
  await second.locator('#prompts').fill('Không được gửi khi panel khác chạy');
  await panel.locator('#prompts').fill('Một bức tranh kiểm thử cục bộ');
  await panel.locator('#start').click();
  await Promise.race([
    flow.waitForFunction(() => clicks === 1),
    panel.waitForFunction(() => !document.querySelector('#error').hidden).then(async () => {
      throw new Error(await panel.locator('#error').textContent());
    })
  ]);
  await second.locator('#start').click();
  await second.waitForFunction(() => document.querySelector('#error').textContent.includes('panel khác'));
  await panel.waitForFunction(() => document.querySelector('#progress').textContent === '1 / 1 hoàn thành', null, { timeout: 15000 });
  assert.equal(await flow.evaluate(() => clicks), 1);
  await flow.evaluate(() => { generateVideo = true; });
  await panel.locator('#mediaType').selectOption('video');
  await panel.locator('#prompts').fill('Video thử nghiệm cục bộ');
  await panel.locator('#start').click();
  await panel.waitForFunction(() => document.querySelector('#progress').textContent === '1 / 1 hoàn thành', null, { timeout: 15000 });
  assert.equal(await flow.evaluate(() => clicks), 2);
  assert.equal(await panel.evaluate(async () => typeof (await chrome.storage.local.get('settings')).settings.prompts), 'string');
  const manifest = await panel.evaluate(() => chrome.runtime.getManifest());
  assert.deepEqual(manifest.permissions, ['sidePanel', 'storage', 'downloads']);
  assert.deepEqual(manifest.host_permissions, ['https://labs.google/*', 'https://flow.google.com/*', 'https://chatgpt.com/*']);
  console.log('PASS Manifest MV3 nạp thật; content script và sender hoạt động với quyền tối thiểu.');
  console.log('PASS Khóa hai panel thật; chỉ một lần bấm tạo.');
  console.log('PASS Canvas PNG → chrome.downloads thật → complete; storage.local thật.');
  console.log('PASS Video MP4 mô phỏng → chrome.downloads thật → complete.');
  console.log('Trang Flow được mô phỏng và chặn mạng, không kiểm thử trên tài khoản Google.');
})().catch(async error => {
  console.error(error);
  for (const page of context?.pages() || []) {
    if (page.url().startsWith('chrome-extension:')) console.error(await page.locator('#error').textContent().catch(() => 'Không đọc được lỗi panel.'));
  }
  process.exitCode = 1;
}).finally(async () => { await context?.close(); });
