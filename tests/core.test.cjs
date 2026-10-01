const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
require('../shared.js');
const U = globalThis.FlowUtils;

test('URL chỉ nhận Flow trên origin Google Labs chính xác', () => {
  for (const url of ['https://labs.google/fx/tools/flow', 'https://labs.google/fx/vi/tools/flow/project/123?x=1', 'https://flow.google.com/project/da51d929-6be3-46db-90ca-dd91e6cea8dd']) assert.equal(U.isFlowUrl(url), true);
  for (const url of ['https://labs.google.evil.test/fx/tools/flow', 'http://labs.google/fx/tools/flow', 'https://labs.google/fx/tools/flow-other', 'https://labs.google/fx/tools/whisk', 'https://flow.google.com/', 'https://flow.google.com/projects', 'https://flow.google.com.evil.test/project/abc', 'file:///flow', 'bad']) assert.equal(U.isFlowUrl(url), false);
});
test('Chỉ URL HTTPS của hạ tầng media Google được tải trực tiếp', () => {
  for (const url of ['https://lh3.googleusercontent.com/image', 'https://storage.googleapis.com/video.mp4',
    'https://aisandbox-pa.googleapis.com/v1/media/image',
    'https://redirector.googlevideo.com/videoplayback', 'https://flow.google.com/file.png']) assert.equal(U.isFlowMediaUrl(url), true);
  for (const url of ['http://lh3.googleusercontent.com/image', 'https://googleusercontent.com.evil.test/image',
    'https://accounts.google.com/login', 'https://googleapis.com.evil.test/file',
    'https://evil.test/video.mp4', 'https://user:password@storage.googleapis.com/video.mp4',
    'javascript:alert(1)', 'bad']) assert.equal(U.isFlowMediaUrl(url), false);
});
test('ChatGPT chỉ nhận origin chính xác và URL ảnh của OpenAI', () => {
  assert.equal(U.isChatGPTUrl('https://chatgpt.com/c/123'), true);
  for (const url of ['https://chatgpt.com.evil.test/', 'https://chat.openai.com/', 'http://chatgpt.com/']) assert.equal(U.isChatGPTUrl(url), false);
  for (const url of ['https://chatgpt.com/backend-api/estuary/content?id=1', 'https://files.oaiusercontent.com/file.png', 'blob:https://chatgpt.com/id']) assert.equal(U.isChatGPTMediaUrl(url), true);
  for (const url of ['https://evil.test/file.png', 'https://openai.com.evil.test/file', 'https://accounts.google.com/']) assert.equal(U.isChatGPTMediaUrl(url), false);
  assert.equal(U.validate({ ...U.defaults, provider: 'chatgpt', mediaType: 'image', prompts: 'ảnh' }).provider, 'chatgpt');
  assert.throws(() => U.validate({ ...U.defaults, provider: 'chatgpt', mediaType: 'video', prompts: 'video' }));
});
test('Tên tệp chặn traversal, ký tự điều khiển và tên thiết bị Windows', () => {
  for (const folder of ['../outside', '..\\..\\outside', 'C:\\Users\\test', '/', '.', 'CON', 'aux.png', 'COM1', 'lpt²', 'a\u0000b', 'x\u202ey', 'abc. ']) {
    const result = U.filename({ folder, serial: true }, 0, 'batch');
    assert.equal(result.split('/').length, 2);
    assert.ok(!/[\\<>:"|?*\u0000-\u001f\u202e]/.test(result));
    assert.ok(!result.split('/').some(part => /^\.+$/.test(part) || /[. ]$/.test(part)));
    assert.ok(result.endsWith('/001_tuhamho.png'));
  }
  assert.equal(U.safeSegment('CON'), '_CON');
  assert.equal(U.safeSegment(''), 'Flow');
  assert.ok(!U.filename({ folder: 'Flow', serial: false }, 0, 'batch').includes('001_'));
  assert.match(U.filename({ folder: 'Flow', serial: true }, 0, 'batch', 'mp4'), /\/001_tuhamho\.mp4$/);
  assert.match(U.filename({ folder: 'Flow', filenameBase: 'My: File', serial: true }, 1, 'batch'), /\/002_My- File\.png$/);
  assert.equal(U.filename({ folder: 'Downloads', filenameBase: 'tuhamho', serial: true }, 35, 'batch', 'png', 'Nhà khảo cổ và điều chưa biết'),
    'Downloads/036_Nhà khảo cổ và điều chưa biết_tuhamho.png');
  assert.equal(U.imageTitle('[00:01] Hand-drawn 2D doodle cartoon animation, flat solid colors, bold black hand-drawn outlines, slightly wobbly imperfect marker lines, a cave archaeologist, lantern and fossils, no text'),
    'cave archaeologist');
  assert.equal(U.imageTitle('prompt', 'Ảnh được tạo 1'), 'prompt');
});
test('Đọc dòng UTF-8 BOM/CRLF/CR, giữ văn bản HTML nguyên dạng dữ liệu', () => {
  assert.deepEqual(U.parsePrompts('\uFEFF a\r\n \n b\rc\n<img onerror=x>'), ['a', 'b', 'c', '<img onerror=x>']);
});
test('Giới hạn đầu vào và khoảng chờ', () => {
  const valid = { ...U.defaults, prompts: 'one\ntwo' };
  assert.equal(U.validate(valid).prompts.length, 2);
  assert.equal(U.validate({ ...valid, startFrom: '2' }).startFrom, 2);
  assert.equal(U.validate({ ...valid, startFrom: '' }).startFrom, null);
  for (const change of [{ prompts: '' }, { prompts: 'x'.repeat(10001) }, { prompts: 'x\n'.repeat(501) }, { startFrom: '0' }, { startFrom: '3' }, { startFrom: '1.5' }, { startFrom: 'abc' }, { delayMin: -1 }, { delayMin: 10, delayMax: 5 }, { delayMax: Infinity }, { timeout: 29 }, { timeout: 901 }, { mediaType: 'audio' }]) {
    assert.throws(() => U.validate({ ...valid, ...change }));
  }
});
test('Manifest chỉ có ba quyền, host tối thiểu Flow/ChatGPT, tài nguyên đều cục bộ', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['sidePanel', 'storage', 'downloads']);
  assert.deepEqual(manifest.host_permissions, ['https://labs.google/*', 'https://flow.google.com/*', 'https://chatgpt.com/*']);
  for (const script of [manifest.background.service_worker, ...manifest.content_scripts.flatMap(entry => entry.js), 'shared.js', 'sidepanel.js']) {
    const source = fs.readFileSync(path.join(root, script), 'utf8');
    assert.ok(!/\b(?:eval|XMLHttpRequest|WebSocket)\s*\(|new\s+Function\s*\(|chrome\.(?:cookies|history|debugger|webRequest)\b|innerHTML\s*=|console\./.test(source), script);
  }
  const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
  assert.match(content, /credentials: "omit", redirect: "error"/);
  assert.match(content, /if \(!localBlob && !localData && !sameOrigin\)/);
  assert.match(content, /mediaDownloadUrl\(source\(image\)\)/);
});
function event() {
  const callbacks = [];
  return { callbacks, addListener(fn) { callbacks.push(fn); }, removeListener(fn) { const i = callbacks.indexOf(fn); if (i >= 0) callbacks.splice(i, 1); }, emit(...args) { callbacks.forEach(fn => fn(...args)); } };
}
test('Worker chỉ nhận điều khiển hàng đợi từ panel extension', async () => {
  const onMessage = event();
  const context = { FlowUtils: {}, importScripts() {}, chrome: {
    runtime: { id: 'test', getURL: file => `chrome-extension://test/${file}`, onMessage, onInstalled: event(), sendMessage: async () => {} },
    sidePanel: { setPanelBehavior: async () => {} },
    storage: { local: { setAccessLevel: async () => {}, get: async () => ({ queueState: null }), set: async () => {} } }
  } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), context);
  let hostileResponse = false;
  onMessage.emit({ type: 'GET_QUEUE_STATUS' }, { id: 'test', url: 'https://example.test/' }, () => { hostileResponse = true; });
  assert.equal(hostileResponse, false);
  const status = await new Promise(resolve => onMessage.emit({ type: 'GET_QUEUE_STATUS' },
    { id: 'test', url: 'chrome-extension://test/sidepanel.html' }, resolve));
  assert.equal(status.ok, true); assert.equal(status.running, false); assert.equal(status.state, null);
  assert.equal(context.downloadedNameMatches('C:\\Downloads\\tuhamho_flow\\052_scene_tuhamho.png', 'tuhamho_flow/052_scene_tuhamho.png'), true);
  assert.equal(context.downloadedNameMatches('C:\\Downloads\\tuhamho_flow\\051_scene_tuhamho.png', 'tuhamho_flow/052_scene_tuhamho.png'), false);
});
test('Worker starts at a selected prompt and downloads the rest without a sidepanel connection', async () => {
  const onMessage = event(), downloadChanged = event();
  const stored = {};
  const promptsSent = [], downloads = [];
  const createPort = () => {
    const onMessage = event(), onDisconnect = event();
    return { name: 'flow-batch-work', onMessage, onDisconnect,
      postMessage(message) {
        if (message.type === 'RUN') {
          promptsSent.push(message.prompt);
          queueMicrotask(() => onMessage.emit({ type: 'RESULT', id: message.id, ok: true,
            dataUrl: 'data:image/png;base64,AAAA', extension: 'png' }));
        }
      }, disconnect() { onDisconnect.emit(); } };
  };
  const context = { FlowUtils: U, importScripts() {}, crypto: require('node:crypto').webcrypto, AbortController,
    setTimeout, clearTimeout, setInterval, clearInterval, chrome: {
    runtime: { id: 'test', getURL: file => `chrome-extension://test/${file}`, onMessage, onInstalled: event(), sendMessage: async () => {} },
    sidePanel: { setPanelBehavior: async () => {} },
    storage: { local: { setAccessLevel: async () => {}, get: async () => ({ queueState: stored.queueState }), set: async value => Object.assign(stored, value) } },
    tabs: { get: async () => ({ url: 'https://flow.google.com/project/test' }), sendMessage: async () => ({ ok: true }), connect: createPort },
    downloads: { onChanged: downloadChanged, download: async options => { downloads.push(options); return downloads.length; },
      search: async ({ id }) => { const item = downloads[id - 1]; return [{ id, state: 'complete', url: item?.url,
        filename: `C:\\Downloads\\${item?.filename.replace(/\//g, '\\')}`, fileSize: 4, mime: 'image/png', finalUrl: item?.url }]; }, cancel: async () => {} }
  } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), context);
  const config = { ...U.defaults, prompts: 'bỏ qua\ngiữa\ncuối', startFrom: '2', delayMin: '0', delayMax: '0' };
  const started = await new Promise(resolve => onMessage.emit({ type: 'START_QUEUE', config, tabId: 7 },
    { id: 'test', url: 'chrome-extension://test/sidepanel.html' }, resolve));
  assert.equal(started.ok, true);
  for (let i = 0; i < 50 && stored.queueState?.items?.filter(item => item.status === 'done').length !== 2; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(promptsSent, ['giữa', 'cuối']);
  assert.equal(downloads.length, 2);
  assert.deepEqual(stored.queueState.items.map(item => item.status), ['skipped', 'done', 'done']);
});
test('Worker stops before downloading a repeated ChatGPT image URL', async () => {
  const onMessage = event(), downloadChanged = event(), stored = {}, promptsSent = [], seenByPrompt = [], downloads = [];
  const createPort = () => {
    const onMessage = event(), onDisconnect = event();
    return { onMessage, onDisconnect, postMessage(message) {
      if (message.type === 'RUN') {
        promptsSent.push(message.prompt);
        seenByPrompt.push(message.seenImageUrls || []);
        queueMicrotask(() => onMessage.emit({ type: 'RESULT', id: message.id, ok: true,
          downloadUrl: 'https://chatgpt.com/backend-api/estuary/content?id=same-image', extension: 'png' }));
      }
    }, disconnect() { onDisconnect.emit(); } };
  };
  const context = { FlowUtils: U, importScripts() {}, crypto: require('node:crypto').webcrypto, AbortController,
    setTimeout, clearTimeout, setInterval, clearInterval, chrome: {
      runtime: { id: 'test', getURL: file => `chrome-extension://test/${file}`, onMessage, onInstalled: event(), sendMessage: async () => {} },
      sidePanel: { setPanelBehavior: async () => {} },
      storage: { local: { setAccessLevel: async () => {}, get: async () => ({ queueState: stored.queueState }), set: async value => Object.assign(stored, value) } },
      tabs: { get: async () => ({ url: 'https://chatgpt.com/c/test' }), sendMessage: async () => ({ ok: true }), connect: createPort },
      downloads: { onChanged: downloadChanged, download: async options => { downloads.push(options); return downloads.length; },
        search: async ({ id }) => { const item = downloads[id - 1]; return [{ id, state: 'complete', url: item?.url,
          filename: `C:\\Downloads\\${item?.filename.replace(/\//g, '\\')}`, fileSize: 4, mime: 'image/png', finalUrl: item?.url }]; }, cancel: async () => {} }
    } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), context);
  const config = { ...U.defaults, provider: 'chatgpt', mediaType: 'image', prompts: 'first\nsecond', delayMin: '0', delayMax: '0' };
  const started = await new Promise(resolve => onMessage.emit({ type: 'START_QUEUE', config, tabId: 7 },
    { id: 'test', url: 'chrome-extension://test/sidepanel.html' }, resolve));
  assert.equal(started.ok, true);
  for (let i = 0; i < 50 && stored.queueState?.items?.[1]?.status !== 'error'; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(promptsSent, ['first', 'second']);
  assert.equal(JSON.stringify(seenByPrompt), JSON.stringify([[], ['https://chatgpt.com/backend-api/estuary/content?id=same-image']]));
  assert.equal(downloads.length, 1);
  assert.deepEqual(stored.queueState.items.map(item => item.status), ['done', 'error']);
  assert.match(stored.queueState.items[1].detail, /cùng một URL ảnh/);
});
