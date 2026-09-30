// 앱 화면 캡처 (서버가 8860에서 켜져 있어야 함): node tools/screenshots.mjs <저장폴더>
import puppeteer from 'puppeteer-core';
const S = process.argv[2];
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
await page.goto('http://localhost:8860/?video=/test/videos_web/squat_mensgarage.mp4', { waitUntil: 'networkidle0' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle0' });
await page.screenshot({ path: `${S}/shot_1_home.png` });
await page.click('#btn-dev-video');
await page.waitForFunction(() => document.getElementById('wo-count').textContent.trim() === '4', { timeout: 60000 });
await page.screenshot({ path: `${S}/shot_2_counting.png` });
await page.waitForFunction(() => !document.getElementById('screen-summary').hidden, { timeout: 60000 });
await page.screenshot({ path: `${S}/shot_3_summary.png` });
await page.evaluate(() => localStorage.clear());
await browser.close();
console.log('ok');
