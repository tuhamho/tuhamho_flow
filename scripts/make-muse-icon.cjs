"use strict";
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const png = fs.readFileSync(path.join(root, "icons", "icon256.png"));
if (png.toString("hex", 0, 8) !== "89504e470d0a1a0a" || png.readUInt32BE(16) !== 256 || png.readUInt32BE(20) !== 256) {
  throw new Error("Expected the provided 256x256 PNG app icon.");
}
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
header.writeUInt8(0, 6); header.writeUInt8(0, 7); header.writeUInt8(0, 8); header.writeUInt8(0, 9);
header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12); header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
fs.writeFileSync(path.join(root, "icons", "muse-app.ico"), Buffer.concat([header, png]));
