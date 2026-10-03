// 오프라인 동작용 서비스 워커: 앱 화면은 최신 우선(네트워크 → 실패 시 캐시),
// 용량 큰 AI 모델·엔진 파일은 캐시 우선(한 번 받으면 다시 안 받음).
const VERSION = 'hfpt-v17';
const SHELL = [
  './', './index.html', './css/app.css', './css/redesign.css', './fonts/PretendardVariable.woff2', './manifest.webmanifest',
  './js/main.js', './js/workout.js', './js/history.js', './js/format.js', './js/store.js', './js/voice.js', './js/pose.js',
  './js/tilt.js', './js/diag.js', './js/native.js', './js/camera.js', './js/framing.js', './js/session-edit.js', './js/session-clock.js', './js/icons.js', './js/routine.js', './js/stats.js', './js/health.js', './privacy.html', './js/demo.js', './data/demos.json',
  './js/engine/features.js', './js/engine/filters.js', './js/engine/counter.js', './js/engine/exercises.js', './js/engine/tracker.js',
  './js/engine/tempo.js',
  './icons/ui/arrow-left.svg',
  './icons/ui/arrow-right.svg',
  './icons/ui/arrows-clockwise.svg',
  './icons/ui/barbell.svg',
  './icons/ui/camera-rotate.svg',
  './icons/ui/camera.svg',
  './icons/ui/caret-right.svg',
  './icons/ui/chart-bar.svg',
  './icons/ui/check.svg',
  './icons/ui/gear.svg',
  './icons/ui/house.svg',
  './icons/ui/list-bullets.svg',
  './icons/ui/minus.svg',
  './icons/ui/pause.svg',
  './icons/ui/pencil-simple.svg',
  './icons/ui/person-simple.svg',
  './icons/ui/play.svg',
  './icons/ui/plus.svg',
  './icons/ui/speaker-high.svg',
  './icons/ui/speaker-slash.svg',
  './icons/ui/trash.svg',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'hfpt-vendor').map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/vendor/')) {
    e.respondWith(caches.open('hfpt-vendor').then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
    return;
  }
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) caches.open(VERSION).then((c) => c.put(e.request, res.clone()));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
