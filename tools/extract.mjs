#!/usr/bin/env node
// 테스트 영상에서 포즈 랜드마크를 뽑아 test/fixtures/<이름>.<모델>.json 으로 저장한다.
// 앱과 똑같은 MediaPipe 파일을 헤드리스 크롬에서 돌리므로 결과가 실제 앱 입력과 같다.
//   node tools/extract.mjs [--fps 15] [--model lite|full|both] [--force] [이름...]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { createServer } from './serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VIDEO_DIR = process.env.VIDEO_DIR || 'test/videos';
const VIDEOS = path.join(ROOT, VIDEO_DIR);
const OUT = path.join(ROOT, 'test/fixtures');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  if (i < 0) return def;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const fps = Number(opt('--fps', 15));
const modelArg = opt('--model', 'lite');
const maxSec = Number(opt('--max-sec', Infinity));
const force = argv.includes('--force');
const names = argv.filter((a) => !a.startsWith('--'));
const models = modelArg === 'both' ? ['lite', 'full'] : [modelArg];

fs.mkdirSync(OUT, { recursive: true });
const files = fs.readdirSync(VIDEOS)
  .filter((f) => /\.(mp4|webm)$/i.test(f))
  .filter((f) => !names.length || names.includes(f.replace(/\.\w+$/, '')));

const server = createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 0,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('[page error]', e.message));
  await page.goto(`${base}/tools/extract.html`);
  await page.waitForFunction('window.ready === true', { timeout: 60000 });

  for (const file of files) {
    const name = file.replace(/\.\w+$/, '');
    for (const model of models) {
      const out = path.join(OUT, `${name}.${model}.json`);
      if (!force && fs.existsSync(out)) {
        console.log(`건너뜀 ${name}.${model} (이미 있음)`);
        continue;
      }
      const res = await page.evaluate((u, f, m, s) => window.extract(u, f, m, s),
        `/${VIDEO_DIR}/${encodeURIComponent(file)}`, fps, model, Number.isFinite(maxSec) ? maxSec : 1e9);
      const detected = res.frames.filter((fr) => fr.lm).length;
      fs.writeFileSync(out, JSON.stringify({ name, ...res }));
      console.log(`${name}.${model}: ${res.frames.length}프레임 (사람 인식 ${detected}), ${res.duration.toFixed(1)}초 영상, 처리 ${(res.ms / 1000).toFixed(1)}초`);
    }
  }
} finally {
  await browser.close();
  server.close();
}
