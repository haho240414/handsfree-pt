#!/usr/bin/env node
// 앱 아이콘 PNG 생성 (헤드리스 크롬으로 SVG를 그려 저장)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const svg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#0e1116"/>
  <circle cx="256" cy="256" r="150" fill="none" stroke="#2a313d" stroke-width="34"/>
  <circle cx="256" cy="256" r="150" fill="none" stroke="#c8f53c" stroke-width="34" stroke-linecap="round"
    stroke-dasharray="${2 * Math.PI * 150 * 0.78} ${2 * Math.PI * 150}" transform="rotate(-90 256 256)"/>
  <text x="256" y="300" text-anchor="middle" font-family="-apple-system, Helvetica, Arial, sans-serif" font-weight="900" font-size="132" fill="#ffffff" letter-spacing="-4">PT</text>
</svg>`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
for (const [name, size] of [['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180]]) {
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0;background:#0e1116">${svg(size)}</body></html>`);
  await page.screenshot({ path: path.join(ROOT, 'app/icons', name), clip: { x: 0, y: 0, width: size, height: size } });
  console.log('저장', name);
}
await browser.close();
