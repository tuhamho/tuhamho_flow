"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { _electron: electron } = require("playwright");

(async () => {
  const root = path.resolve(__dirname, "..");
  const app = await electron.launch({ args: [path.join(root, "muse-app", "main.js")] });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    assert.equal(await page.title(), "Muse AI Studio");
    assert.equal(await page.locator("#password").getAttribute("type"), "password");
    await page.locator("#promptSource").fill("CẢNH 1:\nCảnh đầu\n\nCẢNH 2:\nCảnh sau");
    assert.equal(await page.locator(".scene").count(), 2);
    assert.equal(await page.locator("#sceneCount").innerText(), "2 cảnh");
    assert.equal(await page.locator("#timeout").inputValue(), "30");
    assert.equal(await page.locator("#stop").isDisabled(), true);
  } finally { await app.close(); }
  process.stdout.write("PASS Muse desktop: app opens, keeps password masked, parses scenes, and defaults to a 30-minute timeout.\n");
})().catch(error => { console.error(error); process.exitCode = 1; });
